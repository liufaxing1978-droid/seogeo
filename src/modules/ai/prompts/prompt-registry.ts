import type { AiGatewayFormat, AiGatewayMode } from '../ai.types.js';

export type PromptId =
  | 'seo-audit-analysis-v1'
  | 'geo-readiness-analysis-v1'
  | 'entity-enrichment-v1'
  | 'content-brief-v1'
  | 'content-optimization-v1'
  | 'competitor-gap-v1'
  | 'project-report-summary-v1'
  | 'visibility-trend-analysis-v1'
  | 'growth-opportunity-explanation-v1'
  | 'publication-content-brief-v1'
  | 'publication-article-generation-v1';

export interface PromptDefinition {
  id: PromptId;
  version: 'v1';
  mode: AiGatewayMode;
  responseFormat: AiGatewayFormat;
  system: string;
  buildUserMessage(facts: unknown): string;
}

const FACT_GUARDRAILS = `Use only the supplied facts.
Do not invent crawl, HTTP, ranking, citation, visibility or traffic facts.
Do not claim an issue is fixed unless the supplied deterministic facts say it is fixed.
Return JSON matching the output example exactly. Do not add markdown fences or prose outside the JSON.`;

function buildUserMessage(label: string, example: unknown, facts: unknown): string {
  return `${label}\n\nReturn JSON only.\nOutput example:\n${JSON.stringify(example, null, 2)}\n\nSupplied facts:\n${JSON.stringify(facts)}`;
}

const SEO_PROMPT: PromptDefinition = Object.freeze({
  id: 'seo-audit-analysis-v1', version: 'v1', mode: 'FAST', responseFormat: 'JSON',
  system: `${FACT_GUARDRAILS}\nAnalyze deterministic SEO audit facts. Prioritize practical actions, but never change factual issue state.`,
  buildUserMessage: (facts: unknown) => buildUserMessage('Analyze the deterministic SEO audit facts.', { summary: 'Short factual summary', priorities: [{ priority: 'HIGH', title: 'Action title', reason: 'Why it matters', sourceRefs: ['SEO_ISSUE:<id>'] }], recommendations: [{ title: 'Recommendation title', action: 'Concrete action', sourceRefs: ['SEO_ISSUE:<id>'] }] }, facts)
});

const GEO_PROMPT: PromptDefinition = Object.freeze({
  id: 'geo-readiness-analysis-v1', version: 'v1', mode: 'REASONING', responseFormat: 'JSON',
  system: `${FACT_GUARDRAILS}\nAnalyze deterministic GEO readiness facts. Treat null and UNKNOWN as unavailable evidence, never as zero. AI Visibility is unavailable unless explicitly supplied as a real sampled fact.`,
  buildUserMessage: (facts: unknown) => buildUserMessage('Analyze the deterministic GEO readiness facts.', { summary: 'Short factual summary', opportunities: [{ priority: 'HIGH', dimension: 'CITABILITY', title: 'Opportunity title', recommendation: 'Concrete recommendation', sourceRefs: ['GEO_RULE_RESULT:<id>'] }], unavailableFacts: ['Example unavailable fact'] }, facts)
});

const ENTITY_PROMPT: PromptDefinition = Object.freeze({
  id: 'entity-enrichment-v1', version: 'v1', mode: 'REASONING', responseFormat: 'JSON',
  system: `${FACT_GUARDRAILS}\nSuggest semantic entity enrichment only. Suggestions must not be presented as deterministic entity facts and must reference supplied source IDs.`,
  buildUserMessage: (facts: unknown) => buildUserMessage('Suggest semantic enrichment for the supplied deterministic entities.', { suggestions: [{ entityId: '00000000-0000-0000-0000-000000000000', suggestedDescription: 'Suggested description', suggestedAliases: ['Suggested alias'], rationale: 'Why the suggestion follows from supplied facts', sourceRefs: ['ENTITY:<id>'] }] }, facts)
});

