import { createHash } from 'node:crypto';
import type {
  GrowthEvidenceSeverity,
  GrowthEvidenceSourceModule,
  GrowthEvidenceState,
  Prisma
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';

export const GROWTH_EVIDENCE_VERSION = 'GROWTH_EVIDENCE_V1';
export const GROWTH_EVIDENCE_MAX_PAGES = 500;
export const GROWTH_EVIDENCE_MAX_ROWS_PER_SOURCE = 5_000;

export type GrowthEvidenceWindow = {
  start: Date;
  end: Date;
};

export type GrowthEvidence = {
  sourceModule: GrowthEvidenceSourceModule;
  sourceType: string;
  sourceId: string;
  sourceFactVersion: string;
  ruleKey: string;
  rootCauseKey: string;
  evidenceState: GrowthEvidenceState;
  severity: GrowthEvidenceSeverity | null;
  canonicalPage: string | null;
  numericValue: number | null;
  textSummary: string | null;
  fingerprint: string;
};

export type GrowthEvidenceScoringGroup = {
  rootCauseKey: string;
  representative: GrowthEvidence;
  provenance: GrowthEvidence[];
};

export type GrowthEvidenceSet = {
  provenance: GrowthEvidence[];
  scoringGroups: GrowthEvidenceScoringGroup[];
};

type GrowthEvidenceWithoutFingerprint = Omit<GrowthEvidence, 'fingerprint'>;

type JsonRecord = Record<string, unknown>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)])
  );
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function fingerprintGrowthEvidence(input: GrowthEvidenceWithoutFingerprint): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        sourceModule: input.sourceModule,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceFactVersion: input.sourceFactVersion,
        ruleKey: input.ruleKey
      })
    )
    .digest('hex');
}

function withFingerprint(input: GrowthEvidenceWithoutFingerprint): GrowthEvidence {
  return { ...input, fingerprint: fingerprintGrowthEvidence(input) };
}

const stateRank: Record<GrowthEvidenceState, number> = {
  FAIL: 4,
  UNKNOWN: 3,
  PASS: 2,
  NOT_APPLICABLE: 1
};

const severityRank: Record<GrowthEvidenceSeverity, number> = {
  HIGH: 4,
  MEDIUM: 3,
  LOW: 2,
  INFO: 1
};

function compareRepresentative(left: GrowthEvidence, right: GrowthEvidence): number {
  const state = stateRank[right.evidenceState] - stateRank[left.evidenceState];
  if (state !== 0) return state;
  const severity = (right.severity ? severityRank[right.severity] : 0) - (left.severity ? severityRank[left.severity] : 0);
  if (severity !== 0) return severity;
  const module = left.sourceModule.localeCompare(right.sourceModule);
  if (module !== 0) return module;
  const source = left.sourceId.localeCompare(right.sourceId);
  if (source !== 0) return source;
  return left.fingerprint.localeCompare(right.fingerprint);
}

export function dedupeGrowthEvidence(input: readonly GrowthEvidence[]): GrowthEvidenceSet {
  const byFingerprint = new Map<string, GrowthEvidence>();
  for (const row of input) {
    const existing = byFingerprint.get(row.fingerprint);
    if (!existing || compareRepresentative(row, existing) < 0) byFingerprint.set(row.fingerprint, row);
  }

  const provenance = [...byFingerprint.values()].sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
  const grouped = new Map<string, GrowthEvidence[]>();
  for (const row of provenance) {
    const current = grouped.get(row.rootCauseKey) ?? [];
    current.push(row);
    grouped.set(row.rootCauseKey, current);
  }

  const scoringGroups = [...grouped.entries()]
    .map(([rootCauseKey, rows]) => {
      const sorted = [...rows].sort(compareRepresentative);
      return {
        rootCauseKey,
        representative: sorted[0]!,
        provenance: [...rows].sort((left, right) => left.fingerprint.localeCompare(right.fingerprint))
      };
    })
    .sort((left, right) => left.rootCauseKey.localeCompare(right.rootCauseKey));

  return { provenance, scoringGroups };
}

