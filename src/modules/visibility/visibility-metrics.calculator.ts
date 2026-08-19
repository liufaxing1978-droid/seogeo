import type {
  CalculatedVisibilityMetricRow,
  VisibilityMetricActor,
  VisibilityMetricEvidenceStatus,
  VisibilityMetricInputRecord,
  VisibilityMetricStatus,
  VisibilityMetricType
} from './visibility-metrics.types.js';

type EvidenceField = 'mentionStatus' | 'citationStatus';

type Dimension = {
  dimensionType: CalculatedVisibilityMetricRow['dimensionType'];
  dimensionKey: string;
  dimensionLabelSnapshot: string | null;
  records: VisibilityMetricInputRecord[];
};

type Coverage = {
  candidateObservationCount: number;
  eligibleObservationCount: number;
  notEligibleObservationCount: number;
  unknownObservationCount: number;
};

function uniqueByObservation(records: VisibilityMetricInputRecord[]) {
  const unique = new Map<string, VisibilityMetricInputRecord>();
  for (const record of records) {
    if (!unique.has(record.observationId)) unique.set(record.observationId, record);
  }
  return [...unique.values()].sort((a, b) => a.observationId.localeCompare(b.observationId));
}

function uniqueActors(actors: VisibilityMetricActor[]) {
  const unique = new Map<string, VisibilityMetricActor>();
  for (const actor of actors) {
    if (!unique.has(actor.actorKey)) unique.set(actor.actorKey, actor);
  }
  return [...unique.values()].sort((a, b) => a.actorKey.localeCompare(b.actorKey));
}

function dimensions(records: VisibilityMetricInputRecord[]): Dimension[] {
  const result: Dimension[] = [{
    dimensionType: 'OVERALL',
    dimensionKey: 'OVERALL',
    dimensionLabelSnapshot: null,
    records
  }];

  const providers = [...new Set(records.map((record) => record.provider))].sort();
  for (const provider of providers) {
    result.push({
      dimensionType: 'PROVIDER',
      dimensionKey: provider,
      dimensionLabelSnapshot: provider,
      records: records.filter((record) => record.provider === provider)
    });
  }

  const promptSetIds = [...new Set(records.map((record) => record.promptSetId))].sort();
  for (const promptSetId of promptSetIds) {
    const matching = records.filter((record) => record.promptSetId === promptSetId);
    const labels = [...new Set(matching.map((record) => record.promptSetName))].sort();
    result.push({
      dimensionType: 'PROMPT_SET',
      dimensionKey: promptSetId,
      dimensionLabelSnapshot: labels[0] ?? promptSetId,
      records: matching
    });
  }

  return result;
}

function coverage(records: VisibilityMetricInputRecord[], field: EvidenceField): Coverage {
  let eligibleObservationCount = 0;
  let notEligibleObservationCount = 0;
  let unknownObservationCount = 0;

  for (const record of records) {
    const status = record[field];
    if (status === 'EXTRACTED' || status === 'KNOWN_EMPTY') eligibleObservationCount += 1;
    else if (status === 'NOT_ELIGIBLE') notEligibleObservationCount += 1;
    else unknownObservationCount += 1;
  }

  return {
    candidateObservationCount: records.length,
    eligibleObservationCount,
    notEligibleObservationCount,
    unknownObservationCount
  };
}

function rateStatus(summary: Coverage): VisibilityMetricStatus {
  if (summary.candidateObservationCount === 0) return 'NO_DATA';
  if (summary.unknownObservationCount > 0) return 'UNKNOWN';
  if (summary.eligibleObservationCount > 0) return 'CALCULATED';
  if (summary.notEligibleObservationCount === summary.candidateObservationCount) {
    return 'NOT_ELIGIBLE';
  }
  return 'UNKNOWN';
}

function isActorPresent(
  record: VisibilityMetricInputRecord,
  actor: VisibilityMetricActor,
  metricType: 'MENTION_RATE' | 'CITATION_RATE'
) {
  if (actor.actorType === 'OWNED_ROLLUP') {
    return metricType === 'MENTION_RATE' ? record.ownedMentioned : record.ownedCited;
  }
  if (!actor.actorSubjectId) return false;
  const subjects = metricType === 'MENTION_RATE'
    ? record.competitorMentionedSubjectIds
    : record.competitorCitedSubjectIds;
  return new Set(subjects).has(actor.actorSubjectId);
}

