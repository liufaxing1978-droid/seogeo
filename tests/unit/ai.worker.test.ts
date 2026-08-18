import { describe, expect, it, vi } from 'vitest';
import { processAiJob } from '../../src/modules/ai/ai.worker.js';

describe('P4 AI BullMQ worker', () => {
  it('requires a taskId', async () => {
    await expect(processAiJob({ data: {} as { taskId: string } }, vi.fn())).rejects.toThrow(/taskId is required/i);
  });

  it('delegates exactly one durable task execution', async () => {
    const execute = vi.fn(async (_taskId: string) => undefined);

    await processAiJob({ data: { taskId: 'task-fixture' } }, execute);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('task-fixture');
  });
});