function assertWindow(window: GrowthEvidenceWindow): void {
  if (Number.isNaN(window.start.getTime()) || Number.isNaN(window.end.getTime()) || window.start > window.end) {
    throw new RangeError('Growth evidence window must be valid and ordered');
  }
}

function normalizePages(canonicalPages: readonly string[]): string[] {
  const pages = [...new Set(canonicalPages.map((value) => value.trim()).filter(Boolean))].sort();
  if (pages.length > GROWTH_EVIDENCE_MAX_PAGES) {
    throw new RangeError(`Growth evidence supports at most ${GROWTH_EVIDENCE_MAX_PAGES} canonical pages per load`);
  }
  return pages;
}

function mapSeoSeverity(value: string): GrowthEvidenceSeverity | null {
  if (value === 'CRITICAL' || value === 'HIGH') return 'HIGH';
  if (value === 'MEDIUM') return 'MEDIUM';
  if (value === 'LOW') return 'LOW';
  return null;
}

function mapPriority(value: string | null | undefined): GrowthEvidenceSeverity | null {
  if (value === 'HIGH') return 'HIGH';
  if (value === 'MEDIUM' || value === 'WARNING') return 'MEDIUM';
  if (value === 'LOW') return 'LOW';
  if (value === 'INFO') return 'INFO';
  if (value === 'CRITICAL') return 'HIGH';
  return null;
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(record: JsonRecord | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function rootCauseFromReferences(value: Prisma.JsonValue | null, fallback: string): string {
  for (const raw of asArray(value)) {
    const reference = asRecord(raw);
    const type = readString(reference, 'type');
    const id = readString(reference, 'id');
    if (type === 'P3_CITABILITY' && id) return `P3_CITABILITY:${id}`;
    if (type === 'P3_ENTITY' && id) return `P3_ENTITY:${id}`;
    if (type === 'P3_GEO' && id) return `P3_GEO:${id}`;
  }
  return fallback;
}

function geoModule(dimension: string): GrowthEvidenceSourceModule {
  if (dimension === 'CITABILITY') return 'P3_CITABILITY';
  if (dimension === 'ENTITY') return 'P3_ENTITY';
  return 'P3_GEO';
}

function visibilityState(status: string): GrowthEvidenceState {
  if (status === 'CALCULATED') return 'PASS';
  if (status === 'NO_SIGNAL') return 'FAIL';
  if (status === 'NOT_ELIGIBLE') return 'NOT_APPLICABLE';
  return 'UNKNOWN';
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

function gapRows(value: Prisma.JsonValue): JsonRecord[] {
  return asArray(value).flatMap((item) => {
    const record = asRecord(item);
    return record ? [record] : [];
  });
}

export async function loadGrowthEvidence(
  projectId: string,
  canonicalPages: readonly string[],
  window: GrowthEvidenceWindow
): Promise<GrowthEvidence[]> {
  if (!projectId.trim()) throw new Error('projectId is required');
  assertWindow(window);
  const pages = normalizePages(canonicalPages);
  const pageRows = pages.length === 0
    ? []
    : await prisma.page.findMany({
        where: { projectId, normalizedUrl: { in: pages } },
        select: { id: true, normalizedUrl: true },
        take: GROWTH_EVIDENCE_MAX_PAGES
      });
  const pageIds = pageRows.map((row) => row.id);
  const evidence: GrowthEvidence[] = [];

  const seoAudit = await prisma.seoAuditRun.findFirst({
    where: { projectId, status: 'COMPLETED' },
    orderBy: [{ finishedAt: 'desc' }, { createdAt: 'desc' }],
    select: { id: true }
  });
  if (seoAudit && pageIds.length > 0) {
    const rows = await prisma.seoRuleResult.findMany({
      where: { auditRunId: seoAudit.id, pageId: { in: pageIds } },
      include: {
        page: { select: { normalizedUrl: true } },
        ruleVersion: { include: { seoRule: { select: { ruleCode: true, name: true } } } }
      },
      orderBy: { createdAt: 'asc' },
      take: GROWTH_EVIDENCE_MAX_ROWS_PER_SOURCE
    });
    for (const row of rows) {
      const canonicalPage = row.page?.normalizedUrl ?? null;
      const ruleKey = row.ruleVersion.seoRule.ruleCode;
      evidence.push(
        withFingerprint({
          sourceModule: 'P2_SEO',
          sourceType: 'SEO_RULE_RESULT',
          sourceId: row.id,
          sourceFactVersion: `${row.ruleVersion.id}:v${row.ruleVersion.version}`,
          ruleKey,
          rootCauseKey: `P2_SEO:${ruleKey}:${canonicalPage ?? 'project'}`,
          evidenceState: row.outcome,
          severity: mapSeoSeverity(row.ruleVersion.severity),
          canonicalPage,
          numericValue: null,
          textSummary: `${row.ruleVersion.seoRule.name}: ${row.outcome}`
        })
      );
    }
  }

  const geoAudit = await prisma.geoAuditRun.findFirst({
    where: { projectId, status: 'COMPLETED' },
    orderBy: [{ finishedAt: 'desc' }, { createdAt: 'desc' }],
    select: { id: true }
  });
  if (geoAudit && pageIds.length > 0) {
    const rows = await prisma.geoRuleResult.findMany({
      where: { geoAuditRunId: geoAudit.id, pageId: { in: pageIds } },
      include: {
        page: { select: { normalizedUrl: true } },
        ruleVersion: { include: { geoRule: { select: { ruleCode: true, name: true } } } }
      },
      orderBy: { createdAt: 'asc' },
      take: GROWTH_EVIDENCE_MAX_ROWS_PER_SOURCE
    });
    for (const row of rows) {
      const module = geoModule(row.ruleVersion.dimension);
      const rootPrefix = module;
      evidence.push(
        withFingerprint({
          sourceModule: module,
          sourceType: 'GEO_RULE_RESULT',
          sourceId: row.id,
          sourceFactVersion: `${row.ruleVersion.id}:v${row.ruleVersion.version}`,
          ruleKey: row.ruleVersion.geoRule.ruleCode,
          rootCauseKey: `${rootPrefix}:${row.id}`,
          evidenceState: row.outcome,
          severity: mapPriority(row.ruleVersion.severity),
          canonicalPage: row.page?.normalizedUrl ?? null,
          numericValue: null,
          textSummary: `${row.ruleVersion.geoRule.name}: ${row.outcome}`
        })
      );
    }
  }

  if (pages.length > 0) {
    const rows = await prisma.contentSignal.findMany({
      where: { projectId, document: { canonicalUrl: { in: pages } } },
      include: { document: { select: { canonicalUrl: true, contentHash: true } } },
      orderBy: { createdAt: 'asc' },
      take: GROWTH_EVIDENCE_MAX_ROWS_PER_SOURCE
    });
    for (const row of rows) {
      const fallbackRoot = `P5_CONTENT:${row.ruleKey}:${row.document.canonicalUrl}`;
      evidence.push(
        withFingerprint({
          sourceModule: 'P5_CONTENT',
          sourceType: 'CONTENT_SIGNAL',
          sourceId: row.id,
          sourceFactVersion: `v${row.ruleVersion}:${row.document.contentHash}`,
          ruleKey: row.ruleKey,
          rootCauseKey: rootCauseFromReferences(row.sourceReferences, fallbackRoot),
          evidenceState: row.status,
          severity: row.status === 'UNKNOWN' ? null : mapPriority(row.priority),
          canonicalPage: row.document.canonicalUrl,
          numericValue: row.numericValue,
          textSummary: row.textValue ?? `${row.ruleKey}: ${row.status}`
        })
      );
    }
  }

  const comparisons = await prisma.competitorComparison.findMany({
    where: { projectId, createdAt: { lte: window.end } },
    orderBy: { createdAt: 'desc' },
    take: 50
  });
  for (const comparison of comparisons) {
    const gaps = gapRows(comparison.gaps);
    for (const [index, gap] of gaps.entries()) {
      const canonicalPage = readString(gap, 'canonicalPage');
      if (canonicalPage && pages.length > 0 && !pages.includes(canonicalPage)) continue;
      const type = readString(gap, 'type') ?? 'GAP';
      const severity = mapPriority(readString(gap, 'severity'));
      evidence.push(
        withFingerprint({
          sourceModule: 'P5_COMPETITOR',
          sourceType: 'COMPETITOR_GAP',
          sourceId: `${comparison.id}:${index}`,
          sourceFactVersion: comparison.comparisonVersion,
          ruleKey: `COMPETITOR_${type}`,
          rootCauseKey: `P5_COMPETITOR:${comparison.competitorId}:${type}:${canonicalPage ?? 'project'}`,
          evidenceState: 'FAIL',
          severity,
          canonicalPage,
          numericValue: null,
          textSummary: `Competitor gap: ${type}`
        })
      );
    }
  }

  const visibilitySnapshot = await prisma.visibilityMetricSnapshot.findFirst({
    where: {
      projectId,
      status: 'COMPLETED',
      windowStart: { lte: window.end },
      windowEnd: { gte: window.start }
    },
    orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
    include: {
      rows: {
        where: { dimensionType: 'OVERALL', actorType: 'OWNED_ROLLUP' },
        orderBy: [{ metricType: 'asc' }, { actorKey: 'asc' }]
      }
    }
  });

  if (visibilitySnapshot) {
    for (const row of visibilitySnapshot.rows) {
      evidence.push(
        withFingerprint({
          sourceModule: 'P6_VISIBILITY',
          sourceType: 'VISIBILITY_METRIC_ROW',
          sourceId: row.id,
          sourceFactVersion: `${visibilitySnapshot.formulaVersion}:${visibilitySnapshot.id}`,
          ruleKey: `P6_${row.metricType}`,
          rootCauseKey: `P6_VISIBILITY:${row.metricType}:${row.actorKey}`,
          evidenceState: visibilityState(row.metricStatus),
          severity: null,
          canonicalPage: null,
          numericValue: ratio(row.numerator, row.denominator),
          textSummary: `${row.metricType}: ${row.metricStatus}`
        })
      );
    }

    const comparison = await prisma.visibilityMetricComparison.findFirst({
      where: { projectId, currentSnapshotId: visibilitySnapshot.id },
      orderBy: { createdAt: 'desc' },
      include: {
        rows: {
          where: { dimensionType: 'OVERALL', actorType: 'OWNED_ROLLUP' },
          orderBy: [{ metricType: 'asc' }, { actorKey: 'asc' }]
        }
      }
    });
    if (comparison) {
      for (const row of comparison.rows) {
        evidence.push(
          withFingerprint({
            sourceModule: 'P6_VISIBILITY',
            sourceType: 'VISIBILITY_METRIC_DELTA',
            sourceId: row.id,
            sourceFactVersion: comparison.comparisonVersion,
            ruleKey: `P6_${row.metricType}_DELTA`,
            rootCauseKey: `P6_VISIBILITY:${row.metricType}:${row.actorKey}`,
            evidenceState: visibilityState(row.currentMetricStatus),
            severity: null,
            canonicalPage: null,
            numericValue: row.deltaBasisPoints,
            textSummary: `${row.metricType} delta: ${row.deltaBasisPoints ?? 'UNKNOWN'} basis points`
          })
        );
      }
    }
  }

  const alerts = await prisma.visibilityAlertEvent.findMany({
    where: { projectId, triggeredAt: { gte: window.start, lte: window.end } },
    orderBy: { triggeredAt: 'desc' },
    include: { rule: { select: { ruleType: true } } },
    take: 500
  });
  for (const alert of alerts) {
    evidence.push(
      withFingerprint({
        sourceModule: 'P6_ALERT',
        sourceType: 'VISIBILITY_ALERT_EVENT',
        sourceId: alert.id,
        sourceFactVersion: alert.eventFingerprint,
        ruleKey: `P6_ALERT_${alert.rule.ruleType}`,
        rootCauseKey: `P6_ALERT:${alert.rule.ruleType}:${alert.actorKey ?? 'project'}`,
        evidenceState: alert.status === 'RESOLVED' ? 'PASS' : 'FAIL',
        severity: mapPriority(alert.severity),
        canonicalPage: null,
        numericValue: alert.deltaBasisPoints,
        textSummary: alert.reasonCode
      })
    );
  }

  return dedupeGrowthEvidence(evidence).provenance;
}
