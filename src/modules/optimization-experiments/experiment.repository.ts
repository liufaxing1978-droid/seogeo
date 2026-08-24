import {
  Prisma,
  type MarketCode,
  type OptimizationExperiment,
  type OptimizationExperimentObservation,
  type RecommendedActionType
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { canonicalJson } from './experiment.identity.js';
import type {
  ExperimentContaminationState,
  ExperimentCoverageState,
  ExperimentEffectState,
  ExperimentWindowType
} from './experiment.types.js';

export type CreateExperimentInput = {
  projectId: string;
  optimizationPlanId: string;
  publicationExecutionId: string;
  publicationVerificationId: string;
  experimentVersion: string;
  experimentKey: string;
  interventionType: RecommendedActionType;
  targetUrl: string;
  marketCode: MarketCode | null;
  locale: string | null;
  verifiedAnchorAt: Date;
  measurementScopeJson: Prisma.InputJsonValue;
  observationScheduleJson: Prisma.InputJsonValue;
  expectedDirectionJson: Prisma.InputJsonValue;
};

export type CreateExperimentObservationInput = {
  projectId: string;
  experimentId: string;
  observationVersion: string;
  observationKey: string;
  windowType: ExperimentWindowType;
  windowDays: number;
  dueAt: Date;
  inputCutoffAt: Date;
  baselineSearchSourceRefs: Prisma.InputJsonValue;
  observedSearchSourceRefs: Prisma.InputJsonValue;
  baselineVisibilitySourceRefs: Prisma.InputJsonValue;
  observedVisibilitySourceRefs: Prisma.InputJsonValue;
  baselineMetricsJson: Prisma.InputJsonValue;
  observedMetricsJson: Prisma.InputJsonValue;
  deltaMetricsJson: Prisma.InputJsonValue;
  coverageState: ExperimentCoverageState;
  contaminationState: ExperimentContaminationState;
  effectState: ExperimentEffectState;
  reasonCodes: Prisma.InputJsonValue;
  evaluatorVersion: string;
};

type ExperimentDb = Pick<
  Prisma.TransactionClient,
  'optimizationExperiment' | 'optimizationExperimentObservation'
>;

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: string }).code === 'P2002'
  );
}

function canonicalInputJson(value: Prisma.InputJsonValue): Prisma.InputJsonValue {
  return JSON.parse(canonicalJson(value)) as Prisma.InputJsonValue;
}

function sameDate(left: Date, right: Date): boolean {
  return left.getTime() === right.getTime();
}

function assertExperimentIdentity(
  existing: OptimizationExperiment,
  input: CreateExperimentInput
): void {
  if (
    existing.projectId !== input.projectId
    || existing.optimizationPlanId !== input.optimizationPlanId
    || existing.publicationExecutionId !== input.publicationExecutionId
    || existing.publicationVerificationId !== input.publicationVerificationId
    || existing.experimentVersion !== input.experimentVersion
    || existing.experimentKey !== input.experimentKey
    || existing.interventionType !== input.interventionType
    || existing.targetUrl !== input.targetUrl
    || existing.marketCode !== input.marketCode
    || existing.locale !== input.locale
    || !sameDate(existing.verifiedAnchorAt, input.verifiedAnchorAt)
    || canonicalJson(existing.measurementScopeJson) !== canonicalJson(input.measurementScopeJson)
    || canonicalJson(existing.observationScheduleJson) !== canonicalJson(input.observationScheduleJson)
    || canonicalJson(existing.expectedDirectionJson) !== canonicalJson(input.expectedDirectionJson)
  ) {
    throw new Error('EXPERIMENT_IDENTITY_COLLISION');
  }
}

function assertObservationIdentity(
  existing: OptimizationExperimentObservation,
  input: CreateExperimentObservationInput
): void {
  if (
    existing.projectId !== input.projectId
    || existing.experimentId !== input.experimentId
    || existing.observationVersion !== input.observationVersion
    || existing.observationKey !== input.observationKey
    || existing.windowType !== input.windowType
    || existing.windowDays !== input.windowDays
    || !sameDate(existing.dueAt, input.dueAt)
    || !sameDate(existing.inputCutoffAt, input.inputCutoffAt)
    || canonicalJson(existing.baselineSearchSourceRefs) !== canonicalJson(input.baselineSearchSourceRefs)
    || canonicalJson(existing.observedSearchSourceRefs) !== canonicalJson(input.observedSearchSourceRefs)
    || canonicalJson(existing.baselineVisibilitySourceRefs) !== canonicalJson(input.baselineVisibilitySourceRefs)
    || canonicalJson(existing.observedVisibilitySourceRefs) !== canonicalJson(input.observedVisibilitySourceRefs)
    || canonicalJson(existing.baselineMetricsJson) !== canonicalJson(input.baselineMetricsJson)
    || canonicalJson(existing.observedMetricsJson) !== canonicalJson(input.observedMetricsJson)
    || canonicalJson(existing.deltaMetricsJson) !== canonicalJson(input.deltaMetricsJson)
    || existing.coverageState !== input.coverageState
    || existing.contaminationState !== input.contaminationState
    || existing.effectState !== input.effectState
    || canonicalJson(existing.reasonCodes) !== canonicalJson(input.reasonCodes)
    || existing.evaluatorVersion !== input.evaluatorVersion
  ) {
    throw new Error('EXPERIMENT_OBSERVATION_IDENTITY_COLLISION');
  }
}

