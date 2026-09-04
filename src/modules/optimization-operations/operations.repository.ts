import type { PlanLevel, Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { sortActivity } from './operations.derive.js';
import type {
  OperationsActivityItem,
  OperationsAutomationAlertAuthority,
  OperationsEffectState,
  OperationsFeedbackEvidenceAuthority,
  OperationsInboxAuthority,
  OperationsOutcomeObservation,
  OperationsPipelineAuthority,
  OperationsReservationAuthority,
  OperationsVerificationAuthority,
} from './operations.types.js';

const MAX_LIMIT = 100;
const MAX_OFFSET = 100_000;

type OperationsDb = typeof prisma;

type TerminalWindow = {
  windowType: string;
  windowDays: number;
};

export type OperationsFeedbackProfileRead = {
  id: string;
  projectId: string;
  marketScopeMode: string;
  marketCode: string | null;
  locale: string | null;
  recommendedActionType: string;
  sampleCount: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  rollingEffectBalance: number;
  historicalRankAdjustment: number;
  newestEvidenceCutoffAt: Date;
  createdAt: Date;
};

function assertLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new RangeError('OPERATIONS_LIMIT_OUT_OF_RANGE');
  }
}

function assertOffset(offset: number): void {
  if (!Number.isInteger(offset) || offset < 0 || offset > MAX_OFFSET) {
    throw new RangeError('OPERATIONS_OFFSET_OUT_OF_RANGE');
  }
}

function assertPagination(limit: number, offset: number): void {
  assertLimit(limit);
  assertOffset(offset);
}

function firstString(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    if (typeof item === 'string' && item.length > 0) return item;
  }
  return null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function terminalWindow(value: Prisma.JsonValue): TerminalWindow | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const raw = value.at(-1);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const windowType = raw.windowType;
  const windowDays = raw.windowDays;
  if (typeof windowType !== 'string' || !Number.isInteger(windowDays) || (windowDays as number) <= 0) {
    return null;
  }
  return { windowType, windowDays: windowDays as number };
}

function isTerminalObservation(
  schedule: Prisma.JsonValue,
  observation: { windowType: string; windowDays: number },
): boolean {
  const terminal = terminalWindow(schedule);
  if (terminal === null) return false;
  return observation.windowType === terminal.windowType && observation.windowDays === terminal.windowDays;
}

function firstByKey<T>(rows: readonly T[], keyOf: (row: T) => string | null): Map<string, T> {
  const result = new Map<string, T>();
  for (const row of rows) {
    const key = keyOf(row);
    if (key !== null && !result.has(key)) result.set(key, row);
  }
  return result;
}

function activitySeverity(status: string): OperationsActivityItem['severity'] {
  if (status === 'FAILED' || status === 'VERIFICATION_FAILED') return 'ERROR';
  if (
    status === 'POLICY_BLOCKED'
    || status === 'P8_VALIDATION_BLOCKED'
    || status === 'STALE'
    || status === 'APPROVAL_STALE'
    || status === 'TARGET_REVISION_CHANGED'
    || status === 'STALE_REVIEW_REQUIRED'
  ) {
    return 'WARNING';
  }
  return 'INFO';
}

export class OptimizationOperationsRepository {
  constructor(private readonly db: OperationsDb = prisma) {}

  async getProjectPlanLevel(projectId: string): Promise<PlanLevel | null> {
    const project = await this.db.project.findUnique({
      where: { id: projectId },
      select: { planLevel: true },
    });
    return project?.planLevel ?? null;
  }

