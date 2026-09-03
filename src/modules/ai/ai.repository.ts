import {
  Prisma,
  type AiMode,
  type AiProviderName,
  type AiResponseFormat,
  type AiTask,
  type AiTaskType
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { AiProviderResponse } from './ai.types.js';

export interface CreateAiTaskRecord {
  projectId: string;
  taskType: AiTaskType;
  requestKey: string;
  promptVersion: string;
  factSnapshot: Prisma.InputJsonValue;
  sourceReferences: Prisma.InputJsonValue;
}

export interface CreateAiRunRecord {
  aiTaskId: string;
  attemptNo: number;
  provider: AiProviderName;
  model: string;
  mode: AiMode;
  responseFormat: AiResponseFormat;
  promptVersion: string;
  requestHash: string;
}

export type AiCompletionMaterializer = (tx: Prisma.TransactionClient) => Promise<void>;

export class AiRepository {
  findTaskByRequest(projectId: string, requestKey: string) {
    return prisma.aiTask.findUnique({
      where: { projectId_requestKey: { projectId, requestKey } }
    });
  }

  createTask(input: CreateAiTaskRecord): Promise<AiTask> {
    return prisma.aiTask.create({ data: input });
  }

  getTask(taskId: string) {
    return prisma.aiTask.findUnique({ where: { id: taskId } });
  }

  listProjectTasks(projectId: string) {
    return prisma.aiTask.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        projectId: true,
        taskType: true,
        status: true,
        promptVersion: true,
        errorCode: true,
        errorMessage: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { runs: true } }
      }
    });
  }

  getTaskDetail(taskId: string) {
    return prisma.aiTask.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        projectId: true,
        taskType: true,
        status: true,
        promptVersion: true,
        sourceReferences: true,
        errorCode: true,
        errorMessage: true,
        createdAt: true,
        updatedAt: true,
        runs: {
          orderBy: { attemptNo: 'desc' },
          select: {
            id: true,
            attemptNo: true,
            provider: true,
            model: true,
            mode: true,
            responseFormat: true,
            status: true,
            promptVersion: true,
            startedAt: true,
            finishedAt: true,
            errorCode: true,
            errorMessage: true,
            calls: {
              orderBy: { attemptNo: 'asc' },
              select: {
                attemptNo: true,
                httpStatus: true,
                latencyMs: true,
                promptTokens: true,
                completionTokens: true,
                totalTokens: true,
                cacheHitTokens: true,
                cacheMissTokens: true,
                reasoningTokens: true,
                finishReason: true,
                errorCode: true,
                createdAt: true
              }
            },
            result: {
              select: {
                id: true,
                resultType: true,
                summary: true,
                structuredOutput: true,
                sourceReferences: true,
                provider: true,
                model: true,
                promptVersion: true,
                createdAt: true
              }
            }
          }
        }
      }
    });
  }

  async claimQueuedTask(taskId: string): Promise<boolean> {
    const result = await prisma.aiTask.updateMany({
      where: { id: taskId, status: 'QUEUED' },
      data: { status: 'RUNNING', errorCode: null, errorMessage: null }
    });
    return result.count === 1;
  }

  async prepareRetry(taskId: string): Promise<boolean> {
    const result = await prisma.aiTask.updateMany({
      where: { id: taskId, status: 'FAILED' },
      data: { status: 'QUEUED', errorCode: null, errorMessage: null }
    });
    return result.count === 1;
  }

  markTaskFailed(taskId: string, errorCode: string, errorMessage: string) {
    return prisma.aiTask.update({
      where: { id: taskId },
      data: { status: 'FAILED', errorCode, errorMessage }
    });
  }

  countRuns(taskId: string) {
    return prisma.aiTaskRun.count({ where: { aiTaskId: taskId } });
  }

  createRun(input: CreateAiRunRecord) {
    return prisma.aiTaskRun.create({
      data: { ...input, status: 'RUNNING' }
    });
  }

  recordProviderSuccess(runId: string, response: AiProviderResponse) {
    return prisma.aiProviderCall.create({
      data: {
        aiTaskRunId: runId,
        attemptNo: 1,
        providerResponseId: response.responseId,
        latencyMs: response.latencyMs,
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        totalTokens: response.usage.totalTokens,
        cacheHitTokens: response.usage.cacheHitTokens,
        cacheMissTokens: response.usage.cacheMissTokens,
        reasoningTokens: response.usage.reasoningTokens,
        finishReason: response.finishReason
      }
    });
  }

  async completeRun(
    task: AiTask,
    runId: string,
    response: AiProviderResponse,
    structuredOutput: Prisma.InputJsonValue,
    summary: string,
    materialize?: AiCompletionMaterializer
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.aiAnalysisResult.create({
        data: {
          aiTaskRunId: runId,
          resultType: task.taskType,
          summary,
          structuredOutput,
          sourceReferences: task.sourceReferences as Prisma.InputJsonValue,
          provider: response.provider,
          model: response.model,
          promptVersion: task.promptVersion
        }
      });
      if (materialize) await materialize(tx);
      await tx.aiTaskRun.update({
        where: { id: runId },
        data: { status: 'COMPLETED', finishedAt: new Date() }
      });
      await tx.aiTask.update({
        where: { id: task.id },
        data: { status: 'COMPLETED', errorCode: null, errorMessage: null }
      });
    });
  }

  async failRun(
    taskId: string,
    runId: string,
    input: { errorCode: string; errorMessage: string; httpStatus?: number | null },
    materialize?: AiCompletionMaterializer
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.aiProviderCall.upsert({
        where: { aiTaskRunId_attemptNo: { aiTaskRunId: runId, attemptNo: 1 } },
        create: {
          aiTaskRunId: runId,
          attemptNo: 1,
          httpStatus: input.httpStatus ?? null,
          errorCode: input.errorCode
        },
        update: {}
      });
      await tx.aiTaskRun.update({
        where: { id: runId },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          errorCode: input.errorCode,
          errorMessage: input.errorMessage
        }
      });
      await tx.aiTask.update({
        where: { id: taskId },
        data: {
          status: 'FAILED',
          errorCode: input.errorCode,
          errorMessage: input.errorMessage
        }
      });
      if (materialize) await materialize(tx);
    });
  }
}

export function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
