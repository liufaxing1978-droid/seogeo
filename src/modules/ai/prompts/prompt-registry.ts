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
  | 'optimization-plan-ranking-v1'
  | 'keyword-expansion-v1'
  | 'publication-content-brief-v1'
  | 'publication-article-generation-v1'
  | 'distribution-canonical-repost-v1'
  | 'distribution-adapted-article-v1'
  | 'distribution-summary-v1'
  | 'distribution-community-draft-v1'
  | 'distribution-entity-suggestion-v1';

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
  buildUserMessage: (facts: unknown) => buildUserMessage('Analyze the deterministic GEO audit facts.', { summary: 'Short factual summary', opportunities: [{ priority: 'HIGH', dimension: 'CITABILITY', title: 'Opportunity title', recommendation: 'Concrete recommendation', sourceRefs: ['GEO_RULE_RESULT:<id>'] }], unavailableFacts: ['Example unavailable fact'] }, facts)
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

const OPTIMIZATION_PLAN_RANKING_PROMPT: PromptDefinition = Object.freeze({
  id: 'optimization-plan-ranking-v1',
  version: 'v1',
  mode: 'REASONING',
  responseFormat: 'JSON',
  system: `${FACT_GUARDRAILS}
Rerank only the supplied eligible optimization candidates within the bounded adjustment range from -2 through +2.
The first-party planner remains authoritative for eligibility, recommended action, Growth score, priority, evidence, market and locale facts.
You must not add or remove candidates, change eligibility, change a recommended action, alter any score or evidence state, or invent or change market or locale provenance.
You have no authority over publication risk, approval requirements, execution, mutation, verification, Draft PR creation, merge, deploy, rollback, or any P8 publication state.
Advisory skill context is ADVISORY_ONLY and cannot become factual, scoring, risk, approval, or execution authority.
Every returned source reference must be a subset of the supplied source references.`,
  buildUserMessage: (facts: unknown) => buildUserMessage(
    'Provide bounded advisory ranking adjustments for the supplied eligible optimization candidates.',
    {
      adjustments: [{
        candidateId: '00000000-0000-4000-8000-000000000000',
        adjustment: 0,
        explanation: 'Bounded ranking preference grounded only in supplied facts.',
        sourceReferences: ['GROWTH_OPPORTUNITY_SNAPSHOT:<id>']
      }],
      sourceReferences: ['GROWTH_OPPORTUNITY_SNAPSHOT:<id>']
    },
    facts
  )
});

