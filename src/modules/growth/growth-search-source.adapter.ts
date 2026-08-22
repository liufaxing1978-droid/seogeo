import type { MarketCode, PrismaClient } from '@prisma/client';
import { SearchFactMaterializer } from '../search-facts/search-fact.materializer.js';
import { SearchFactRepository } from '../search-facts/search-fact.repository.js';
import {
  SEARCH_FACT_NORMALIZATION_VERSION,
  type SearchFactCompleteness,
  type SearchFactKind,
  type SearchFactMetricSemantic,
  type SearchFactProviderCode,
  type SearchFactView
} from '../search-facts/search-fact.types.js';
import type { QueryPageFactLike } from './growth.types.js';

export const GROWTH_SEARCH_PROVENANCE_VERSION =
  'GROWTH_SEARCH_PROVENANCE_V1' as const;

export type GrowthSearchSourceMode =
  | 'CONFIGURED_MARKET'
  | 'UNCONFIGURED_LEGACY';

export type GrowthSearchMarketProjection = {
  marketCode: MarketCode;
  locale: string;
  propertyRef: string;
};

export type GrowthSearchCorroboratingLane = {
  provider: SearchFactProviderCode;
  marketCode: MarketCode;
  locale: string;
  propertyRef: string;
  factKinds: SearchFactKind[];
  snapshotIds: string[];
  sourceCompleteness: SearchFactCompleteness[];
};

export type GrowthSearchConfiguredProvenance = {
  version: typeof GROWTH_SEARCH_PROVENANCE_VERSION;
  mode: 'CONFIGURED_MARKET';
  scoringLane: {
    provider: 'GOOGLE_SEARCH_CONSOLE';
    factKind: 'QUERY_PAGE';
    snapshotIds: string[];
    sourceRefs: string[];
    marketProjections: GrowthSearchMarketProjection[];
  };
  corroboratingLanes: GrowthSearchCorroboratingLane[];
};

export type GrowthSearchLegacyProvenance = {
  version: typeof GROWTH_SEARCH_PROVENANCE_VERSION;
  mode: 'UNCONFIGURED_LEGACY';
  scoringLane: {
    provider: 'GOOGLE_SEARCH_CONSOLE';
    source: 'RAW_GSC_COMPATIBILITY';
    gscSnapshotIds: string[];
  };
  corroboratingLanes: [];
};

export type GrowthSearchProvenanceV1 =
  | GrowthSearchConfiguredProvenance
  | GrowthSearchLegacyProvenance;

export type GrowthSearchSourceInput = {
  projectId: string;
  propertyId: string;
  selectedGscSnapshotIds: readonly string[];
  sourceDateFrom: Date;
  sourceDateTo: Date;
};

export type GrowthSearchSourceResult = {
  scoringFacts: QueryPageFactLike[];
  selectedGscSnapshotIds: string[];
  provenance: GrowthSearchProvenanceV1;
};

export type GrowthSearchSourceDeps = {
  materializer?: Pick<SearchFactMaterializer, 'materializeGoogleSnapshot'>;
  repository?: Pick<SearchFactRepository, 'listCompletedFacts'>;
};

const REQUIRED_GOOGLE_METRICS = [
  'CLICKS',
  'IMPRESSIONS',
  'CTR',
  'GOOGLE_SEARCH_CONSOLE_POSITION'
] as const satisfies readonly SearchFactMetricSemantic[];

const BING_CORROBORATING_FACT_KINDS = [
  'PAGE',
  'QUERY',
  'SITE'
] as const satisfies readonly SearchFactKind[];

type RequiredGoogleMetric = (typeof REQUIRED_GOOGLE_METRICS)[number];

type ScoringCandidate = {
  identity: string;
  signature: string;
  row: QueryPageFactLike;
};

function sourceMismatch(): never {
  throw new Error('GROWTH_SEARCH_SOURCE_MISMATCH');
}

