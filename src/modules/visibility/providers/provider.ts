import type {
  VisibilityGroundingMode,
  VisibilityProvider
} from '@prisma/client';

export type VisibilitySampleStatus = 'COMPLETED' | 'REFUSED' | 'UNSUPPORTED' | 'INCOMPLETE';

export interface VisibilitySampleRequest {
  prompt: string;
  model: string;
  locale: string | null;
  country: string | null;
  groundingMode: VisibilityGroundingMode;
  providerOptions: Record<string, unknown>;
}

export interface VisibilityCitationSource {
  url: string;
  title: string | null;
  position: number | null;
  sourceType: string | null;
}

export interface VisibilitySampleResponse {
  status: VisibilitySampleStatus;
  providerResponseId: string | null;
  answerText: string | null;
  citations: VisibilityCitationSource[];
  searchMetadata: Record<string, unknown>;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  searchUnits: number | null;
  costMicros: number | null;
  costCurrency: string | null;
  pricingVersion: string | null;
  latencyMs: number | null;
}

export interface VisibilityProviderAdapter {
  readonly provider: VisibilityProvider;
  readonly channel: 'API';
  supportsWebGrounding(mode: VisibilityGroundingMode): boolean;
  estimateCostMicros(request: VisibilitySampleRequest): number | null;
  sample(request: VisibilitySampleRequest): Promise<VisibilitySampleResponse>;
}

export type VisibilityProviderErrorCode =
  | 'VISIBILITY_PROVIDER_DUPLICATE_ADAPTER'
  | 'VISIBILITY_PROVIDER_UNAVAILABLE'
  | 'VISIBILITY_WEB_GROUNDING_UNSUPPORTED'
  | 'VISIBILITY_PROVIDER_RATE_LIMITED'
  | 'VISIBILITY_PROVIDER_AUTH_FAILED'
  | 'VISIBILITY_PROVIDER_FAILED'
  | 'VISIBILITY_PROVIDER_MALFORMED_RESPONSE';

function safeProviderMessage(message: string): string {
  return message
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/authorization\s*[:=]\s*\S+/gi, 'Authorization:[redacted]')
    .replace(/api[_-]?key\s*[:=]\s*\S+/gi, 'api_key=[redacted]')
    .replace(/token\s*[:=]\s*\S+/gi, 'token=[redacted]')
    .slice(0, 300);
}

export class VisibilityProviderError extends Error {
  readonly code: VisibilityProviderErrorCode;
  readonly httpStatus: number | null;
  readonly retryable: boolean;

  constructor(
    code: VisibilityProviderErrorCode,
    message: string,
    options: { httpStatus?: number | null; retryable?: boolean } = {}
  ) {
    super(safeProviderMessage(message));
    this.name = 'VisibilityProviderError';
    this.code = code;
    this.httpStatus = options.httpStatus ?? null;
    this.retryable = options.retryable ?? false;
  }
}
