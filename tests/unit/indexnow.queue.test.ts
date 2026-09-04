import { describe, expect, it, vi } from 'vitest';
import {
  INDEXNOW_QUEUE_ATTEMPTS,
  INDEXNOW_SUBMISSION_QUEUE_NAME,
  IndexNowSubmissionQueue
} from '../../src/modules/indexnow/indexnow.queue.js';

describe('P9 IndexNow submission queue', () => {
  it('enqueues one idempotent batch job with exactly three bounded attempts', async () => {
    const add = vi.fn(async () => ({ id: 'job-1' }));
    const queue = new IndexNowSubmissionQueue({ add });

    await queue.enqueue('batch-1');

    expect(INDEXNOW_SUBMISSION_QUEUE_NAME).toBe('indexnow-submission');
    expect(INDEXNOW_QUEUE_ATTEMPTS).toBe(3);
    expect(add).toHaveBeenCalledWith(
      'submit-batch',
      { batchId: 'batch-1' },
      {
        jobId: 'indexnow-batch-1',
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: 200
      }
    );
  });
});
