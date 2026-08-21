import { createHash } from 'node:crypto';
import type { AiTask, Prisma } from '@prisma/client';
import type { Job } from 'bullmq';
import {
  materializeArticleGenerationOutput,
  parseArticleGenerationOutput as parsePublicationArticleGenerationOutput,
  parseContentBriefOutput as parsePublicationContentBriefOutput
} from '../publication/publication-ai.js';
import { PublicationServiceError } from '../publication/publication.service.js';
import { aiGatewayConfig } from './ai.config.js';
import { AiGateway } from './ai.gateway.js';
import { aiObservability, type AiObservability } from './ai-observability.js';
import type { AiGatewayRequest, AiProviderResponse } from './ai.types.js';
import { parseCompetitorGapOutput } from './competitor-intelligence.js';
import { parseContentBriefOutput, parseContentOptimizationOutput, persistContentBrief } from './content-intelligence.js';
import { DeepSeekProvider } from './deepseek.provider.js';
import { parseEntityEnrichmentOutput } from './entity-intelligence.js';
import { parseGeoAnalysisOutput } from './geo-intelligence.js';
import { parseGrowthOpportunityExplanationOutput } from './growth-opportunity-explanation.js';
import { getPromptDefinition } from './prompts/prompt-registry.js';
import { AiProviderError } from './provider.js';
import { AiProviderRegistry } from './provider-registry.js';
import { parseReportExecutiveOutput } from './report-intelligence.js';
import { AiRepository } from './ai.repository.js';
import { parseSeoAnalysisOutput } from './seo-intelligence.js';
import { AiOutputValidationError } from './structured-output.js';
import { parseVisibilityTrendAnalysisOutput } from './visibility-trend-analysis.js';

export interface AiJobData { taskId: string; }
export interface AiCompletionGateway { complete(request: AiGatewayRequest): Promise<AiProviderResponse>; }
export interface ExecuteAiTaskDependencies { repository?: AiRepository; gateway?: AiCompletionGateway; observability?: AiObservability; }

type AiTaskExecutor = (taskId: string) => Promise<void>;
type AiJobLike = Pick<Job<AiJobData>, 'data'>;
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
    case 'SEO_AUDIT_ANALYSIS': return 'seo-audit-analysis-v1';
    case 'GEO_READINESS_ANALYSIS': return 'geo-readiness-analysis-v1';
    case 'ENTITY_ENRICHMENT': return 'entity-enrichment-v1';
    case 'CONTENT_BRIEF': return 'content-brief-v1';
    case 'CONTENT_OPTIMIZATION_ANALYSIS': return 'content-optimization-v1';
    case 'COMPETITOR_GAP_ANALYSIS': return 'competitor-gap-v1';
    case 'REPORT_EXECUTIVE_SUMMARY': return 'project-report-summary-v1';
    case 'VISIBILITY_TREND_ANALYSIS': return 'visibility-trend-analysis-v1';
    case 'GROWTH_OPPORTUNITY_EXPLANATION': return 'growth-opportunity-explanation-v1';
    case 'PUBLICATION_CONTENT_BRIEF': return 'publication-content-brief-v1';
    case 'PUBLICATION_ARTICLE_GENERATION': return 'publication-article-generation-v1';
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonicalize(child)]));
  }
  return value;
}

function requestHash(task: AiTask, model: string, mode: string, responseFormat: string): string {
  return createHash('sha256').update(JSON.stringify({ taskType: task.taskType, promptVersion: task.promptVersion, model, mode, responseFormat, factSnapshot: canonicalize(task.factSnapshot) })).digest('hex');
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof AiProviderError || error instanceof AiOutputValidationError || error instanceof PublicationServiceError) {
    return error.message.replace(/[\r\n\t]+/g, ' ').slice(0, 300);
  }
  return 'AI execution failed';
}
function errorCode(error: unknown): string {
  if (error instanceof AiProviderError || error instanceof AiOutputValidationError || error instanceof PublicationServiceError) {
    return error.code;
  }
  return 'AI_EXECUTION_FAILED';
}

