import type { VisibilityGroundingMode } from '@prisma/client';
import type {
  VisibilityProviderAdapter,
  VisibilitySampleRequest,
  VisibilitySampleResponse
} from './provider.js';

export class DeepSeekVisibilityProvider implements VisibilityProviderAdapter {
  readonly provider = 'DEEPSEEK' as const;
  readonly channel = 'API' as const;

  supportsWebGrounding(_mode: VisibilityGroundingMode) {
    return false;
  }

  estimateCostMicros(_request: VisibilitySampleRequest): number | null {
    return null;
  }

  async sample(_request: VisibilitySampleRequest): Promise<VisibilitySampleResponse> {
    return {
      status: 'UNSUPPORTED',
      providerResponseId: null,
      answerText: null,
      citations: [],
      citationEvidenceState: 'NOT_APPLICABLE',
      searchMetadata: {},
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      searchUnits: null,
      costMicros: null,
      costCurrency: null,
      pricingVersion: null,
      latencyMs: null
    };
  }
}
