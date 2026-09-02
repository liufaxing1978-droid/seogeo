import path from 'node:path';
import { Queue, Worker } from 'bullmq';
import { processAiJob, type AiJobData } from '../modules/ai/ai.worker.js';
import { processCompetitorCrawlJob, type CompetitorCrawlJobData } from '../modules/competitor/competitor.worker.js';
import { processContentRefreshJob, type ContentRefreshJobData } from '../modules/content/content.worker.js';
import { processCrawlJob, type CrawlJobData } from '../modules/crawler/crawl.worker.js';
import {
  DISTRIBUTION_PREPARATION_QUEUE_NAME,
  DISTRIBUTION_PREPARATION_WORKER_CONCURRENCY,
  type DistributionPreparationJobData
} from '../modules/distribution/distribution.queue.js';
import { processDistributionPreparationJob } from '../modules/distribution/distribution.worker.js';
import { processGeoAuditJob, type GeoAuditJobData } from '../modules/geo/geo.worker.js';
import {
  GROWTH_MATERIALIZATION_QUEUE_NAME,
  GROWTH_MATERIALIZATION_WORKER_CONCURRENCY,
  processGrowthMaterializationJob,
  type GrowthMaterializationJobData
} from '../modules/growth/growth.worker.js';
import {
  OPTIMIZATION_AUTOPILOT_QUEUE_ATTEMPTS,
  OPTIMIZATION_AUTOPILOT_QUEUE_NAME,
  OptimizationAutopilotQueue,
  type OptimizationAutopilotJobData
} from '../modules/optimization-autopilot/autopilot.queue.js';
import { OptimizationAutopilotRepository } from '../modules/optimization-autopilot/autopilot.repository.js';
import { processOptimizationAutopilotJob } from '../modules/optimization-autopilot/autopilot.worker.js';
import {
  OPTIMIZATION_FEEDBACK_QUEUE_ATTEMPTS,
  OPTIMIZATION_FEEDBACK_QUEUE_NAME,
  OptimizationFeedbackQueue,
  type OptimizationFeedbackJobData
} from '../modules/optimization-feedback/feedback.queue.js';
import { feedbackObservability } from '../modules/optimization-feedback/feedback.observability.js';
import { OptimizationFeedbackRepository } from '../modules/optimization-feedback/feedback.repository.js';
import { OptimizationFeedbackService } from '../modules/optimization-feedback/feedback.service.js';
import { processOptimizationFeedbackJob } from '../modules/optimization-feedback/feedback.worker.js';
import {
  OptimizationAutomationActionDispatcher,
  type OfficialSearchSyncPort
} from '../modules/optimization-orchestration/orchestration.automation.actions.js';
import { automationDefinitionManagementRepository } from '../modules/optimization-orchestration/orchestration.automation-definition.repository.js';
import {
  processOptimizationAutomationJob,
  type OptimizationAutomationWorkerDeps
} from '../modules/optimization-orchestration/orchestration.automation.worker.js';
import {
  OPTIMIZATION_AUTOMATION_QUEUE_NAME,
  OPTIMIZATION_ORCHESTRATION_QUEUE_NAME,
  OPTIMIZATION_PLANNING_QUEUE_NAME,
  OPTIMIZATION_QUEUE_ATTEMPTS,
  OptimizationAutomationQueue,
  OptimizationOrchestrationQueue,
  OptimizationPlanningQueue,
  type OptimizationAutomationJobData,
  type OptimizationOrchestrationJobData,
  type OptimizationPlanningJobData
} from '../modules/optimization-orchestration/orchestration.queue.js';
import { optimizationOrchestrationRepository } from '../modules/optimization-orchestration/orchestration.repository.js';
import { OptimizationOrchestrationService } from '../modules/optimization-orchestration/orchestration.service.js';
import {
  classifyOptimizationOrchestrationError,
  processOptimizationOrchestrationJob,
  processOptimizationPlanningJob
} from '../modules/optimization-orchestration/orchestration.worker.js';
import {
  OPTIMIZATION_EXPERIMENT_QUEUE_ATTEMPTS,
  OPTIMIZATION_EXPERIMENT_QUEUE_NAME,
  OptimizationExperimentQueue,
  type OptimizationExperimentJobData
} from '../modules/optimization-experiments/experiment.queue.js';
import { OptimizationExperimentRepository } from '../modules/optimization-experiments/experiment.repository.js';
import { OptimizationExperimentService } from '../modules/optimization-experiments/experiment.service.js';
import { processOptimizationExperimentJob } from '../modules/optimization-experiments/experiment.worker.js';
import { optimizationService } from '../modules/optimization/optimization.service.js';
import { projectRepository } from '../modules/projects/project.repository.js';
import {
  PUBLICATION_EXECUTION_QUEUE_NAME,
  PublicationExecutionQueue,
  type PublicationExecutionJobData,
  type PublicationExecutionQueuePort
} from '../modules/publication/publication-execution.queue.js';
import {
  PUBLICATION_EXECUTION_WORKER_CONCURRENCY,
  classifyPublicationExecutionError,
  processPublicationExecutionJob
} from '../modules/publication/publication-execution.worker.js';
import {
  PUBLICATION_VERIFICATION_QUEUE_NAME,
  PUBLICATION_VERIFICATION_WORKER_CONCURRENCY
} from '../modules/publication/publication-verification.queue.js';
import {
  processPublicationVerificationJob,
  type PublicationVerificationJobData
} from '../modules/publication/publication-verification.worker.js';
import {
  processSearchConsoleSyncJob,
  SEARCH_CONSOLE_SYNC_QUEUE_NAME,
  SEARCH_CONSOLE_SYNC_WORKER_CONCURRENCY,
  type SearchConsoleSyncJobData
} from '../modules/search-console/search-console.worker.js';
import { createDefaultOfficialSearchSyncService } from '../modules/search-sync/official-search-sync.routes.js';
import { officialSearchSyncRepository } from '../modules/search-sync/official-search-sync.repository.js';
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
import {
  VISIBILITY_MONITORING_ATTEMPTS,
  VISIBILITY_MONITORING_QUEUE_NAME,
  VisibilityMonitoringQueue,
  type VisibilityMonitoringQueuePort
} from '../modules/visibility/visibility-monitoring.queue.js';
import {
  processVisibilityMonitoringJob,
  VISIBILITY_MONITORING_WORKER_CONCURRENCY
} from '../modules/visibility/visibility-monitoring.worker.js';
import { processVisibilityJob, type VisibilityJobData } from '../modules/visibility/visibility.worker.js';
import { createRedisConnection } from './connection.js';
import { QUEUE_NAMES } from './queues.js';

