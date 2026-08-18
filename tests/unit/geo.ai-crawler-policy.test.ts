import { describe, expect, it } from 'vitest';
import {
  AI_CRAWLER_CATALOG,
  type AiCrawlerCatalogEntry
} from '../../src/modules/geo/ai-crawler-catalog.js';
import { evaluateAiCrawlerPolicy } from '../../src/modules/geo/ai-crawler-evaluator.js';

function crawler(code: string): AiCrawlerCatalogEntry {
  const found = AI_CRAWLER_CATALOG.find((entry) => entry.crawlerCode === code);
  if (!found) throw new Error(`Missing crawler fixture: ${code}`);
  return found;
}

describe('AI crawler catalog', () => {
  it('contains only officially documented robots-controlled crawler identities', () => {
    expect(AI_CRAWLER_CATALOG.map((entry) => entry.crawlerCode)).toEqual([
      'OAI_SEARCHBOT',
      'GPTBOT',
      'GOOGLE_EXTENDED',
      'CLAUDEBOT',
      'CLAUDE_SEARCHBOT',
      'PERPLEXITYBOT'
    ]);

    expect(AI_CRAWLER_CATALOG.map((entry) => entry.robotsToken)).toEqual([
      'OAI-SearchBot',
      'GPTBot',
      'Google-Extended',
      'ClaudeBot',
      'Claude-SearchBot',
      'PerplexityBot'
    ]);

    expect(JSON.stringify(AI_CRAWLER_CATALOG)).not.toContain('Claude-User');
    expect(JSON.stringify(AI_CRAWLER_CATALOG)).not.toContain('Perplexity-User');
  });

  it('distinguishes robots-only training/control tokens from search-discovery crawlers', () => {
    expect(crawler('OAI_SEARCHBOT')).toMatchObject({ provider: 'OPENAI', purpose: 'SEARCH_DISCOVERY' });
    expect(crawler('GPTBOT')).toMatchObject({ provider: 'OPENAI', purpose: 'MODEL_TRAINING' });
    expect(crawler('GOOGLE_EXTENDED')).toMatchObject({
      provider: 'GOOGLE',
      purpose: 'AI_TRAINING_AND_GROUNDING_CONTROL',
      httpUserAgent: null
    });
    expect(crawler('CLAUDE_SEARCHBOT')).toMatchObject({ provider: 'ANTHROPIC', purpose: 'SEARCH_DISCOVERY' });
    expect(crawler('PERPLEXITYBOT')).toMatchObject({ provider: 'PERPLEXITY', purpose: 'SEARCH_DISCOVERY' });
  });
});

describe('evaluateAiCrawlerPolicy', () => {
  it('returns FAIL when robots.txt explicitly blocks the crawler at the evaluated URL', () => {
    const result = evaluateAiCrawlerPolicy(crawler('OAI_SEARCHBOT'), {
      evaluatedUrl: 'https://example.com/',
      robotsStatusCode: 200,
      robotsRawText: 'User-agent: OAI-SearchBot\nDisallow: /',
      robotsParseError: null,
      pageReachable: true,
      metaRobots: null,
      xRobotsTag: null
    });

    expect(result).toMatchObject({
      robotsAllowed: false,
      reachable: true,
      status: 'FAIL'
    });
  });

  it('keeps unavailable robots facts UNKNOWN instead of assuming allow or deny', () => {
    const result = evaluateAiCrawlerPolicy(crawler('CLAUDEBOT'), {
      evaluatedUrl: 'https://example.com/',
      robotsStatusCode: 503,
      robotsRawText: null,
      robotsParseError: 'robots unavailable: HTTP 503',
      pageReachable: true,
      metaRobots: null,
      xRobotsTag: null
    });

    expect(result).toMatchObject({
      robotsAllowed: null,
      status: 'UNKNOWN'
    });
  });

  it('treats factual 404 robots.txt as allowing robots access', () => {
    const result = evaluateAiCrawlerPolicy(crawler('PERPLEXITYBOT'), {
      evaluatedUrl: 'https://example.com/',
      robotsStatusCode: 404,
      robotsRawText: null,
      robotsParseError: null,
      pageReachable: true,
      metaRobots: null,
      xRobotsTag: null
    });

    expect(result).toMatchObject({ robotsAllowed: true, reachable: true, status: 'PASS' });
  });

  it('applies noindex to OAI-SearchBot discovery readiness but not GPTBot training policy', () => {
    const facts = {
      evaluatedUrl: 'https://example.com/',
      robotsStatusCode: 200,
      robotsRawText: 'User-agent: *\nAllow: /',
      robotsParseError: null,
      pageReachable: true,
      metaRobots: 'noindex,follow',
      xRobotsTag: null
    } as const;

    expect(evaluateAiCrawlerPolicy(crawler('OAI_SEARCHBOT'), facts)).toMatchObject({
      robotsAllowed: true,
      metaRobotsAllowed: false,
      status: 'FAIL'
    });
    expect(evaluateAiCrawlerPolicy(crawler('GPTBOT'), facts)).toMatchObject({
      robotsAllowed: true,
      metaRobotsAllowed: null,
      status: 'PASS'
    });
  });

  it('does not apply generic Google Search meta directives to Google-Extended control', () => {
    const result = evaluateAiCrawlerPolicy(crawler('GOOGLE_EXTENDED'), {
      evaluatedUrl: 'https://example.com/',
      robotsStatusCode: 200,
      robotsRawText: 'User-agent: Google-Extended\nAllow: /',
      robotsParseError: null,
      pageReachable: true,
      metaRobots: 'noindex',
      xRobotsTag: 'noindex'
    });

    expect(result).toMatchObject({
      robotsAllowed: true,
      metaRobotsAllowed: null,
      xRobotsAllowed: null,
      status: 'PASS'
    });
  });
});
