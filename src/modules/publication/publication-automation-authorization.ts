import {
  Prisma,
  type AutopilotExecutionReservation,
  type AutopilotPolicy,
  type OptimizationAutopilotDecision,
  type PublicationAutomationAuthorization
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { parseControlledAutopilotGlobalKillSwitch } from '../optimization-autopilot/autopilot.config.js';
import { hashCanonicalJson } from '../optimization-autopilot/autopilot.identity.js';
import type { CreatePublicationAutomationAuthorizationInput } from './publication.types.js';

export const PUBLICATION_AUTOMATION_SOURCE = 'CONTROLLED_AUTOPILOT' as const;

export class PublicationAutomationAuthorizationError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'PublicationAutomationAuthorizationError';
  }
}

type JsonRecord = Record<string, unknown>;

export interface AutomationAuthorizationPlanRecord {
  id: string;
  projectId: string;
  draftId: string;
  draftVersion: number;
  version: number;
  planHash: string;
  baseSha: string;
  targetRepository: string;
  targetBranch: string;
  targetBlobHashes: unknown;
  operations: unknown;
  riskClass: string;
}

export interface AutomationAuthorizationPreviewRecord {
  id: string;
  planId: string;
  projectId: string;
  previewHash: string;
  validationResult: unknown;
}

export interface AutomationAuthorizationLiveTarget {
  repositoryIdentity: string;
  branch: string;
  headSha: string;
  files: Record<string, string>;
}

export interface AuthorizePublicationAutomationInput {
  projectId: string;
  planId: string;
  decisionId: string;
  reservationId: string;
  expiresAt: Date;
}

export interface AssertAutomationAuthorizationCurrentInput {
  authorization: PublicationAutomationAuthorization;
  plan: AutomationAuthorizationPlanRecord;
  preview: AutomationAuthorizationPreviewRecord;
  decision: OptimizationAutopilotDecision;
  policy: AutopilotPolicy;
  reservation: AutopilotExecutionReservation;
  liveTarget: AutomationAuthorizationLiveTarget;
  globalKillSwitch: boolean;
  now?: Date;
}

function fail(code: string, message: string): never {
  throw new PublicationAutomationAuthorizationError(code, message);
}

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const values: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || !item.trim()) return null;
    values.push(item.trim());
  }
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function jsonObject(value: unknown): JsonRecord {
  return record(value) ?? {};
}

function sameJson(left: unknown, right: unknown): boolean {
  return hashCanonicalJson(jsonObject(left)) === hashCanonicalJson(jsonObject(right));
}

function sameStringArray(left: unknown, right: readonly string[]): boolean {
  const normalized = stringArray(left);
  return normalized !== null
    && normalized.length === right.length
    && normalized.every((value, index) => value === [...right].sort()[index]);
}

function exactCreateOperationFacts(operations: unknown): {
  contentHash: string;
  operationTypes: ['CREATE_CONTENT_PAGE'];
} | null {
  if (!Array.isArray(operations) || operations.length !== 1) return null;
  const operation = record(operations[0]);
  if (!operation || operation.type !== 'CREATE_CONTENT_PAGE') return null;
  if (typeof operation.contentHash !== 'string' || !operation.contentHash.trim()) return null;
  return {
    contentHash: operation.contentHash,
    operationTypes: ['CREATE_CONTENT_PAGE']
  };
}

function validationIsMachineClear(preview: AutomationAuthorizationPreviewRecord): boolean {
  const validation = record(preview.validationResult);
  if (!validation || validation.canCreatePlan !== true) return false;
  const blockingCodes = stringArray(validation.blockingCodes);
  const warningCodes = stringArray(validation.warningCodes);
  const unconfirmedWarningCodes = stringArray(validation.unconfirmedWarningCodes);
  return blockingCodes !== null
    && warningCodes !== null
    && unconfirmedWarningCodes !== null
    && blockingCodes.length === 0
    && warningCodes.length === 0
    && unconfirmedWarningCodes.length === 0;
}