function requiredMetric(
  fact: SearchFactView,
  semantic: RequiredGoogleMetric
): number {
  const rows = fact.metrics.filter((metric) => metric.metricSemantic === semantic);
  if (rows.length === 0) {
    throw new Error('GROWTH_SEARCH_SCORING_METRIC_MISSING');
  }
  if (rows.length !== 1) {
    throw new Error('GROWTH_SEARCH_SOURCE_CONFLICT');
  }

  const metric = rows[0]!;
  if (metric.evidenceState !== 'KNOWN_PRESENT' || metric.numericValue === null) {
    throw new Error('GROWTH_SEARCH_SCORING_METRIC_UNKNOWN');
  }

  const value = metric.numericValue;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('GROWTH_SEARCH_SOURCE_CONFLICT');
  }
  if (semantic === 'CTR' && value > 1) {
    throw new Error('GROWTH_SEARCH_SOURCE_CONFLICT');
  }
  return value;
}

function scoringCandidate(
  fact: SearchFactView,
  selectedGscSnapshotIds: ReadonlySet<string>
): ScoringCandidate {
  if (
    fact.provider !== 'GOOGLE_SEARCH_CONSOLE' ||
    fact.factKind !== 'QUERY_PAGE' ||
    fact.sourceKind !== 'GSC_DAILY_SNAPSHOT' ||
    !selectedGscSnapshotIds.has(fact.sourceRef) ||
    fact.sourceObservationRef.trim().length === 0 ||
    fact.factKey.trim().length === 0 ||
    fact.normalizedQuery === null ||
    fact.normalizedQuery.trim().length === 0 ||
    fact.canonicalPage === null ||
    fact.canonicalPage.trim().length === 0 ||
    fact.queryNormalizationVersion === null ||
    fact.queryNormalizationVersion.trim().length === 0 ||
    fact.canonicalizationVersion === null ||
    fact.canonicalizationVersion.trim().length === 0 ||
    Number.isNaN(fact.sourceDate.getTime())
  ) {
    sourceMismatch();
  }

  const clicks = requiredMetric(fact, 'CLICKS');
  const impressions = requiredMetric(fact, 'IMPRESSIONS');
  const ctr = requiredMetric(fact, 'CTR');
  const position = requiredMetric(fact, 'GOOGLE_SEARCH_CONSOLE_POSITION');

  const metrics = [
    ['CLICKS', clicks],
    ['CTR', ctr],
    ['GOOGLE_SEARCH_CONSOLE_POSITION', position],
    ['IMPRESSIONS', impressions]
  ] as const;

  const identity = JSON.stringify([
    fact.sourceObservationRef,
    fact.sourceDate.toISOString(),
    fact.factKey
  ]);
  const signature = JSON.stringify({
    sourceRef: fact.sourceRef,
    sourceDate: fact.sourceDate.toISOString(),
    factKey: fact.factKey,
    normalizedQuery: fact.normalizedQuery,
    canonicalPage: fact.canonicalPage,
    queryNormalizationVersion: fact.queryNormalizationVersion,
    canonicalizationVersion: fact.canonicalizationVersion,
    metrics
  });

  return {
    identity,
    signature,
    row: {
      date: fact.sourceDate,
      normalizedQuery: fact.normalizedQuery,
      canonicalPage: fact.canonicalPage,
      clicks,
      impressions,
      ctr,
      position
    }
  };
}