const VISIBILITY_MONITORING_RECONCILE_EVERY_MS = 60 * 60 * 1000;
export const OPTIMIZATION_PLANNING_WORKER_CONCURRENCY = 1;
export const OPTIMIZATION_ORCHESTRATION_WORKER_CONCURRENCY = 2;
export const OPTIMIZATION_AUTOMATION_WORKER_CONCURRENCY = 2;
export const OPTIMIZATION_AUTOPILOT_WORKER_CONCURRENCY = 2;
export const OPTIMIZATION_EXPERIMENT_WORKER_CONCURRENCY = 2;
export const OPTIMIZATION_FEEDBACK_WORKER_CONCURRENCY = 2;
export const OPTIMIZATION_DAILY_RECONCILE_EVERY_MS = 24 * 60 * 60 * 1000;
export const OPTIMIZATION_DAILY_RECONCILE_SCHEDULER = {
  id: 'optimization-daily-reconcile',
  repeat: { every: OPTIMIZATION_DAILY_RECONCILE_EVERY_MS },
  job: {
    name: 'reconcile-daily',
    data: { kind: 'RECONCILE_DAILY' as const }
  }
} as const;
export const OPTIMIZATION_AUTOPILOT_DAILY_RECONCILE_EVERY_MS = 24 * 60 * 60 * 1000;
export const OPTIMIZATION_AUTOPILOT_DAILY_RECONCILE_SCHEDULER = {
  id: 'optimization-autopilot-daily-reconcile',
  repeat: { every: OPTIMIZATION_AUTOPILOT_DAILY_RECONCILE_EVERY_MS },
  job: {
    name: 'reconcile-daily',
    data: { kind: 'RECONCILE_DAILY' as const }
  }
} as const;
export const OPTIMIZATION_EXPERIMENT_DAILY_RECONCILE_EVERY_MS = 24 * 60 * 60 * 1000;
export const OPTIMIZATION_EXPERIMENT_DAILY_RECONCILE_SCHEDULER = {
  id: 'optimization-experiment-daily-reconcile',
  repeat: { every: OPTIMIZATION_EXPERIMENT_DAILY_RECONCILE_EVERY_MS },
  job: {
    name: 'reconcile-daily',
    data: { kind: 'RECONCILE_DAILY' as const }
  }
} as const;
export const OPTIMIZATION_FEEDBACK_DAILY_RECONCILE_EVERY_MS = 24 * 60 * 60 * 1000;
export const OPTIMIZATION_FEEDBACK_DAILY_RECONCILE_SCHEDULER = {
  id: 'optimization-feedback-daily-reconcile',
  repeat: { every: OPTIMIZATION_FEEDBACK_DAILY_RECONCILE_EVERY_MS },
  job: {
    name: 'reconcile-daily',
    data: { kind: 'RECONCILE_DAILY' as const }
  }
} as const;

