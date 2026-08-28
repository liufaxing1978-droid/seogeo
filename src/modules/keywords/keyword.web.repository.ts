import { NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import {
  keywordCoverageService,
  type KeywordCoverageService,
} from './keyword-coverage.service.js';
import { KeywordRepository } from './keyword.repository.js';
import type { KeywordCoverageResult, KeywordListRecord } from './keyword.types.js';

export interface KeywordCenterKeywordRecord extends KeywordListRecord {
  parentKeywordId: string | null;
  groupIds: string[];
  coverage: KeywordCoverageResult;
}

export interface KeywordCenterViewModel {
  project: {
    id: string;
    name: string;
    defaultLanguage: string;
    targetCountry: string;
  };
  summary: {
    active: number;
    locked: number;
    strong: number;
    partial: number;
    none: number;
    unknown: number;
  };
  keywords: KeywordCenterKeywordRecord[];
  groups: Array<{ id: string; name: string }>;
  suggestions: Array<{
    id: string;
    seedKeywordId: string;
    suggestedText: string;
    status: string;
    rationale: string | null;
  }>;
}

export class KeywordWebRepository {
  constructor(
    private readonly coverageService: KeywordCoverageService = keywordCoverageService,
    private readonly keywordRepository = new KeywordRepository(),
  ) {}

  async load(projectId: string): Promise<KeywordCenterViewModel> {
    const [project, keywords, relations, groups, memberships, suggestions] = await Promise.all([
      prisma.project.findUnique({
        where: { id: projectId },
        select: {
          id: true,
          name: true,
          defaultLanguage: true,
          targetCountry: true,
        },
      }),
      this.keywordRepository.listKeywords(projectId),
      prisma.keywordRelation.findMany({
        where: { projectId },
        select: { childKeywordId: true, parentKeywordId: true },
      }),
      this.keywordRepository.listGroups(projectId),
      prisma.keywordGroupMembership.findMany({
        where: { projectId },
        select: { keywordId: true, groupId: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.keywordSuggestion.findMany({
        where: { projectId },
        select: {
          id: true,
          seedKeywordId: true,
          suggestedText: true,
          status: true,
          rationale: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);

    if (!project) {
      throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
    }

    const coverageByKeyword = await this.coverageService.evaluateProject(projectId, keywords);
    const parentByChild = new Map(relations.map((item) => [item.childKeywordId, item.parentKeywordId]));
    const groupsByKeyword = new Map<string, string[]>();
    for (const membership of memberships) {
      const ids = groupsByKeyword.get(membership.keywordId) ?? [];
      ids.push(membership.groupId);
      groupsByKeyword.set(membership.keywordId, ids);
    }

    const rows: KeywordCenterKeywordRecord[] = keywords.map((keyword) => ({
      id: keyword.id,
      projectId: keyword.projectId,
      text: keyword.text,
      normalizedText: keyword.normalizedText,
      type: keyword.type,
      intent: keyword.intent,
      priority: keyword.priority,
      status: keyword.status,
      locked: keyword.locked,
      source: keyword.source,
      parentKeywordId: parentByChild.get(keyword.id) ?? null,
      groupIds: groupsByKeyword.get(keyword.id) ?? [],
      coverage: coverageByKeyword.get(keyword.id) ?? {
        status: 'UNKNOWN',
        reason: 'NO_ACTIVE_PAGE_EVIDENCE',
        matches: [],
      },
    }));

    const summary = rows.reduce(
      (acc, row) => {
        if (row.status === 'ACTIVE') acc.active += 1;
        if (row.locked) acc.locked += 1;
        if (row.coverage.status === 'STRONG') acc.strong += 1;
        if (row.coverage.status === 'PARTIAL') acc.partial += 1;
        if (row.coverage.status === 'NONE') acc.none += 1;
        if (row.coverage.status === 'UNKNOWN') acc.unknown += 1;
        return acc;
      },
      { active: 0, locked: 0, strong: 0, partial: 0, none: 0, unknown: 0 },
    );

    return {
      project,
      summary,
      keywords: rows,
      groups: groups.map((group) => ({ id: group.id, name: group.name })),
      suggestions: suggestions.map((suggestion) => ({
        id: suggestion.id,
        seedKeywordId: suggestion.seedKeywordId,
        suggestedText: suggestion.suggestedText,
        status: suggestion.status,
        rationale: suggestion.rationale,
      })),
    };
  }
}
