import { Worker } from 'bullmq';
import { processAiJob, type AiJobData } from '../modules/ai/ai.worker.js';
import { processContentRefreshJob, type ContentRefreshJobData } from '../modules/content/content.worker.js';
import { processCrawlJob, type CrawlJobData } from '../modules/crawler/crawl.worker.js';
import { processGeoAuditJob, type GeoAuditJobData } from '../modules/geo/geo.worker.js';
import { processSeoAuditJob, type SeoAuditJobData } from '../modules/seo/seo.worker.js';
import { createRedisConnection } from './connection.js';
import { QUEUE_NAMES } from './queues.js';

export async function startWorkers() {
  const connection = createRedisConnection();
  const workers = QUEUE_NAMES.filter((name) => name !== 'visibility').map((name) => {
    if (name === 'crawl') return new Worker<CrawlJobData>(name, processCrawlJob, { connection });
    if (name === 'seo-audit') return new Worker<SeoAuditJobData>(name, processSeoAuditJob, { connection });
    if (name === 'geo-audit') return new Worker<GeoAuditJobData>(name, processGeoAuditJob, { connection });
    if (name === 'content') return new Worker<ContentRefreshJobData>(name, processContentRefreshJob, { connection, concurrency: 2 });
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
