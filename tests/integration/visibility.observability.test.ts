import { describe, expect, it, vi } from 'vitest';
import {
  emitVisibilityEvent,
  serializeVisibilityEvent
} from '../../src/modules/visibility/visibility-observability.js';

describe('P6-A visibility observability', () => {
  it('serializes only the approved observability fields', () => {
    const serialized = serializeVisibilityEvent('visibility.observation.completed', {
      projectId: 'project-1',
      runId: 'run-1',
      observationId: 'observation-1',
      provider: 'openai',
      model: 'gpt-5',
      channel: 'API',
      promptId: 'prompt-1',
      promptVersion: 2,
      status: 'COMPLETED',
      errorCode: null,
      latencyMs: 842,
      promptTokens: 100,
      completionTokens: 40,
      totalTokens: 140,
      searchUnits: 1,
      costMicros: 1234,
      Authorization: 'Bearer secret',
      api_key: 'secret-key',
      cookie: 'session=secret',
      answerText: 'private answer body',
      promptText: 'private prompt body',
      reasoning: 'private chain',
      thought: 'private thought',
      searchPlanning: 'private search planning',
      providerBody: { secret: true }
    });

    expect(serialized).toEqual({
      event: 'visibility.observation.completed',
      projectId: 'project-1',
      runId: 'run-1',
      observationId: 'observation-1',
      provider: 'openai',
      model: 'gpt-5',
      channel: 'API',
      promptId: 'prompt-1',
      promptVersion: 2,
      status: 'COMPLETED',
      errorCode: null,
      latencyMs: 842,
      promptTokens: 100,
      completionTokens: 40,
      totalTokens: 140,
      searchUnits: 1,
      costMicros: 1234
    });

    const text = JSON.stringify(serialized);
    for (const forbidden of [
      'Authorization',
      'api_key',
      'cookie=',
      'private answer body',
      'private prompt body',
      'reasoning',
      'thought',
      'search planning',
      'providerBody'
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('emits an allowed visibility event without leaking sensitive bodies', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    emitVisibilityEvent('visibility.run.failed', {
      runId: 'run-2',
      projectId: 'project-2',
      status: 'FAILED',
      errorCode: 'VISIBILITY_PROVIDER_FAILED',
      promptText: 'do not log me',
      answerText: 'do not log me either'
    });

    expect(info).toHaveBeenCalledTimes(1);
    const emitted = info.mock.calls[0]?.[0];
    expect(emitted).toEqual({
      event: 'visibility.run.failed',
      runId: 'run-2',
      projectId: 'project-2',
      status: 'FAILED',
      errorCode: 'VISIBILITY_PROVIDER_FAILED'
    });
    expect(JSON.stringify(emitted)).not.toContain('do not log me');

    info.mockRestore();
  });
});
