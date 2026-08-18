import type { ContentFacts } from './content.types.js';

export type ContentRuleStatus = 'PASS' | 'FAIL' | 'UNKNOWN';
export type ContentRulePriority = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH';

export interface RelatedContentFacts {
  entityCount: number | null;
  citabilityStatus: 'PASS' | 'FAIL' | 'UNKNOWN';
  schemaTypesKnown?: boolean;
}

export interface EvaluatedContentRule {
  ruleKey: string;
  ruleVersion: 1;
  status: ContentRuleStatus;
  priority: ContentRulePriority;
  category: string;
  summary: string;
  numericValue: number | null;
  textValue: string | null;
  opportunityKey: string;
  sourceReferences: Array<{ type: string; id: string }>;
}

const V1 = 1 as const;
export const CONTENT_RULESET_V1 = {
  version: V1,
  bodySubstantiveMinWords: 600,
  headingStructureMin: 2,
  internalLinkSupportMin: 3
} as const;

function textPresence(value: string | null): ContentRuleStatus {
  if (value === null) return 'UNKNOWN';
  return value.trim().length > 0 ? 'PASS' : 'FAIL';
}

function numericThreshold(value: number | null, min: number): ContentRuleStatus {
  if (value === null) return 'UNKNOWN';
  return value >= min ? 'PASS' : 'FAIL';
}

function makeRule(
  facts: ContentFacts,
  input: Omit<EvaluatedContentRule, 'ruleVersion' | 'opportunityKey' | 'sourceReferences'>
): EvaluatedContentRule {
  return {
    ...input,
    ruleVersion: V1,
    opportunityKey: `${input.ruleKey}:v${V1}`,
    sourceReferences: [{ type: 'PAGE_SNAPSHOT', id: facts.latestPageSnapshotId }]
  };
}

export function evaluateContentDocument(
  facts: ContentFacts,
  related: RelatedContentFacts
): EvaluatedContentRule[] {
  const schemaStatus: ContentRuleStatus =
    related.schemaTypesKnown === false ? 'UNKNOWN' : facts.schemaTypes.length > 0 ? 'PASS' : 'FAIL';
  const entityStatus: ContentRuleStatus =
    related.entityCount === null ? 'UNKNOWN' : related.entityCount > 0 ? 'PASS' : 'FAIL';

  return [
    makeRule(facts, {
      ruleKey: 'CONTENT_TITLE_PRESENT', status: textPresence(facts.title), priority: 'HIGH', category: 'BASICS',
      summary: '页面应具有可用标题。', numericValue: null, textValue: facts.title
    }),
    makeRule(facts, {
      ruleKey: 'CONTENT_H1_PRESENT', status: textPresence(facts.h1), priority: 'HIGH', category: 'BASICS',
      summary: '页面应具有明确 H1。', numericValue: null, textValue: facts.h1
    }),
    makeRule(facts, {
      ruleKey: 'CONTENT_META_DESCRIPTION_PRESENT', status: textPresence(facts.metaDescription), priority: 'MEDIUM', category: 'BASICS',
      summary: '页面应具有 meta description。', numericValue: null, textValue: facts.metaDescription
    }),
    makeRule(facts, {
      ruleKey: 'CONTENT_BODY_SUBSTANTIVE', status: numericThreshold(facts.wordCount, CONTENT_RULESET_V1.bodySubstantiveMinWords), priority: 'HIGH', category: 'DEPTH',
      summary: '正文应达到基础信息深度。', numericValue: facts.wordCount, textValue: null
    }),
    makeRule(facts, {
      ruleKey: 'CONTENT_HEADING_STRUCTURE', status: numericThreshold(facts.headingCount, CONTENT_RULESET_V1.headingStructureMin), priority: 'MEDIUM', category: 'STRUCTURE',
      summary: '正文应具有可解析的标题层级。', numericValue: facts.headingCount, textValue: null
    }),
    makeRule(facts, {
      ruleKey: 'CONTENT_INTERNAL_LINK_SUPPORT', status: numericThreshold(facts.internalLinkCount, CONTENT_RULESET_V1.internalLinkSupportMin), priority: 'MEDIUM', category: 'INTERNAL_LINKING',
      summary: '页面应获得足够的站内链接支持。', numericValue: facts.internalLinkCount, textValue: null
    }),
    makeRule(facts, {
      ruleKey: 'CONTENT_STRUCTURED_DATA_SUPPORT', status: schemaStatus, priority: 'LOW', category: 'STRUCTURED_DATA',
      summary: '在来源事实可确认时，页面应具有可用结构化数据。', numericValue: facts.schemaTypes.length, textValue: null
    }),
    {
      ...makeRule(facts, {
        ruleKey: 'CONTENT_ENTITY_SUPPORT', status: entityStatus, priority: 'MEDIUM', category: 'ENTITY',
        summary: '页面应与 P3 已识别实体形成明确关系。', numericValue: related.entityCount, textValue: null
      }),
      sourceReferences: [{ type: 'PAGE_ENTITY_FACTS', id: facts.pageId }]
    },
    {
      ...makeRule(facts, {
        ruleKey: 'CONTENT_CITABILITY_SUPPORT', status: related.citabilityStatus, priority: 'HIGH', category: 'CITABILITY',
        summary: '页面应满足 P3 可引用性确定性条件。', numericValue: null, textValue: related.citabilityStatus
      }),
      sourceReferences: [{ type: 'P3_CITABILITY', id: facts.pageId }]
    }
  ];
}
