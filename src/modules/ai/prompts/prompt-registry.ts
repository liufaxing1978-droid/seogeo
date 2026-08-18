import type { AiGatewayFormat, AiGatewayMode } from '../ai.types.js';

export type PromptId =
  | 'seo-audit-analysis-v1'
  | 'geo-readiness-analysis-v1'
  | 'entity-enrichment-v1';

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
  id: 'seo-audit-analysis-v1',
  version: 'v1',
  mode: 'FAST',
  responseFormat: 'JSON',
  system: `${FACT_GUARDRAILS}\nAnalyze deterministic SEO audit facts. Prioritize practical actions, but never change factual issue state.`,
  buildUserMessage: (facts) =>
    buildUserMessage(
      'Analyze the deterministic SEO audit facts.',
      {
        summary: 'Short factual summary',
        priorities: [
          { priority: 'HIGH', title: 'Action title', reason: 'Why it matters', sourceRefs: ['SEO_ISSUE:<id>'] }
        ],
        recommendations: [
          { title: 'Recommendation title', action: 'Concrete action', sourceRefs: ['SEO_ISSUE:<id>'] }
        ]
      },
      facts
    )
});

const GEO_PROMPT: PromptDefinition = Object.freeze({
  id: 'geo-readiness-analysis-v1',
  version: 'v1',
  mode: 'REASONING',
  responseFormat: 'JSON',
  system: `${FACT_GUARDRAILS}\nAnalyze deterministic GEO readiness facts. Treat null and UNKNOWN as unavailable evidence, never as zero. AI Visibility is unavailable unless explicitly supplied as a real sampled fact.`,
  buildUserMessage: (facts) =>
    buildUserMessage(
      'Analyze the deterministic GEO readiness facts.',
      {
        summary: 'Short factual summary',
        opportunities: [
          {
            priority: 'HIGH',
            dimension: 'CITABILITY',
            title: 'Opportunity title',
            recommendation: 'Concrete recommendation',
            sourceRefs: ['GEO_RULE_RESULT:<id>']
          }
        ],
        unavailableFacts: ['Example unavailable fact']
      },
      facts
    )
});

const ENTITY_PROMPT: PromptDefinition = Object.freeze({
  id: 'entity-enrichment-v1',
  version: 'v1',
  mode: 'REASONING',
  responseFormat: 'JSON',
  system: `${FACT_GUARDRAILS}\nSuggest semantic entity enrichment only. Suggestions must not be presented as deterministic entity facts and must reference supplied source IDs.`,
  buildUserMessage: (facts) =>
    buildUserMessage(
      'Suggest semantic enrichment for the supplied deterministic entities.',
      {
        suggestions: [
          {
            entityId: '00000000-0000-0000-0000-000000000000',
            suggestedDescription: 'Suggested description',
            suggestedAliases: ['Suggested alias'],
            rationale: 'Why the suggestion follows from supplied facts',
            sourceRefs: ['ENTITY:<id>']
          }
        ]
      },
      facts
    )
});

export const PROMPT_DEFINITIONS: readonly PromptDefinition[] = Object.freeze([
  SEO_PROMPT,
  GEO_PROMPT,
  ENTITY_PROMPT
]);

const PROMPT_BY_ID = new Map<PromptId, PromptDefinition>(
  PROMPT_DEFINITIONS.map((prompt) => [prompt.id, prompt])
);

export function getPromptDefinition(id: string): PromptDefinition {
  const prompt = PROMPT_BY_ID.get(id as PromptId);
  if (!prompt) {
    throw new Error(`Unknown AI prompt: ${id}`);
  }
  return prompt;
}
