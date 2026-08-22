import type { CitationEvidenceState, VisibilityGroundingMode } from '@prisma/client';
import {
  VisibilityProviderError,
  type VisibilityCitationSource,
  type VisibilityProviderAdapter,
  type VisibilitySampleRequest,
  type VisibilitySampleResponse
} from './provider.js';

const PERPLEXITY_SONAR_URL = 'https://api.perplexity.ai/v1/sonar';
const PERPLEXITY_REPORTED_COST_VERSION = 'perplexity-reported-cost-v1';

export interface PerplexityVisibilityHttpRequest { url: string; method: 'POST'; headers: Record<string, string>; body: Record<string, unknown>; }
export interface PerplexityVisibilityHttpResponse { status: number; body: unknown; latencyMs: number; }
export interface PerplexityVisibilityTransport { send(request: PerplexityVisibilityHttpRequest): Promise<PerplexityVisibilityHttpResponse>; }

class FetchPerplexityVisibilityTransport implements PerplexityVisibilityTransport {
  async send(request: PerplexityVisibilityHttpRequest): Promise<PerplexityVisibilityHttpResponse> {
    const startedAt = Date.now();
    const response = await fetch(request.url, { method: request.method, headers: request.headers, body: JSON.stringify(request.body) });
    let body: unknown = null;
    try { body = await response.json(); } catch { body = null; }
    return { status: response.status, body, latencyMs: Date.now() - startedAt };
  }
}

