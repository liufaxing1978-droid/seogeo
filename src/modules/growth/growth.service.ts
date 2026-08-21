import type {
  GrowthComponentState,
  GrowthLifecycleStatus,
  GrowthOpportunityType
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { detectKeywordCannibalization } from './cannibalization.js';
import { buildProjectCtrCurve } from './ctr-curve.js';
import {
  dedupeGrowthEvidence,
  GROWTH_EVIDENCE_VERSION,
  loadGrowthEvidence,
  type GrowthEvidence
} from './growth-evidence.js';
import { detectNormalOpportunityTypes, selectPrimaryType } from './growth-detectors.js';
import { emitGrowthEvent } from './growth.observability.js';
import { growthRepository } from './growth.repository.js';
import {
  calculateGrowthScore,
  scoreCtrGap,
  scoreDemand,
  scoreGscTrend,
  scoreP6Visibility,
  scorePositionPotential,
  scoreSiteGap,
  unknown,
  type GrowthComponent,
  type P6VisibilitySignal
} from './growth-score.js';
import {
  aggregateQueryPageFacts,
  assessStableWindowCoverage,
  resolveStableWindows
} from './gsc-window.js';
import { detectNewContentOpportunity } from './new-content.js';
import {
  GROWTH_TOPIC_IDENTITY_VERSION,
  GROWTH_TOPIC_SNAPSHOT_VERSION,
  resolveTopicAssignment,
  scoreTopicCluster
} from './topic-cluster.js';
import type { ProjectCtrCurveV1, QueryPageAggregate } from './growth.types.js';

export const GROWTH_OPPORTUNITY_SNAPSHOT_VERSION = 'GROWTH_OPPORTUNITY_V1' as const;
export const GROWTH_MATERIALIZATION_VERSION = 'GROWTH_MATERIALIZATION_V1' as const;
export const GROWTH_MAX_CANDIDATES = 1_000;
export const GROWTH_MAX_TOPIC_MEMBERS = 500;

export type GrowthMaterializationDeps = {
  googleSearch?: (...args: unknown[]) => unknown;
  p6Provider?: (...args: unknown[]) => unknown;
  deepSeek?: (...args: unknown[]) => unknown;
};

export type GrowthLifecycleSnapshotState = {
  id?: string | null;
  actionable: boolean;
};

export type GrowthMaterializationResult = {
  state: 'COMPLETED' | 'INELIGIBLE';
  selectedGscSnapshotIds: string[];
  opportunitySnapshotCount: number;
  topicSnapshotCount: number;
  missingDates: string[];
};

type P3TopicBinding = {
  entityId: string;
  canonicalName: string;
  normalizedName: string;
};

function atUtcStart(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function aggregateKey(row: Pick<QueryPageAggregate, 'normalizedQuery' | 'canonicalPage'>): string {
  return JSON.stringify([row.normalizedQuery, row.canonicalPage]);
}

function ctrBucket(position: number | null): keyof ProjectCtrCurveV1['buckets'] | null {
  if (position === null || !Number.isFinite(position) || position <= 0) return null;
  if (position < 2) return '1';
  if (position < 3) return '2';
  if (position < 4) return '3';
  if (position < 6) return '4-5';
  if (position < 11) return '6-10';
  if (position < 21) return '11-20';
  if (position < 31) return '21-30';
  if (position < 51) return '31-50';
  return '>50';
}

function expectedCtr(curve: ProjectCtrCurveV1, position: number | null): number | null {
  const bucket = ctrBucket(position);
  if (!bucket) return null;
  const row = curve.buckets[bucket];
  return row.state === 'KNOWN' ? row.expectedCtr : null;
}

function demandPercentiles(rows: readonly QueryPageAggregate[]): Map<string, number> {
  const ordered = [...rows].sort((a, b) =>
    b.impressions - a.impressions ||
    a.normalizedQuery.localeCompare(b.normalizedQuery) ||
    a.canonicalPage.localeCompare(b.canonicalPage)
  );
  const out = new Map<string, number>();
  const denominator = Math.max(1, ordered.length);
  ordered.forEach((row, index) => out.set(aggregateKey(row), index / denominator));
  return out;
}

function pageEvidence(allEvidence: readonly GrowthEvidence[], canonicalPage: string): GrowthEvidence[] {
  return allEvidence.filter((row) => row.canonicalPage === null || row.canonicalPage === canonicalPage);
}

function normalizeTopicText(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function p3BindingRank(entityType: string, role: string): number {
  if (entityType === 'TOPIC' && role === 'PRIMARY') return 0;
  if (entityType === 'TOPIC') return 1;
  if (role === 'PRIMARY') return 2;
  return 3;
}

async function loadP3TopicBindings(
  projectId: string,
  canonicalPages: readonly string[]
): Promise<Map<string, P3TopicBinding>> {
  const pages = [...new Set(canonicalPages.map((value) => value.trim()).filter(Boolean))].sort();
  if (pages.length === 0) return new Map();
  const rows = await prisma.pageEntity.findMany({
    where: {
      page: { projectId, normalizedUrl: { in: pages } },
      entity: { projectId, status: 'ACTIVE' }
    },
    select: {
      role: true,
      confidence: true,
      page: { select: { normalizedUrl: true } },
      entity: {
        select: {
          id: true,
          entityType: true,
          canonicalName: true,
          normalizedName: true
        }
      }
    },
    take: GROWTH_MAX_CANDIDATES * 10
  });

  rows.sort((a, b) =>
    a.page.normalizedUrl.localeCompare(b.page.normalizedUrl) ||
    p3BindingRank(a.entity.entityType, a.role) - p3BindingRank(b.entity.entityType, b.role) ||
    b.confidence - a.confidence ||
    a.entity.normalizedName.localeCompare(b.entity.normalizedName) ||
    a.entity.id.localeCompare(b.entity.id)
  );

  const bindings = new Map<string, P3TopicBinding>();
  for (const row of rows) {
    if (p3BindingRank(row.entity.entityType, row.role) >= 3) continue;
    if (bindings.has(row.page.normalizedUrl)) continue;
    bindings.set(row.page.normalizedUrl, {
      entityId: row.entity.id,
      canonicalName: row.entity.canonicalName,
      normalizedName: row.entity.normalizedName
    });
  }
  return bindings;
}

function scoreSiteEvidence(evidence: readonly GrowthEvidence[]): GrowthComponent {
  const rows = dedupeGrowthEvidence(evidence).scoringGroups
    .map((group) => group.representative)
    .filter((row) =>
      row.sourceModule === 'P2_SEO' ||
      row.sourceModule === 'P3_GEO' ||
      row.sourceModule === 'P3_ENTITY' ||
      row.sourceModule === 'P3_CITABILITY' ||
      row.sourceModule === 'P5_CONTENT' ||
      row.sourceModule === 'P5_COMPETITOR'
    )
    .map((row) => ({ state: row.evidenceState, severity: row.severity }));
  return scoreSiteGap(rows);
}

function scorePersistedVisibility(evidence: readonly GrowthEvidence[]): GrowthComponent {
  const signals: P6VisibilitySignal[] = evidence.flatMap((row) => {
    if (
      row.sourceModule !== 'P6_VISIBILITY' ||
      row.sourceType !== 'VISIBILITY_METRIC_DELTA' ||
      row.numericValue === null ||
      !Number.isFinite(row.numericValue)
    ) return [];
    return [{ kind: 'OWNED_DELTA' as const, deltaBasisPoints: row.numericValue }];
  });
  return signals.length > 0 ? scoreP6Visibility(signals) : unknown();
}

function componentState(component: GrowthComponent): GrowthComponentState {
  return component.state;
}

function componentScore(component: GrowthComponent): number | null {
  return component.state === 'KNOWN' ? Math.round(component.score) : null;
}

function opportunityEvidenceRows(evidence: readonly GrowthEvidence[]) {
  return evidence.map((row) => ({
    sourceModule: row.sourceModule,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    sourceFactVersion: row.sourceFactVersion,
    ruleKey: row.ruleKey,
    rootCauseKey: row.rootCauseKey,
    evidenceState: row.evidenceState,
    severity: row.severity,
    numericValue: row.numericValue,
    textSummary: row.textSummary,
    fingerprint: row.fingerprint
  }));
}

function isActionableScore(score: number | null): boolean {
  return score !== null && score >= 25;
}

function lifecycleTimestampPatch(status: GrowthLifecycleStatus, now: Date) {
  if (status === 'RESOLVED') return { resolvedAt: now };
  if (status === 'REOPENED') return { reopenedAt: now, resolvedAt: null };
  return {};
}

export async function reconcileOpportunityLifecycle(
  identityId: string,
  currentSnapshot: GrowthLifecycleSnapshotState,
  history?: readonly GrowthLifecycleSnapshotState[]
) {
  const lifecycle = await prisma.growthOpportunityLifecycle.findUnique({
    where: { opportunityIdentityId: identityId },
    include: { identity: { select: { projectId: true } } }
  });
  if (!lifecycle) throw new Error('Growth opportunity lifecycle not found');

  const effectiveHistory = history ?? (await prisma.growthOpportunitySnapshot.findMany({
    where: { opportunityIdentityId: identityId },
    orderBy: [{ currentWindowEnd: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
    take: 2,
    select: { id: true, score: true }
  })).map((row) => ({
    id: row.id,
    actionable: isActionableScore(row.score)
  }));

  const now = new Date();
  if (currentSnapshot.actionable) {
    if (lifecycle.status === 'DONE' || lifecycle.status === 'RESOLVED') {
      const updated = await growthRepository.updateLifecycle(
        identityId,
        {
          status: 'REOPENED',
          ...(currentSnapshot.id ? { latestSnapshotId: currentSnapshot.id } : {}),
          ...lifecycleTimestampPatch('REOPENED', now)
        },
        {
          eventType: 'AUTO_REOPENED',
          actorType: 'SYSTEM',
          reasonCode: 'GROWTH_OPPORTUNITY_RECURRED'
        }
      );
      emitGrowthEvent('growth.lifecycle.changed', {
        projectId: lifecycle.identity.projectId,
        identityId,
        lifecycleEventType: 'AUTO_REOPENED',
        lifecycleStatus: 'REOPENED',
        reasonCode: 'GROWTH_OPPORTUNITY_RECURRED'
      });
      return updated;
    }

    if (currentSnapshot.id && lifecycle.latestSnapshotId !== currentSnapshot.id) {
      return prisma.growthOpportunityLifecycle.update({
        where: { opportunityIdentityId: identityId },
        data: { latestSnapshotId: currentSnapshot.id }
      });
    }
    return lifecycle;
  }

  const twoConsecutiveNonActionable = effectiveHistory.length >= 2 &&
    effectiveHistory.slice(0, 2).every((row) => !row.actionable);
  if (
    twoConsecutiveNonActionable &&
    lifecycle.status !== 'DISMISSED' &&
    lifecycle.status !== 'RESOLVED'
  ) {
    const updated = await growthRepository.updateLifecycle(
      identityId,
      {
        status: 'RESOLVED',
        ...lifecycleTimestampPatch('RESOLVED', now)
      },
      {
        eventType: 'AUTO_RESOLVED',
        actorType: 'SYSTEM',
        reasonCode: 'GROWTH_OPPORTUNITY_NON_ACTIONABLE_TWO_WINDOWS'
      }
    );
    emitGrowthEvent('growth.lifecycle.changed', {
      projectId: lifecycle.identity.projectId,
      identityId,
      lifecycleEventType: 'AUTO_RESOLVED',
      lifecycleStatus: 'RESOLVED',
      reasonCode: 'GROWTH_OPPORTUNITY_NON_ACTIONABLE_TWO_WINDOWS'
    });
    return updated;
  }

  return lifecycle;
}

type MaterializedMember = {
  snapshotId: string;
  topicClusterId: string;
  normalizedQuery: string;
  canonicalPage: string;
  aggregate: QueryPageAggregate;
  demandScore: number | null;
  score: number | null;
  trendVisibilityScore: number | null;
};

export async function materializeGrowthWindow(
  projectId: string,
  asOfDate: Date,
  _deps: GrowthMaterializationDeps = {}
): Promise<GrowthMaterializationResult> {
  if (!projectId.trim()) throw new Error('projectId is required');
  const windows = resolveStableWindows(asOfDate);
  const windowStart = atUtcStart(windows.previous.start);
  const windowEnd = atUtcStart(windows.current.end);
  const currentStart = atUtcStart(windows.current.start);
  const currentEnd = atUtcStart(windows.current.end);
  const previousStart = atUtcStart(windows.previous.start);
  const previousEnd = atUtcStart(windows.previous.end);

  const property = await prisma.searchConsoleProperty.findFirst({
    where: {
      projectId,
      isActive: true,
      connection: { status: 'CONNECTED' }
    },
    orderBy: [{ lastSyncAt: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }]
  });
  if (!property) {
    return {
      state: 'INELIGIBLE',
      selectedGscSnapshotIds: [],
      opportunitySnapshotCount: 0,
      topicSnapshotCount: 0,
      missingDates: []
    };
  }

  const dailySnapshots = await prisma.gscDailySnapshot.findMany({
    where: {
      projectId,
      propertyId: property.id,
      date: { gte: windowStart, lte: windowEnd },
      status: 'COMPLETED'
    },
    select: { id: true, date: true, status: true, syncVersion: true },
    orderBy: [{ date: 'asc' }, { syncVersion: 'desc' }, { id: 'asc' }]
  });
  const coverage = assessStableWindowCoverage(windows, dailySnapshots);
  const selectedGscSnapshotIds = coverage.selectedSnapshots.map((row) => row.id);
  if (coverage.state !== 'ELIGIBLE') {
    return {
      state: 'INELIGIBLE',
      selectedGscSnapshotIds,
      opportunitySnapshotCount: 0,
      topicSnapshotCount: 0,
      missingDates: coverage.missingDates
    };
  }

  const facts = await prisma.gscQueryPageFact.findMany({
    where: { projectId, snapshotId: { in: selectedGscSnapshotIds } },
    select: {
      date: true,
      normalizedQuery: true,
      canonicalPage: true,
      clicks: true,
      impressions: true,
      ctr: true,
      position: true
    },
    orderBy: [{ date: 'asc' }, { normalizedQuery: 'asc' }, { canonicalPage: 'asc' }]
  });

  const currentFacts = facts.filter((row) => row.date >= currentStart && row.date <= currentEnd);
  const previousFacts = facts.filter((row) => row.date >= previousStart && row.date <= previousEnd);
  const currentAggregates = aggregateQueryPageFacts(currentFacts).slice(0, GROWTH_MAX_CANDIDATES);
  const previousAggregates = aggregateQueryPageFacts(previousFacts);
  const previousByKey = new Map(previousAggregates.map((row) => [aggregateKey(row), row]));
  const percentiles = demandPercentiles(currentAggregates);
  const ctrCurve = buildProjectCtrCurve(currentAggregates);
  const canonicalPages = currentAggregates.map((row) => row.canonicalPage);
  const allEvidence = await loadGrowthEvidence(projectId, canonicalPages, {
    start: currentStart,
    end: currentEnd
  });
  const p3TopicBindings = await loadP3TopicBindings(projectId, canonicalPages);

  const provenance = {
    materializationVersion: GROWTH_MATERIALIZATION_VERSION,
    evidenceVersion: GROWTH_EVIDENCE_VERSION,
    gscSnapshotIds: selectedGscSnapshotIds
  };
  const scoreContextFor = (aggregate: QueryPageAggregate) => {
    const previous = previousByKey.get(aggregateKey(aggregate));
    const evidence = pageEvidence(allEvidence, aggregate.canonicalPage);
    const demand = scoreDemand(aggregate.impressions, percentiles.get(aggregateKey(aggregate)) ?? null);
    const positionPotential = scorePositionPotential(aggregate.position);
    const ctrGap = scoreCtrGap(aggregate.ctr, expectedCtr(ctrCurve, aggregate.position));
    const siteGap = scoreSiteEvidence(evidence);
    const gscTrend = previous ? scoreGscTrend(aggregate, previous) : unknown();
    const p6Visibility = scorePersistedVisibility(evidence);
    const score = calculateGrowthScore({ demand, positionPotential, ctrGap, siteGap, gscTrend, p6Visibility });
    return {
      aggregate,
      evidence,
      demand,
      positionPotential,
      ctrGap,
      siteGap,
      gscTrend,
      p6Visibility,
      score
    };
  };
  const scoreContexts = currentAggregates.map(scoreContextFor);
  const scoreContextByKey = new Map(scoreContexts.map((row) => [aggregateKey(row.aggregate), row]));
  const breakdownFor = (context: (typeof scoreContexts)[number]) => ({
    demandState: componentState(context.demand),
    demandScore: componentScore(context.demand),
    positionPotentialState: componentState(context.positionPotential),
    positionPotentialScore: componentScore(context.positionPotential),
    ctrGapState: componentState(context.ctrGap),
    ctrGapScore: componentScore(context.ctrGap),
    siteGapState: componentState(context.siteGap),
    siteGapScore: componentScore(context.siteGap),
    gscTrendState: componentState(context.gscTrend),
    gscTrendScore: componentScore(context.gscTrend),
    p6VisibilityState: componentState(context.p6Visibility),
    p6VisibilityScore: componentScore(context.p6Visibility),
    trendVisibilityDisplayState: context.score.trendVisibilityDisplayScore === null ? 'UNKNOWN' as const : 'KNOWN' as const,
    trendVisibilityDisplayScore: context.score.trendVisibilityDisplayScore === null
      ? null
      : Math.round(context.score.trendVisibilityDisplayScore),
    availableWeight: context.score.availableWeight,
    evidenceCoverage: context.score.evidenceCoverage,
    weightedTotal: context.score.weightedTotal,
    formulaVersion: context.score.formulaVersion
  });
  const members: MaterializedMember[] = [];

  for (const context of scoreContexts) {
    const { aggregate, evidence, demand, positionPotential, ctrGap, gscTrend, p6Visibility, score } = context;
    const signals = detectNormalOpportunityTypes({
      position: aggregate.position,
      positionPotential,
      ctrGap,
      gscTrend,
      p6Visibility,
      evidence
    });
    if (signals.length === 0) continue;
    const types = selectPrimaryType(signals);
    const p3Topic = p3TopicBindings.get(aggregate.canonicalPage);

    const assignment = resolveTopicAssignment({
      normalizedQuery: aggregate.normalizedQuery,
      p3Topic: p3Topic ? {
        entityId: p3Topic.entityId,
        topicKey: p3Topic.normalizedName,
        primaryQuery: p3Topic.canonicalName
      } : null,
      primaryQuery: aggregate.normalizedQuery
    });
    const topic = await growthRepository.getOrCreateTopicCluster({
      projectId,
      topicIdentityVersion: GROWTH_TOPIC_IDENTITY_VERSION,
      topicKey: assignment.topicKey,
      primaryEntityId: assignment.primaryEntityId,
      primaryQuery: assignment.primaryQuery
    });
    const identity = await growthRepository.getOrCreateOpportunityIdentity({
      projectId,
      identityType: 'QUERY_PAGE_GROWTH',
      normalizedQuery: aggregate.normalizedQuery,
      canonicalPage: aggregate.canonicalPage
    });

    let snapshot = await prisma.growthOpportunitySnapshot.findFirst({
      where: {
        opportunityIdentityId: identity.id,
        snapshotVersion: GROWTH_OPPORTUNITY_SNAPSHOT_VERSION,
        currentWindowStart: currentStart,
        currentWindowEnd: currentEnd
      }
    });
    if (!snapshot) {
      snapshot = await growthRepository.createOpportunitySnapshot({
        opportunityIdentityId: identity.id,
        projectId,
        snapshotVersion: GROWTH_OPPORTUNITY_SNAPSHOT_VERSION,
        formulaVersion: score.formulaVersion,
        currentWindowStart: currentStart,
        currentWindowEnd: currentEnd,
        previousWindowStart: previousStart,
        previousWindowEnd: previousEnd,
        dataCutoffAt: currentEnd,
        topicClusterId: topic.id,
        primaryType: types.primaryType,
        secondaryTypes: types.secondaryTypes,
        score: score.score,
        priority: score.priority,
        scoreState: score.scoreState,
        evidenceQuality: score.evidenceQuality,
        evidenceCoverage: score.evidenceCoverage,
        rankingEligible: score.rankingEligible,
        sourceProvenance: provenance,
        breakdown: breakdownFor(context),
        evidence: opportunityEvidenceRows(evidence)
      });
    }

    await growthRepository.ensureLifecycle(identity.id, snapshot.id, {
      actorType: 'SYSTEM',
      reasonCode: 'GROWTH_MATERIALIZED'
    });
    await reconcileOpportunityLifecycle(
      identity.id,
      { id: snapshot.id, actionable: isActionableScore(snapshot.score) }
    );

    members.push({
      snapshotId: snapshot.id,
      topicClusterId: topic.id,
      normalizedQuery: aggregate.normalizedQuery,
      canonicalPage: aggregate.canonicalPage,
      aggregate,
      demandScore: componentScore(demand),
      score: snapshot.score,
      trendVisibilityScore: score.trendVisibilityDisplayScore
    });
  }

  const queryGroups = new Map<string, QueryPageAggregate[]>();
  for (const aggregate of currentAggregates) {
    const rows = queryGroups.get(aggregate.normalizedQuery) ?? [];
    rows.push(aggregate);
    queryGroups.set(aggregate.normalizedQuery, rows);
  }
  const queryDemandRows = [...queryGroups.entries()]
    .map(([normalizedQuery, rows]) => ({
      normalizedQuery,
      rows,
      impressions: rows.reduce((sum, row) => sum + row.impressions, 0)
    }))
    .sort((a, b) => b.impressions - a.impressions || a.normalizedQuery.localeCompare(b.normalizedQuery));
  const queryDemandPercentile = new Map<string, number>();
  const queryDemandDenominator = Math.max(1, queryDemandRows.length);
  queryDemandRows.forEach((row, index) => {
    queryDemandPercentile.set(row.normalizedQuery, index / queryDemandDenominator);
  });
  const orderedQueryImpressions = queryDemandRows.map((row) => row.impressions).sort((a, b) => a - b);
  const projectQueryP50Impressions = orderedQueryImpressions.length > 0
    ? orderedQueryImpressions[Math.floor((orderedQueryImpressions.length - 1) * 0.5)]!
    : null;

  let specialOpportunitySnapshotCount = 0;
  const cannibalizationQueries = new Set<string>();
  for (const queryRow of queryDemandRows) {
    const queryDemand = scoreDemand(
      queryRow.impressions,
      queryDemandPercentile.get(queryRow.normalizedQuery) ?? null
    );
    const detector = detectKeywordCannibalization({
      normalizedQuery: queryRow.normalizedQuery,
      demandScore: componentScore(queryDemand),
      projectP50Impressions: projectQueryP50Impressions,
      pages: queryRow.rows.map((row) => ({
        canonicalPage: row.canonicalPage,
        impressions: row.impressions,
        position: row.position,
        ctr: row.ctr
      }))
    });
    if (detector.state !== 'DETECTED') continue;
    cannibalizationQueries.add(queryRow.normalizedQuery);

    const competingPages = detector.competingPages.map((row) => row.canonicalPage).sort();
    const competingSet = new Set(competingPages);
    const basisCandidates = queryRow.rows
      .map((row) => scoreContextByKey.get(aggregateKey(row)))
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .filter((row) => competingSet.has(row.aggregate.canonicalPage))
      .sort((a, b) =>
        (b.score.score ?? -1) - (a.score.score ?? -1) ||
        a.aggregate.canonicalPage.localeCompare(b.aggregate.canonicalPage)
      );
    const basis = basisCandidates[0];
    if (!basis) throw new Error('Cannibalization score basis not found');

    const identity = await growthRepository.getOrCreateOpportunityIdentity({
      projectId,
      identityType: 'KEYWORD_CANNIBALIZATION',
      normalizedQuery: queryRow.normalizedQuery,
      canonicalPages: competingPages
    });
    let snapshot = await prisma.growthOpportunitySnapshot.findFirst({
      where: {
        opportunityIdentityId: identity.id,
        snapshotVersion: GROWTH_OPPORTUNITY_SNAPSHOT_VERSION,
        currentWindowStart: currentStart,
        currentWindowEnd: currentEnd
      }
    });
    if (!snapshot) {
      const combinedEvidence = dedupeGrowthEvidence(
        basisCandidates.flatMap((row) => row.evidence)
      ).provenance;
      snapshot = await growthRepository.createOpportunitySnapshot({
        opportunityIdentityId: identity.id,
        projectId,
        snapshotVersion: GROWTH_OPPORTUNITY_SNAPSHOT_VERSION,
        formulaVersion: basis.score.formulaVersion,
        currentWindowStart: currentStart,
        currentWindowEnd: currentEnd,
        previousWindowStart: previousStart,
        previousWindowEnd: previousEnd,
        dataCutoffAt: currentEnd,
        primaryType: 'KEYWORD_CANNIBALIZATION',
        secondaryTypes: [],
        score: basis.score.score,
        priority: basis.score.priority,
        scoreState: basis.score.scoreState,
        evidenceQuality: basis.score.evidenceQuality,
        evidenceCoverage: basis.score.evidenceCoverage,
        rankingEligible: basis.score.rankingEligible,
        sourceProvenance: {
          ...provenance,
          detector: {
            type: 'KEYWORD_CANNIBALIZATION',
            reasonCodes: detector.reasonCodes,
            competingPages,
            primaryPageCandidate: detector.primaryPageCandidate,
            queryImpressions: queryRow.impressions,
            projectP50Impressions: projectQueryP50Impressions
          },
          scoreBasis: {
            type: 'MAX_MEMBER_QUERY_PAGE_SCORE',
            canonicalPage: basis.aggregate.canonicalPage
          }
        },
        breakdown: breakdownFor(basis),
        evidence: opportunityEvidenceRows(combinedEvidence)
      });
    }

    await growthRepository.ensureLifecycle(identity.id, snapshot.id, {
      actorType: 'SYSTEM',
      reasonCode: 'GROWTH_CANNIBALIZATION_MATERIALIZED'
    });
    await reconcileOpportunityLifecycle(
      identity.id,
      { id: snapshot.id, actionable: isActionableScore(snapshot.score) }
    );
    specialOpportunitySnapshotCount += 1;
  }

  for (const queryRow of queryDemandRows) {
    const queryContexts = queryRow.rows
      .map((row) => scoreContextByKey.get(aggregateKey(row)))
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
    if (queryContexts.length === 0) continue;

    const combinedEvidence = dedupeGrowthEvidence(
      queryContexts.flatMap((row) => row.evidence)
    ).provenance;
    const coverageEvidence = combinedEvidence.filter((row) =>
      row.sourceModule === 'P3_GEO' ||
      row.sourceModule === 'P3_ENTITY' ||
      row.sourceModule === 'P3_CITABILITY' ||
      row.sourceModule === 'P5_CONTENT'
    );
    const knownCoverageEvidence = coverageEvidence.filter((row) =>
      row.evidenceState === 'PASS' || row.evidenceState === 'FAIL'
    );
    const evidenceKnown = knownCoverageEvidence.length > 0;
    const hasCoverageGap = evidenceKnown
      ? knownCoverageEvidence.some((row) => row.evidenceState === 'FAIL')
      : null;

    const normalizedQueryTopic = normalizeTopicText(queryRow.normalizedQuery);
    const hasDeterministicDuplicateLandingPage = queryRow.rows.some((row) => {
      const binding = p3TopicBindings.get(row.canonicalPage);
      if (!binding) return false;
      return normalizeTopicText(binding.normalizedName) === normalizedQueryTopic ||
        normalizeTopicText(binding.canonicalName) === normalizedQueryTopic;
    });
    const queryDemand = scoreDemand(
      queryRow.impressions,
      queryDemandPercentile.get(queryRow.normalizedQuery) ?? null
    );
    const detector = detectNewContentOpportunity({
      normalizedQuery: queryRow.normalizedQuery,
      demandScore: componentScore(queryDemand),
      queryImpressions: queryRow.impressions,
      projectP50Impressions: projectQueryP50Impressions,
      pages: queryRow.rows.map((row) => ({
        canonicalPage: row.canonicalPage,
        impressions: row.impressions,
        position: row.position
      }))
    }, {
      hasCoverageGap,
      hasDeterministicDuplicateLandingPage,
      evidenceKnown,
      cannibalizationActive: cannibalizationQueries.has(queryRow.normalizedQuery)
    });
    if (detector.state !== 'DETECTED') continue;

    const basisCandidates = [...queryContexts].sort((a, b) =>
      (b.score.score ?? -1) - (a.score.score ?? -1) ||
      a.aggregate.canonicalPage.localeCompare(b.aggregate.canonicalPage)
    );
    const basis = basisCandidates[0];
    if (!basis) throw new Error('New Content score basis not found');

    const identity = await growthRepository.getOrCreateOpportunityIdentity({
      projectId,
      identityType: 'NEW_CONTENT_OPPORTUNITY',
      normalizedQuery: queryRow.normalizedQuery
    });
    let snapshot = await prisma.growthOpportunitySnapshot.findFirst({
      where: {
        opportunityIdentityId: identity.id,
        snapshotVersion: GROWTH_OPPORTUNITY_SNAPSHOT_VERSION,
        currentWindowStart: currentStart,
        currentWindowEnd: currentEnd
      }
    });
    if (!snapshot) {
      snapshot = await growthRepository.createOpportunitySnapshot({
        opportunityIdentityId: identity.id,
        projectId,
        snapshotVersion: GROWTH_OPPORTUNITY_SNAPSHOT_VERSION,
        formulaVersion: basis.score.formulaVersion,
        currentWindowStart: currentStart,
        currentWindowEnd: currentEnd,
        previousWindowStart: previousStart,
        previousWindowEnd: previousEnd,
        dataCutoffAt: currentEnd,
        primaryType: 'NEW_CONTENT_OPPORTUNITY',
        secondaryTypes: [],
        score: basis.score.score,
        priority: basis.score.priority,
        scoreState: basis.score.scoreState,
        evidenceQuality: basis.score.evidenceQuality,
        evidenceCoverage: basis.score.evidenceCoverage,
        rankingEligible: basis.score.rankingEligible,
        sourceProvenance: {
          ...provenance,
          detector: {
            type: 'NEW_CONTENT_OPPORTUNITY',
            reasonCodes: detector.reasonCodes,
            queryImpressions: queryRow.impressions,
            projectP50Impressions: projectQueryP50Impressions,
            pages: queryRow.rows
              .map((row) => ({
                canonicalPage: row.canonicalPage,
                impressions: row.impressions,
                position: row.position
              }))
              .sort((a, b) => a.canonicalPage.localeCompare(b.canonicalPage)),
            coverageEvidenceFingerprints: knownCoverageEvidence
              .map((row) => row.fingerprint)
              .sort(),
            duplicateLandingPage: hasDeterministicDuplicateLandingPage
          },
          scoreBasis: {
            type: 'MAX_MEMBER_QUERY_PAGE_SCORE',
            canonicalPage: basis.aggregate.canonicalPage
          }
        },
        breakdown: breakdownFor(basis),
        evidence: opportunityEvidenceRows(combinedEvidence)
      });
    }

    await growthRepository.ensureLifecycle(identity.id, snapshot.id, {
      actorType: 'SYSTEM',
      reasonCode: 'GROWTH_NEW_CONTENT_MATERIALIZED'
    });
    await reconcileOpportunityLifecycle(
      identity.id,
      { id: snapshot.id, actionable: isActionableScore(snapshot.score) }
    );
    specialOpportunitySnapshotCount += 1;
  }

  let topicSnapshotCount = 0;
  const byTopic = new Map<string, MaterializedMember[]>();
  for (const member of members) {
    const rows = byTopic.get(member.topicClusterId) ?? [];
    if (rows.length < GROWTH_MAX_TOPIC_MEMBERS) rows.push(member);
    byTopic.set(member.topicClusterId, rows);
  }

  for (const [topicClusterId, topicMembers] of byTopic) {
    const existing = await prisma.growthTopicClusterSnapshot.findFirst({
      where: {
        topicClusterId,
        snapshotVersion: GROWTH_TOPIC_SNAPSHOT_VERSION,
        currentWindowStart: currentStart,
        currentWindowEnd: currentEnd
      }
    });
    if (existing) {
      topicSnapshotCount += 1;
      continue;
    }

    const trendScores = topicMembers
      .map((row) => row.trendVisibilityScore)
      .filter((value): value is number => value !== null && Number.isFinite(value));
    const topicScore = scoreTopicCluster({
      opportunities: topicMembers.map((row) => ({ score: row.score, demand: row.demandScore })),
      trendVisibilityScore: trendScores.length > 0
        ? trendScores.reduce((sum, value) => sum + value, 0) / trendScores.length
        : null
    });
    const totalImpressions = topicMembers.reduce((sum, row) => sum + row.aggregate.impressions, 0);
    const totalClicks = topicMembers.reduce((sum, row) => sum + row.aggregate.clicks, 0);
    const weightedPosition = topicMembers.reduce(
      (sum, row) => sum + (row.aggregate.position ?? 0) * row.aggregate.impressions,
      0
    );

    await growthRepository.createTopicSnapshot({
      topicClusterId,
      projectId,
      snapshotVersion: GROWTH_TOPIC_SNAPSHOT_VERSION,
      currentWindowStart: currentStart,
      currentWindowEnd: currentEnd,
      previousWindowStart: previousStart,
      previousWindowEnd: previousEnd,
      dataCutoffAt: currentEnd,
      memberQueries: [...new Set(topicMembers.map((row) => row.normalizedQuery))].sort(),
      memberPages: [...new Set(topicMembers.map((row) => row.canonicalPage))].sort(),
      sourceProvenance: provenance,
      totalImpressions,
      totalClicks,
      ctr: totalImpressions > 0 ? totalClicks / totalImpressions : 0,
      position: totalImpressions > 0 ? weightedPosition / totalImpressions : null,
      topOpportunityScore: topicScore.topOpportunityScore,
      topicScore: topicScore.score,
      priority: topicScore.priority,
      scoreState: topicScore.scoreState,
      evidenceQuality: topicScore.evidenceQuality,
      evidenceCoverage: topicScore.evidenceCoverage,
      rankingEligible: topicScore.rankingEligible,
      trendVisibilityState: topicScore.trendVisibilityState
    });
    topicSnapshotCount += 1;
  }

  return {
    state: 'COMPLETED',
    selectedGscSnapshotIds,
    opportunitySnapshotCount: members.length + specialOpportunitySnapshotCount,
    topicSnapshotCount,
    missingDates: []
  };
}