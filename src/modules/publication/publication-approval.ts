import type { PublicationRiskClass } from '@prisma/client';
import { canonicalPublicationJson } from './publication.hash.js';
import { publicationRepository } from './publication.repository.js';
import type { CreatePublicationApprovalInput } from './publication.types.js';

export class PublicationApprovalError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'PublicationApprovalError';
  }
}

export interface ApprovalPlanRecord {
  id: string;
  projectId: string;
  proposalId?: string;
  draftId: string;
  draftVersion: number;
  version: number;
  planHash: string;
  baseSha: string;
  targetRepository: string;
  targetBranch: string;
  targetBlobHashes: unknown;
  operations: unknown;
  riskClass: PublicationRiskClass;
}

export interface ApprovalPreviewRecord {
  id: string;
  planId: string;
  projectId: string;
  previewHash: string;
  validationResult: unknown;
}

export interface ApprovalRecord {
  id: string;
  projectId: string;
  planId: string;
  planVersion: number;
  planHash: string;
  contentVersion: number;
  contentHash: string;
  previewHash: string;
  baseSha: string;
  targetRepository: string;
  targetBranch: string;
  targetBlobHashes: unknown;
  approverActorId: string;
  approvedRiskClass: PublicationRiskClass;
  confirmedWarningCodes: unknown;
  expiresAt: Date | null;
}

export interface ApprovalLiveTarget {
  repositoryIdentity: string;
  branch: string;
  headSha: string;
  files: Record<string, string>;
}

export interface ApprovalRepository {
  getPlanForApproval(planId: string): Promise<ApprovalPlanRecord | null>;
  getPreviewForPlan(planId: string): Promise<ApprovalPreviewRecord | null>;
  getDraftVersion(draftId: string, version: number): Promise<{ contentHash: string | null } | null>;
  createApproval(input: CreatePublicationApprovalInput): Promise<ApprovalRecord>;
}

export interface ApprovePublicationPlanInput {
  projectId: string;
  planId: string;
  expectedPlanHash: string;
  expectedContentHash: string;
  expectedPreviewHash: string;
  confirmedRisk?: 'MEDIUM' | 'HIGH';
  confirmedWarningCodes?: string[];
  expiresAt?: Date | null;
}

export interface ApprovalActorContext {
  actorId: string;
}