export function adaptGoogleScoringFacts(
  facts: readonly SearchFactView[],
  selectedGscSnapshotIds: ReadonlySet<string>
): QueryPageFactLike[] {
  if (selectedGscSnapshotIds.size === 0) {
    throw new Error('GROWTH_SEARCH_SOURCE_MISMATCH');
  }

  const byRawObservation = new Map<string, ScoringCandidate>();
  for (const fact of facts) {
    const candidate = scoringCandidate(fact, selectedGscSnapshotIds);
    const existing = byRawObservation.get(candidate.identity);
    if (existing && existing.signature !== candidate.signature) {
      throw new Error('GROWTH_SEARCH_SOURCE_CONFLICT');
    }
    if (!existing) byRawObservation.set(candidate.identity, candidate);
  }

  return [...byRawObservation.values()]
    .sort((left, right) =>
      left.row.date instanceof Date && right.row.date instanceof Date
        ? left.row.date.getTime() - right.row.date.getTime() ||
          left.row.normalizedQuery.localeCompare(right.row.normalizedQuery) ||
          left.row.canonicalPage.localeCompare(right.row.canonicalPage) ||
          left.identity.localeCompare(right.identity)
        : left.identity.localeCompare(right.identity)
    )
    .map((candidate) => candidate.row);
}

function corroboratingFactIdentity(fact: SearchFactView): string {
  return JSON.stringify([
    fact.provider,
    fact.marketCode,
    fact.locale,
    fact.propertyRef,
    fact.factKind,
    fact.sourceDate.toISOString(),
    fact.factKey
  ]);
}

function preferCorroboratingFact(
  candidate: SearchFactView,
  existing: SearchFactView
): boolean {
  const candidateCutoff = candidate.sourceCutoffAt.getTime();
  const existingCutoff = existing.sourceCutoffAt.getTime();
  if (candidateCutoff !== existingCutoff) {
    return candidateCutoff > existingCutoff;
  }

  const candidateTieBreak = [
    candidate.snapshotId,
    candidate.sourceRef,
    candidate.sourceObservationRef
  ];
  const existingTieBreak = [
    existing.snapshotId,
    existing.sourceRef,
    existing.sourceObservationRef
  ];

  for (let index = 0; index < candidateTieBreak.length; index += 1) {
    const order = candidateTieBreak[index]!.localeCompare(existingTieBreak[index]!);
    if (order !== 0) return order < 0;
  }
  return false;
}

export function dedupeCorroboratingFacts(
  facts: readonly SearchFactView[]
): SearchFactView[] {
  const allowedKinds = new Set<SearchFactKind>(BING_CORROBORATING_FACT_KINDS);
  const selected = new Map<string, SearchFactView>();

  for (const fact of facts) {
    if (
      fact.provider !== 'BING_WEBMASTER' ||
      !allowedKinds.has(fact.factKind) ||
      Number.isNaN(fact.sourceDate.getTime()) ||
      Number.isNaN(fact.sourceCutoffAt.getTime()) ||
      fact.factKey.trim().length === 0 ||
      fact.snapshotId.trim().length === 0 ||
      fact.sourceRef.trim().length === 0 ||
      fact.sourceObservationRef.trim().length === 0
    ) {
      throw new Error('GROWTH_SEARCH_SOURCE_CONFLICT');
    }

    const identity = corroboratingFactIdentity(fact);
    const existing = selected.get(identity);
    if (!existing || preferCorroboratingFact(fact, existing)) {
      selected.set(identity, fact);
    }
  }

  return [...selected.values()].sort((left, right) =>
    left.provider.localeCompare(right.provider) ||
    left.marketCode.localeCompare(right.marketCode) ||
    left.locale.localeCompare(right.locale) ||
    left.propertyRef.localeCompare(right.propertyRef) ||
    left.factKind.localeCompare(right.factKind) ||
    left.sourceDate.getTime() - right.sourceDate.getTime() ||
    left.factKey.localeCompare(right.factKey) ||
    left.snapshotId.localeCompare(right.snapshotId)
  );
}