function record(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function stringValue(value: unknown): string | null { return typeof value === 'string' && value.length > 0 ? value : null; }
function nonNegativeInteger(value: unknown): number | null { return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null; }
function nonNegativeNumber(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null; }

function normalizeUsage(value: unknown) {
  const usage = record(value);
  return { promptTokens: nonNegativeInteger(usage?.prompt_tokens), completionTokens: nonNegativeInteger(usage?.completion_tokens), totalTokens: nonNegativeInteger(usage?.total_tokens), searchUnits: nonNegativeInteger(usage?.num_search_queries) };
}

function normalizeReportedCost(value: unknown) {
  const totalCostUsd = nonNegativeNumber(record(record(value)?.cost)?.total_cost);
  if (totalCostUsd === null) return { costMicros: null, costCurrency: null, pricingVersion: null };
  return { costMicros: Math.round(totalCostUsd * 1_000_000), costCurrency: 'USD', pricingVersion: PERPLEXITY_REPORTED_COST_VERSION };
}

interface SafeSearchResult { title: string | null; url: string; date: string | null; lastUpdated: string | null; source: string | null; }
function normalizeSearchResults(value: unknown): SafeSearchResult[] {
  if (!Array.isArray(value)) return [];
  const results: SafeSearchResult[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const itemRecord = record(item);
    const url = stringValue(itemRecord?.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    results.push({ title: stringValue(itemRecord?.title), url, date: stringValue(itemRecord?.date), lastUpdated: stringValue(itemRecord?.last_updated), source: stringValue(itemRecord?.source) });
  }
  return results;
}

function normalizeCitations(value: unknown, searchResults: SafeSearchResult[]): VisibilityCitationSource[] {
  if (!Array.isArray(value)) return [];
  const titleByUrl = new Map(searchResults.map((item) => [item.url, item.title]));
  const citations: VisibilityCitationSource[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const url = stringValue(item);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    citations.push({ url, title: titleByUrl.get(url) ?? null, position: citations.length + 1, sourceType: 'citation' });
  }
  return citations;
}

function citationEvidenceState(body: Record<string, unknown>, citations: VisibilityCitationSource[], results: SafeSearchResult[]): CitationEvidenceState {
  if (citations.length > 0 || results.length > 0) return 'KNOWN_PRESENT';
  if (Array.isArray(body.citations) && Array.isArray(body.search_results)) return 'KNOWN_EMPTY';
  return 'UNKNOWN';
}

function normalizeAnswer(choices: unknown[]): string | null {
  for (const choice of choices) {
    const content = stringValue(record(record(choice)?.message)?.content);
    if (content) return content;
  }
  return null;
}

function providerHttpError(status: number): VisibilityProviderError {
  if (status === 401 || status === 403) return new VisibilityProviderError('VISIBILITY_PROVIDER_AUTH_FAILED', `Perplexity visibility request failed with HTTP ${status}`, { httpStatus: status, retryable: false });
  if (status === 429) return new VisibilityProviderError('VISIBILITY_PROVIDER_RATE_LIMITED', 'Perplexity visibility request was rate limited', { httpStatus: status, retryable: false });
  return new VisibilityProviderError('VISIBILITY_PROVIDER_FAILED', `Perplexity visibility request failed with HTTP ${status}`, { httpStatus: status, retryable: false });
}

function normalizeDomainFilter(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const domains = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return domains.length ? domains : null;
}

export class PerplexityVisibilityProvider implements VisibilityProviderAdapter {
  readonly provider = 'PERPLEXITY' as const;
  readonly channel = 'API' as const;
  readonly capabilities = ['WEB_GROUNDED', 'CITATION_NATIVE'] as const;
  private readonly apiKey: string;
  private readonly transport: PerplexityVisibilityTransport;

  constructor(options: { apiKey?: string; transport?: PerplexityVisibilityTransport } = {}) {
    this.apiKey = options.apiKey ?? process.env.PERPLEXITY_API_KEY ?? '';
    this.transport = options.transport ?? new FetchPerplexityVisibilityTransport();
  }

  supportsWebGrounding(mode: VisibilityGroundingMode) { return mode === 'SONAR'; }
  estimateCostMicros(_request: VisibilitySampleRequest): number | null { return null; }

  async sample(request: VisibilitySampleRequest): Promise<VisibilitySampleResponse> {
    if (!this.apiKey.trim()) throw new VisibilityProviderError('VISIBILITY_PROVIDER_AUTH_FAILED', 'Perplexity API key is not configured', { retryable: false });
    if (!this.supportsWebGrounding(request.groundingMode)) return { status: 'UNSUPPORTED', providerResponseId: null, answerText: null, citations: [], citationEvidenceState: 'NOT_APPLICABLE', searchMetadata: {}, promptTokens: null, completionTokens: null, totalTokens: null, searchUnits: null, costMicros: null, costCurrency: null, pricingVersion: null, latencyMs: null };

    const requestBody: Record<string, unknown> = { model: request.model, messages: [{ role: 'user', content: request.prompt }] };
    const domainFilter = normalizeDomainFilter(request.providerOptions.searchDomainFilter);
    if (domainFilter) requestBody.search_domain_filter = domainFilter;
    const recencyFilter = stringValue(request.providerOptions.searchRecencyFilter);
    if (recencyFilter) requestBody.search_recency_filter = recencyFilter;

    let response: PerplexityVisibilityHttpResponse;
    try {
      response = await this.transport.send({ url: PERPLEXITY_SONAR_URL, method: 'POST', headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' }, body: requestBody });
    } catch (error) {
      if (error instanceof VisibilityProviderError) throw error;
      throw new VisibilityProviderError('VISIBILITY_PROVIDER_FAILED', 'Perplexity visibility request failed', { retryable: false });
    }
    if (response.status < 200 || response.status >= 300) throw providerHttpError(response.status);

    const responseBody = record(response.body);
    const id = stringValue(responseBody?.id);
    const choices = Array.isArray(responseBody?.choices) ? responseBody.choices : null;
    if (!responseBody || !id || choices === null) throw new VisibilityProviderError('VISIBILITY_PROVIDER_MALFORMED_RESPONSE', 'Perplexity returned a malformed visibility response', { httpStatus: response.status, retryable: false });

    const answerText = normalizeAnswer(choices);
    const searchResults = normalizeSearchResults(responseBody.search_results);
    const citations = answerText ? normalizeCitations(responseBody.citations, searchResults) : [];
    const usage = normalizeUsage(responseBody.usage);
    const cost = normalizeReportedCost(responseBody.usage);

    return {
      status: answerText ? 'COMPLETED' : 'INCOMPLETE',
      providerResponseId: id,
      answerText,
      citations,
      citationEvidenceState: answerText ? citationEvidenceState(responseBody, citations, searchResults) : 'UNKNOWN',
      searchMetadata: { searchResults },
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      totalTokens: usage.totalTokens,
      searchUnits: usage.searchUnits,
      costMicros: cost.costMicros,
      costCurrency: cost.costCurrency,
      pricingVersion: cost.pricingVersion,
      latencyMs: response.latencyMs
    };
  }
}
