import type {
  GrowthComponentState,
  GrowthLifecycleStatus,
  GrowthOpportunityType
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { buildProjectCtrCurve } from './ctr-curve.js';
import {
  dedupeGrowthEvidence,
  GROWTH_EVIDENCE_VERSION,
  loadGrowthEvidence,
  type GrowthEvidence
} from './growth-evidence.js';
import { detectNormalOpportunityTypes, selectPrimaryType } from './growth-detectors.js';
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
  history: readonly GrowthLifecycleSnapshotState[]
) {
  const lifecycle = await prisma.growthOpportunityLifecycle.findUnique({
    where: { opportunityIdentityId: identityId }
  });
  if (!lifecycle) throw new Error('Growth opportunity lifecycle not found');

  const now = new Date();
  if (currentSnapshot.actionable) {
    if (lifecycle.status === 'DONE' || lifecycle.status === 'RESOLVED') {
      return growthRepository.updateLifecycle(
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
    }

    if (currentSnapshot.id && lifecycle.latestSnapshotId !== currentSnapshot.id) {
      return prisma.growthOpportunityLifecycle.update({
        where: { opportunityIdentityId: identityId },
        data: { latestSnapshotId: currentSnapshot.id }
      });
    }
    return lifecycle;
  }

  const twoConsecutiveNonActionable = history.length >= 2 &&
    history.slice(0, 2).every((row) => !row.actionable);
  if (
    twoConsecutiveNonActionable &&
    lifecycle.status !== 'DISMISSED' &&
    lifecycle.status !== 'RESOLVED'
  ) {
    return growthRepository.updateLifecycle(
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
  const allEvidence = await loadGrowthEvidence(projectId, currentAggregates.map((row) => row.canonicalPage), {
    start: currentStart,
    end: currentEnd
  });

  const provenance = {
    materializationVersion: GROWTH_MATERIALIZATION_VERSION,
    evidenceVersion: GROWTH_EVIDENCE_VERSION,
    gscSnapshotIds: selectedGscSnapshotIds
  };
  const members: MaterializedMember[] = [];

  for (const aggregate of currentAggregates) {
    const previous = previousByKey.get(aggregateKey(aggregate));
    const evidence = pageEvidence(allEvidence, aggregate.canonicalPage);
    const demand = scoreDemand(aggregate.impressions, percentiles.get(aggregateKey(aggregate)) ?? null);
    const positionPotential = scorePositionPotential(aggregate.position);
    const ctrGap = scoreCtrGap(aggregate.ctr, expectedCtr(ctrCurve, aggregate.position));
    const siteGap = scoreSiteEvidence(evidence);
    const gscTrend = previous
      ? scoreGscTrend(aggregate, previous)
      : unknown();
    const p6Visibility = scorePersistedVisibility(evidence);
    const score = calculateGrowthScore({ demand, positionPotential, ctrGap, siteGap, gscTrend, p6Visibility });
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

    const assignment = resolveTopicAssignment({
      normalizedQuery: aggregate.normalizedQuery,
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
        breakdown: {
          demandState: componentState(demand),
          demandScore: componentScore(demand),
          positionPotentialState: componentState(positionPotential),
          positionPotentialScore: componentScore(positionPotential),
          ctrGapState: componentState(ctrGap),
          ctrGapScore: componentScore(ctrGap),
          siteGapState: componentState(siteGap),
          siteGapScore: componentScore(siteGap),
          gscTrendState: componentState(gscTrend),
          gscTrendScore: componentScore(gscTrend),
          p6VisibilityState: componentState(p6Visibility),
          p6VisibilityScore: componentScore(p6Visibility),
          trendVisibilityDisplayState: score.trendVisibilityDisplayScore === null ? 'UNKNOWN' : 'KNOWN',
          trendVisibilityDisplayScore: score.trendVisibilityDisplayScore === null
            ? null
            : Math.round(score.trendVisibilityDisplayScore),
          availableWeight: score.availableWeight,
          evidenceCoverage: score.evidenceCoverage,
          weightedTotal: score.weightedTotal,
          formulaVersion: score.formulaVersion
        },
        evidence: opportunityEvidenceRows(evidence)
      });
    }

    await growthRepository.ensureLifecycle(identity.id, snapshot.id, {
      actorType: 'SYSTEM',
      reasonCode: 'GROWTH_MATERIALIZED'
    });
    await reconcileOpportunityLifecycle(
      identity.id,
      { id: snapshot.id, actionable: isActionableScore(snapshot.score) },
      [{ id: snapshot.id, actionable: isActionableScore(snapshot.score) }]
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
    opportunitySnapshotCount: members.length,
    topicSnapshotCount,
    missingDates: []
  };
}
