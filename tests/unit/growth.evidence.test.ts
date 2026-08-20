import { describe, expect, it } from 'vitest';
import {
  dedupeGrowthEvidence,
  fingerprintGrowthEvidence,
  type GrowthEvidence
} from '../../src/modules/growth/growth-evidence.js';

function evidence(overrides: Partial<GrowthEvidence> = {}): GrowthEvidence {
  const base: Omit<GrowthEvidence, 'fingerprint'> = {
    sourceModule: 'P3_CITABILITY',
    sourceType: 'GEO_RULE_RESULT',
    sourceId: 'source-1',
    sourceFactVersion: 'v1',
    ruleKey: 'GEO_CITABILITY_READY',
    rootCauseKey: 'P3_CITABILITY:source-1',
    evidenceState: 'FAIL',
    severity: 'HIGH',
    canonicalPage: 'https://example.com/guide',
    numericValue: null,
    textSummary: 'Citability requirement failed.'
  };
  const merged = { ...base, ...overrides };
  return { ...merged, fingerprint: fingerprintGrowthEvidence(merged) };
}

describe('P7-A growth evidence normalization', () => {
  it('fingerprints stable provenance and changes when source fact version changes', () => {
    const a = evidence();
    const b = evidence();
    const c = evidence({ sourceFactVersion: 'v2' });
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(c.fingerprint).not.toBe(a.fingerprint);
  });

  it('keeps duplicate provenance rows visible while counting one root cause for scoring', () => {
    const p3 = evidence();
    const p5 = evidence({
      sourceModule: 'P5_CONTENT',
      sourceType: 'CONTENT_SIGNAL',
      sourceId: 'content-signal-1',
      sourceFactVersion: 'rule-v1',
      ruleKey: 'CONTENT_CITABILITY_SUPPORT',
      rootCauseKey: p3.rootCauseKey,
      severity: 'MEDIUM',
      textSummary: 'Content signal wraps the same P3 citability fact.'
    });

    const set = dedupeGrowthEvidence([p5, p3]);
    expect(set.provenance).toHaveLength(2);
    expect(set.scoringGroups).toHaveLength(1);
    expect(set.scoringGroups[0]?.rootCauseKey).toBe(p3.rootCauseKey);
    expect(set.scoringGroups[0]?.representative.sourceModule).toBe('P3_CITABILITY');
    expect(set.scoringGroups[0]?.provenance.map((row) => row.sourceModule).sort()).toEqual([
      'P3_CITABILITY',
      'P5_CONTENT'
    ]);
  });

  it('preserves UNKNOWN as UNKNOWN instead of manufacturing PASS or FAIL', () => {
    const unknown = evidence({
      sourceModule: 'P5_CONTENT',
      sourceId: 'unknown-1',
      ruleKey: 'CONTENT_BODY_SUBSTANTIVE',
      rootCauseKey: 'P5_CONTENT:CONTENT_BODY_SUBSTANTIVE:https://example.com/guide',
      evidenceState: 'UNKNOWN',
      severity: null,
      textSummary: 'Upstream evidence unavailable.'
    });

    const set = dedupeGrowthEvidence([unknown]);
    expect(set.scoringGroups[0]?.representative.evidenceState).toBe('UNKNOWN');
    expect(set.scoringGroups[0]?.representative.severity).toBeNull();
  });

  it('dedupes identical provenance fingerprints deterministically', () => {
    const row = evidence();
    const set = dedupeGrowthEvidence([row, { ...row }]);
    expect(set.provenance).toHaveLength(1);
    expect(set.scoringGroups).toHaveLength(1);
  });
});