function resultSummary(task: AiTask, output: unknown): string {
  const record = output !== null && typeof output === 'object' && !Array.isArray(output) ? output as Record<string, unknown> : null;
  const supplied = record?.summary;
  if (typeof supplied === 'string' && supplied.trim()) return supplied.trim().slice(0, 2000);
  switch (task.taskType) {
    case 'SEO_AUDIT_ANALYSIS': return 'SEO analysis completed.';
    case 'GEO_READINESS_ANALYSIS': return 'GEO readiness analysis completed.';
    case 'ENTITY_ENRICHMENT': return 'Entity enrichment suggestions generated.';
    case 'CONTENT_BRIEF': return 'Content brief generated.';
    case 'CONTENT_OPTIMIZATION_ANALYSIS': return 'Content optimization analysis completed.';
    case 'COMPETITOR_GAP_ANALYSIS': return 'Competitor gap analysis completed.';
    case 'REPORT_EXECUTIVE_SUMMARY': return 'Project report executive summary completed.';
    case 'VISIBILITY_TREND_ANALYSIS': return 'Visibility trend analysis completed.';
    case 'GROWTH_OPPORTUNITY_EXPLANATION': return 'Growth opportunity explanation completed.';
    case 'PUBLICATION_CONTENT_BRIEF': return 'Advisory publication content brief generated.';
    case 'PUBLICATION_ARTICLE_GENERATION': return 'Advisory publication article draft generated.';
  }
}

function parseTaskOutput(task: AiTask, content: string): unknown {
  switch (task.taskType) {
    case 'SEO_AUDIT_ANALYSIS': return parseSeoAnalysisOutput(content, task.sourceReferences);
    case 'GEO_READINESS_ANALYSIS': return parseGeoAnalysisOutput(content, task.sourceReferences);
    case 'ENTITY_ENRICHMENT': return parseEntityEnrichmentOutput(content, task.sourceReferences);
    case 'CONTENT_BRIEF': return parseContentBriefOutput(content, task.sourceReferences);
    case 'CONTENT_OPTIMIZATION_ANALYSIS': return parseContentOptimizationOutput(content, task.sourceReferences);
    case 'COMPETITOR_GAP_ANALYSIS': return parseCompetitorGapOutput(content, task.sourceReferences);
    case 'REPORT_EXECUTIVE_SUMMARY': return parseReportExecutiveOutput(content, task.sourceReferences);
    case 'VISIBILITY_TREND_ANALYSIS': return parseVisibilityTrendAnalysisOutput(content, task.sourceReferences);
    case 'GROWTH_OPPORTUNITY_EXPLANATION': return parseGrowthOpportunityExplanationOutput(content, task.sourceReferences);
    case 'PUBLICATION_CONTENT_BRIEF': return parsePublicationContentBriefOutput(content, task.sourceReferences);
    case 'PUBLICATION_ARTICLE_GENERATION': return parsePublicationArticleGenerationOutput(content, task.sourceReferences);
  }
}