const CONTENT_BRIEF_PROMPT: PromptDefinition = Object.freeze({
  id: 'content-brief-v1', version: 'v1', mode: 'REASONING', responseFormat: 'JSON',
  system: `${FACT_GUARDRAILS}\nCreate an advisory content brief from deterministic owned-content facts. Never claim rankings, traffic, citations or AI visibility. Every conclusion must stay traceable to supplied source references.`,
  buildUserMessage: (facts: unknown) => buildUserMessage('Create a content brief from the supplied deterministic facts.', { objective: 'Content objective', audience: 'Audience', primaryTopic: 'Primary topic', supportingTopics: ['Topic'], recommendedOutline: ['Section'], entitiesToCover: ['Entity'], questionsToAnswer: ['Question'], internalLinkSuggestions: ['Suggestion'], evidenceNotes: ['Evidence note'], sourceReferences: ['CONTENT_DOCUMENT:<id>'] }, facts)
});

const CONTENT_OPTIMIZATION_PROMPT: PromptDefinition = Object.freeze({
  id: 'content-optimization-v1', version: 'v1', mode: 'REASONING', responseFormat: 'JSON',
  system: `${FACT_GUARDRAILS}\nRecommend content improvements only. Do not rewrite deterministic audit state, and do not claim a recommendation is verified until a new deterministic refresh says so.`,
  buildUserMessage: (facts: unknown) => buildUserMessage('Recommend bounded content optimizations from the supplied deterministic facts.', { summary: 'Summary', priorities: [{ priority: 'HIGH', action: 'Action', sourceRefs: ['CONTENT_OPPORTUNITY:<id>'] }], sectionRecommendations: ['Recommendation'], entityRecommendations: ['Recommendation'], internalLinkRecommendations: ['Recommendation'], citabilityRecommendations: ['Recommendation'], doNotChange: ['Stable element'], sourceReferences: ['CONTENT_DOCUMENT:<id>'] }, facts)
});

const COMPETITOR_GAP_PROMPT: PromptDefinition = Object.freeze({
  id: 'competitor-gap-v1', version: 'v1', mode: 'REASONING', responseFormat: 'JSON',
  system: `${FACT_GUARDRAILS}\nExplain only the supplied deterministic owned-versus-competitor comparison. Do not invent search rankings, organic traffic, citations, AI visibility, market share or share of voice. Treat UNKNOWN as unavailable evidence.`,
  buildUserMessage: (facts: unknown) => buildUserMessage('Explain and prioritize the supplied deterministic competitor gaps.', { summary: 'Gap summary', priorities: [{ priority: 'HIGH', metric: 'averageWordCount', explanation: 'What the deterministic gap means', action: 'Concrete action', sourceRefs: ['COMPETITOR_COMPARISON:<id>'] }], unavailableClaims: ['search rankings'], sourceReferences: ['COMPETITOR_COMPARISON:<id>'] }, facts)
});

const PROJECT_REPORT_SUMMARY_PROMPT: PromptDefinition = Object.freeze({
  id: 'project-report-summary-v1', version: 'v1', mode: 'REASONING', responseFormat: 'JSON',
  system: `${FACT_GUARDRAILS}\nSummarize a persisted project report. Deterministic report facts are authoritative. Any supplied advisory AI material must stay labeled advisory. Do not invent AI Visibility, prompt rank, citation share, share of voice, search rankings or traffic. Treat null/UNKNOWN as unavailable evidence.`,
  buildUserMessage: (facts: unknown) => buildUserMessage('Create an executive summary from the supplied persisted report snapshot.', { summary: 'Executive summary', keyFindings: [{ category: 'SEO', finding: 'Finding grounded in the report', sourceRefs: ['REPORT_SNAPSHOT:<id>'] }], priorities: [{ priority: 'HIGH', action: 'Action', rationale: 'Why it matters', sourceRefs: ['REPORT_SNAPSHOT:<id>'] }], unavailableFacts: ['AI Visibility'], sourceReferences: ['REPORT_SNAPSHOT:<id>'] }, facts)
});

