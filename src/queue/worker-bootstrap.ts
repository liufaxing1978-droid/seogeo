import { Worker } from 'bullmq';
import { createRedisConnection } from './connection.js';
import { QUEUE_NAMES } from './queues.js';

export async function startWorkers() {
  const connection = createRedisConnection();
  const workers = QUEUE_NAMES.filter((name) => name !== 'visibility').map(
    (name) => new Worker(name, async () => undefined, { connection })
  );

  return {
    async close() {
      await Promise.all(workers.map((worker) => worker.close()));
      await connection.quit();
    }
  };
}