export async function executeAiTask(taskId: string, dependencies: ExecuteAiTaskDependencies = {}): Promise<void> {
  const repository = dependencies.repository ?? new AiRepository();
  const gateway = dependencies.gateway ?? getDefaultGateway();
  const observability = dependencies.observability ?? aiObservability;
  const task = await repository.getTask(taskId);
  if (!task) throw new Error(`AI task not found: ${taskId}`);
  if (task.status === 'COMPLETED' || task.status === 'RUNNING' || task.status === 'FAILED') return;
  const claimed = await repository.claimQueuedTask(taskId);
  if (!claimed) return;

  const expectedPrompt = expectedPromptId(task);
  if (task.promptVersion !== expectedPrompt) {
    await repository.markTaskFailed(task.id, 'AI_PROMPT_MISMATCH', 'AI task prompt does not match its task type');
    observability.emit({ event: 'ai.task.failed', taskId: task.id, projectId: task.projectId, promptVersion: task.promptVersion, errorCode: 'AI_PROMPT_MISMATCH' });
    throw new Error('AI task prompt does not match its task type');
  }

  const prompt = getPromptDefinition(task.promptVersion);
  const model = prompt.mode === 'REASONING' ? aiGatewayConfig.reasoningModel : aiGatewayConfig.fastModel;
  const attemptNo = (await repository.countRuns(task.id)) + 1;
  const run = await repository.createRun({ aiTaskId: task.id, attemptNo, provider: 'DEEPSEEK', model, mode: prompt.mode, responseFormat: prompt.responseFormat, promptVersion: prompt.id, requestHash: requestHash(task, model, prompt.mode, prompt.responseFormat) });
  observability.emit({ event: 'ai.task.started', taskId: task.id, projectId: task.projectId, runId: run.id, provider: 'DEEPSEEK', model, promptVersion: task.promptVersion });

  let providerCompleted = false;
  try {
    const response = await gateway.complete({ messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.buildUserMessage(task.factSnapshot) }], mode: prompt.mode, responseFormat: prompt.responseFormat });
    providerCompleted = true;
    await repository.recordProviderSuccess(run.id, response);
    observability.emit({ event: 'ai.provider.request.completed', taskId: task.id, projectId: task.projectId, runId: run.id, provider: 'DEEPSEEK', model: response.model, promptVersion: task.promptVersion, latencyMs: response.latencyMs, promptTokens: response.usage.promptTokens, completionTokens: response.usage.completionTokens, totalTokens: response.usage.totalTokens, cacheHitTokens: response.usage.cacheHitTokens, cacheMissTokens: response.usage.cacheMissTokens, reasoningTokens: response.usage.reasoningTokens });

    const output = parseTaskOutput(task, response.content);
    observability.emit({ event: 'ai.output.validated', taskId: task.id, projectId: task.projectId, runId: run.id, provider: 'DEEPSEEK', model: response.model, promptVersion: task.promptVersion });
    const materialize = task.taskType === 'CONTENT_BRIEF'
      ? (tx: Prisma.TransactionClient) => persistContentBrief(task, output as ReturnType<typeof parseContentBriefOutput>, tx).then(() => undefined)
      : task.taskType === 'PUBLICATION_ARTICLE_GENERATION'
        ? (tx: Prisma.TransactionClient) => materializeArticleGenerationOutput(
          task,
          output as ReturnType<typeof parsePublicationArticleGenerationOutput>,
          tx
        )
        : undefined;
    await repository.completeRun(task, run.id, response, output as Prisma.InputJsonValue, resultSummary(task, output), materialize);
    observability.emit({ event: 'ai.task.completed', taskId: task.id, projectId: task.projectId, runId: run.id, provider: 'DEEPSEEK', model: response.model, promptVersion: task.promptVersion });
  } catch (error) {
    const code = errorCode(error);
    const httpStatus = error instanceof AiProviderError ? error.httpStatus : null;
    await repository.failRun(task.id, run.id, { errorCode: code, errorMessage: safeErrorMessage(error), httpStatus });
    if (!providerCompleted) observability.emit({ event: 'ai.provider.request.failed', taskId: task.id, projectId: task.projectId, runId: run.id, provider: 'DEEPSEEK', model, promptVersion: task.promptVersion, httpStatus, errorCode: code });
    observability.emit({ event: 'ai.task.failed', taskId: task.id, projectId: task.projectId, runId: run.id, provider: 'DEEPSEEK', model, promptVersion: task.promptVersion, httpStatus, errorCode: code });
    throw error;
  }
}

export async function processAiJob(job: AiJobLike, tokenOrExecute?: string | AiTaskExecutor): Promise<void> {
  const taskId = job.data?.taskId;
  if (!taskId || typeof taskId !== 'string') throw new Error('taskId is required for AI jobs');
  const execute = typeof tokenOrExecute === 'function' ? tokenOrExecute : executeAiTask;
  await execute(taskId);
}