function currentPolicySnapshot(policy: AutopilotPolicy): JsonRecord | null {
  const allowedOperationClasses = stringArray(policy.allowedOperationClasses);
  if (!allowedOperationClasses) return null;
  return {
    version: policy.policyVersion,
    enabled: policy.enabled,
    allowedRiskClass: policy.allowedRiskClass,
    allowedOperationClasses,
    dailyDraftPrLimit: policy.dailyDraftPrLimit,
    maxConcurrentRuns: policy.maxConcurrentRuns,
    requireFreshEvidence: policy.requireFreshEvidence,
    minimumEvidenceCoverage: policy.minimumEvidenceCoverage,
    pauseOnVerificationFailure: policy.pauseOnVerificationFailure,
    killSwitch: policy.killSwitch
  };
}

function policyPermitsExactCreate(policy: AutopilotPolicy): boolean {
  const allowedOperationClasses = stringArray(policy.allowedOperationClasses);
  return policy.enabled
    && !policy.killSwitch
    && policy.allowedRiskClass === 'LOW'
    && allowedOperationClasses?.length === 1
    && allowedOperationClasses[0] === 'CREATE_CONTENT_PAGE';
}

function sourceSnapshotMatches(
  decision: OptimizationAutopilotDecision,
  plan: AutomationAuthorizationPlanRecord,
  preview: AutomationAuthorizationPreviewRecord
): boolean {
  const source = record(decision.sourceSnapshot);
  if (!source) return false;
  const operationFacts = exactCreateOperationFacts(plan.operations);
  if (!operationFacts) return false;
  return source.publicationPlanId === plan.id
    && source.publicationPlanHash === plan.planHash
    && source.publicationPreviewId === preview.id
    && source.publicationPreviewHash === preview.previewHash
    && source.publicationRiskClass === plan.riskClass
    && source.publicationBaseSha === plan.baseSha
    && source.publicationTargetRepository === plan.targetRepository
    && source.publicationTargetBranch === plan.targetBranch
    && sameStringArray(source.publicationOperationTypes, operationFacts.operationTypes);
}

function utcDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function reservationIsCurrent(
  reservation: AutopilotExecutionReservation,
  projectId: string,
  decisionId: string,
  now: Date
): boolean {
  return reservation.projectId === projectId
    && reservation.decisionId === decisionId
    && reservation.status === 'RESERVED'
    && reservation.releasedAt === null
    && utcDateKey(reservation.utcDate) === utcDateKey(now);
}

function assertDecisionPolicyBinding(
  decision: OptimizationAutopilotDecision,
  policy: AutopilotPolicy,
  plan: AutomationAuthorizationPlanRecord,
  preview: AutomationAuthorizationPreviewRecord
): string {
  if (
    decision.projectId !== plan.projectId
    || decision.status !== 'AUTOPILOT_READY'
    || decision.p8PlanId !== plan.id
    || decision.p8PreviewId !== preview.id
    || decision.policyId !== policy.id
    || decision.policyVersion !== policy.policyVersion
  ) {
    fail('AUTOMATION_AUTHORIZATION_STALE', 'Autopilot decision is not bound to the current P8 plan, preview and policy');
  }
  if (!sourceSnapshotMatches(decision, plan, preview)) {
    fail('AUTOMATION_AUTHORIZATION_STALE', 'Autopilot source snapshot does not match the immutable P8 artifacts');
  }
  if (!policyPermitsExactCreate(policy)) {
    fail('AUTOMATION_POLICY_BLOCKED', 'Current controlled-autopilot policy does not permit exact LOW create publication');
  }

  const snapshot = currentPolicySnapshot(policy);
  if (!snapshot) {
    fail('AUTOMATION_POLICY_BLOCKED', 'Current controlled-autopilot policy snapshot is invalid');
  }
  const currentHash = hashCanonicalJson(snapshot);
  const decisionHash = hashCanonicalJson(decision.policySnapshot);
  if (currentHash !== decisionHash) {
    fail('AUTOMATION_AUTHORIZATION_STALE', 'Current controlled-autopilot policy no longer matches the decision snapshot');
  }
  return decisionHash;
}

function assertPlanPreviewContentBinding(
  plan: AutomationAuthorizationPlanRecord,
  preview: AutomationAuthorizationPreviewRecord,
  contentHash: string | null
): string {
  const operationFacts = exactCreateOperationFacts(plan.operations);
  if (
    plan.riskClass !== 'LOW'
    || !operationFacts
    || preview.planId !== plan.id
    || preview.projectId !== plan.projectId
    || !validationIsMachineClear(preview)
    || !contentHash
    || operationFacts.contentHash !== contentHash
  ) {
    fail('AUTOMATION_AUTHORIZATION_BLOCKED', 'P8 plan, preview or content is not exact LOW machine-authorizable CREATE_CONTENT_PAGE');
  }
  return contentHash;
}