export function summarizeCorroboratingFacts(
  facts: readonly SearchFactView[]
): GrowthSearchCorroboratingLane[] {
  const lanes = new Map<
    string,
    {
      provider: SearchFactProviderCode;
      marketCode: MarketCode;
      locale: string;
      propertyRef: string;
      factKinds: Set<SearchFactKind>;
      snapshotIds: Set<string>;
      sourceCompleteness: Set<SearchFactCompleteness>;
    }
  >();

  for (const fact of facts) {
    const laneKey = JSON.stringify([
      fact.provider,
      fact.marketCode,
      fact.locale,
      fact.propertyRef
    ]);
    let lane = lanes.get(laneKey);
    if (!lane) {
      lane = {
        provider: fact.provider,
        marketCode: fact.marketCode,
        locale: fact.locale,
        propertyRef: fact.propertyRef,
        factKinds: new Set<SearchFactKind>(),
        snapshotIds: new Set<string>(),
        sourceCompleteness: new Set<SearchFactCompleteness>()
      };
      lanes.set(laneKey, lane);
    }
    lane.factKinds.add(fact.factKind);
    lane.snapshotIds.add(fact.snapshotId);
    lane.sourceCompleteness.add(fact.sourceCompleteness);
  }

  return [...lanes.values()]
    .map((lane) => ({
      provider: lane.provider,
      marketCode: lane.marketCode,
      locale: lane.locale,
      propertyRef: lane.propertyRef,
      factKinds: [...lane.factKinds].sort(),
      snapshotIds: [...lane.snapshotIds].sort(),
      sourceCompleteness: [...lane.sourceCompleteness].sort()
    }))
    .sort((left, right) =>
      left.provider.localeCompare(right.provider) ||
      left.marketCode.localeCompare(right.marketCode) ||
      left.locale.localeCompare(right.locale) ||
      left.propertyRef.localeCompare(right.propertyRef)
    );
}

function assertSourceInput(input: GrowthSearchSourceInput): void {
  if (
    input.projectId.trim().length === 0 ||
    input.propertyId.trim().length === 0 ||
    input.selectedGscSnapshotIds.length === 0 ||
    Number.isNaN(input.sourceDateFrom.getTime()) ||
    Number.isNaN(input.sourceDateTo.getTime()) ||
    input.sourceDateFrom.getTime() > input.sourceDateTo.getTime()
  ) {
    sourceMismatch();
  }

  const unique = new Set(input.selectedGscSnapshotIds);
  if (
    unique.size !== input.selectedGscSnapshotIds.length ||
    [...unique].some((id) => id.trim().length === 0)
  ) {
    sourceMismatch();
  }
}

export class GrowthSearchSourceAdapter {
  private readonly materializer: Pick<SearchFactMaterializer, 'materializeGoogleSnapshot'>;
  private readonly repository: Pick<SearchFactRepository, 'listCompletedFacts'>;

  constructor(
    private readonly db: PrismaClient,
    deps: GrowthSearchSourceDeps = {}
  ) {
    this.materializer = deps.materializer ?? new SearchFactMaterializer(db);
    this.repository = deps.repository ?? new SearchFactRepository(db);
  }

