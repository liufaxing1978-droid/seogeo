import { Queue, Worker } from 'bullmq';
import { processAiJob, type AiJobData } from '../modules/ai/ai.worker.js';
import { processCompetitorCrawlJob, type CompetitorCrawlJobData } from '../modules/competitor/competitor.worker.js';
import { processContentRefreshJob, type ContentRefreshJobData } from '../modules/content/content.worker.js';
import { processCrawlJob, type CrawlJobData } from '../modules/crawler/crawl.worker.js';
import { processGeoAuditJob, type GeoAuditJobData } from '../modules/geo/geo.worker.js';
import { processSeoAuditJob, type SeoAuditJobData } from '../modules/seo/seo.worker.js';
import {
  VISIBILITY_EXTRACTION_QUEUE_NAME,
  VisibilityExtractionQueue,
  type VisibilityExtractionQueuePort
} from '../modules/visibility/visibility-extraction.queue.js';
import { processVisibilityExtractionJob } from '../modules/visibility/visibility-extraction.worker.js';
import {
  VISIBILITY_METRICS_QUEUE_NAME
} from '../modules/visibility/visibility-metrics.queue.js';
import {
  processVisibilityMetricsJob,
  VISIBILITY_METRICS_WORKER_CONCURRENCY
} from '../modules/visibility/visibility-metrics.worker.js';
import { processVisibilityJob, type VisibilityJobData } from '../modules/visibility/visibility.worker.js';
import { createRedisConnection } from './connection.js';
import { QUEUE_NAMES } from './queues.js';

export function workerDefinitionForQueue(name: 'visibility' | 'visibility-extraction' | 'visibility-metrics') {
  if (name === 'visibility') {
    return {
      processor: processVisibilityJob,
      concurrency: 2
    } as const;
  }
  if (name === 'visibility-extraction') {
    return {
      processor: processVisibilityExtractionJob,
      concurrency: 4
    } as const;
  }
  if (name === 'visibility-metrics') {
    return {
      processor: processVisibilityMetricsJob,
      concurrency: VISIBILITY_METRICS_WORKER_CONCURRENCY
    } as const;
  }
  throw new Error(`Unsupported worker definition: ${name}`);
}

export async function startWorkers() {
  const connection = createRedisConnection();
  const supportQueues: Queue[] = [];
  const workers = QUEUE_NAMES.map((name) => {
    if (name === 'crawl') return new Worker<CrawlJobData>(name, processCrawlJob, { connection });
    if (name === 'seo-audit') return new Worker<SeoAuditJobData>(name, processSeoAuditJob, { connection });
    if (name === 'geo-audit') return new Worker<GeoAuditJobData>(name, processGeoAuditJob, { connection });
    if (name === 'content') return new Worker<ContentRefreshJobData>(name, processContentRefreshJob, { connection, concurrency: 2 });
    if (name === 'competitor') return new Worker<CompetitorCrawlJobData>(name, processCompetitorCrawlJob, { connection, concurrency: 2 });
    if (name === 'visibility') {
      return new Worker<VisibilityJobData>(name, processVisibilityJob, {
        connection,
        concurrency: 2
      });
    }
    if (name === VISIBILITY_EXTRACTION_QUEUE_NAME) {
      const supportQueue = new Queue(name, { connection });
      supportQueues.push(supportQueue);
      const extractionQueue = new VisibilityExtractionQueue(
        supportQueue as unknown as VisibilityExtractionQueuePort
      );
      return new Worker<Record<string, unknown>>(
        name,
        async (job) => processVisibilityExtractionJob(
          { name: job.name, data: job.data },
          { queue: extractionQueue }
        ),
        { connection, concurrency: 4 }
      );
    }
    if (name === VISIBILITY_METRICS_QUEUE_NAME) {
      return new Worker<Record<string, unknown>>(
        name,
        async (job) => processVisibilityMetricsJob({ name: job.name, data: job.data }),
        { connection, concurrency: VISIBILITY_METRICS_WORKER_CONCURRENCY }
      );
    }
    if (name === 'ai') return new Worker<AiJobData>(name, processAiJob, { connection });
    return new Worker(name, async () => undefined, { connection });
  });

  return {
    async close() {
      await Promise.all(workers.map((worker) => worker.close()));
      await Promise.all(supportQueues.map((queue) => queue.close()));
      await connection.quit();
    }
  };
}