function fail(code: string, message: string): never {
  throw new PublicationApprovalError(code, message);
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function normalizeJsonObject(value: unknown): Record<string, unknown> {
  return objectRecord(value) ?? {};
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalPublicationJson(normalizeJsonObject(left))
    === canonicalPublicationJson(normalizeJsonObject(right));
}

function extractPlanContentHash(operations: unknown): string | null {
  if (!Array.isArray(operations)) return null;
  const hashes = new Set<string>();
  for (const operation of operations) {
    const record = objectRecord(operation);
    const value = record?.contentHash;
    if (typeof value === 'string' && value.trim()) hashes.add(value);
  }
  return hashes.size === 1 ? [...hashes][0]! : null;
}

function validationWarningCodes(preview: ApprovalPreviewRecord): string[] {
  const validation = objectRecord(preview.validationResult);
  return [...new Set(stringArray(validation?.warningCodes))].sort();
}

function validationAllowsApproval(preview: ApprovalPreviewRecord): boolean {
  const validation = objectRecord(preview.validationResult);
  if (!validation) return false;
  const blockingCodes = stringArray(validation.blockingCodes);
  const unconfirmedWarnings = stringArray(validation.unconfirmedWarningCodes);
  return validation.canCreatePlan === true
    && blockingCodes.length === 0
    && unconfirmedWarnings.length === 0;
}

function assertWarningsConfirmed(required: string[], supplied: string[] | undefined): void {
  if (required.length === 0) return;
  if (!supplied) fail('APPROVAL_REQUIRED', 'Publication warnings require explicit human confirmation');
  const confirmed = new Set(supplied);
  if (required.some((code) => !confirmed.has(code))) {
    fail('APPROVAL_REQUIRED', 'Every publication warning must be explicitly confirmed');
  }
}

export async function approvePublicationPlan(
  input: ApprovePublicationPlanInput,
  actor: ApprovalActorContext,
  repository: ApprovalRepository = publicationRepository
): Promise<ApprovalRecord> {
  if (!actor.actorId.trim()) {
    fail('APPROVAL_REQUIRED', 'Authenticated approver actor is required');
  }

  const plan = await repository.getPlanForApproval(input.planId);
  if (!plan || plan.projectId !== input.projectId) {
    fail('APPROVAL_STALE', 'Publication plan is unavailable or no longer belongs to this project');
  }
  if (plan.riskClass === 'HIGH') {
    fail('OPERATION_NOT_ALLOWED', 'HIGH risk publication plans cannot be approved in P8-A');
  }

  const preview = await repository.getPreviewForPlan(plan.id);
  const draftVersion = await repository.getDraftVersion(plan.draftId, plan.draftVersion);
  if (!preview || preview.projectId !== plan.projectId || !draftVersion?.contentHash) {
    fail('APPROVAL_STALE', 'Publication approval inputs are incomplete or stale');
  }

  const operationContentHash = extractPlanContentHash(plan.operations);
  if (
    input.expectedPlanHash !== plan.planHash
    || input.expectedPreviewHash !== preview.previewHash
    || input.expectedContentHash !== draftVersion.contentHash
    || operationContentHash !== draftVersion.contentHash
  ) {
    fail('APPROVAL_STALE', 'Reviewed publication hashes no longer match immutable stored facts');
  }
  if (!validationAllowsApproval(preview)) {
    fail('APPROVAL_REQUIRED', 'Deterministic validation has not cleared approval');
  }

  const warningCodes = validationWarningCodes(preview);
  assertWarningsConfirmed(warningCodes, input.confirmedWarningCodes);

  if (plan.riskClass === 'MEDIUM') {
    if (input.confirmedRisk !== 'MEDIUM' || input.confirmedWarningCodes === undefined) {
      fail('APPROVAL_REQUIRED', 'MEDIUM risk requires explicit risk and warning review acknowledgement');
    }
  }

  if (input.expiresAt && input.expiresAt.getTime() <= Date.now()) {
    fail('APPROVAL_STALE', 'Approval expiry must be in the future');
  }

  return repository.createApproval({
    projectId: plan.projectId,
    planId: plan.id,
    planVersion: plan.version,
    planHash: plan.planHash,
    contentHash: draftVersion.contentHash,
    previewHash: preview.previewHash,
    baseSha: plan.baseSha,
    approverActorId: actor.actorId,
    approvedRiskClass: plan.riskClass,
    confirmedWarningCodes: input.confirmedWarningCodes ?? [],
    expiresAt: input.expiresAt ?? null
  });
}

export function assertApprovalCurrent(
  plan: ApprovalPlanRecord,
  preview: ApprovalPreviewRecord,
  approval: ApprovalRecord,
  liveTarget: ApprovalLiveTarget,
  now: Date = new Date()
): void {
  const contentHash = extractPlanContentHash(plan.operations);
  const immutableBindingMatches =
    approval.planId === plan.id
    && approval.projectId === plan.projectId
    && approval.planVersion === plan.version
    && approval.planHash === plan.planHash
    && approval.contentVersion === plan.draftVersion
    && contentHash !== null
    && approval.contentHash === contentHash
    && preview.planId === plan.id
    && preview.projectId === plan.projectId
    && approval.previewHash === preview.previewHash
    && approval.baseSha === plan.baseSha
    && approval.targetRepository === plan.targetRepository
    && approval.targetBranch === plan.targetBranch
    && sameJson(approval.targetBlobHashes, plan.targetBlobHashes)
    && approval.approvedRiskClass === plan.riskClass;

  if (!immutableBindingMatches) {
    fail('APPROVAL_STALE', 'Publication approval no longer matches its immutable plan and preview binding');
  }
  if (approval.expiresAt && approval.expiresAt.getTime() <= now.getTime()) {
    fail('APPROVAL_STALE', 'Publication approval has expired');
  }

  const requiredWarnings = validationWarningCodes(preview);
  const confirmedWarnings = new Set(stringArray(approval.confirmedWarningCodes));
  if (requiredWarnings.some((code) => !confirmedWarnings.has(code))) {
    fail('APPROVAL_STALE', 'Publication approval no longer covers the preview warning set');
  }

  if (
    liveTarget.repositoryIdentity !== approval.targetRepository
    || liveTarget.branch !== approval.targetBranch
    || liveTarget.headSha !== approval.baseSha
  ) {
    fail('TARGET_REVISION_CHANGED', 'Live publication repository revision changed after approval');
  }

  const approvedBlobs = normalizeJsonObject(approval.targetBlobHashes);
  for (const [path, expectedBlob] of Object.entries(approvedBlobs)) {
    if (typeof expectedBlob !== 'string' || liveTarget.files[path] !== expectedBlob) {
      fail('TARGET_REVISION_CHANGED', 'A touched publication target changed after approval');
    }
  }
}