  async load(input: GrowthSearchSourceInput): Promise<GrowthSearchSourceResult> {
    assertSourceInput(input);

    const property = await this.db.searchConsoleProperty.findFirst({
      where: {
        id: input.propertyId,
        projectId: input.projectId
      },
      select: {
        id: true,
        propertyUri: true,
        propertyType: true
      }
    });
    if (!property) sourceMismatch();

    const selectedIds = [...input.selectedGscSnapshotIds];
    const snapshots = await this.db.gscDailySnapshot.findMany({
      where: {
        id: { in: selectedIds },
        projectId: input.projectId,
        propertyId: property.id,
        status: 'COMPLETED'
      },
      select: {
        id: true,
        date: true,
        syncVersion: true,
        status: true
      },
      orderBy: [
        { date: 'asc' },
        { syncVersion: 'desc' },
        { id: 'asc' }
      ]
    });

    if (snapshots.length !== selectedIds.length) sourceMismatch();
    if (snapshots.some((snapshot) =>
      snapshot.date.getTime() < input.sourceDateFrom.getTime() ||
      snapshot.date.getTime() > input.sourceDateTo.getTime()
    )) {
      sourceMismatch();
    }

    const authoritativeIds = snapshots.map((snapshot) => snapshot.id);
    const authoritativeSet = new Set(authoritativeIds);
    const markets = await this.db.projectMarket.findMany({
      where: {
        projectId: input.projectId,
        enabled: true
      },
      select: {
        id: true,
        marketCode: true,
        locale: true
      },
      orderBy: [
        { marketCode: 'asc' },
        { locale: 'asc' },
        { id: 'asc' }
      ]
    });

    if (markets.length === 0) {
      const facts = await this.db.gscQueryPageFact.findMany({
        where: {
          projectId: input.projectId,
          snapshotId: { in: authoritativeIds }
        },
        select: {
          date: true,
          normalizedQuery: true,
          canonicalPage: true,
          clicks: true,
          impressions: true,
          ctr: true,
          position: true
        },
        orderBy: [
          { date: 'asc' },
          { normalizedQuery: 'asc' },
          { canonicalPage: 'asc' },
          { id: 'asc' }
        ]
      });

      return {
        scoringFacts: facts,
        selectedGscSnapshotIds: authoritativeIds,
        provenance: {
          version: GROWTH_SEARCH_PROVENANCE_VERSION,
          mode: 'UNCONFIGURED_LEGACY',
          scoringLane: {
            provider: 'GOOGLE_SEARCH_CONSOLE',
            source: 'RAW_GSC_COMPATIBILITY',
            gscSnapshotIds: authoritativeIds
          },
          corroboratingLanes: []
        }
      };
    }

    const normalizedSnapshotIds: string[] = [];
    for (const snapshot of snapshots) {
      for (const market of markets) {
        const normalized = await this.materializer.materializeGoogleSnapshot({
          snapshotId: snapshot.id,
          marketCode: market.marketCode,
          locale: market.locale,
          normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION
        });
        normalizedSnapshotIds.push(normalized.id);
      }
    }

    const unifiedFacts: SearchFactView[] = [];
    for (const market of markets) {
      unifiedFacts.push(...await this.repository.listCompletedFacts({
        projectId: input.projectId,
        provider: 'GOOGLE_SEARCH_CONSOLE',
        marketCode: market.marketCode,
        locale: market.locale,
        propertyRef: property.propertyUri,
        factKind: 'QUERY_PAGE',
        sourceDateFrom: input.sourceDateFrom,
        sourceDateTo: input.sourceDateTo
      }));
    }

    const scoringFacts = adaptGoogleScoringFacts(unifiedFacts, authoritativeSet);
    const corroboratingFacts: SearchFactView[] = [];
    for (const market of markets) {
      corroboratingFacts.push(...await this.repository.listCompletedFacts({
        projectId: input.projectId,
        provider: 'BING_WEBMASTER',
        marketCode: market.marketCode,
        locale: market.locale,
        propertyRef: property.propertyUri,
        sourceDateFrom: input.sourceDateFrom,
        sourceDateTo: input.sourceDateTo
      }));
    }
    const corroboratingLanes = summarizeCorroboratingFacts(
      dedupeCorroboratingFacts(corroboratingFacts)
    );

    const marketProjections = markets.map((market) => ({
      marketCode: market.marketCode,
      locale: market.locale,
      propertyRef: property.propertyUri
    })).sort((left, right) =>
      left.marketCode.localeCompare(right.marketCode) ||
      left.locale.localeCompare(right.locale) ||
      left.propertyRef.localeCompare(right.propertyRef)
    );

    return {
      scoringFacts,
      selectedGscSnapshotIds: authoritativeIds,
      provenance: {
        version: GROWTH_SEARCH_PROVENANCE_VERSION,
        mode: 'CONFIGURED_MARKET',
        scoringLane: {
          provider: 'GOOGLE_SEARCH_CONSOLE',
          factKind: 'QUERY_PAGE',
          snapshotIds: [...new Set(normalizedSnapshotIds)].sort(),
          sourceRefs: [...authoritativeSet].sort(),
          marketProjections
        },
        corroboratingLanes
      }
    };
  }
}
