import { Worker } from 'bullmq';
import { processAiJob, type AiJobData } from '../modules/ai/ai.worker.js';
import { processCompetitorCrawlJob, type CompetitorCrawlJobData } from '../modules/competitor/competitor.worker.js';
import { processContentRefreshJob, type ContentRefreshJobData } from '../modules/content/content.worker.js';
import { processCrawlJob, type CrawlJobData } from '../modules/crawler/crawl.worker.js';
import { processGeoAuditJob, type GeoAuditJobData } from '../modules/geo/geo.worker.js';
import { processSeoAuditJob, type SeoAuditJobData } from '../modules/seo/seo.worker.js';
import { processVisibilityJob, type VisibilityJobData } from '../modules/visibility/visibility.worker.js';
import { createRedisConnection } from './connection.js';
import { QUEUE_NAMES } from './queues.js';

export function workerDefinitionForQueue(name: 'visibility') {
  if (name !== 'visibility') throw new Error(`Unsupported worker definition: ${name}`);
  return {
    processor: processVisibilityJob,
    concurrency: 2
  } as const;
}

export async function startWorkers() {
  const connection = createRedisConnection();
  const workers = QUEUE_NAMES.map((name) => {
    if (name === 'crawl') return new Worker<CrawlJobData>(name, processCrawlJob, { connection });
    if (name === 'seo-audit') return new Worker<SeoAuditJobData>(name, processSeoAuditJob, { connection });
    if (name === 'geo-audit') return new Worker<GeoAuditJobData>(name, processGeoAuditJob, { connection });
    if (name === 'content') return new Worker<ContentRefreshJobData>(name, processContentRefreshJob, { connection, concurrency: 2 });
    if (name === 'competitor') return new Worker<CompetitorCrawlJobData>(name, processCompetitorCrawlJob, { connection, concurrency: 2 });
    if (name === 'visibility') {
      const definition = workerDefinitionForQueue(name);
      return new Worker<VisibilityJobData>(name, definition.processor, {
        connection,
        concurrency: definition.concurrency
      });
    }
    if (name === 'ai') return new Worker<AiJobData>(name, processAiJob, { connection });
    return new Worker(name, async () => undefined, { connection });
  });

  return {
    async close() {
      await Promise.all(workers.map((worker) => worker.close()));
      await connection.quit();
    }
  };
}