export function buildOptimizationAutopilotRuntimeDeps(input: {
  repository: OptimizationAutopilotRepository;
  queue: Pick<OptimizationAutopilotQueue, 'enqueueRunItem'>;
  executionQueue: PublicationExecutionQueuePort;
}) {
  return input;
}

export function buildOptimizationAutomationRuntimeDeps(input: {
  repository: OptimizationAutomationWorkerDeps['repository'];
  service: OptimizationAutomationWorkerDeps['service'];
  searchSync: OfficialSearchSyncPort;
  now?: () => Date;
}): OptimizationAutomationWorkerDeps {
  return {
    repository: input.repository,
    service: input.service,
    actions: new OptimizationAutomationActionDispatcher({
      searchSync: input.searchSync,
      ...(input.now ? { now: input.now } : {})
    })
  };
}

export async function reconcileOptimizationAutomationDefinitionSchedules(input: {
  projects: {
    list(): Promise<Array<{ id: string }>>;
  };
  orchestration: {
    reconcileAutomationSchedules(
      projectId: string
    ): Promise<{ considered: number; synced: number }>;
  };
}): Promise<{ projects: number; definitions: number; synced: number }> {
  const projects = await input.projects.list();
  let definitions = 0;
  let synced = 0;

  for (const project of projects) {
    const result = await input.orchestration.reconcileAutomationSchedules(project.id);
    definitions += result.considered;
    synced += result.synced;
  }

  return {
    projects: projects.length,
    definitions,
    synced
  };
}

export function buildPublicationVerificationExperimentHandoff(
  queue: Pick<OptimizationExperimentQueue, 'enqueueStart'>
) {
  return {
    onVerified: async (input: { executionId: string; projectId: string }): Promise<void> => {
      await queue.enqueueStart(input.executionId, input.projectId);
    }
  };
}

export function buildOptimizationExperimentFeedbackHandoff(
  queue: Pick<OptimizationFeedbackQueue, 'enqueueObservation'>
) {
  return {
    onObservationPersisted: async (input: {
      projectId: string;
      experimentId: string;
      observationId: string;
    }): Promise<void> => {
      await queue.enqueueObservation(
        input.projectId,
        input.experimentId,
        input.observationId
      );
    }
  };
}

function publicationExecutionErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.length > 0) return code;
  }
  return 'EXECUTION_FAILED';
}

function optimizationOrchestrationErrorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.length > 0) return code;
  }
  return 'OPTIMIZATION_ORCHESTRATION_FAILED';
}

