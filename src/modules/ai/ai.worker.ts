import { createHash } from 'node:crypto';
import type { AiTask, Prisma } from '@prisma/client';
import type { Job } from 'bullmq';
import { z } from 'zod';
import { aiGatewayConfig } from './ai.config.js';
import { AiGateway } from './ai.gateway.js';
import type { AiGatewayRequest, AiProviderResponse } from './ai.types.js';
import { DeepSeekProvider } from './deepseek.provider.js';
import { getPromptDefinition } from './prompts/prompt-registry.js';
import { AiProviderError } from './provider.js';
import { AiProviderRegistry } from './provider-registry.js';
import { AiRepository } from './ai.repository.js';
import { parseSeoAnalysisOutput } from './seo-intelligence.js';
import { AiOutputValidationError, parseStructuredOutput } from './structured-output.js';

export interface AiJobData {
  taskId: string;
}

export interface AiCompletionGateway {
  complete(request: AiGatewayRequest): Promise<AiProviderResponse>;
}

export interface ExecuteAiTaskDependencies {
  repository?: AiRepository;
  gateway?: AiCompletionGateway;
}

type AiTaskExecutor = (taskId: string) => Promise<void>;
type AiJobLike = Pick<Job<AiJobData>, 'data'>;

const GENERIC_JSON_OUTPUT = z.record(z.string(), z.unknown());

let defaultGateway: AiGateway | null = null;

function getDefaultGateway(): AiGateway {
  if (!defaultGateway) {
    const provider = new DeepSeekProvider(aiGatewayConfig);
    defaultGateway = new AiGateway(new AiProviderRegistry([provider]), aiGatewayConfig);
  }
  return defaultGateway;
}

function expectedPromptId(task: AiTask): string {
  switch (task.taskType) {
    case 'SEO_AUDIT_ANALYSIS':
      return 'seo-audit-analysis-v1';
    case 'GEO_READINESS_ANALYSIS':
      return 'geo-readiness-analysis-v1';
    case 'ENTITY_ENRICHMENT':
      return 'entity-enrichment-v1';
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)])
    );
  }
  return value;
}

function requestHash(task: AiTask, model: string, mode: string, responseFormat: string): string {
  const payload = JSON.stringify({
    taskType: task.taskType,
    promptVersion: task.promptVersion,
    model,
    mode,
    responseFormat,
    factSnapshot: canonicalize(task.factSnapshot)
  });
  return createHash('sha256').update(payload).digest('hex');
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof AiProviderError || error instanceof AiOutputValidationError) {
    return error.message.replace(/[\r\n\t]+/g, ' ').slice(0, 300);
  }
  return 'AI execution failed';
}

function errorCode(error: unknown): string {
  if (error instanceof AiProviderError || error instanceof AiOutputValidationError) return error.code;
  return 'AI_EXECUTION_FAILED';
}

function resultSummary(task: AiTask, output: unknown): string {
  const record = output !== null && typeof output === 'object' && !Array.isArray(output)
    ? (output as Record<string, unknown>)
    : null;
  const supplied = record?.summary;
  if (typeof supplied === 'string' && supplied.trim().length > 0) {
    return supplied.trim().slice(0, 2000);
  }
  switch (task.taskType) {
    case 'SEO_AUDIT_ANALYSIS':
      return 'SEO analysis completed.';
    case 'GEO_READINESS_ANALYSIS':
      return 'GEO readiness analysis completed.';
    case 'ENTITY_ENRICHMENT':
      return 'Entity enrichment suggestions generated.';
  }
}

function parseTaskOutput(task: AiTask, content: string): unknown {
  if (task.taskType === 'SEO_AUDIT_ANALYSIS') {
    return parseSeoAnalysisOutput(content, task.sourceReferences);
  }
  return parseStructuredOutput(content, GENERIC_JSON_OUTPUT);
}

export async function executeAiTask(
  taskId: string,
  dependencies: ExecuteAiTaskDependencies = {}
): Promise<void> {
  const repository = dependencies.repository ?? new AiRepository();
  const gateway = dependencies.gateway ?? getDefaultGateway();
  const task = await repository.getTask(taskId);
  if (!task) throw new Error(`AI task not found: ${taskId}`);

  if (task.status === 'COMPLETED' || task.status === 'RUNNING' || task.status === 'FAILED') return;

  const claimed = await repository.claimQueuedTask(taskId);
  if (!claimed) return;

  const expectedPrompt = expectedPromptId(task);
  if (task.promptVersion !== expectedPrompt) {
    await repository.markTaskFailed(task.id, 'AI_PROMPT_MISMATCH', 'AI task prompt does not match its task type');
    throw new Error('AI task prompt does not match its task type');
  }

  const prompt = getPromptDefinition(task.promptVersion);
  const model = prompt.mode === 'REASONING' ? aiGatewayConfig.reasoningModel : aiGatewayConfig.fastModel;
  const attemptNo = (await repository.countRuns(task.id)) + 1;
  const run = await repository.createRun({
    aiTaskId: task.id,
    attemptNo,
    provider: 'DEEPSEEK',
    model,
    mode: prompt.mode,
    responseFormat: prompt.responseFormat,
    promptVersion: prompt.id,
    requestHash: requestHash(task, model, prompt.mode, prompt.responseFormat)
  });

  try {
    const response = await gateway.complete({
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.buildUserMessage(task.factSnapshot) }
      ],
      mode: prompt.mode,
      responseFormat: prompt.responseFormat
    });

    const output = parseTaskOutput(task, response.content);
    await repository.completeRun(
      task,
      run.id,
      response,
      output as Prisma.InputJsonValue,
      resultSummary(task, output)
    );
  } catch (error) {
    await repository.failRun(task.id, run.id, {
      errorCode: errorCode(error),
      errorMessage: safeErrorMessage(error),
      httpStatus: error instanceof AiProviderError ? error.httpStatus : null
    });
    throw error;
  }
}

export async function processAiJob(
  job: AiJobLike,
  tokenOrExecute?: string | AiTaskExecutor
): Promise<void> {
  const taskId = job.data?.taskId;
  if (!taskId || typeof taskId !== 'string') {
    throw new Error('taskId is required for AI jobs');
  }

  const execute = typeof tokenOrExecute === 'function' ? tokenOrExecute : executeAiTask;
  await execute(taskId);
}
