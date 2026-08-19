import { describe, expect, it } from 'vitest';
import type { CitationEvidenceState } from '@prisma/client';
import type {
  VisibilitySampleRequest,
  VisibilitySampleResponse
} from '../../src/modules/visibility/providers/provider.js';
import { DeepSeekVisibilityProvider } from '../../src/modules/visibility/providers/deepseek.provider.js';

const request: VisibilitySampleRequest = {
  prompt: 'Which sites explain Chinese folk religion?',
  model: 'deepseek-chat',
  locale: 'en-US',
  country: 'US',
  groundingMode: 'UNSUPPORTED_WEB_GROUNDING',
  providerOptions: {}
};

function requireCitationEvidence(response: VisibilitySampleResponse): CitationEvidenceState {
  return response.citationEvidenceState;
}

describe('P6-B citation evidence contract', () => {
  it('requires every normalized provider response to expose explicit citation evidence state', async () => {
    const result = await new DeepSeekVisibilityProvider().sample(request);
    expect(requireCitationEvidence(result)).toBe('NOT_APPLICABLE');
  });

  it('keeps DeepSeek web grounding zero-network and not applicable', async () => {
    const adapter = new DeepSeekVisibilityProvider();
    expect(adapter.supportsWebGrounding('UNSUPPORTED_WEB_GROUNDING')).toBe(false);
    const result = await adapter.sample(request);
    expect(result.status).toBe('UNSUPPORTED');
    expect(result.citations).toEqual([]);
    expect(result.citationEvidenceState).toBe('NOT_APPLICABLE');
  });
});