export function workerDefinitionForQueue(
  name:
    | 'search-console-sync'
    | 'growth-materialization'
    | 'optimization-planning'
    | 'optimization-orchestration'
    | 'optimization-automation'
    | 'optimization-autopilot'
    | 'optimization-experiment-evaluation'
    | 'optimization-feedback-materialization'
    | 'visibility'
    | 'visibility-extraction'
    | 'visibility-metrics'
    | 'visibility-monitoring'
    | 'site-mutation-execution'
    | 'site-mutation-verification'
    | 'distribution-preparation'
) {
  if (name === SEARCH_CONSOLE_SYNC_QUEUE_NAME) {
    return {
      processor: processSearchConsoleSyncJob,
      concurrency: SEARCH_CONSOLE_SYNC_WORKER_CONCURRENCY
    } as const;
  }
  if (name === GROWTH_MATERIALIZATION_QUEUE_NAME) {
    return {
      processor: processGrowthMaterializationJob,
      concurrency: GROWTH_MATERIALIZATION_WORKER_CONCURRENCY
    } as const;
  }
  if (name === OPTIMIZATION_PLANNING_QUEUE_NAME) {
    return {
      processor: processOptimizationPlanningJob,
      concurrency: OPTIMIZATION_PLANNING_WORKER_CONCURRENCY
    } as const;
  }
  if (name === OPTIMIZATION_ORCHESTRATION_QUEUE_NAME) {
    return {
      processor: processOptimizationOrchestrationJob,
      concurrency: OPTIMIZATION_ORCHESTRATION_WORKER_CONCURRENCY
    } as const;
  }
  if (name === OPTIMIZATION_AUTOMATION_QUEUE_NAME) {
    return {
      processor: processOptimizationAutomationJob,
      concurrency: OPTIMIZATION_AUTOMATION_WORKER_CONCURRENCY
    } as const;
  }
  if (name === OPTIMIZATION_AUTOPILOT_QUEUE_NAME) {
    return {
      processor: processOptimizationAutopilotJob,
      concurrency: OPTIMIZATION_AUTOPILOT_WORKER_CONCURRENCY
    } as const;
  }
  if (name === OPTIMIZATION_EXPERIMENT_QUEUE_NAME) {
    return {
      processor: processOptimizationExperimentJob,
      concurrency: OPTIMIZATION_EXPERIMENT_WORKER_CONCURRENCY
    } as const;
  }
  if (name === OPTIMIZATION_FEEDBACK_QUEUE_NAME) {
    return {
      processor: processOptimizationFeedbackJob,
      concurrency: OPTIMIZATION_FEEDBACK_WORKER_CONCURRENCY
    } as const;
  }
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
  if (name === 'visibility-monitoring') {
    return {
      processor: processVisibilityMonitoringJob,
      concurrency: VISIBILITY_MONITORING_WORKER_CONCURRENCY
    } as const;
  }
  if (name === PUBLICATION_EXECUTION_QUEUE_NAME) {
    return {
      processor: processPublicationExecutionJob,
      concurrency: PUBLICATION_EXECUTION_WORKER_CONCURRENCY
    } as const;
  }
  if (name === PUBLICATION_VERIFICATION_QUEUE_NAME) {
    return {
      processor: processPublicationVerificationJob,
      concurrency: PUBLICATION_VERIFICATION_WORKER_CONCURRENCY
    } as const;
  }
  if (name === DISTRIBUTION_PREPARATION_QUEUE_NAME) {
    return {
      processor: processDistributionPreparationJob,
      concurrency: DISTRIBUTION_PREPARATION_WORKER_CONCURRENCY
    } as const;
  }
  throw new Error(`Unsupported worker definition: ${name}`);
}