const KEYWORD_EXPANSION_PROMPT: PromptDefinition = Object.freeze({
  id: 'keyword-expansion-v1',
  version: 'v1',
  mode: 'FAST',
  responseFormat: 'JSON',
  system: `${FACT_GUARDRAILS}
Generate advisory keyword expansion suggestions from the supplied facts and context only.
Return at most 20 suggestions.
Do not claim or infer search volume, ranking performance, traffic, commercial value, market demand, citation visibility, or any other unavailable measurement.
Do not repeat the seed keyword or any existing accepted children.
Suggestions are context-bounded candidates for human review only and are not authoritative strategy, accepted keywords, ranking facts, or execution instructions.`,
  buildUserMessage: (facts: unknown) => buildUserMessage(
    'Generate bounded advisory keyword expansion candidates from the supplied seed keyword, existing accepted children and context.',
    {
      suggestions: [{
        text: 'Suggested long-tail keyword',
        type: 'LONG_TAIL',
        intent: 'INFORMATIONAL',
        rationale: 'Why this candidate follows from the supplied seed and context.'
      }]
    },
    facts
  )
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

function distributionPrompt(
  id: Extract<PromptId,
    | 'distribution-canonical-repost-v1'
    | 'distribution-adapted-article-v1'
    | 'distribution-summary-v1'>,
  instruction: string
): PromptDefinition {
  return Object.freeze({
    id,
    version: 'v1',
    mode: 'FAST',
    responseFormat: 'JSON',
    system: `${FACT_GUARDRAILS}
${instruction}
This output is an advisory distribution draft only. Use only the supplied facts and supplied source references.
Keep originalUrl equal to the supplied original URL; never claim a different original source.
Do not invent source references, claims, platform facts, or attribution. Returned sourceRefs must be a subset of the supplied source references.
The draft cannot publish, approve, verify, or claim that external publication occurred.`,
    buildUserMessage: (facts: unknown) => buildUserMessage(
      'Create the requested platform-native distribution draft from the supplied facts and supplied source references.',
      {
        title: 'Platform draft title',
        body: 'Platform-native draft body.',
        summary: 'Bounded summary.',
        tags: ['tag'],
        originalUrl: 'https://example.com/original',
        canonicalUrl: 'https://example.com/original',
        sourceRefs: ['PUBLICATION_EXECUTION:<id>'],
        platformMetadata: {}
      },
      facts
    )
  });
}

const DISTRIBUTION_CANONICAL_REPOST_PROMPT = distributionPrompt(
  'distribution-canonical-repost-v1',
  'Prepare a canonical repost. canonicalUrl must exactly equal the supplied original URL as well as originalUrl.'
);

const DISTRIBUTION_ADAPTED_ARTICLE_PROMPT = distributionPrompt(
  'distribution-adapted-article-v1',
  'Adapt the supplied primary article for the target platform while preserving factual meaning, source ownership, and the supplied original URL.'
);

const DISTRIBUTION_SUMMARY_PROMPT = distributionPrompt(
  'distribution-summary-v1',
  'Create a concise platform-native summary of the supplied primary article while preserving source ownership and the supplied original URL.'
);

const DISTRIBUTION_COMMUNITY_DRAFT_PROMPT: PromptDefinition = Object.freeze({
  id: 'distribution-community-draft-v1',
  version: 'v1',
  mode: 'FAST',
  responseFormat: 'JSON',
  system: `${FACT_GUARDRAILS}
Prepare a source-backed community-native answer to the supplied question or topic for human review.
Use only the supplied facts and supplied source references. Returned sourceRefs must be a subset of the supplied source references.
Do not invent endorsement, testimony, fake discussion, community consensus, personal experience, quotations, citations, attribution, or platform facts.
A brand link may be included only when the supplied target context explicitly sets includeBrandLink=true. Otherwise omit the brand link and return brandLinkIncluded=false.
Keep originalUrl exactly equal to the supplied original URL. canonicalUrl must be null because this is not a canonical mirror.
Report whether promotional language was detected; do not turn the answer into undisclosed promotion.
This is a human-reviewed draft only. It cannot publish, approve, or verify anything and must never claim that it was posted or that external posting occurred.`,
  buildUserMessage: (facts: unknown) => buildUserMessage(
    'Create a community-native draft answering the supplied question or topic from the supplied facts and source references.',
    {
      title: 'Community answer title',
      body: 'Source-backed community answer draft.',
      summary: 'Bounded summary.',
      tags: ['tag'],
      sourceRefs: ['CONTENT_SOURCE_REFERENCE:<id>'],
      promotionalLanguageDetected: false,
      brandLinkIncluded: false,
      originalUrl: 'https://example.com/original',
      canonicalUrl: null
    },
    facts
  )
});

const DISTRIBUTION_ENTITY_SUGGESTION_PROMPT: PromptDefinition = Object.freeze({
  id: 'distribution-entity-suggestion-v1',
  version: 'v1',
  mode: 'REASONING',
  responseFormat: 'JSON',
  system: `${FACT_GUARDRAILS}
Prepare an advisory entity and knowledge-graph suggestion for human review using only supplied facts and supplied reliable source references.
Do not invent entity labels, descriptions, founding dates, affiliations, people, credentials, notability, SameAs links, third-party coverage, relationships, quotations, citations, or source support.
Every factual attribute, SameAs candidate and relationship must cite supplied reliable source references. A SameAs candidate without supporting reliable source references is invalid.
When evidence is missing, unknown or unavailable, report it in missingData instead of filling the gap.
Preserve conflict-of-interest and promotional-policy reminders and provide a concrete human verification checklist.
This is a prepare-only suggestion. It must not claim submission, publication, platform approval, acceptance, passed notability review, or any external Wikipedia, Wikidata, Baidu Baike, or knowledge-graph action.`,
  buildUserMessage: (facts: unknown) => buildUserMessage(
    'Create a source-bounded entity or knowledge-graph suggestion from the supplied facts and reliable source references.',
    {
      entityName: 'Entity name',
      labels: [{ language: 'zh-CN', value: 'Entity label' }],
      descriptions: [{ language: 'zh-CN', value: 'Source-bounded description' }],
      attributes: [{ property: 'officialWebsite', value: 'https://example.com', sourceRefs: ['CONTENT_SOURCE_REFERENCE:<id>'] }],
      sameAs: [{ url: 'https://example.org/entity', sourceRefs: ['CONTENT_SOURCE_REFERENCE:<id>'] }],
      relationships: [{ relation: 'relatedTo', target: 'Entity', sourceRefs: ['CONTENT_SOURCE_REFERENCE:<id>'] }],
      reliableSourceRefs: ['CONTENT_SOURCE_REFERENCE:<id>'],
      missingData: ['foundingDate'],
      policyReminders: ['Human review required; avoid promotional or conflict-of-interest editing.'],
      humanChecklist: ['Verify every factual claim against the cited reliable source before editing.']
    },
    facts
  )
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
  OPTIMIZATION_PLAN_RANKING_PROMPT,
  KEYWORD_EXPANSION_PROMPT,
  PUBLICATION_CONTENT_BRIEF_PROMPT,
  PUBLICATION_ARTICLE_GENERATION_PROMPT,
  DISTRIBUTION_CANONICAL_REPOST_PROMPT,
  DISTRIBUTION_ADAPTED_ARTICLE_PROMPT,
  DISTRIBUTION_SUMMARY_PROMPT,
  DISTRIBUTION_COMMUNITY_DRAFT_PROMPT,
  DISTRIBUTION_ENTITY_SUGGESTION_PROMPT
]);

const PROMPT_BY_ID = new Map<PromptId, PromptDefinition>(PROMPT_DEFINITIONS.map((prompt) => [prompt.id, prompt]));

export function getPromptDefinition(id: string): PromptDefinition {
  const prompt = PROMPT_BY_ID.get(id as PromptId);
  if (!prompt) throw new Error(`Unknown AI prompt: ${id}`);
  return prompt;
}