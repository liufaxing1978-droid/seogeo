import type { AiTask, AiTaskType, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { AppError, NotFoundError } from '../../core/errors.js';
import { createRedisConnection } from '../../queue/connection.js';
import { AiRepository, isUniqueConstraintError } from './ai.repository.js';
import type { AiJobData } from './ai.worker.js';

export interface CreateAiTaskInput {
  projectId: string;
  taskType: AiTaskType;
  requestKey: string;
  promptVersion: string;
  factSnapshot: Prisma.InputJsonValue;
  sourceReferences: Prisma.InputJsonValue;
}

export interface AiTaskJobQueue {
  add(
    name: string,
    data: AiJobData,
    options: { jobId: string; attempts: number }
  ): Promise<unknown>;
}

class LazyBullAiQueue implements AiTaskJobQueue {
  private queue: Queue<AiJobData> | null = null;

  private getQueue() {
    if (!this.queue) {
      this.queue = new Queue<AiJobData>('ai', { connection: createRedisConnection() });
    }
    return this.queue;
  }

  add(name: string, data: AiJobData, options: { jobId: string; attempts: number }) {
    return this.getQueue().add(name, data, options);
  }
}

function safeQueueFailure(): string {
  return 'Failed to enqueue AI task';
}

export class AiTaskService {
  constructor(
    private readonly repository: AiRepository,
    private readonly queue: AiTaskJobQueue
  ) {}

  private async enqueue(taskId: string, jobId: string): Promise<void> {
    try {
      await this.queue.add('ai-task', { taskId }, { jobId, attempts: 1 });
    } catch (error) {
      await this.repository.markTaskFailed(taskId, 'AI_QUEUE_ENQUEUE_FAILED', safeQueueFailure());
      throw error;
    }
  }

  async createAndEnqueue(input: CreateAiTaskInput): Promise<AiTask> {
    const existing = await this.repository.findTaskByRequest(input.projectId, input.requestKey);
    if (existing) return existing;

    let task: AiTask;
    try {
      task = await this.repository.createTask(input);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const raced = await this.repository.findTaskByRequest(input.projectId, input.requestKey);
        if (raced) return raced;
      }
      throw error;
    }

    await this.enqueue(task.id, `ai-task-${task.id}`);
    return task;
  }

  async retry(taskId: string): Promise<AiTask> {
    const task = await this.repository.getTask(taskId);
    if (!task) throw new NotFoundError('AI task not found', 'AI_TASK_NOT_FOUND');
    if (task.status !== 'FAILED') {
      throw new AppError('Only failed AI tasks can be retried', 409, 'AI_TASK_NOT_RETRYABLE');
    }

    const nextAttemptNo = (await this.repository.countRuns(taskId)) + 1;
    const claimed = await this.repository.prepareRetry(taskId);
    if (!claimed) {
      throw new AppError('AI task retry state changed', 409, 'AI_TASK_RETRY_CONFLICT');
    }

    await this.enqueue(taskId, `ai-task-${taskId}-retry-${nextAttemptNo}`);
    return (await this.repository.getTask(taskId)) as AiTask;
  }
}

export const aiTaskService = new AiTaskService(new AiRepository(), new LazyBullAiQueue());