  async getCurrentPolicy(projectId: string) {
    return this.db.autopilotPolicy.findUnique({
      where: { projectId },
      select: {
        id: true,
        projectId: true,
        enabled: true,
        policyVersion: true,
        allowedRiskClass: true,
        allowedOperationClasses: true,
        dailyDraftPrLimit: true,
        maxConcurrentRuns: true,
        requireFreshEvidence: true,
        minimumEvidenceCoverage: true,
        pauseOnVerificationFailure: true,
        killSwitch: true,
        enabledBy: true,
        enabledAt: true,
        updatedBy: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async countTodayRuns(projectId: string, utcDayStart: Date, utcDayEnd: Date): Promise<number> {
    return this.db.optimizationRun.count({
      where: {
        projectId,
        createdAt: { gte: utcDayStart, lt: utcDayEnd },
      },
    });
  }

  async listAutomationAlertAuthority(
    projectId: string,
    limit: number,
  ): Promise<OperationsAutomationAlertAuthority[]> {
    assertLimit(limit);
    const rows = await this.db.automationRun.findMany({
      where: {
        projectId,
        status: { in: ['FAILED', 'TIMED_OUT'] },
      },
      select: {
        id: true,
        status: true,
        lastErrorCode: true,
        updatedAt: true,
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });

    return rows.map((row) => ({
      id: row.id,
      status: row.status as OperationsAutomationAlertAuthority['status'],
      lastErrorCode: row.lastErrorCode,
      updatedAt: row.updatedAt,
      authorityUrl: `/api/v1/projects/${projectId}/optimization/automation-runs/${row.id}`,
    }));
  }

  async listRecentVerificationAuthority(
    projectId: string,
    limit: number,
  ): Promise<OperationsVerificationAuthority[]> {
    assertLimit(limit);
    const rows = await this.db.publicationVerification.findMany({
      where: { projectId },
      select: {
        id: true,
        executionId: true,
        status: true,
        observedUrl: true,
        observedAt: true,
        httpStatus: true,
        titleMatches: true,
        descriptionMatches: true,
        canonicalMatches: true,
        h1Matches: true,
        indexable: true,
        schemaValid: true,
        contentFingerprintOk: true,
        regressionFindings: true,
        reasonCode: true,
        createdAt: true,
        execution: {
          select: {
            plan: { select: { targetPublicUrl: true } },
          },
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });

    return rows.map((row) => ({
      id: row.id,
      executionId: row.executionId,
      status: row.status,
      targetUrl: row.observedUrl ?? row.execution.plan.targetPublicUrl,
      observedAt: row.observedAt,
      httpStatus: row.httpStatus,
      titleMatches: row.titleMatches,
      descriptionMatches: row.descriptionMatches,
      canonicalMatches: row.canonicalMatches,
      h1Matches: row.h1Matches,
      indexable: row.indexable,
      schemaValid: row.schemaValid,
      contentFingerprintOk: row.contentFingerprintOk,
      regressionFindings: stringArray(row.regressionFindings),
      reasonCode: row.reasonCode,
      createdAt: row.createdAt,
      authorityUrl: `/projects/${projectId}/publication/verifications/${row.id}`,
    }));
  }

  async listPipelineAuthority(
    projectId: string,
    limit: number,
    offset: number,
  ): Promise<OperationsPipelineAuthority[]> {
    assertPagination(limit, offset);

    const growthRows = await this.db.growthOpportunityIdentity.findMany({
      where: { projectId },
      select: { id: true, createdAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: limit,
    });
    if (growthRows.length === 0) return [];

    const growthIds = growthRows.map((row) => row.id);
    const candidates = await this.db.optimizationCandidate.findMany({
      where: { projectId, growthOpportunityIdentityId: { in: growthIds } },
      select: {
        id: true,
        growthOpportunityIdentityId: true,
        eligibilityState: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_LIMIT,
    });
    const candidateByGrowth = firstByKey(candidates, (row) => row.growthOpportunityIdentityId);
    const candidateIds = [...candidateByGrowth.values()].map((row) => row.id);

    const plans = candidateIds.length === 0
      ? []
      : await this.db.optimizationPlan.findMany({
          where: { projectId, candidateId: { in: candidateIds } },
          select: { id: true, candidateId: true, createdAt: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: MAX_LIMIT,
        });
    const planByCandidate = firstByKey(plans, (row) => row.candidateId);
    const planIds = [...planByCandidate.values()].map((row) => row.id);

    const decisions = planIds.length === 0
      ? []
      : await this.db.optimizationAutopilotDecision.findMany({
          where: { projectId, optimizationPlanId: { in: planIds } },
          select: {
            id: true,
            optimizationPlanId: true,
            status: true,
            reasonCodes: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: MAX_LIMIT,
        });
    const decisionByPlan = firstByKey(decisions, (row) => row.optimizationPlanId);

    const proposals = planIds.length === 0
      ? []
      : await this.db.publicationProposal.findMany({
          where: {
            projectId,
            sourceType: 'P9_OPTIMIZATION_PLAN',
            sourceReferenceId: { in: planIds },
          },
          select: { id: true, sourceReferenceId: true, createdAt: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: MAX_LIMIT,
        });
    const proposalByOptimizationPlan = firstByKey(proposals, (row) => row.sourceReferenceId);
    const proposalIds = [...proposalByOptimizationPlan.values()].map((row) => row.id);

    const publicationPlans = proposalIds.length === 0
      ? []
      : await this.db.publicationPlan.findMany({
          where: { projectId, proposalId: { in: proposalIds } },
          select: {
            id: true,
            proposalId: true,
            createdAt: true,
            preview: { select: { id: true } },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: MAX_LIMIT,
        });
    const publicationPlanByProposal = firstByKey(publicationPlans, (row) => row.proposalId);
    const publicationPlanIds = [...publicationPlanByProposal.values()].map((row) => row.id);

    const executions = publicationPlanIds.length === 0
      ? []
      : await this.db.publicationExecution.findMany({
          where: { projectId, planId: { in: publicationPlanIds } },
          select: {
            id: true,
            planId: true,
            status: true,
            pullRequestNo: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          take: MAX_LIMIT,
        });
    const executionByPublicationPlan = firstByKey(executions, (row) => row.planId);
    const executionIds = [...executionByPublicationPlan.values()].map((row) => row.id);

    const verifications = executionIds.length === 0
      ? []
      : await this.db.publicationVerification.findMany({
          where: { projectId, executionId: { in: executionIds } },
          select: {
            id: true,
            executionId: true,
            status: true,
            observedAt: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: MAX_LIMIT,
        });
    const verificationByExecution = firstByKey(verifications, (row) => row.executionId);

    const experiments = planIds.length === 0
      ? []
      : await this.db.optimizationExperiment.findMany({
          where: { projectId, optimizationPlanId: { in: planIds } },
          select: {
            id: true,
            optimizationPlanId: true,
            observationScheduleJson: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: MAX_LIMIT,
        });
    const experimentByPlan = firstByKey(experiments, (row) => row.optimizationPlanId);
    const experimentIds = [...experimentByPlan.values()].map((row) => row.id);

    const observations = experimentIds.length === 0
      ? []
      : await this.db.optimizationExperimentObservation.findMany({
          where: { projectId, experimentId: { in: experimentIds } },
          select: {
            id: true,
            experimentId: true,
            windowType: true,
            windowDays: true,
            effectState: true,
            inputCutoffAt: true,
            createdAt: true,
          },
          orderBy: [{ inputCutoffAt: 'desc' }, { id: 'desc' }],
          take: MAX_LIMIT,
        });

    const terminalObservationByExperiment = new Map<string, (typeof observations)[number]>();
    const experimentById = new Map(experiments.map((row) => [row.id, row]));
    for (const observation of observations) {
      if (terminalObservationByExperiment.has(observation.experimentId)) continue;
      const experiment = experimentById.get(observation.experimentId);
      if (experiment && isTerminalObservation(experiment.observationScheduleJson, observation)) {
        terminalObservationByExperiment.set(observation.experimentId, observation);
      }
    }

    return growthRows.map((growth) => {
      const candidate = candidateByGrowth.get(growth.id) ?? null;
      const plan = candidate ? planByCandidate.get(candidate.id) ?? null : null;
      const decision = plan ? decisionByPlan.get(plan.id) ?? null : null;
      const proposal = plan ? proposalByOptimizationPlan.get(plan.id) ?? null : null;
      const publicationPlan = proposal ? publicationPlanByProposal.get(proposal.id) ?? null : null;
      const execution = publicationPlan ? executionByPublicationPlan.get(publicationPlan.id) ?? null : null;
      const verification = execution ? verificationByExecution.get(execution.id) ?? null : null;
      const experiment = plan ? experimentByPlan.get(plan.id) ?? null : null;
      const observation = experiment ? terminalObservationByExperiment.get(experiment.id) ?? null : null;

      return {
        growthOpportunityId: growth.id,
        candidate: candidate
          ? { id: candidate.id, eligibilityState: candidate.eligibilityState }
          : null,
        optimizationPlanId: plan?.id ?? null,
        autopilotDecision: decision
          ? {
              id: decision.id,
              status: decision.status,
              reasonCode: firstString(decision.reasonCodes) ?? decision.status,
              updatedAt: decision.createdAt,
            }
          : null,
        p8Authority: proposal
          ? {
              proposalId: proposal.id,
              planId: publicationPlan?.id ?? null,
              previewId: publicationPlan?.preview?.id ?? null,
            }
          : null,
        publicationExecution: execution
          ? {
              id: execution.id,
              status: execution.status,
              pullRequestNo: execution.pullRequestNo,
              updatedAt: execution.updatedAt,
            }
          : null,
        publicationVerification: verification
          ? {
              id: verification.id,
              status: verification.status,
              updatedAt: verification.observedAt ?? verification.createdAt,
            }
          : null,
        experiment: experiment
          ? { id: experiment.id, createdAt: experiment.createdAt }
          : null,
        terminalObservation: observation
          ? {
              id: observation.id,
              effectState: observation.effectState,
              inputCutoffAt: observation.inputCutoffAt,
              createdAt: observation.createdAt,
            }
          : null,
      } satisfies OperationsPipelineAuthority;
    });
  }

  async listInboxAuthority(
    projectId: string,
    limit: number,
    offset: number,
  ): Promise<OperationsInboxAuthority[]> {
    assertPagination(limit, offset);
    if (offset >= MAX_LIMIT) return [];
    const scanLimit = Math.min(MAX_LIMIT, offset + limit);

    const [decisions, executions] = await Promise.all([
      this.db.optimizationAutopilotDecision.findMany({
        where: {
          projectId,
          status: { in: ['POLICY_BLOCKED', 'P8_VALIDATION_BLOCKED', 'STALE'] },
        },
        select: {
          id: true,
          optimizationPlanId: true,
          status: true,
          reasonCodes: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: scanLimit,
      }),
      this.db.publicationExecution.findMany({
        where: {
          projectId,
          status: {
            in: [
              'PR_CREATED',
              'VERIFICATION_FAILED',
              'FAILED',
              'STALE_REVIEW_REQUIRED',
              'APPROVAL_STALE',
              'TARGET_REVISION_CHANGED',
            ],
          },
        },
        select: {
          id: true,
          status: true,
          errorCode: true,
          updatedAt: true,
          plan: {
            select: {
              targetPublicUrl: true,
              proposal: {
                select: { sourceType: true, sourceReferenceId: true },
              },
            },
          },
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: scanLimit,
      }),
    ]);

    const authority: OperationsInboxAuthority[] = [
      ...decisions.map((decision) => ({
        authorityType: 'AUTOPILOT_DECISION' as const,
        authorityId: decision.id,
        status: decision.status,
        reasonCode: firstString(decision.reasonCodes) ?? decision.status,
        updatedAt: decision.createdAt,
        authorityUrl: null,
        optimizationPlanId: decision.optimizationPlanId,
        targetUrl: null,
      })),
      ...executions.map((execution) => ({
        authorityType: 'PUBLICATION_EXECUTION' as const,
        authorityId: execution.id,
        status: execution.status,
        reasonCode: execution.errorCode ?? execution.status,
        updatedAt: execution.updatedAt,
        authorityUrl: execution.status === 'PR_CREATED' ? null : null,
        optimizationPlanId: execution.plan.proposal.sourceType === 'P9_OPTIMIZATION_PLAN'
          ? execution.plan.proposal.sourceReferenceId
          : null,
        targetUrl: execution.plan.targetPublicUrl,
      })),
    ];

    authority.sort((left, right) => (
      left.updatedAt.getTime() - right.updatedAt.getTime()
      || left.authorityId.localeCompare(right.authorityId)
    ));
    return authority.slice(offset, offset + limit);
  }

  async listTerminalObservations(
    projectId: string,
    cutoffStart: Date,
    cutoffEnd: Date,
  ): Promise<OperationsOutcomeObservation[]> {
    const experiments = await this.db.optimizationExperiment.findMany({
      where: {
        projectId,
        observations: {
          some: { inputCutoffAt: { gte: cutoffStart, lte: cutoffEnd } },
        },
      },
      select: { id: true, observationScheduleJson: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_LIMIT,
    });
    if (experiments.length === 0) return [];

    const scheduleByExperiment = new Map(
      experiments.map((experiment) => [experiment.id, experiment.observationScheduleJson]),
    );
    const observations = await this.db.optimizationExperimentObservation.findMany({
      where: {
        projectId,
        experimentId: { in: experiments.map((experiment) => experiment.id) },
        inputCutoffAt: { gte: cutoffStart, lte: cutoffEnd },
      },
      select: {
        id: true,
        experimentId: true,
        windowType: true,
        windowDays: true,
        effectState: true,
        inputCutoffAt: true,
        createdAt: true,
      },
      orderBy: [{ inputCutoffAt: 'desc' }, { id: 'desc' }],
      take: MAX_LIMIT,
    });

    return observations
      .filter((observation) => {
        const schedule = scheduleByExperiment.get(observation.experimentId);
        return schedule !== undefined && isTerminalObservation(schedule, observation);
      })
      .map((observation) => ({
        id: observation.id,
        effectState: observation.effectState as OperationsEffectState,
        inputCutoffAt: observation.inputCutoffAt,
        createdAt: observation.createdAt,
      }));
  }

  async listFeedbackEvidence(
    projectId: string,
    cutoffStart: Date,
    cutoffEnd: Date,
  ): Promise<OperationsFeedbackEvidenceAuthority[]> {
    const rows = await this.db.optimizationFeedbackEvidence.findMany({
      where: {
        projectId,
        inputCutoffAt: { gte: cutoffStart, lte: cutoffEnd },
      },
      select: { observationId: true, inputCutoffAt: true },
      orderBy: [{ inputCutoffAt: 'desc' }, { observationId: 'desc' }],
      take: MAX_LIMIT,
    });
    return rows;
  }

  async listFeedbackProfiles(
    projectId: string,
    limit: number,
    offset: number,
  ): Promise<OperationsFeedbackProfileRead[]> {
    assertPagination(limit, offset);
    const rows = await this.db.optimizationFeedbackProfile.findMany({
      where: { projectId },
      select: {
        id: true,
        projectId: true,
        marketScopeMode: true,
        marketCode: true,
        locale: true,
        recommendedActionType: true,
        sampleCount: true,
        positiveCount: true,
        neutralCount: true,
        negativeCount: true,
        rollingEffectBalance: true,
        historicalRankAdjustment: true,
        newestEvidenceCutoffAt: true,
        createdAt: true,
      },
      orderBy: [{ newestEvidenceCutoffAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: limit,
    });
    return rows.map((row) => ({
      ...row,
      marketScopeMode: row.marketScopeMode,
      marketCode: row.marketCode,
      recommendedActionType: row.recommendedActionType,
    }));
  }

  async listReservations(
    projectId: string,
    utcDate: Date,
  ): Promise<OperationsReservationAuthority[]> {
    const rows = await this.db.autopilotExecutionReservation.findMany({
      where: { projectId, utcDate },
      select: { status: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: MAX_LIMIT,
    });
    return rows;
  }

  async listRecentActivityAuthority(
    projectId: string,
    limit: number,
  ): Promise<OperationsActivityItem[]> {
    assertLimit(limit);
    const [plans, runs, decisions, executions, verifications, observations, evidence, revisions] = await Promise.all([
      this.db.optimizationPlan.findMany({
        where: { projectId },
        select: { id: true, recommendedActionType: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      }),
      this.db.optimizationRun.findMany({
        where: { projectId },
        select: { id: true, status: true, createdAt: true, startedAt: true, completedAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      }),
      this.db.optimizationAutopilotDecision.findMany({
        where: { projectId },
        select: { id: true, status: true, reasonCodes: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      }),
      this.db.publicationExecution.findMany({
        where: { projectId },
        select: { id: true, status: true, createdAt: true, startedAt: true, completedAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      }),
      this.db.publicationVerification.findMany({
        where: { projectId },
        select: { id: true, status: true, reasonCode: true, observedAt: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      }),
      this.db.optimizationExperimentObservation.findMany({
        where: { projectId },
        select: { id: true, effectState: true, inputCutoffAt: true },
        orderBy: [{ inputCutoffAt: 'desc' }, { id: 'desc' }],
        take: limit,
      }),
      this.db.optimizationFeedbackEvidence.findMany({
        where: { projectId },
        select: { id: true, effectState: true, inputCutoffAt: true },
        orderBy: [{ inputCutoffAt: 'desc' }, { id: 'desc' }],
        take: limit,
      }),
      this.db.autopilotPolicyRevision.findMany({
        where: { projectId },
        select: { id: true, actorId: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
      }),
    ]);

    const items: OperationsActivityItem[] = [];
    for (const plan of plans) {
      items.push({
        occurredAt: plan.createdAt,
        sourceModule: 'P9_A',
        eventType: 'OPTIMIZATION_PLAN_CREATED',
        title: 'Optimization plan created',
        summary: String(plan.recommendedActionType),
        authorityId: plan.id,
        authorityUrl: null,
        severity: 'INFO',
      });
    }
    for (const run of runs) {
      items.push({
        occurredAt: run.completedAt ?? run.startedAt ?? run.createdAt,
        sourceModule: 'P9_B',
        eventType: `OPTIMIZATION_RUN_${run.status}`,
        title: 'Optimization run',
        summary: run.status,
        authorityId: run.id,
        authorityUrl: null,
        severity: activitySeverity(run.status),
      });
    }
    for (const decision of decisions) {
      items.push({
        occurredAt: decision.createdAt,
        sourceModule: 'P9_C',
        eventType: `AUTOPILOT_${decision.status}`,
        title: 'Autopilot decision',
        summary: firstString(decision.reasonCodes) ?? decision.status,
        authorityId: decision.id,
        authorityUrl: null,
        severity: activitySeverity(decision.status),
      });
    }
    for (const execution of executions) {
      items.push({
        occurredAt: execution.completedAt ?? execution.startedAt ?? execution.createdAt,
        sourceModule: 'P8',
        eventType: `PUBLICATION_${execution.status}`,
        title: 'Publication execution',
        summary: execution.status,
        authorityId: execution.id,
        authorityUrl: null,
        severity: activitySeverity(execution.status),
      });
    }
    for (const verification of verifications) {
      items.push({
        occurredAt: verification.observedAt ?? verification.createdAt,
        sourceModule: 'P8',
        eventType: `VERIFICATION_${verification.status}`,
        title: 'Publication verification',
        summary: verification.reasonCode ?? verification.status,
        authorityId: verification.id,
        authorityUrl: null,
        severity: verification.status === 'FAILED' ? 'ERROR' : 'INFO',
      });
    }
    for (const observation of observations) {
      items.push({
        occurredAt: observation.inputCutoffAt,
        sourceModule: 'P9_D',
        eventType: `EXPERIMENT_${observation.effectState}`,
        title: 'Experiment observation',
        summary: observation.effectState,
        authorityId: observation.id,
        authorityUrl: null,
        severity: observation.effectState === 'NEGATIVE' ? 'WARNING' : 'INFO',
      });
    }
    for (const row of evidence) {
      items.push({
        occurredAt: row.inputCutoffAt,
        sourceModule: 'P9_E',
        eventType: `FEEDBACK_${row.effectState}`,
        title: 'Feedback evidence accepted',
        summary: row.effectState,
        authorityId: row.id,
        authorityUrl: null,
        severity: row.effectState === 'NEGATIVE' ? 'WARNING' : 'INFO',
      });
    }
    for (const revision of revisions) {
      items.push({
        occurredAt: revision.createdAt,
        sourceModule: 'P9_F',
        eventType: 'POLICY_REVISION_APPLIED',
        title: 'Autopilot policy revised',
        summary: revision.actorId,
        authorityId: revision.id,
        authorityUrl: null,
        severity: 'INFO',
      });
    }

    return sortActivity(items).slice(0, limit);
  }

  async listPolicyRevisions(projectId: string, limit: number, offset: number) {
    assertPagination(limit, offset);
    return this.db.autopilotPolicyRevision.findMany({
      where: { projectId },
      select: {
        id: true,
        projectId: true,
        policyId: true,
        revisionVersion: true,
        requestId: true,
        revisionKey: true,
        previousPolicyUpdatedAt: true,
        appliedPolicyUpdatedAt: true,
        beforeSnapshotJson: true,
        afterSnapshotJson: true,
        actorId: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: offset,
      take: limit,
    });
  }
}
