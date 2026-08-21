import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

export const QUEUE_NAMES = [
  'crawl',
  'seo-audit',
  'geo-audit',
  'content',
  'competitor',
  'search-console-sync',
  'growth-materialization',
  'visibility',
  'visibility-extraction',
  'visibility-metrics',
  'visibility-monitoring',
  'site-mutation-execution',
  'site-mutation-verification',
  'distribution-preparation',
  'ai',
  'report'
] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];
export type QueueRegistry = Record<QueueName, Queue>;

export function createQueues(connection: Redis): QueueRegistry {
  return Object.fromEntries(
    QUEUE_NAMES.map((name) => [name, new Queue(name, { connection })])
  ) as QueueRegistry;
}