function assertLiveTarget(
  authorization: PublicationAutomationAuthorization,
  liveTarget: AutomationAuthorizationLiveTarget
): void {
  if (
    liveTarget.repositoryIdentity !== authorization.targetRepository
    || liveTarget.branch !== authorization.targetBranch
    || liveTarget.headSha !== authorization.baseSha
  ) {
    fail('TARGET_REVISION_CHANGED', 'Live publication target changed after machine authorization');
  }
  const blobs = jsonObject(authorization.targetBlobHashes);
  for (const [path, expectedBlob] of Object.entries(blobs)) {
    if (typeof expectedBlob !== 'string' || liveTarget.files[path] !== expectedBlob) {
      fail('TARGET_REVISION_CHANGED', 'A touched publication target changed after machine authorization');
    }
  }
}

function expectedAuthorizationMatches(
  authorization: PublicationAutomationAuthorization,
  expected: CreatePublicationAutomationAuthorizationInput
): boolean {
  return authorization.projectId === expected.projectId
    && authorization.planId === expected.planId
    && authorization.planVersion === expected.planVersion
    && authorization.planHash === expected.planHash
    && authorization.contentVersion === expected.contentVersion
    && authorization.contentHash === expected.contentHash
    && authorization.previewHash === expected.previewHash
    && authorization.baseSha === expected.baseSha
    && authorization.targetRepository === expected.targetRepository
    && authorization.targetBranch === expected.targetBranch
    && sameJson(authorization.targetBlobHashes, expected.targetBlobHashes)
    && authorization.authorizedRiskClass === expected.authorizedRiskClass
    && authorization.automationDecisionId === expected.automationDecisionId
    && authorization.automationPolicyVersion === expected.automationPolicyVersion
    && authorization.automationPolicyHash === expected.automationPolicyHash
    && authorization.automationSource === expected.automationSource
    && authorization.expiresAt?.getTime() === expected.expiresAt.getTime();
}

