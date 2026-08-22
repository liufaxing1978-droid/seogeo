import { describe, expect, it } from 'vitest';
import type { VisibilitySampleRequest } from '../../src/modules/visibility/providers/provider.js';
import {
  MicrosoftVisibilityProvider,
  type MicrosoftVisibilityHttpRequest,
  type MicrosoftVisibilityHttpResponse,
  type MicrosoftVisibilityTransport
} from '../../src/modules/visibility/providers/microsoft.provider.js';

class FixtureTransport implements MicrosoftVisibilityTransport {
  calls: MicrosoftVisibilityHttpRequest[] = [];
  constructor(private readonly responses: MicrosoftVisibilityHttpResponse[]) {}
  async send(request: MicrosoftVisibilityHttpRequest) {
    this.calls.push(request);
    const response = this.responses.shift();
    if (!response) throw new Error('missing fixture response');
    return response;
  }
}

const request: VisibilitySampleRequest = {
  prompt: 'Which websites explain Chinese folk religious traditions well?',
  model: 'microsoft-365-copilot',
  locale: 'en-US',
  country: 'US',
  groundingMode: 'WEB_SEARCH',
  providerOptions: { timeZone: 'America/Denver' }
};

function createConversation() {
  return { id: 'conv_fixture_123', status: 'active', turnCount: 0 };
}

function chatConversation() {
  return {
    id: 'conv_fixture_123',
    state: 'active',
    turnCount: 1,
    messages: [
      {
        '@odata.type': '#microsoft.graph.copilotConversationResponseMessage',
        id: 'msg_user',
        text: request.prompt,
        attributions: []
      },
      {
        '@odata.type': '#microsoft.graph.copilotConversationResponseMessage',
        id: 'msg_assistant',
        text: 'Xingshantang is one useful source.',
        attributions: [
          { attributionType: 'citation', providerDisplayName: 'Xingshantang', attributionSource: 'model', seeMoreWebUrl: 'https://xingshantang.org/article' },
          { attributionType: 'citation', providerDisplayName: 'Reference', attributionSource: 'model', seeMoreWebUrl: 'https://example.org/reference' },
          { attributionType: 'citation', providerDisplayName: 'Duplicate', attributionSource: 'model', seeMoreWebUrl: 'https://xingshantang.org/article' }
        ]
      }
    ]
  };
}

describe('P9-0D Microsoft 365 Copilot Work IQ visibility adapter', () => {
  it('creates a Work IQ conversation, keeps web grounding enabled, and normalizes citations', async () => {
    const transport = new FixtureTransport([
      { status: 201, body: createConversation(), latencyMs: 10 },
      { status: 200, body: chatConversation(), latencyMs: 25 }
    ]);
    const adapter = new MicrosoftVisibilityProvider({ accessToken: 'fixture-token', transport });

    expect(adapter.supportsWebGrounding('WEB_SEARCH')).toBe(true);
    const result = await adapter.sample(request);

    expect(transport.calls).toHaveLength(2);
    expect(transport.calls[0]).toMatchObject({
      url: 'https://workiq.svc.cloud.microsoft/rest/conversations',
      method: 'POST',
      body: {}
    });
    expect(transport.calls[1]).toMatchObject({
      url: 'https://workiq.svc.cloud.microsoft/rest/conversations/conv_fixture_123/chat',
      method: 'POST',
      body: {
        message: { text: request.prompt },
        locationHint: { timeZone: 'America/Denver' },
        contextualResources: { webContext: { isWebEnabled: true } }
      }
    });
    expect(JSON.stringify(transport.calls)).not.toContain('fixture-token');
    expect(result).toEqual({
      status: 'COMPLETED',
      providerResponseId: 'conv_fixture_123',
      answerText: 'Xingshantang is one useful source.',
      citations: [
        { url: 'https://xingshantang.org/article', title: 'Xingshantang', position: null, sourceType: 'microsoft_attribution' },
        { url: 'https://example.org/reference', title: 'Reference', position: null, sourceType: 'microsoft_attribution' }
      ],
      citationEvidenceState: 'KNOWN_PRESENT',
      searchMetadata: {
        surface: 'MICROSOFT_365_COPILOT_WORK_IQ',
        groundingProvider: 'BING_WEB_SEARCH',
        webGroundingEnabled: true,
        requestedModel: 'microsoft-365-copilot'
      },
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      searchUnits: null,
      costMicros: null,
      costCurrency: null,
      pricingVersion: null,
      latencyMs: 35
    });
  });

  it('marks an explicit empty attribution collection as KNOWN_EMPTY', async () => {
    const body = chatConversation();
    body.messages[1].attributions = [];
    const adapter = new MicrosoftVisibilityProvider({
      accessToken: 'fixture-token',
      transport: new FixtureTransport([
        { status: 201, body: createConversation(), latencyMs: 1 },
        { status: 200, body, latencyMs: 2 }
      ])
    });
    await expect(adapter.sample(request)).resolves.toMatchObject({ citationEvidenceState: 'KNOWN_EMPTY' });
  });

  it('fails before network when delegated Work IQ access token is not configured', async () => {
    const transport = new FixtureTransport([]);
    await expect(new MicrosoftVisibilityProvider({ accessToken: '', transport }).sample(request))
      .rejects.toMatchObject({ code: 'VISIBILITY_PROVIDER_AUTH_FAILED' });
    expect(transport.calls).toHaveLength(0);
  });

  it.each([
    [401, 'VISIBILITY_PROVIDER_AUTH_FAILED'],
    [403, 'VISIBILITY_PROVIDER_AUTH_FAILED'],
    [429, 'VISIBILITY_PROVIDER_RATE_LIMITED'],
    [500, 'VISIBILITY_PROVIDER_FAILED']
  ])('maps Work IQ HTTP %s to stable safe error %s', async (status, code) => {
    const adapter = new MicrosoftVisibilityProvider({
      accessToken: 'fixture-token',
      transport: new FixtureTransport([{ status, latencyMs: 3, body: { error: 'sensitive upstream body' } }])
    });
    await expect(adapter.sample(request)).rejects.toMatchObject({ code, httpStatus: status });
  });

  it('maps transport failures without leaking raw transport details', async () => {
    const transport: MicrosoftVisibilityTransport = {
      async send() { throw new Error('Authorization: Bearer SUPERSECRET timeout from upstream'); }
    };
    const adapter = new MicrosoftVisibilityProvider({ accessToken: 'fixture-token', transport });
    await expect(adapter.sample(request)).rejects.toMatchObject({ code: 'VISIBILITY_PROVIDER_FAILED' });
  });

  it('returns UNSUPPORTED without network calls for non-web grounding modes', async () => {
    const transport = new FixtureTransport([]);
    const adapter = new MicrosoftVisibilityProvider({ accessToken: 'fixture-token', transport });
    const result = await adapter.sample({ ...request, groundingMode: 'NONE' });
    expect(result).toMatchObject({ status: 'UNSUPPORTED', citationEvidenceState: 'NOT_APPLICABLE' });
    expect(transport.calls).toHaveLength(0);
  });
});