function baseRow(
  dimension: Dimension,
  actor: VisibilityMetricActor,
  metricType: VisibilityMetricType,
  metricStatus: VisibilityMetricStatus,
  summary: Coverage,
  numerator: number,
  denominator: number
): CalculatedVisibilityMetricRow {
  return {
    metricType,
    metricStatus,
    dimensionType: dimension.dimensionType,
    dimensionKey: dimension.dimensionKey,
    dimensionLabelSnapshot: dimension.dimensionLabelSnapshot,
    actorType: actor.actorType,
    actorSubjectId: actor.actorSubjectId,
    actorKey: actor.actorKey,
    numerator,
    denominator,
    ...summary
  };
}

function calculateRate(
  dimension: Dimension,
  actors: VisibilityMetricActor[],
  metricType: 'MENTION_RATE' | 'CITATION_RATE',
  evidenceField: EvidenceField
) {
  const summary = coverage(dimension.records, evidenceField);
  const metricStatus = rateStatus(summary);
  const denominator = summary.eligibleObservationCount;

  return actors.map((actor) => {
    const numerator = dimension.records.filter((record) =>
      record[evidenceField] === 'EXTRACTED' && isActorPresent(record, actor, metricType)
    ).length;
    return baseRow(
      dimension,
      actor,
      metricType,
      metricStatus,
      summary,
      numerator,
      denominator
    );
  });
}

function calculateMentionSov(dimension: Dimension, actors: VisibilityMetricActor[]) {
  const summary = coverage(dimension.records, 'mentionStatus');
  const numerators = new Map(actors.map((actor) => [actor.actorKey, 0]));
  const ownedActor = actors.find((actor) => actor.actorType === 'OWNED_ROLLUP');
  const competitorsBySubject = new Map(
    actors
      .filter((actor) => actor.actorType === 'COMPETITOR' && actor.actorSubjectId)
      .map((actor) => [actor.actorSubjectId!, actor])
  );

  for (const record of dimension.records) {
    if (record.mentionStatus !== 'EXTRACTED') continue;

    if (ownedActor && record.ownedMentioned) {
      numerators.set(ownedActor.actorKey, (numerators.get(ownedActor.actorKey) ?? 0) + 1);
    }

    for (const subjectId of new Set(record.competitorMentionedSubjectIds)) {
      const actor = competitorsBySubject.get(subjectId);
      if (!actor) continue;
      numerators.set(actor.actorKey, (numerators.get(actor.actorKey) ?? 0) + 1);
    }
  }

  const denominator = [...numerators.values()].reduce((sum, value) => sum + value, 0);
  let metricStatus: VisibilityMetricStatus;
  if (summary.candidateObservationCount === 0) metricStatus = 'NO_DATA';
  else if (summary.unknownObservationCount > 0) metricStatus = 'UNKNOWN';
  else if (summary.eligibleObservationCount === 0) metricStatus = 'NOT_ELIGIBLE';
  else if (denominator === 0) metricStatus = 'NO_SIGNAL';
  else metricStatus = 'CALCULATED';

  return actors.map((actor) => baseRow(
    dimension,
    actor,
    'MENTION_SHARE_OF_VOICE',
    metricStatus,
    summary,
    numerators.get(actor.actorKey) ?? 0,
    denominator
  ));
}

export function calculateVisibilityMetrics(input: {
  records: VisibilityMetricInputRecord[];
  actors: VisibilityMetricActor[];
}): CalculatedVisibilityMetricRow[] {
  const records = uniqueByObservation(input.records);
  const actors = uniqueActors(input.actors);
  const rows: CalculatedVisibilityMetricRow[] = [];

  for (const dimension of dimensions(records)) {
    rows.push(...calculateRate(dimension, actors, 'MENTION_RATE', 'mentionStatus'));
    rows.push(...calculateRate(dimension, actors, 'CITATION_RATE', 'citationStatus'));
    rows.push(...calculateMentionSov(dimension, actors));
  }

  return rows;
}