function asInputJsonObject(value: unknown): Prisma.InputJsonObject {
  const object = record(value);
  if (!object) return {};
  return JSON.parse(JSON.stringify(object)) as Prisma.InputJsonObject;
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export async function authorizePublicationAutomation(
  input: AuthorizePublicationAutomationInput
): Promise<PublicationAutomationAuthorization> {
  const now = new Date();
  if (!(input.expiresAt instanceof Date) || Number.isNaN(input.expiresAt.getTime()) || input.expiresAt.getTime() <= now.getTime()) {
    fail('AUTOMATION_AUTHORIZATION_STALE', 'Machine authorization expiry must be a valid future time');
  }
  if (parseControlledAutopilotGlobalKillSwitch(process.env.CONTROLLED_AUTOPILOT_GLOBAL_KILL_SWITCH)) {
    fail('AUTOMATION_KILL_SWITCH_ACTIVE', 'Controlled autopilot global kill switch is active');
  }

  const [plan, preview, decision, reservation] = await Promise.all([
    prisma.publicationPlan.findUnique({ where: { id: input.planId } }),
    prisma.publicationPreview.findUnique({ where: { planId: input.planId } }),
    prisma.optimizationAutopilotDecision.findUnique({ where: { id: input.decisionId } }),
    prisma.autopilotExecutionReservation.findUnique({ where: { id: input.reservationId } })
  ]);
  if (!plan || plan.projectId !== input.projectId) {
    fail('AUTOMATION_AUTHORIZATION_STALE', 'Publication plan is unavailable or belongs to a different project');
  }
  if (!preview || preview.projectId !== input.projectId) {
    fail('AUTOMATION_AUTHORIZATION_STALE', 'Publication preview is unavailable or belongs to a different project');
  }
  if (!decision || decision.projectId !== input.projectId) {
    fail('AUTOMATION_AUTHORIZATION_STALE', 'Autopilot decision is unavailable or belongs to a different project');
  }
  const policy = await prisma.autopilotPolicy.findUnique({ where: { id: decision.policyId } });
  if (!policy || policy.projectId !== input.projectId) {
    fail('AUTOMATION_AUTHORIZATION_STALE', 'Autopilot policy is unavailable or belongs to a different project');
  }
  if (!reservation || !reservationIsCurrent(reservation, input.projectId, decision.id, now)) {
    fail('AUTOMATION_RESERVATION_STALE', 'Autopilot reservation is not current, reserved, or owned by this decision');
  }

  const draftVersion = await prisma.contentDraftVersion.findFirst({
    where: { draftId: plan.draftId, version: plan.draftVersion },
    select: { contentHash: true }
  });
  const contentHash = assertPlanPreviewContentBinding(plan, preview, draftVersion?.contentHash ?? null);
  const policyHash = assertDecisionPolicyBinding(decision, policy, plan, preview);

  const createInput: CreatePublicationAutomationAuthorizationInput = {
    projectId: plan.projectId,
    planId: plan.id,
    planVersion: plan.version,
    planHash: plan.planHash,
    contentVersion: plan.draftVersion,
    contentHash,
    previewHash: preview.previewHash,
    baseSha: plan.baseSha,
    targetRepository: plan.targetRepository,
    targetBranch: plan.targetBranch,
    targetBlobHashes: asInputJsonObject(plan.targetBlobHashes),
    authorizedRiskClass: 'LOW',
    automationDecisionId: decision.id,
    automationPolicyVersion: decision.policyVersion,
    automationPolicyHash: policyHash,
    automationSource: PUBLICATION_AUTOMATION_SOURCE,
    expiresAt: input.expiresAt
  };

  const existing = await prisma.publicationAutomationAuthorization.findUnique({
    where: { automationDecisionId: decision.id }
  });
  if (existing) {
    if (!expectedAuthorizationMatches(existing, createInput)) {
      fail('AUTOMATION_AUTHORIZATION_IDENTITY_COLLISION', 'Existing machine authorization does not match the immutable decision binding');
    }
    return existing;
  }

  try {
    return await prisma.publicationAutomationAuthorization.create({ data: createInput });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const raced = await prisma.publicationAutomationAuthorization.findUnique({
      where: { automationDecisionId: decision.id }
    });
    if (!raced || !expectedAuthorizationMatches(raced, createInput)) {
      fail('AUTOMATION_AUTHORIZATION_IDENTITY_COLLISION', 'Concurrent machine authorization did not match the immutable decision binding');
    }
    return raced;
  }
}

export function assertAutomationAuthorizationCurrent(
  input: AssertAutomationAuthorizationCurrentInput
): void {
  const now = input.now ?? new Date();
  const { authorization, plan, preview, decision, policy, reservation } = input;

  if (input.globalKillSwitch || policy.killSwitch || !policy.enabled) {
    fail('AUTOMATION_KILL_SWITCH_ACTIVE', 'Controlled autopilot is no longer enabled for execution');
  }
  if (authorization.expiresAt === null || authorization.expiresAt.getTime() <= now.getTime()) {
    fail('AUTOMATION_AUTHORIZATION_STALE', 'Machine authorization has expired');
  }
  if (!reservationIsCurrent(reservation, authorization.projectId, decision.id, now)) {
    fail('AUTOMATION_RESERVATION_STALE', 'Autopilot reservation is no longer current');
  }

  const contentHash = assertPlanPreviewContentBinding(plan, preview, authorization.contentHash);
  const policyHash = assertDecisionPolicyBinding(decision, policy, plan, preview);
  const immutableBindingMatches = authorization.projectId === plan.projectId
    && authorization.planId === plan.id
    && authorization.planVersion === plan.version
    && authorization.planHash === plan.planHash
    && authorization.contentVersion === plan.draftVersion
    && authorization.contentHash === contentHash
    && authorization.previewHash === preview.previewHash
    && authorization.baseSha === plan.baseSha
    && authorization.targetRepository === plan.targetRepository
    && authorization.targetBranch === plan.targetBranch
    && sameJson(authorization.targetBlobHashes, plan.targetBlobHashes)
    && authorization.authorizedRiskClass === 'LOW'
    && authorization.automationDecisionId === decision.id
    && authorization.automationPolicyVersion === decision.policyVersion
    && authorization.automationPolicyHash === policyHash
    && authorization.automationSource === PUBLICATION_AUTOMATION_SOURCE;

  if (!immutableBindingMatches) {
    fail('AUTOMATION_AUTHORIZATION_STALE', 'Machine authorization no longer matches its immutable plan, preview, decision and policy binding');
  }
  assertLiveTarget(authorization, input.liveTarget);
}
