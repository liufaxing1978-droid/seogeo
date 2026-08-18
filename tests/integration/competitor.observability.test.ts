import { describe, expect, it } from 'vitest';
import { CompetitorObservability, type CompetitorObservabilityEvent } from '../../src/modules/competitor/competitor-observability.js';

describe('P5-B competitor observability contract', () => {
  it('emits only bounded identifiers, counts and stable errors', () => {
    const events: CompetitorObservabilityEvent[] = [];
    const observability = new CompetitorObservability((event) => events.push(event));

    observability.emit({ event: 'competitor.crawl.queued', projectId: 'project-1', competitorId: 'competitor-1', crawlId: 'crawl-1' });
    observability.emit({ event: 'competitor.crawl.started', projectId: 'project-1', competitorId: 'competitor-1', crawlId: 'crawl-1' });
    observability.emit({ event: 'competitor.crawl.completed', projectId: 'project-1', competitorId: 'competitor-1', crawlId: 'crawl-1', pageCount: 25 });
    observability.emit({ event: 'competitor.comparison.created', projectId: 'project-1', competitorId: 'competitor-1', comparisonId: 'comparison-1' });

    expect(events.map((event) => event.event)).toEqual([
      'competitor.crawl.queued',
      'competitor.crawl.started',
      'competitor.crawl.completed',
      'competitor.comparison.created'
    ]);
    const serialized = JSON.stringify(events);
    for (const forbidden of ['https://competitor.example.com', 'Authorization', 'cookie=', 'page body', 'prompt text', 'reasoning_content', 'full ai output']) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
