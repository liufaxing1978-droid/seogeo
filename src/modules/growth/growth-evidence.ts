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

export type GrowthEvidenceWindow = { start: Date; end: Date };

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

type EvidenceInput = Omit<GrowthEvidence, 'fingerprint'>;
type JsonRecord = Record<string, unknown>;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, canonicalize(child)])
  );
}

export function fingerprintGrowthEvidence(input: EvidenceInput): string {
  const identity = {
    sourceModule: input.sourceModule,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceFactVersion: input.sourceFactVersion,
    ruleKey: input.ruleKey
  };
  return createHash('sha256').update(JSON.stringify(canonicalize(identity))).digest('hex');
}

function makeEvidence(input: EvidenceInput): GrowthEvidence {
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

function compareRepresentative(a: GrowthEvidence, b: GrowthEvidence): number {
  const state = stateRank[b.evidenceState] - stateRank[a.evidenceState];
  if (state) return state;
  const severity = (b.severity ? severityRank[b.severity] : 0) - (a.severity ? severityRank[a.severity] : 0);
  if (severity) return severity;
  return a.sourceModule.localeCompare(b.sourceModule) ||
    a.sourceId.localeCompare(b.sourceId) ||
    a.fingerprint.localeCompare(b.fingerprint);
}

export function dedupeGrowthEvidence(input: readonly GrowthEvidence[]): GrowthEvidenceSet {
  const byFingerprint = new Map<string, GrowthEvidence>();
  for (const row of input) {
    const existing = byFingerprint.get(row.fingerprint);
    if (!existing || compareRepresentative(row, existing) < 0) byFingerprint.set(row.fingerprint, row);
  }
  const provenance = [...byFingerprint.values()].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint));
  const roots = new Map<string, GrowthEvidence[]>();
  for (const row of provenance) roots.set(row.rootCauseKey, [...(roots.get(row.rootCauseKey) ?? []), row]);
  const scoringGroups = [...roots.entries()]
    .map(([rootCauseKey, rows]) => ({
      rootCauseKey,
      representative: [...rows].sort(compareRepresentative)[0]!,
      provenance: [...rows].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint))
    }))
    .sort((a, b) => a.rootCauseKey.localeCompare(b.rootCauseKey));
  return { provenance, scoringGroups };
}

function assertWindow(window: GrowthEvidenceWindow): void {
  if (Number.isNaN(window.start.getTime()) || Number.isNaN(window.end.getTime()) || window.start > window.end) {
    throw new RangeError('Growth evidence window must be valid and ordered');
  }
}

