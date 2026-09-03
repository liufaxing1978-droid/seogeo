import { NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import {
  keywordCoverageService,
  type KeywordCoverageService,
} from './keyword-coverage.service.js';
import {
  keywordSearchEvidenceService,
  type KeywordSearchEvidenceResult,
  type KeywordSearchEvidenceService,
} from './keyword-search-evidence.service.js';
import { KeywordRepository } from './keyword.repository.js';
import { KeywordOpportunityRepository } from './keyword-opportunity.repository.js';
import type {
  KeywordOpportunityBreakdownEntry,
  KeywordOpportunityComponentName,
} from './keyword-opportunity-score.js';
import type { KeywordCoverageResult, KeywordListRecord } from './keyword.types.js';
import type { KeywordListQuery } from './keyword.schema.js';
import { resolveEffectiveTargetUrl } from './keyword-target-url.js';

export interface KeywordCenterKeywordRecord extends KeywordListRecord {
  parentKeywordId: string | null;
  groupIds: string[];
  entityIds: string[];
  coverage: KeywordCoverageResult;
  searchEvidence: KeywordSearchEvidenceResult;
  opportunity: null | {
    id: string;
    score: number | null;
    dataConfidence: number;
    formulaVersion: string;
    breakdown: Record<KeywordOpportunityComponentName, KeywordOpportunityBreakdownEntry>;
    createdAt: Date;
  };
  target: { state: 'DIRECT' | 'INHERITED' | 'UNMAPPED' | 'AMBIGUOUS'; url: string | null };
  cannibalization: null | { risk: string; recommendedAction: string | null; confidence: number | null; createdAt: Date };
  contentGap: null | {
    status: 'OPEN' | 'CONTENT_PLANNED' | 'IN_PROGRESS' | 'RESOLVED' | 'IGNORED';
    coverageStatus: string;
    reasonCodes: string[];
    contentEntryHref: string;
  };
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
  keywordOptions: Array<{ id: string; text: string; status: string; locked: boolean }>;
  groups: Array<{ id: string; name: string; primaryKeywordId: string | null; entityIds: string[] }>;
  entityOptions: Array<{ id: string; canonicalName: string; entityType: string }>;
  suggestions: Array<{
    id: string;
    seedKeywordId: string;
    suggestedText: string;
    suggestedType: string | null;
    suggestedIntent: string | null;
    category: 'RELATED' | 'LONG_TAIL' | 'QUESTION';
    status: string;
    rationale: string | null;
  }>;
  filters: KeywordListQuery;
}

export class KeywordWebRepository {
  constructor(
    private readonly coverageService: KeywordCoverageService = keywordCoverageService,
    private readonly keywordRepository = new KeywordRepository(),
    private readonly searchEvidenceService: Pick<KeywordSearchEvidenceService, 'evaluateProject'> = keywordSearchEvidenceService,
    private readonly opportunityRepository = new KeywordOpportunityRepository(),
  ) {}

  async load(projectId: string, filters: KeywordListQuery = {}): Promise<KeywordCenterViewModel> {
    const [project, keywords, keywordOptions, relations, groups, memberships, suggestions, targets, cannibalization, contentGaps, entityMappings, entities] = await Promise.all([
      prisma.project.findUnique({
        where: { id: projectId },
        select: {
          id: true,
          name: true,
          defaultLanguage: true,
          targetCountry: true,
        },
      }),
      this.keywordRepository.listKeywords(projectId, filters),
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
          suggestedType: true,
          suggestedIntent: true,
          status: true,
          rationale: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      prisma.keywordTargetMapping.findMany({ where: { projectId }, select: { keywordId: true, groupId: true, normalizedUrl: true } }),
      prisma.keywordCannibalizationSnapshot.findMany({ where: { projectId, keywordId: { not: null } }, orderBy: { createdAt: 'desc' }, select: { keywordId: true, risk: true, recommendedAction: true, confidence: true, createdAt: true } }),
      prisma.keywordContentGap.findMany({ where: { projectId, keywordId: { not: null } }, select: { keywordId: true, status: true, coverageStatus: true, reasonCodes: true } }),
      prisma.keywordEntityMapping.findMany({ where: { projectId }, select: { keywordId: true, groupId: true, entityId: true } }),
      prisma.entity.findMany({ where: { projectId, status: 'ACTIVE' }, select: { id: true, canonicalName: true, entityType: true }, orderBy: { canonicalName: 'asc' } }),
    ]);

    if (!project) {
      throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
    }

    const [coverageByKeyword, searchEvidenceByKeyword, opportunityByKeyword] = await Promise.all([
      this.coverageService.evaluateProject(projectId, keywords),
      this.searchEvidenceService.evaluateProject(projectId, keywords),
      this.opportunityRepository.findLatestForKeywords(
        projectId,
        keywords.map((keyword) => keyword.id),
      ),
    ]);
    const parentByChild = new Map(relations.map((item) => [item.childKeywordId, item.parentKeywordId]));
    const targetByKeyword = new Map(targets.flatMap((item) => item.keywordId ? [[item.keywordId, item.normalizedUrl] as const] : []));
    const targetByGroup = new Map(targets.flatMap((item) => item.groupId ? [[item.groupId, item.normalizedUrl] as const] : []));
    const cannibalizationByKeyword = new Map<string, (typeof cannibalization)[number]>();
    for (const item of cannibalization) if (item.keywordId && !cannibalizationByKeyword.has(item.keywordId)) cannibalizationByKeyword.set(item.keywordId, item);
    const contentGapByKeyword = new Map(contentGaps.flatMap((item) => item.keywordId ? [[item.keywordId, item] as const] : []));
    const groupsByKeyword = new Map<string, string[]>();
    for (const membership of memberships) {
      const ids = groupsByKeyword.get(membership.keywordId) ?? [];
      ids.push(membership.groupId);
      groupsByKeyword.set(membership.keywordId, ids);
    }
    const entityIdsByKeyword = new Map<string, string[]>();
    const entityIdsByGroup = new Map<string, string[]>();
    for (const mapping of entityMappings) {
      if (mapping.keywordId) (entityIdsByKeyword.get(mapping.keywordId) ?? entityIdsByKeyword.set(mapping.keywordId, []).get(mapping.keywordId)!).push(mapping.entityId);
      if (mapping.groupId) (entityIdsByGroup.get(mapping.groupId) ?? entityIdsByGroup.set(mapping.groupId, []).get(mapping.groupId)!).push(mapping.entityId);
    }

    const rows: KeywordCenterKeywordRecord[] = keywords.map((keyword) => {
      const searchEvidence = searchEvidenceByKeyword.get(keyword.id);
      if (!searchEvidence) {
        throw new Error(`Keyword search evidence result missing for keyword ${keyword.id}`);
      }

      const opportunity = opportunityByKeyword.get(keyword.id);
      return {
        id: keyword.id,
        projectId: keyword.projectId,
        text: keyword.text,
        normalizedText: keyword.normalizedText,
        type: keyword.type,
        intent: keyword.intent,
        priority: keyword.priority,
        status: keyword.status,
        lifecycleStatus: keyword.lifecycleStatus,
        locked: keyword.locked,
        source: keyword.source,
        parentKeywordId: parentByChild.get(keyword.id) ?? null,
        groupIds: groupsByKeyword.get(keyword.id) ?? [],
        entityIds: entityIdsByKeyword.get(keyword.id) ?? [],
        coverage: coverageByKeyword.get(keyword.id) ?? {
          status: 'UNKNOWN',
          reason: 'NO_ACTIVE_PAGE_EVIDENCE',
          matches: [],
        },
        searchEvidence,
        opportunity: opportunity ? {
          id: opportunity.id,
          score: opportunity.score,
          dataConfidence: opportunity.dataConfidence,
          formulaVersion: opportunity.formulaVersion,
          breakdown: opportunity.breakdown as unknown as Record<
            KeywordOpportunityComponentName,
            KeywordOpportunityBreakdownEntry
          >,
          createdAt: opportunity.createdAt,
        } : null,
        target: resolveEffectiveTargetUrl({ direct: targetByKeyword.get(keyword.id) ?? null, inherited: (groupsByKeyword.get(keyword.id) ?? []).flatMap((groupId) => targetByGroup.get(groupId) ?? []) }),
        cannibalization: cannibalizationByKeyword.get(keyword.id) ?? null,
        contentGap: contentGapByKeyword.get(keyword.id) ? {
          status: contentGapByKeyword.get(keyword.id)!.status,
          coverageStatus: contentGapByKeyword.get(keyword.id)!.coverageStatus,
          reasonCodes: contentGapByKeyword.get(keyword.id)!.reasonCodes as string[],
          contentEntryHref: `/projects/${projectId}/content`,
        } : null,
      };
    });

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
      keywordOptions: keywordOptions.map((keyword) => ({
        id: keyword.id,
        text: keyword.text,
        status: keyword.status,
        locked: keyword.locked,
      })),
      groups: groups.map((group) => ({
        id: group.id,
        name: group.name,
        primaryKeywordId: group.primaryKeywordId,
        entityIds: entityIdsByGroup.get(group.id) ?? [],
      })),
      entityOptions: entities,
      suggestions: suggestions.map((suggestion) => ({
        id: suggestion.id,
        seedKeywordId: suggestion.seedKeywordId,
        suggestedText: suggestion.suggestedText,
        suggestedType: suggestion.suggestedType,
        suggestedIntent: suggestion.suggestedIntent,
        category: suggestion.suggestedType === 'QUESTION'
          ? 'QUESTION'
          : suggestion.suggestedType === 'LONG_TAIL'
            ? 'LONG_TAIL'
            : 'RELATED',
        status: suggestion.status,
        rationale: suggestion.rationale,
      })),
      filters,
    };
  }
}