const VISIBILITY_TREND_PROMPT: PromptDefinition = Object.freeze({
  id: 'visibility-trend-analysis-v1', version: 'v1', mode: 'REASONING', responseFormat: 'JSON',
  system: `${FACT_GUARDRAILS}\nExplain only the supplied persisted AI Visibility trend facts. Treat UNKNOWN, NO_DATA, NOT_ELIGIBLE and NO_SIGNAL as non-numeric states, never as zero. The output is advisory only and must not claim that deterministic visibility facts, comparisons or alerts were changed. Do not invent prompt text, answer content, citation URLs, provider data, rankings or traffic.`,
  buildUserMessage: (facts: unknown) => buildUserMessage('Explain the supplied persisted AI Visibility trend and suggest bounded follow-up actions.', { summary: 'Trend summary', trends: [{ metricType: 'MENTION_RATE', direction: 'IMPROVED', explanation: 'Explanation grounded in supplied delta/status facts', sourceRefs: ['VISIBILITY_METRIC_COMPARISON:<id>'] }], priorities: [{ priority: 'HIGH', action: 'Follow-up action', rationale: 'Why the supplied facts support it', sourceRefs: ['VISIBILITY_METRIC_COMPARISON:<id>'] }], caveats: ['UNKNOWN is unavailable evidence, not zero.'], sourceReferences: ['VISIBILITY_METRIC_COMPARISON:<id>'] }, facts)
});

const GROWTH_OPPORTUNITY_EXPLANATION_PROMPT: PromptDefinition = Object.freeze({
  id: 'growth-opportunity-explanation-v1', version: 'v1', mode: 'REASONING', responseFormat: 'JSON',
  system: `${FACT_GUARDRAILS}\nExplain only the supplied persisted Growth opportunity facts. The deterministic score, priority, opportunity type, evidence states and lifecycle are authoritative and must never be changed by this output. Treat UNKNOWN, PARTIAL and null as unavailable or incomplete evidence, never as zero. The output is advisory only: recommend bounded follow-up actions, but do not claim any lifecycle transition, SEO/GEO fix, content change, redirect, canonical change or execution occurred. Do not invent rankings, traffic, citations, AI visibility or provider facts. Every action must cite supplied source references.`,
  buildUserMessage: (facts: unknown) => buildUserMessage('Explain the supplied persisted Growth opportunity and suggest bounded advisory actions.', { summary: 'Opportunity summary', whyNow: 'Why the supplied deterministic facts make this opportunity important now', actions: [{ priority: 'HIGH', action: 'Advisory follow-up action', rationale: 'Why supplied facts support the action', sourceRefs: ['GROWTH_OPPORTUNITY_SNAPSHOT:<id>'] }], caveats: ['UNKNOWN or PARTIAL evidence remains unavailable/incomplete, not zero.'], sourceReferences: ['GROWTH_OPPORTUNITY_SNAPSHOT:<id>'] }, facts)
});

