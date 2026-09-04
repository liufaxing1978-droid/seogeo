import type { Keyword } from '@prisma/client';
import { NotFoundError } from '../../core/errors.js';
import {
  keywordCoverageService,
  type KeywordCoverageService,
} from './keyword-coverage.service.js';
import type { KeywordCoverageResult } from './keyword.types.js';
import {
  KeywordOpportunityRepository,
} from './keyword-opportunity.repository.js';
import {
  scoreKeywordOpportunity,
  type KeywordOpportunityComponentInput,
  type KeywordOpportunityScoreInput,
} from './keyword-opportunity-score.js';
import { KeywordRepository } from './keyword.repository.js';
import {
  keywordSearchEvidenceService,
  type KeywordSearchEvidenceResult,
  type KeywordSearchEvidenceService,
} from './keyword-search-evidence.service.js';

const unknown = (): KeywordOpportunityComponentInput => ({
  state: 'UNKNOWN',
  score: null,
  provenance: [],
});

function known(score: number, provenance: string[]): KeywordOpportunityComponentInput {
  return { state: 'KNOWN', score, provenance };
}

function demandComponent(
  evidence: KeywordSearchEvidenceResult,
): KeywordOpportunityComponentInput {
  const lanes = evidence.evidence.filter((item) =>
    item.kind === 'LANE'
    && item.state === 'OBSERVED'
    && item.metrics.impressions !== null);
  if (lanes.length === 0) return unknown();

  const impressions = lanes.reduce((sum, lane) => sum + lane.metrics.impressions!, 0);
  const score = Math.min(100, Math.round(Math.log10(impressions + 1) / 4 * 100));
  return known(score, lanes.map((lane) => [
    'OFFICIAL_SEARCH_IMPRESSIONS',
    lane.provider,
    lane.marketCode,
    lane.locale,
    lane.snapshotIds.join(','),
    String(lane.metrics.impressions),
  ].join(':')));
}

function rankingOpportunityScore(position: number): number {
  if (position <= 3) return 20;
  if (position <= 10) return 70;
  if (position <= 20) return 100;
  if (position <= 50) return 70;
  if (position <= 100) return 40;
  return 20;
}

function rankingComponent(
  evidence: KeywordSearchEvidenceResult,
): KeywordOpportunityComponentInput {
  const lanes = evidence.evidence
    .filter((item) => item.kind === 'LANE' && item.state === 'OBSERVED')
    .sort((left, right) => {
      const priority = (provider: string) => provider === 'GOOGLE_SEARCH_CONSOLE' ? 0 : 1;
      return priority(left.provider) - priority(right.provider);
    });

  for (const lane of lanes) {
    const position = lane.provider === 'GOOGLE_SEARCH_CONSOLE'
      ? lane.metrics.searchConsoleAveragePosition
      : lane.metrics.bingAverageImpressionPosition ?? lane.metrics.bingAverageClickPosition;
    if (position === null) continue;
    return known(rankingOpportunityScore(position), [[
      'OFFICIAL_SEARCH_POSITION',
      lane.provider,
      lane.marketCode,
      lane.locale,
      lane.snapshotIds.join(','),
      String(position),
    ].join(':')]);
  }

  return unknown();
}

function coverageComponents(coverage: KeywordCoverageResult): {
  contentGap: KeywordOpportunityComponentInput;
  authorityFit: KeywordOpportunityComponentInput;
} {
  const provenance = [`PAGE_COVERAGE:${coverage.status}:${coverage.reason}`];
  if (coverage.status === 'NONE') {
    return { contentGap: known(100, provenance), authorityFit: known(30, provenance) };
  }
  if (coverage.status === 'PARTIAL') {
    return { contentGap: known(65, provenance), authorityFit: known(65, provenance) };
  }
  if (coverage.status === 'STRONG') {
    return { contentGap: known(20, provenance), authorityFit: known(100, provenance) };
  }
  return { contentGap: unknown(), authorityFit: unknown() };
}

function strategicComponent(keyword: Pick<Keyword, 'priority'>): KeywordOpportunityComponentInput {
  const score = { HIGH: 100, MEDIUM: 60, LOW: 25 }[keyword.priority];
  return known(score, [`KEYWORD_PRIORITY:${keyword.priority}`]);
}

function geoComponent(
  keyword: Pick<Keyword, 'type' | 'intent'>,
): KeywordOpportunityComponentInput {
  const intentScores = {
    INFORMATIONAL: 90,
    NAVIGATIONAL: 45,
    COMMERCIAL_INVESTIGATION: 85,
    TRANSACTIONAL: 60,
    LOCAL: 70,
  } as const;
  if (keyword.intent && keyword.intent !== 'UNKNOWN') {
    return known(intentScores[keyword.intent], [`KEYWORD_INTENT:${keyword.intent}`]);
  }

  const typeScores = {
    CORE: 65,
    LONG_TAIL: 80,
    BRAND: 70,
    QUESTION: 100,
    LOCAL: 75,
    COMMERCIAL: 70,
  } as const;
  return known(typeScores[keyword.type], [`KEYWORD_TYPE:${keyword.type}`]);
}

export function buildKeywordOpportunityScoreInput(input: {
  keyword: Pick<Keyword, 'type' | 'intent' | 'priority'>;
  searchEvidence: KeywordSearchEvidenceResult;
  coverage: KeywordCoverageResult;
}): KeywordOpportunityScoreInput {
  const coverage = coverageComponents(input.coverage);
  return {
    components: {
      relevance: unknown(),
      demand: demandComponent(input.searchEvidence),
      rankingOpportunity: rankingComponent(input.searchEvidence),
      difficulty: unknown(),
      contentGap: coverage.contentGap,
      authorityFit: coverage.authorityFit,
      strategicValue: strategicComponent(input.keyword),
      geoValue: geoComponent(input.keyword),
    },
  };
}

export class KeywordOpportunityService {
  constructor(
    private readonly repository = new KeywordOpportunityRepository(),
    private readonly keywordRepository = new KeywordRepository(),
    private readonly searchEvidenceService: Pick<KeywordSearchEvidenceService, 'evaluateKeyword'> = keywordSearchEvidenceService,
    private readonly coverageService: Pick<KeywordCoverageService, 'evaluateKeyword'> = keywordCoverageService,
  ) {}

  async calculate(projectId: string, keywordId: string, actorUserId: string) {
    const keyword = await this.keywordRepository.findKeyword(projectId, keywordId);
    if (!keyword) throw new NotFoundError('Keyword not found', 'KEYWORD_NOT_FOUND');

    const [searchEvidence, coverage] = await Promise.all([
      this.searchEvidenceService.evaluateKeyword(projectId, keywordId),
      this.coverageService.evaluateKeyword(projectId, keywordId),
    ]);
    const result = scoreKeywordOpportunity(buildKeywordOpportunityScoreInput({
      keyword,
      searchEvidence,
      coverage,
    }));
    return this.repository.appendSnapshot({
      projectId,
      keywordId,
      actorUserId,
      ...result,
    });
  }

  findLatest(projectId: string, keywordId: string) {
    return this.repository.findLatest(projectId, keywordId);
  }
}

export const keywordOpportunityService = new KeywordOpportunityService();
