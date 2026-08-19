import { describe, expect, it, vi } from 'vitest';
import {
  emitVisibilityIntelligenceEvent,
  serializeVisibilityIntelligenceEvent
} from '../../src/modules/visibility/visibility-intelligence.observability.js';
import {
  VisibilityExtractionQueue,
  type VisibilityExtractionQueuePort
} from '../../src/modules/visibility/visibility-extraction.queue.js';

class FakeQueuePort implements VisibilityExtractionQueuePort {
  async add(
    _name: string,
    _data: Record<string, unknown>,
    options: { jobId: string; attempts: number }
  ) {
    return { id: options.jobId };
  }
}

describe('P6-B visibility intelligence observability', () => {
  it('allows only safe IDs, provenance, states, counts, errors and duration', () => {
    const serialized = serializeVisibilityIntelligenceEvent(
      'visibility.extraction.completed',
      {
        projectId: 'project-id',
        observationId: 'observation-id',
        extractionId: 'extraction-id',
        subjectId: 'subject-id',
        extractorVersion: 'P6B_EXTRACTION_V1',
        subjectSetHash: 'hash',
        status: 'COMPLETED',
        mentionStatus: 'EXTRACTED',
        citationStatus: 'KNOWN_EMPTY',
        mentionCount: 2,
        citationCount: 0,
        enqueuedCount: 5,
        errorCode: null,
        durationMs: 42,
        promptText: 'SECRET PROMPT',
        answerText: 'SECRET ANSWER',
        alias: 'SECRET ALIAS',
        canonicalValue: 'SECRET SUBJECT',
        providerBody: { secret: true },
        apiKey: 'sk-secret',
        cookie: 'session=secret',
        reasoning: 'SECRET REASONING'
      }
    );

    expect(serialized).toEqual({
      event: 'visibility.extraction.completed',
      projectId: 'project-id',
      observationId: 'observation-id',
      extractionId: 'extraction-id',
      subjectId: 'subject-id',
      extractorVersion: 'P6B_EXTRACTION_V1',
      subjectSetHash: 'hash',
      status: 'COMPLETED',
      mentionStatus: 'EXTRACTED',
      citationStatus: 'KNOWN_EMPTY',
      mentionCount: 2,
      citationCount: 0,
      enqueuedCount: 5,
      errorCode: null,
      durationMs: 42
    });
    expect(JSON.stringify(serialized)).not.toMatch(
      /SECRET|promptText|answerText|alias|canonicalValue|providerBody|apiKey|cookie|reasoning/
    );
  });

  it('emits only serialized safe fields', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    emitVisibilityIntelligenceEvent('visibility.subject.alias_ambiguous', {
      projectId: 'project-id',
      subjectId: 'subject-id',
      errorCode: 'AMBIGUOUS_ALIAS',
      alias: 'PRIVATE ALIAS',
      canonicalValue: 'PRIVATE SUBJECT'
    });
    expect(info).toHaveBeenCalledWith({
      event: 'visibility.subject.alias_ambiguous',
      projectId: 'project-id',
      subjectId: 'subject-id',
      errorCode: 'AMBIGUOUS_ALIAS'
    });
    info.mockRestore();
  });

  it('emits safe queued/backfill events without serializing queue payload content', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const queue = new VisibilityExtractionQueue(new FakeQueuePort());

    await queue.enqueueObservation({
      projectId: 'project-id',
      observationId: 'observation-id',
      extractorVersion: 'P6B_EXTRACTION_V1',
      subjectSetHash: 'subject-hash'
    });
    await queue.enqueueBackfill({
      projectId: 'project-id',
      extractorVersion: 'P6B_EXTRACTION_V1',
      subjectSetHash: 'subject-hash',
      afterObservationId: null,
      limit: 50
    });

    expect(info).toHaveBeenCalledWith(expect.objectContaining({
      event: 'visibility.extraction.queued',
      projectId: 'project-id',
      observationId: 'observation-id',
      extractorVersion: 'P6B_EXTRACTION_V1',
      subjectSetHash: 'subject-hash',
      status: 'QUEUED'
    }));
    expect(info).toHaveBeenCalledWith(expect.objectContaining({
      event: 'visibility.extraction.backfill_queued',
      projectId: 'project-id',
      extractorVersion: 'P6B_EXTRACTION_V1',
      subjectSetHash: 'subject-hash',
      status: 'QUEUED'
    }));
    info.mockRestore();
  });
});