export class OptimizationExperimentRepository {
  constructor(private readonly db: ExperimentDb = prisma) {}

  async createOrGetExperiment(input: CreateExperimentInput): Promise<OptimizationExperiment> {
    const existing = await this.db.optimizationExperiment.findUnique({
      where: {
        projectId_experimentKey: {
          projectId: input.projectId,
          experimentKey: input.experimentKey
        }
      }
    });
    if (existing) {
      assertExperimentIdentity(existing, input);
      return existing;
    }

    try {
      return await this.db.optimizationExperiment.create({
        data: {
          projectId: input.projectId,
          optimizationPlanId: input.optimizationPlanId,
          publicationExecutionId: input.publicationExecutionId,
          publicationVerificationId: input.publicationVerificationId,
          experimentVersion: input.experimentVersion,
          experimentKey: input.experimentKey,
          interventionType: input.interventionType,
          targetUrl: input.targetUrl,
          marketCode: input.marketCode,
          locale: input.locale,
          verifiedAnchorAt: input.verifiedAnchorAt,
          measurementScopeJson: canonicalInputJson(input.measurementScopeJson),
          observationScheduleJson: canonicalInputJson(input.observationScheduleJson),
          expectedDirectionJson: canonicalInputJson(input.expectedDirectionJson)
        }
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      const byKey = await this.db.optimizationExperiment.findUnique({
        where: {
          projectId_experimentKey: {
            projectId: input.projectId,
            experimentKey: input.experimentKey
          }
        }
      });
      if (byKey) {
        assertExperimentIdentity(byKey, input);
        return byKey;
      }

      const byExecution = await this.db.optimizationExperiment.findUnique({
        where: {
          optimizationPlanId_publicationExecutionId_experimentVersion: {
            optimizationPlanId: input.optimizationPlanId,
            publicationExecutionId: input.publicationExecutionId,
            experimentVersion: input.experimentVersion
          }
        }
      });
      if (byExecution) {
        assertExperimentIdentity(byExecution, input);
        return byExecution;
      }

      throw error;
    }
  }

  async createOrGetObservation(
    input: CreateExperimentObservationInput
  ): Promise<OptimizationExperimentObservation> {
    const existing = await this.db.optimizationExperimentObservation.findUnique({
      where: {
        experimentId_observationKey: {
          experimentId: input.experimentId,
          observationKey: input.observationKey
        }
      }
    });
    if (existing) {
      assertObservationIdentity(existing, input);
      return existing;
    }

    try {
      return await this.db.optimizationExperimentObservation.create({
        data: {
          projectId: input.projectId,
          experimentId: input.experimentId,
          observationVersion: input.observationVersion,
          observationKey: input.observationKey,
          windowType: input.windowType,
          windowDays: input.windowDays,
          dueAt: input.dueAt,
          inputCutoffAt: input.inputCutoffAt,
          baselineSearchSourceRefs: canonicalInputJson(input.baselineSearchSourceRefs),
          observedSearchSourceRefs: canonicalInputJson(input.observedSearchSourceRefs),
          baselineVisibilitySourceRefs: canonicalInputJson(input.baselineVisibilitySourceRefs),
          observedVisibilitySourceRefs: canonicalInputJson(input.observedVisibilitySourceRefs),
          baselineMetricsJson: canonicalInputJson(input.baselineMetricsJson),
          observedMetricsJson: canonicalInputJson(input.observedMetricsJson),
          deltaMetricsJson: canonicalInputJson(input.deltaMetricsJson),
          coverageState: input.coverageState,
          contaminationState: input.contaminationState,
          effectState: input.effectState,
          reasonCodes: canonicalInputJson(input.reasonCodes),
          evaluatorVersion: input.evaluatorVersion
        }
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const collided = await this.db.optimizationExperimentObservation.findUnique({
        where: {
          experimentId_observationKey: {
            experimentId: input.experimentId,
            observationKey: input.observationKey
          }
        }
      });
      if (!collided) throw error;
      assertObservationIdentity(collided, input);
      return collided;
    }
  }
}

const defaultRepository = new OptimizationExperimentRepository();

export function createOrGetExperiment(
  input: CreateExperimentInput
): Promise<OptimizationExperiment> {
  return defaultRepository.createOrGetExperiment(input);
}

export function createOrGetObservation(
  input: CreateExperimentObservationInput
): Promise<OptimizationExperimentObservation> {
  return defaultRepository.createOrGetObservation(input);
}