export async function startWorkers() {
  const connection = createRedisConnection();
  const supportQueues: Queue[] = [];

  const monitoringSupportQueue = new Queue(VISIBILITY_MONITORING_QUEUE_NAME, { connection });
  supportQueues.push(monitoringSupportQueue);
  const monitoringQueue = new VisibilityMonitoringQueue(
    monitoringSupportQueue as unknown as VisibilityMonitoringQueuePort
  );

  const optimizationPlanningSupportQueue = new Queue(OPTIMIZATION_PLANNING_QUEUE_NAME, { connection });
  const optimizationOrchestrationSupportQueue = new Queue(OPTIMIZATION_ORCHESTRATION_QUEUE_NAME, { connection });
  const optimizationAutomationSupportQueue = new Queue<OptimizationAutomationJobData>(
    OPTIMIZATION_AUTOMATION_QUEUE_NAME,
    { connection }
  );
  const optimizationAutopilotSupportQueue = new Queue(OPTIMIZATION_AUTOPILOT_QUEUE_NAME, { connection });
  const optimizationExperimentSupportQueue = new Queue<OptimizationExperimentJobData>(
    OPTIMIZATION_EXPERIMENT_QUEUE_NAME,
    { connection }
  );
  const optimizationFeedbackSupportQueue = new Queue<OptimizationFeedbackJobData>(
    OPTIMIZATION_FEEDBACK_QUEUE_NAME,
    { connection }
  );
  const publicationExecutionSupportQueue = new Queue<PublicationExecutionJobData>(
    PUBLICATION_EXECUTION_QUEUE_NAME,
    { connection }
  );
  supportQueues.push(
    optimizationPlanningSupportQueue,
    optimizationOrchestrationSupportQueue,
    optimizationAutomationSupportQueue,
    optimizationAutopilotSupportQueue,
    optimizationExperimentSupportQueue,
    optimizationFeedbackSupportQueue,
    publicationExecutionSupportQueue
  );
  const optimizationPlanningQueue = new OptimizationPlanningQueue(optimizationPlanningSupportQueue);
  const optimizationOrchestrationQueue = new OptimizationOrchestrationQueue(
    optimizationOrchestrationSupportQueue
  );
  const optimizationAutomationQueue = new OptimizationAutomationQueue(
    optimizationAutomationSupportQueue
  );
  const optimizationAutopilotQueue = new OptimizationAutopilotQueue(
    optimizationAutopilotSupportQueue
  );
  const optimizationExperimentQueue = new OptimizationExperimentQueue(
    optimizationExperimentSupportQueue
  );
  const optimizationFeedbackQueue = new OptimizationFeedbackQueue(
    optimizationFeedbackSupportQueue
  );
  const publicationExecutionQueue = new PublicationExecutionQueue(publicationExecutionSupportQueue);
  const optimizationAutopilotRepository = new OptimizationAutopilotRepository();
  const optimizationAutopilotRuntimeDeps = buildOptimizationAutopilotRuntimeDeps({
    repository: optimizationAutopilotRepository,
    queue: optimizationAutopilotQueue,
    executionQueue: publicationExecutionQueue
  });
  const optimizationExperimentRepository = new OptimizationExperimentRepository();
  const optimizationExperimentService = new OptimizationExperimentService(
    optimizationExperimentRepository
  );
  const optimizationFeedbackRepository = new OptimizationFeedbackRepository();
  const optimizationFeedbackService = new OptimizationFeedbackService(
    optimizationFeedbackRepository
  );
  const optimizationExperimentFeedbackHandoff = buildOptimizationExperimentFeedbackHandoff(
    optimizationFeedbackQueue
  );
  const optimizationExperimentRuntimeDeps = {
    service: optimizationExperimentService,
    queue: optimizationExperimentQueue,
    repository: optimizationExperimentRepository,
    feedbackHandoff: optimizationExperimentFeedbackHandoff
  };
  const optimizationFeedbackRuntimeDeps = {
    service: optimizationFeedbackService,
    repository: optimizationFeedbackRepository,
    queue: optimizationFeedbackQueue,
    observability: feedbackObservability
  };
  const publicationVerificationExperimentHandoff = buildPublicationVerificationExperimentHandoff(
    optimizationExperimentQueue
  );
  const optimizationOrchestrationService = new OptimizationOrchestrationService({
    repository: optimizationOrchestrationRepository,
    planningQueue: optimizationPlanningQueue,
    projects: projectRepository,
    automationRuns: optimizationOrchestrationRepository,
    automationQueue: optimizationAutomationQueue,
    automationDefinitions: automationDefinitionManagementRepository,
    automationSchedules: optimizationAutomationQueue
  });
  await reconcileOptimizationAutomationDefinitionSchedules({
    projects: projectRepository,
    orchestration: optimizationOrchestrationService
  });
  const optimizationAutomationRuntimeDeps = buildOptimizationAutomationRuntimeDeps({
    repository: optimizationOrchestrationRepository,
    service: optimizationOrchestrationService,
    searchSync: createDefaultOfficialSearchSyncService(officialSearchSyncRepository)
  });
  const advisoryRootDir = path.resolve('vendor/third-party-skills');

  const workers = QUEUE_NAMES.map((name) => {
    if (name === 'crawl') return new Worker<CrawlJobData>(name, processCrawlJob, { connection });
    if (name === 'seo-audit') return new Worker<SeoAuditJobData>(name, processSeoAuditJob, { connection });
    if (name === 'geo-audit') return new Worker<GeoAuditJobData>(name, processGeoAuditJob, { connection });
    if (name === 'content') return new Worker<ContentRefreshJobData>(name, processContentRefreshJob, { connection, concurrency: 2 });
    if (name === 'competitor') return new Worker<CompetitorCrawlJobData>(name, processCompetitorCrawlJob, { connection, concurrency: 2 });
    if (name === SEARCH_CONSOLE_SYNC_QUEUE_NAME) {
      return new Worker<SearchConsoleSyncJobData>(name, processSearchConsoleSyncJob, {
        connection,
        concurrency: SEARCH_CONSOLE_SYNC_WORKER_CONCURRENCY
      });
    }
    if (name === GROWTH_MATERIALIZATION_QUEUE_NAME) {
      return new Worker<GrowthMaterializationJobData>(
        name,
        async (job) => processGrowthMaterializationJob(
          { name: job.name, data: job.data },
          { optimizationTrigger: optimizationOrchestrationService }
        ),
        { connection, concurrency: GROWTH_MATERIALIZATION_WORKER_CONCURRENCY }
      );
    }
    if (name === OPTIMIZATION_PLANNING_QUEUE_NAME) {
      return new Worker<OptimizationPlanningJobData>(
        name,
        async (job) => {
          try {
            await processOptimizationPlanningJob(
              { name: job.name, data: job.data },
              {
                repository: optimizationOrchestrationRepository,
                materializeProject: (projectId, options) =>
                  optimizationService.materializeProject(projectId, options),
                orchestrationQueue: optimizationOrchestrationQueue,
                orchestrationService: optimizationOrchestrationService,
                advisoryRootDir
              }
            );
          } catch (error) {
            const code = optimizationOrchestrationErrorCode(error);
            if (classifyOptimizationOrchestrationError(code) === 'NON_RETRYABLE') job.discard();
            throw error;
          }
        },
        { connection, concurrency: OPTIMIZATION_PLANNING_WORKER_CONCURRENCY }
      );
    }
    if (name === OPTIMIZATION_ORCHESTRATION_QUEUE_NAME) {
      return new Worker<OptimizationOrchestrationJobData>(
        name,
        async (job) => {
          try {
            await processOptimizationOrchestrationJob(
              { name: job.name, data: job.data },
              {
                repository: optimizationOrchestrationRepository,
                autopilotQueue: optimizationAutopilotQueue
              }
            );
          } catch (error) {
            const code = optimizationOrchestrationErrorCode(error);
            if (classifyOptimizationOrchestrationError(code) === 'NON_RETRYABLE') job.discard();
            throw error;
          }
        },
        { connection, concurrency: OPTIMIZATION_ORCHESTRATION_WORKER_CONCURRENCY }
      );
    }
    if (name === OPTIMIZATION_AUTOMATION_QUEUE_NAME) {
      return new Worker<OptimizationAutomationJobData>(
        name,
        async (job) => processOptimizationAutomationJob(
          { id: job.id, name: job.name, data: job.data },
          optimizationAutomationRuntimeDeps
        ),
        { connection, concurrency: OPTIMIZATION_AUTOMATION_WORKER_CONCURRENCY }
      );
    }
    if (name === OPTIMIZATION_AUTOPILOT_QUEUE_NAME) {
      return new Worker<OptimizationAutopilotJobData>(
        name,
        async (job) => processOptimizationAutopilotJob(
          { name: job.name, data: job.data },
          optimizationAutopilotRuntimeDeps
        ),
        { connection, concurrency: OPTIMIZATION_AUTOPILOT_WORKER_CONCURRENCY }
      );
    }
    if (name === OPTIMIZATION_EXPERIMENT_QUEUE_NAME) {
      return new Worker<OptimizationExperimentJobData>(
        name,
        async (job) => processOptimizationExperimentJob(
          { name: job.name, data: job.data } as Parameters<typeof processOptimizationExperimentJob>[0],
          optimizationExperimentRuntimeDeps
        ),
        { connection, concurrency: OPTIMIZATION_EXPERIMENT_WORKER_CONCURRENCY }
      );
    }
    if (name === OPTIMIZATION_FEEDBACK_QUEUE_NAME) {
      return new Worker<OptimizationFeedbackJobData>(
        name,
        async (job) => processOptimizationFeedbackJob(
          { name: job.name, data: job.data } as Parameters<typeof processOptimizationFeedbackJob>[0],
          optimizationFeedbackRuntimeDeps
        ),
        { connection, concurrency: OPTIMIZATION_FEEDBACK_WORKER_CONCURRENCY }
      );
    }
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
        async (job) => processVisibilityMetricsJob(
          { name: job.name, data: job.data },
          { monitoringQueue }
        ),
        { connection, concurrency: VISIBILITY_METRICS_WORKER_CONCURRENCY }
      );
    }
    if (name === VISIBILITY_MONITORING_QUEUE_NAME) {
      return new Worker<Record<string, unknown>>(
        name,
        async (job) => processVisibilityMonitoringJob(
          { name: job.name, data: job.data },
          { queue: monitoringQueue }
        ),
        { connection, concurrency: VISIBILITY_MONITORING_WORKER_CONCURRENCY }
      );
    }
    if (name === PUBLICATION_EXECUTION_QUEUE_NAME) {
      return new Worker<PublicationExecutionJobData>(
        name,
        async (job) => {
          try {
            await processPublicationExecutionJob({ name: job.name, data: job.data });
          } catch (error) {
            const code = publicationExecutionErrorCode(error);
            if (classifyPublicationExecutionError(code) === 'NON_RETRYABLE') job.discard();
            throw error;
          }
        },
        { connection, concurrency: PUBLICATION_EXECUTION_WORKER_CONCURRENCY }
      );
    }
    if (name === PUBLICATION_VERIFICATION_QUEUE_NAME) {
      return new Worker<PublicationVerificationJobData>(
        name,
        async (job) => processPublicationVerificationJob(
          { name: job.name, data: job.data },
          publicationVerificationExperimentHandoff
        ),
        { connection, concurrency: PUBLICATION_VERIFICATION_WORKER_CONCURRENCY }
      );
    }
    if (name === DISTRIBUTION_PREPARATION_QUEUE_NAME) {
      return new Worker<DistributionPreparationJobData>(
        name,
        async (job) => processDistributionPreparationJob({ name: job.name, data: job.data }),
        { connection, concurrency: DISTRIBUTION_PREPARATION_WORKER_CONCURRENCY }
      );
    }
    if (name === 'ai') return new Worker<AiJobData>(name, processAiJob, { connection });
    return new Worker(name, async () => undefined, { connection });
  });

  await monitoringSupportQueue.upsertJobScheduler(
    'visibility-monitoring-hourly-reconcile',
    { every: VISIBILITY_MONITORING_RECONCILE_EVERY_MS },
    {
      name: 'reconcile-history',
      data: {},
      opts: { attempts: VISIBILITY_MONITORING_ATTEMPTS }
    }
  );

  await optimizationPlanningSupportQueue.upsertJobScheduler(
    OPTIMIZATION_DAILY_RECONCILE_SCHEDULER.id,
    OPTIMIZATION_DAILY_RECONCILE_SCHEDULER.repeat,
    {
      ...OPTIMIZATION_DAILY_RECONCILE_SCHEDULER.job,
      opts: { attempts: OPTIMIZATION_QUEUE_ATTEMPTS }
    }
  );

  await optimizationAutopilotSupportQueue.upsertJobScheduler(
    OPTIMIZATION_AUTOPILOT_DAILY_RECONCILE_SCHEDULER.id,
    OPTIMIZATION_AUTOPILOT_DAILY_RECONCILE_SCHEDULER.repeat,
    {
      ...OPTIMIZATION_AUTOPILOT_DAILY_RECONCILE_SCHEDULER.job,
      opts: { attempts: OPTIMIZATION_AUTOPILOT_QUEUE_ATTEMPTS }
    }
  );

  await optimizationExperimentSupportQueue.upsertJobScheduler(
    OPTIMIZATION_EXPERIMENT_DAILY_RECONCILE_SCHEDULER.id,
    OPTIMIZATION_EXPERIMENT_DAILY_RECONCILE_SCHEDULER.repeat,
    {
      ...OPTIMIZATION_EXPERIMENT_DAILY_RECONCILE_SCHEDULER.job,
      opts: { attempts: OPTIMIZATION_EXPERIMENT_QUEUE_ATTEMPTS }
    }
  );

  await optimizationFeedbackSupportQueue.upsertJobScheduler(
    OPTIMIZATION_FEEDBACK_DAILY_RECONCILE_SCHEDULER.id,
    OPTIMIZATION_FEEDBACK_DAILY_RECONCILE_SCHEDULER.repeat,
    {
      ...OPTIMIZATION_FEEDBACK_DAILY_RECONCILE_SCHEDULER.job,
      opts: { attempts: OPTIMIZATION_FEEDBACK_QUEUE_ATTEMPTS }
    }
  );

  return {
    async close() {
      await Promise.all(workers.map((worker) => worker.close()));
      await Promise.all(supportQueues.map((queue) => queue.close()));
      await connection.quit();
    }
  };
}