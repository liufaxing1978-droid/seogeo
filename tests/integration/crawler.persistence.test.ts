import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';

beforeEach(async () => {
  await prisma.pageSnapshot.deleteMany();
  await prisma.page.deleteMany();
  await prisma.crawlRun.deleteMany();
  await prisma.project.deleteMany();
});

describe('crawler persistence', () => {
  it('keeps one stable page identity while appending crawl snapshots', async () => {
    const project = await prisma.project.create({
      data: {
        name: 'Crawler Test',
        slug: `crawler-test-${Date.now()}`,
        primaryDomain: 'example.com'
      }
    });

    const run = await prisma.crawlRun.create({
      data: {
        projectId: project.id,
        runType: 'MANUAL',
        status: 'RUNNING',
        seedUrl: 'https://example.com/',
        maxPages: 500,
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

    await prisma.pageSnapshot.createMany({
      data: [
        {
          pageId: page.id,
          crawlRunId: run.id,
          finalUrl: 'https://example.com/',
          statusCode: 200,
          title: 'First snapshot',
          capturedAt: new Date('2026-08-18T00:00:00Z'),
          parserVersion: '0.1.0'
        },
        {
          pageId: page.id,
          crawlRunId: run.id,
          finalUrl: 'https://example.com/',
          statusCode: 200,
          title: 'Second snapshot',
          capturedAt: new Date('2026-08-18T01:00:00Z'),
          parserVersion: '0.1.0'
        }
      ]
    });

    expect(await prisma.page.count({ where: { projectId: project.id } })).toBe(1);
    expect(await prisma.pageSnapshot.count({ where: { pageId: page.id } })).toBe(2);
  });
});