const PUBLICATION_CONTENT_BRIEF_PROMPT: PromptDefinition = Object.freeze({
  id: 'publication-content-brief-v1', version: 'v1', mode: 'REASONING', responseFormat: 'JSON',
  system: `${FACT_GUARDRAILS}
Create an advisory publication content brief only from the supplied facts and supplied source references.
Do not invent historical or history claims, lineage or transmission claims, author or authorship claims, dates, ritual details, quotations, provenance, credentials, or source support.
A listed source is not automatically verified merely because it was supplied; preserve uncertainty and explicitly mark uncertain claims or claims that still need a source.
Never turn an advisory recommendation into an authoritative factual conclusion. Never claim publication, approval, verification, execution, or a site change occurred.
Every factual outline claim that depends on evidence must cite a supplied source reference. Do not create or return any source reference that was not supplied.`,
  buildUserMessage: (facts: unknown) => buildUserMessage('Create an advisory publication content brief from the supplied facts and supplied source references.', {
    summary: 'Advisory brief summary grounded in the supplied facts.',
    thesis: 'Conservative thesis bounded by supplied evidence.',
    outline: [{ heading: 'Section heading', purpose: 'What this section should establish without exceeding the evidence.', evidenceRefs: ['CONTENT_SOURCE_REFERENCE:<id>'] }],
    evidenceNeeds: [{ claim: 'Claim requiring support', status: 'NEEDS_SOURCE', sourceRefs: [] }],
    seo: { primaryKeyword: 'Primary keyword', secondaryKeywords: ['Secondary keyword'], titleIdeas: ['Title idea'], metaDescriptionNotes: 'Factual description guidance.' },
    geo: { answerTargets: ['Answer target'], entityNotes: ['Entity note'], citabilityNotes: ['Citability note'] },
    caveats: ['Historical, lineage, authorship, date and ritual claims need supplied evidence.'],
    sourceReferences: ['CONTENT_SOURCE_REFERENCE:<id>']
  }, facts)
});

const PUBLICATION_ARTICLE_GENERATION_PROMPT: PromptDefinition = Object.freeze({
  id: 'publication-article-generation-v1', version: 'v1', mode: 'FAST', responseFormat: 'JSON',
  system: `${FACT_GUARDRAILS}
Generate an advisory article draft only from the supplied facts, the supplied advisory brief, and supplied source references.
Do not invent historical or history claims, lineage or transmission claims, author or authorship claims, dates, ritual details, quotations, provenance, credentials, or source support.
If evidence is uncertain or incomplete, omit the unsupported claim or state the uncertainty conservatively; never fill gaps with plausible-sounding material.
A supplied source is not automatically verified or authoritative. Do not describe AI-generated prose as verified, authoritative, approved, published, or executed.
Every factual claim that requires evidence must remain traceable to a supplied source reference. Do not create or return any source reference that was not supplied.
The output is a draft for human review. It cannot approve itself, alter a publication plan, publish content, or claim that a site change occurred.`,
  buildUserMessage: (facts: unknown) => buildUserMessage('Generate an advisory publication article draft from the supplied facts, brief and supplied source references.', {
    title: 'Article title',
    body: 'Article draft body.',
    excerpt: 'Short excerpt.',
    metaDescription: 'Factual meta description.',
    schemaJson: { '@context': 'https://schema.org', '@type': 'Article' },
    sourceReferences: ['CONTENT_SOURCE_REFERENCE:<id>'],
    caveats: ['Unsupported claims were omitted or explicitly qualified.']
  }, facts)
});

export const PROMPT_DEFINITIONS: readonly PromptDefinition[] = Object.freeze([
  SEO_PROMPT,
  GEO_PROMPT,
  ENTITY_PROMPT,
  CONTENT_BRIEF_PROMPT,
  CONTENT_OPTIMIZATION_PROMPT,
  COMPETITOR_GAP_PROMPT,
  PROJECT_REPORT_SUMMARY_PROMPT,
  VISIBILITY_TREND_PROMPT,
  GROWTH_OPPORTUNITY_EXPLANATION_PROMPT,
  PUBLICATION_CONTENT_BRIEF_PROMPT,
  PUBLICATION_ARTICLE_GENERATION_PROMPT
]);

const PROMPT_BY_ID = new Map<PromptId, PromptDefinition>(PROMPT_DEFINITIONS.map((prompt) => [prompt.id, prompt]));

export function getPromptDefinition(id: string): PromptDefinition {
  const prompt = PROMPT_BY_ID.get(id as PromptId);
  if (!prompt) throw new Error(`Unknown AI prompt: ${id}`);
  return prompt;
}