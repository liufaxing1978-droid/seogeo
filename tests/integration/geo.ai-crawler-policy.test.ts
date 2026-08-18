import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { evaluateAiCrawlersForAudit } from '../../src/modules/geo/ai-crawler-evaluator.js';

beforeEach(async () => {
  await prisma.project.deleteMany();
  await prisma.geoRuleVersion.deleteMany();
  await prisma.geoRule.deleteMany();
});

describe('persisted AI crawler readiness', () => {
  it('evaluates the stored seed URL facts for every supported robots-controlled crawler', async () => {
    const project = await prisma.project.create({
      data: {
        name: 'Crawler Policy Fixture',
        slug: `crawler-policy-${Date.now()}`,
        primaryDomain: 'example.com'
      }
    });

    const crawlRun = await prisma.crawlRun.create({
      data: {
        projectId: project.id,
        runType: 'MANUAL',
        status: 'COMPLETED',
        seedUrl: 'https://example.com/',
        crawlerVersion: '0.1.0'
      }
    });

    const page = await prisma.page.create({
      data: {
        projectId: project.id,
        url: 'https://example.com/',
        normalizedUrl: 'https://example.com/',
        host: 'example.com',
        path: '/'
      }
    });

    await prisma.pageSnapshot.create({
      data: {
        pageId: page.id,
        crawlRunId: crawlRun.id,
        finalUrl: 'https://example.com/',
        statusCode: 200,
        contentType: 'text/html',
        title: 'Home',
        metaRobots: 'noindex,follow',
        h1: 'Home',
        h1Count: 1,
        wordCount: 400,
        indexable: false,
        parserVersion: '0.2.0',
        httpResult: {
          create: {
            requestUrl: 'https://example.com/',
            finalUrl: 'https://example.com/',
            statusCode: 200,
            headers: { 'x-robots-tag': 'noindex' },
            responseBytes: 1000,
            latencyMs: 20
          }
        }
      }
    });

    await prisma.robotsResult.create({
      data: {
        crawlRunId: crawlRun.id,
        url: 'https://example.com/robots.txt',
        statusCode: 200,
        rawText: [
          'User-agent: GPTBot',
          'Disallow: /',
          '',
          'User-agent: *',
          'Allow: /'
        ].join('\n'),
        parseError: null
      }
    });

    const audit = await prisma.geoAuditRun.create({
      data: {
        projectId: project.id,
        crawlRunId: crawlRun.id,
        status: 'RUNNING',
        engineVersion: 'geo-0.1.0'
      }
    });

    const first = await evaluateAiCrawlersForAudit(audit.id);
    const retry = await evaluateAiCrawlersForAudit(audit.id);

    expect(first).toEqual({ evaluatedCrawlers: 6, passed: 4, failed: 2, unknown: 0 });
    expect(retry).toEqual(first);
    expect(await prisma.aiCrawlerResult.count({ where: { geoAuditRunId: audit.id } })).toBe(6);

    const rows = await prisma.aiCrawlerResult.findMany({
      where: { geoAuditRunId: audit.id },
      orderBy: { crawlerCode: 'asc' }
    });
    const byCode = new Map(rows.map((row) => [row.crawlerCode, row]));

    expect(byCode.get('GPTBOT')).toMatchObject({
      robotsAllowed: false,
      metaRobotsAllowed: null,
      xRobotsAllowed: null,
      reachable: true,
      status: 'FAIL'
    });
    expect(byCode.get('OAI_SEARCHBOT')).toMatchObject({
      robotsAllowed: true,
      metaRobotsAllowed: false,
      xRobotsAllowed: null,
      reachable: true,
      status: 'FAIL'
    });
    expect(byCode.get('GOOGLE_EXTENDED')).toMatchObject({
      robotsAllowed: true,
      metaRobotsAllowed: null,
      xRobotsAllowed: null,
      reachable: true,
      status: 'PASS'
    });

    const evidence = byCode.get('OAI_SEARCHBOT')?.evidence as Record<string, unknown>;
    expect(evidence).toMatchObject({
      evaluatedUrl: 'https://example.com/',
      robotsToken: 'OAI-SearchBot',
      metaDirectiveSemantics: 'OPENAI_SEARCH_NOINDEX'
    });
    expect(JSON.stringify(evidence)).not.toContain('Home');
  });

  it('persists UNKNOWN when stored robots policy is unavailable instead of assuming access', async () => {
    const project = await prisma.project.create({
      data: {
        name: 'Unknown Policy Fixture',
        slug: `unknown-policy-${Date.now()}`,
        primaryDomain: 'unknown.example.com'
      }
    });
    const crawlRun = await prisma.crawlRun.create({
      data: {
        projectId: project.id,
        runType: 'MANUAL',
        status: 'COMPLETED',
        seedUrl: 'https://unknown.example.com/',
        crawlerVersion: '0.1.0'
      }
    });
    await prisma.robotsResult.create({
      data: {
        crawlRunId: crawlRun.id,
        url: 'https://unknown.example.com/robots.txt',
        statusCode: 503,
        rawText: null,
        parseError: 'robots unavailable: HTTP 503'
      }
    });
    const audit = await prisma.geoAuditRun.create({
      data: {
        projectId: project.id,
        crawlRunId: crawlRun.id,
        status: 'RUNNING',
        engineVersion: 'geo-0.1.0'
      }
    });

    const result = await evaluateAiCrawlersForAudit(audit.id);

    expect(result).toEqual({ evaluatedCrawlers: 6, passed: 0, failed: 0, unknown: 6 });
    expect(
      await prisma.aiCrawlerResult.count({
        where: { geoAuditRunId: audit.id, status: 'UNKNOWN', robotsAllowed: null }
      })
    ).toBe(6);
  });
});
