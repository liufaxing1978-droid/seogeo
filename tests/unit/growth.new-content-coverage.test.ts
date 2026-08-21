import { describe, expect, it } from 'vitest';
import { summarizeNewContentCoverageEvidence } from '../../src/modules/growth/growth.service.js';

type Evidence = Parameters<typeof summarizeNewContentCoverageEvidence>[0][number];

function evidence(
  sourceModule: Evidence['sourceModule'],
  ruleKey: string,
  evidenceState: Evidence['evidenceState']
): Evidence {
  return { sourceModule, ruleKey, evidenceState };
}

describe('P7-A new-content coverage evidence boundary', () => {
  it('accepts entity, citability, content-GEO and P5 content facts only', () => {
    expect(summarizeNewContentCoverageEvidence([
      evidence('P3_ENTITY', 'ENTITY_ABOUT_PAGE_MISSING', 'FAIL')
    ])).toEqual({ evidenceKnown: true, hasCoverageGap: true, eligibleEvidenceCount: 1 });

    expect(summarizeNewContentCoverageEvidence([
      evidence('P3_CITABILITY', 'CITABILITY_NO_SUMMARY_BLOCK', 'PASS')
    ])).toEqual({ evidenceKnown: true, hasCoverageGap: false, eligibleEvidenceCount: 1 });

    expect(summarizeNewContentCoverageEvidence([
      evidence('P3_GEO', 'CONTENT_GEO_SUMMARY_ABSENT', 'FAIL')
    ])).toEqual({ evidenceKnown: true, hasCoverageGap: true, eligibleEvidenceCount: 1 });

    expect(summarizeNewContentCoverageEvidence([
      evidence('P5_CONTENT', 'CONTENT_TOPIC_COVERAGE', 'FAIL')
    ])).toEqual({ evidenceKnown: true, hasCoverageGap: true, eligibleEvidenceCount: 1 });
  });

  it('does not treat brand, AI-crawler, SEO, competitor or P6 failures as content coverage evidence', () => {
    expect(summarizeNewContentCoverageEvidence([
      evidence('P3_GEO', 'BRAND_SITE_NAME_INCONSISTENT', 'FAIL'),
      evidence('P3_GEO', 'AI_CRAWLER_BLOCKED', 'FAIL'),
      evidence('P2_SEO', 'SEO_TITLE_MISSING', 'FAIL'),
      evidence('P5_COMPETITOR', 'COMPETITOR_CONTENT_GAP', 'FAIL'),
      evidence('P6_VISIBILITY', 'P6_MENTION_SHARE_OF_VOICE', 'FAIL')
    ])).toEqual({ evidenceKnown: false, hasCoverageGap: null, eligibleEvidenceCount: 0 });
  });

  it('ignores UNKNOWN/NOT_APPLICABLE eligible evidence until a known PASS or FAIL exists', () => {
    expect(summarizeNewContentCoverageEvidence([
      evidence('P3_ENTITY', 'ENTITY_AUTHOR_UNCLEAR', 'UNKNOWN'),
      evidence('P3_CITABILITY', 'CITABILITY_NO_SOURCE_LINKS', 'NOT_APPLICABLE'),
      evidence('P5_CONTENT', 'CONTENT_TOPIC_COVERAGE', 'UNKNOWN')
    ])).toEqual({ evidenceKnown: false, hasCoverageGap: null, eligibleEvidenceCount: 0 });
  });
});