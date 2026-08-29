import { describe, expect, it, vi } from 'vitest';
import type { KeywordCoverageService } from '../../src/modules/keywords/keyword-coverage.service.js';
import type {
  KeywordSearchEvidenceResult,
  KeywordSearchEvidenceService,
} from '../../src/modules/keywords/keyword-search-evidence.service.js';
import { keywordService } from '../../src/modules/keywords/keyword.service.js';
import { KeywordWebRepository } from '../../src/modules/keywords/keyword.web.repository.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

function evidenceFor(keyword: { id: string; text: string }): KeywordSearchEvidenceResult {
  return {
    keyword: {
      id: keyword.id,
      text: keyword.text,
      normalizedMatchText: keyword.text.normalize('NFKC').trim().toLocaleLowerCase('und'),
    },
    dateFrom: '2026-08-01',
    dateTo: '2026-08-28',
    evidence: [],
  };
}

function coverageService(): KeywordCoverageService {
  return {
    evaluateProject: vi.fn(async (_projectId: string, keywords: Array<{ id: string }>) => new Map(
      keywords.map((keyword) => [
        keyword.id,
        {
          status: 'UNKNOWN' as const,
          reason: 'NO_ACTIVE_PAGE_EVIDENCE' as const,
          matches: [],
        },
      ]),
    )),
  } as unknown as KeywordCoverageService;
}

describe('P11-02A keyword center search-evidence read model', () => {
  it('loads search evidence once for all keywords and attaches the matching result to each row', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OWNER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const first = await keywordService.createManual({
        actorUserId: fixture.user.id,
        projectId: fixture.project.id,
        text: '符纸',
        type: 'CORE',
      });
      const second = await keywordService.createManual({
        actorUserId: fixture.user.id,
        projectId: fixture.project.id,
        text: '六壬符纸',
        type: 'LONG_TAIL',
      });
      const expected = new Map([
        [first.id, evidenceFor(first)],
        [second.id, evidenceFor(second)],
      ]);
      const evaluateProject = vi.fn(async () => expected);
      const searchEvidenceService = { evaluateProject } as unknown as KeywordSearchEvidenceService;
      const repository = new (KeywordWebRepository as any)(
        coverageService(),
        undefined,
        searchEvidenceService,
      ) as KeywordWebRepository;

      const model = await repository.load(fixture.project.id);

      expect(evaluateProject).toHaveBeenCalledTimes(1);
      expect(evaluateProject).toHaveBeenCalledWith(
        fixture.project.id,
        expect.arrayContaining([
          expect.objectContaining({ id: first.id, text: first.text }),
          expect.objectContaining({ id: second.id, text: second.text }),
        ]),
      );
      expect((model.keywords.find((item) => item.id === first.id) as any)?.searchEvidence)
        .toEqual(expected.get(first.id));
      expect((model.keywords.find((item) => item.id === second.id) as any)?.searchEvidence)
        .toEqual(expected.get(second.id));
    } finally {
      await fixture.cleanup();
    }
  });

  it('fails closed when bulk search evidence omits an authoritative keyword', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OWNER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const keyword = await keywordService.createManual({
        actorUserId: fixture.user.id,
        projectId: fixture.project.id,
        text: '符纸',
        type: 'CORE',
      });
      const evaluateProject = vi.fn(async () => new Map<string, KeywordSearchEvidenceResult>());
      const searchEvidenceService = { evaluateProject } as unknown as KeywordSearchEvidenceService;
      const repository = new (KeywordWebRepository as any)(
        coverageService(),
        undefined,
        searchEvidenceService,
      ) as KeywordWebRepository;

      await expect(repository.load(fixture.project.id)).rejects.toThrow();
      expect(evaluateProject).toHaveBeenCalledTimes(1);
      expect(evaluateProject).toHaveBeenCalledWith(
        fixture.project.id,
        expect.arrayContaining([expect.objectContaining({ id: keyword.id })]),
      );
    } finally {
      await fixture.cleanup();
    }
  });
});