function normalizePages(values: readonly string[]): string[] {
  const pages = [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
  if (pages.length > GROWTH_EVIDENCE_MAX_PAGES) throw new RangeError('Too many Growth evidence pages');
  return pages;
}

function severity(value: string | null | undefined): GrowthEvidenceSeverity | null {
  if (value === 'CRITICAL' || value === 'HIGH') return 'HIGH';
  if (value === 'MEDIUM' || value === 'WARNING') return 'MEDIUM';
  if (value === 'LOW') return 'LOW';
  if (value === 'INFO') return 'INFO';
  return null;
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}
function asArray(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function readString(value: JsonRecord | null, key: string): string | null {
  const item = value?.[key];
  return typeof item === 'string' && item.trim() ? item : null;
}
function referenceRoot(value: Prisma.JsonValue | null, fallback: string): string {
  for (const item of asArray(value)) {
    const record = asRecord(item);
    const type = readString(record, 'type');
    const id = readString(record, 'id');
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

export async function loadGrowthEvidence(
  projectId: string,
  canonicalPages: readonly string[],
  window: GrowthEvidenceWindow
): Promise<GrowthEvidence[]> {
  if (!projectId.trim()) throw new Error('projectId is required');
  assertWindow(window);
  const pages = normalizePages(canonicalPages);
  const pageRows = pages.length === 0 ? [] : await prisma.page.findMany({
    where: { projectId, normalizedUrl: { in: pages } },
    select: { id: true, normalizedUrl: true },
    take: GROWTH_EVIDENCE_MAX_PAGES
  });
  const pageIds = pageRows.map((row) => row.id);
  const out: GrowthEvidence[] = [];

  const seoAudit = await prisma.seoAuditRun.findFirst({
    where: { projectId, status: 'COMPLETED' },
    orderBy: [{ finishedAt: 'desc' }, { createdAt: 'desc' }],
    select: { id: true }
  });
  if (seoAudit && pageIds.length) {
    const rows = await prisma.seoRuleResult.findMany({
      where: { auditRunId: seoAudit.id, pageId: { in: pageIds } },
      include: {
        page: { select: { normalizedUrl: true } },
        ruleVersion: { include: { seoRule: { select: { ruleCode: true, name: true } } } }
      },
      orderBy: { createdAt: 'asc' }, take: GROWTH_EVIDENCE_MAX_ROWS_PER_SOURCE
    });
    for (const row of rows) {
      const canonicalPage = row.page?.normalizedUrl ?? null;
      const ruleKey = row.ruleVersion.seoRule.ruleCode;
      out.push(makeEvidence({
        sourceModule: 'P2_SEO', sourceType: 'SEO_RULE_RESULT', sourceId: row.id,
        sourceFactVersion: `${row.ruleVersion.id}:v${row.ruleVersion.version}`, ruleKey,
        rootCauseKey: `P2_SEO:${ruleKey}:${canonicalPage ?? 'project'}`,
        evidenceState: row.outcome, severity: severity(row.ruleVersion.severity), canonicalPage,
        numericValue: null, textSummary: `${row.ruleVersion.seoRule.name}: ${row.outcome}`
      }));
    }
  }

  const geoAudit = await prisma.geoAuditRun.findFirst({
    where: { projectId, status: 'COMPLETED' },
    orderBy: [{ finishedAt: 'desc' }, { createdAt: 'desc' }], select: { id: true }
  });
  if (geoAudit && pageIds.length) {
    const rows = await prisma.geoRuleResult.findMany({
      where: { geoAuditRunId: geoAudit.id, pageId: { in: pageIds } },
      include: {
        page: { select: { normalizedUrl: true } },
        ruleVersion: { include: { geoRule: { select: { ruleCode: true, name: true } } } }
      },
      orderBy: { createdAt: 'asc' }, take: GROWTH_EVIDENCE_MAX_ROWS_PER_SOURCE
    });
    for (const row of rows) {
      const module = geoModule(row.ruleVersion.dimension);
      out.push(makeEvidence({
        sourceModule: module, sourceType: 'GEO_RULE_RESULT', sourceId: row.id,
        sourceFactVersion: `${row.ruleVersion.id}:v${row.ruleVersion.version}`,
        ruleKey: row.ruleVersion.geoRule.ruleCode, rootCauseKey: `${module}:${row.id}`,
        evidenceState: row.outcome, severity: severity(row.ruleVersion.severity),
        canonicalPage: row.page?.normalizedUrl ?? null, numericValue: null,
        textSummary: `${row.ruleVersion.geoRule.name}: ${row.outcome}`
      }));
    }
  }

  if (pages.length) {
    const rows = await prisma.contentSignal.findMany({
      where: { projectId, document: { canonicalUrl: { in: pages } } },
      include: { document: { select: { canonicalUrl: true, contentHash: true } } },
      orderBy: { createdAt: 'asc' }, take: GROWTH_EVIDENCE_MAX_ROWS_PER_SOURCE
    });
    for (const row of rows) {
      out.push(makeEvidence({
        sourceModule: 'P5_CONTENT', sourceType: 'CONTENT_SIGNAL', sourceId: row.id,
        sourceFactVersion: `v${row.ruleVersion}:${row.document.contentHash}`, ruleKey: row.ruleKey,
        rootCauseKey: referenceRoot(row.sourceReferences, `P5_CONTENT:${row.ruleKey}:${row.document.canonicalUrl}`),
        evidenceState: row.status, severity: row.status === 'UNKNOWN' ? null : severity(row.priority),
        canonicalPage: row.document.canonicalUrl, numericValue: row.numericValue,
        textSummary: row.textValue ?? `${row.ruleKey}: ${row.status}`
      }));
    }
  }

  // P2/P3/P5 are latest persisted site facts. The GSC stable window is a search-performance
  // measurement window and must not silently discard a newer completed site/competitor fact.
  const comparisons = await prisma.competitorComparison.findMany({
    where: { projectId }, orderBy: { createdAt: 'desc' }, take: 50
  });
  for (const comparison of comparisons) {
    for (const [index, item] of asArray(comparison.gaps).entries()) {
      const gap = asRecord(item);
      if (!gap) continue;
      const canonicalPage = readString(gap, 'canonicalPage');
      if (canonicalPage && pages.length && !pages.includes(canonicalPage)) continue;
      const type = readString(gap, 'type') ?? 'GAP';
      out.push(makeEvidence({
        sourceModule: 'P5_COMPETITOR', sourceType: 'COMPETITOR_GAP', sourceId: `${comparison.id}:${index}`,
        sourceFactVersion: comparison.comparisonVersion, ruleKey: `COMPETITOR_${type}`,
        rootCauseKey: `P5_COMPETITOR:${comparison.competitorId}:${type}:${canonicalPage ?? 'project'}`,
        evidenceState: 'FAIL', severity: severity(readString(gap, 'severity')), canonicalPage,
        numericValue: null, textSummary: `Competitor gap: ${type}`
      }));
    }
  }

  const visibilitySnapshot = await prisma.visibilityMetricSnapshot.findFirst({
    where: { projectId, status: 'COMPLETED', windowStart: { lte: window.end }, windowEnd: { gte: window.start } },
    orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
    include: { rows: { where: { dimensionType: 'OVERALL', actorType: 'OWNED_ROLLUP' }, orderBy: [{ metricType: 'asc' }, { actorKey: 'asc' }] } }
  });
  if (visibilitySnapshot) {
    for (const row of visibilitySnapshot.rows) {
      out.push(makeEvidence({
        sourceModule: 'P6_VISIBILITY', sourceType: 'VISIBILITY_METRIC_ROW', sourceId: row.id,
        sourceFactVersion: `${visibilitySnapshot.formulaVersion}:${visibilitySnapshot.id}`,
        ruleKey: `P6_${row.metricType}`, rootCauseKey: `P6_VISIBILITY:${row.metricType}:${row.actorKey}`,
        evidenceState: visibilityState(row.metricStatus), severity: null, canonicalPage: null,
        numericValue: ratio(row.numerator, row.denominator), textSummary: `${row.metricType}: ${row.metricStatus}`
      }));
    }
    const comparison = await prisma.visibilityMetricComparison.findFirst({
      where: { projectId, currentSnapshotId: visibilitySnapshot.id }, orderBy: { createdAt: 'desc' },
      include: { rows: { where: { dimensionType: 'OVERALL', actorType: 'OWNED_ROLLUP' }, orderBy: [{ metricType: 'asc' }, { actorKey: 'asc' }] } }
    });
    if (comparison) {
      for (const row of comparison.rows) {
        out.push(makeEvidence({
          sourceModule: 'P6_VISIBILITY', sourceType: 'VISIBILITY_METRIC_DELTA', sourceId: row.id,
          sourceFactVersion: comparison.comparisonVersion, ruleKey: `P6_${row.metricType}_DELTA`,
          rootCauseKey: `P6_VISIBILITY:${row.metricType}:${row.actorKey}`,
          evidenceState: visibilityState(row.currentMetricStatus), severity: null, canonicalPage: null,
          numericValue: row.deltaBasisPoints,
          textSummary: `${row.metricType} delta: ${row.deltaBasisPoints ?? 'UNKNOWN'} basis points`
        }));
      }
    }
  }

  const alerts = await prisma.visibilityAlertEvent.findMany({
    where: { projectId, triggeredAt: { gte: window.start, lte: window.end } },
    orderBy: { triggeredAt: 'desc' }, include: { rule: { select: { ruleType: true } } }, take: 500
  });
  for (const alert of alerts) {
    out.push(makeEvidence({
      sourceModule: 'P6_ALERT', sourceType: 'VISIBILITY_ALERT_EVENT', sourceId: alert.id,
      sourceFactVersion: alert.eventFingerprint, ruleKey: `P6_ALERT_${alert.rule.ruleType}`,
      rootCauseKey: `P6_ALERT:${alert.rule.ruleType}:${alert.actorKey ?? 'project'}`,
      evidenceState: alert.status === 'RESOLVED' ? 'PASS' : 'FAIL', severity: severity(alert.severity),
      canonicalPage: null, numericValue: alert.deltaBasisPoints, textSummary: alert.reasonCode
    }));
  }

  return dedupeGrowthEvidence(out).provenance;
}
