import type { Job } from 'bullmq';
import { executeCrawlRun } from './crawl-engine.js';

export interface CrawlJobData {
  crawlRunId: string;
}

type CrawlExecutor = (crawlRunId: string) => Promise<void>;
type CrawlJobLike = Pick<Job<CrawlJobData>, 'data'>;

export async function processCrawlJob(
  job: CrawlJobLike,
  execute: CrawlExecutor = executeCrawlRun
): Promise<void> {
  const crawlRunId = job.data?.crawlRunId;
  if (!crawlRunId || typeof crawlRunId !== 'string') {
    throw new Error('crawlRunId is required for crawl jobs');
  }

  await execute(crawlRunId);
}
