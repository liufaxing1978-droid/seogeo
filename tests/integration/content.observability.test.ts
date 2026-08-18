import { describe, expect, it } from 'vitest';
import { ContentObservability, type ContentObservabilityEvent } from '../../src/modules/content/content-observability.js';

describe('P5-A content observability contract', () => {
  it('emits only bounded identifiers and aggregate counts', () => {
    const events: ContentObservabilityEvent[] = [];
    const observability = new ContentObservability((event) => events.push(event));

    observability.emit({ event: 'content.refresh.queued', projectId: 'project-1' });
    observability.emit({ event: 'content.refresh.started', projectId: 'project-1' });
    observability.emit({ event: 'content.document.updated', projectId: 'project-1', documentId: 'document-1' });
    observability.emit({ event: 'content.opportunity.updated', projectId: 'project-1', documentId: 'document-1', opportunitiesEvaluated: 9 });
    observability.emit({ event: 'content.refresh.completed', projectId: 'project-1', documentsUpdated: 1, opportunitiesEvaluated: 9 });

    expect(events.map((event) => event.event)).toEqual([
      'content.refresh.queued',
      'content.refresh.started',
      'content.document.updated',
      'content.opportunity.updated',
      'content.refresh.completed'
    ]);
    const serialized = JSON.stringify(events);
    for (const forbidden of ['Authorization', 'cookie=', 'secret-value', 'reasoning_content', 'full page body', 'prompt text', 'full ai output']) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
