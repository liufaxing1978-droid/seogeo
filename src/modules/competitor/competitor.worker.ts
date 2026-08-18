import type { Job } from 'bullmq';
import { prisma } from '../../db/prisma.js';
import { fetchPage } from '../crawler/http-fetcher.js';
import { parseHtml } from '../crawler/html-parser.js';
import { isInProjectScope, normalizeCrawlUrl } from '../crawler/url-normalizer.js';
import type { CompetitorCrawlJobData } from './competitor.service.js';

export type { CompetitorCrawlJobData } from './competitor.service.js';
export type CompetitorFetch = typeof fetchPage;

export interface CompetitorWorkerDependencies {
  fetcher?: CompetitorFetch;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.replace(/[\r\n\t]+/g, ' ').slice(0, 300) : 'Competitor crawl failed';
}

export async function executeCompetitorCrawl(competitorCrawlId: string, dependencies: CompetitorWorkerDependencies = {}) {
  const fetcher = dependencies.fetcher ?? fetchPage;
  const crawl = await prisma.competitorCrawl.findUnique({ where: { id: competitorCrawlId }, include: { competitor: true } });
  if (!crawl) throw new Error(`Competitor crawl not found: ${competitorCrawlId}`);
  if (crawl.status === 'COMPLETED' || crawl.status === 'RUNNING' || crawl.status === 'CANCELLED') return;

  await prisma.competitorCrawl.update({ where: { id: crawl.id }, data: { status: 'RUNNING', startedAt: new Date(), finishedAt: null, errorMessage: null } });
  const queue = [normalizeCrawlUrl(crawl.seedUrl)];
  const seen = new Set<string>();
  let pagesCrawled = 0;

  try {
    while (queue.length && pagesCrawled < crawl.maxPages) {
      const normalizedUrl = queue.shift()!;
      if (seen.has(normalizedUrl)) continue;
      seen.add(normalizedUrl);
      if (!isInProjectScope(new URL(normalizedUrl), crawl.competitor.domain)) continue;

      const result = await fetcher(normalizedUrl);
      let parsed: ReturnType<typeof parseHtml> | null = null;
      if (result.body) {
        parsed = parseHtml(result.body, result.finalUrl, result.headers, result.statusCode);
      }

      await prisma.competitorPageSnapshot.upsert({
        where: { competitorCrawlId_normalizedUrl: { competitorCrawlId: crawl.id, normalizedUrl } },
        create: {
          competitorCrawlId: crawl.id,
          url: normalizedUrl,
          normalizedUrl,
          finalUrl: result.finalUrl,
          statusCode: result.statusCode || null,
          fetchError: result.errorCode,
          title: parsed?.title ?? null,
          metaDescription: parsed?.metaDescription ?? null,
          canonicalUrl: parsed?.canonicalUrl ?? null,
          h1: parsed?.h1 ?? null,
          wordCount: parsed ? parsed.wordCount : null,
          headingCount: parsed ? parsed.h1Count + parsed.h2Count + parsed.h3Count : null,
          internalLinkCount: parsed?.internalLinksCount ?? null,
          externalLinkCount: parsed?.externalLinksCount ?? null,
          imageCount: parsed?.imagesCount ?? null,
          schemaCount: parsed?.schemaCount ?? null,
          indexable: parsed?.indexable ?? null,
          contentHash: parsed?.contentHash ?? null,
          fetchedAt: new Date()
        },
        update: {
          finalUrl: result.finalUrl,
          statusCode: result.statusCode || null,
          fetchError: result.errorCode,
          title: parsed?.title ?? null,
          metaDescription: parsed?.metaDescription ?? null,
          canonicalUrl: parsed?.canonicalUrl ?? null,
          h1: parsed?.h1 ?? null,
          wordCount: parsed ? parsed.wordCount : null,
          headingCount: parsed ? parsed.h1Count + parsed.h2Count + parsed.h3Count : null,
          internalLinkCount: parsed?.internalLinksCount ?? null,
          externalLinkCount: parsed?.externalLinksCount ?? null,
          imageCount: parsed?.imagesCount ?? null,
          schemaCount: parsed?.schemaCount ?? null,
          indexable: parsed?.indexable ?? null,
          contentHash: parsed?.contentHash ?? null,
          fetchedAt: new Date()
        }
      });
      pagesCrawled += 1;

      if (parsed) {
        for (const link of parsed.internalLinks) {
          if (queue.length + seen.size >= crawl.maxPages * 4) break;
          try {
            const normalized = normalizeCrawlUrl(link);
            if (isInProjectScope(new URL(normalized), crawl.competitor.domain) && !seen.has(normalized)) queue.push(normalized);
          } catch {
            // Invalid links are ignored, matching P1 deterministic URL policy.
          }
        }
      }
    }

    await prisma.competitorCrawl.update({ where: { id: crawl.id }, data: { status: 'COMPLETED', pagesCrawled, finishedAt: new Date(), errorMessage: null } });
  } catch (error) {
    await prisma.competitorCrawl.update({ where: { id: crawl.id }, data: { status: 'FAILED', pagesCrawled, finishedAt: new Date(), errorMessage: safeError(error) } });
    throw error;
  }
}

export async function processCompetitorCrawlJob(job: Job<CompetitorCrawlJobData>) {
  if (!job.data?.competitorCrawlId) throw new Error('competitorCrawlId is required');
  await executeCompetitorCrawl(job.data.competitorCrawlId);
}
