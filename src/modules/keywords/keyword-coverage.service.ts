import { NotFoundError } from '../../core/errors.js';
import { resolveKeywordCoverage } from './keyword-coverage.js';
import { KeywordCoverageRepository } from './keyword-coverage.repository.js';
import { KeywordRepository } from './keyword.repository.js';

export class KeywordCoverageService {
  constructor(
    private readonly coverageRepository = new KeywordCoverageRepository(),
    private readonly keywordRepository = new KeywordRepository(),
  ) {}

  async evaluateProject(
    projectId: string,
    keywords: Array<{ id: string; text: string }>,
  ) {
    const facts = await this.coverageRepository.listActivePageFacts(projectId);
    return new Map(
      keywords.map((keyword) => [
        keyword.id,
        resolveKeywordCoverage(keyword.text, facts.usablePages, facts.emptyReason),
      ]),
    );
  }

  async evaluateKeyword(projectId: string, keywordId: string) {
    const keyword = await this.keywordRepository.findKeyword(projectId, keywordId);
    if (!keyword) {
      throw new NotFoundError('Keyword not found', 'KEYWORD_NOT_FOUND');
    }

    const coverage = await this.evaluateProject(projectId, [keyword]);
    return coverage.get(keyword.id)!;
  }
}

export const keywordCoverageService = new KeywordCoverageService();
