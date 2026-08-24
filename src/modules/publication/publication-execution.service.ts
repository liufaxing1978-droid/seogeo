import { createHash } from 'node:crypto';
import { Prisma, type PublicationExecution } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

export const PUBLICATION_EXECUTION_KEY_VERSION = 'PUBLICATION_EXECUTION_KEY_V2' as const;
export type PublicationExecutionAuthorizationKind = 'HUMAN_APPROVAL' | 'AUTOMATION_AUTHORIZATION';

export class PublicationExecutionServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'PublicationExecutionServiceError';
  }
}

function fail(code: string, message: string): never {
  throw new PublicationExecutionServiceError(code, message);
}

export function buildPublicationExecutionKeyV2(input: {
  authorizationKind: PublicationExecutionAuthorizationKind;
  planId: string;
  authorizationId: string;
  planHash: string;
}): string {
  return createHash('sha256')
    .update(`${PUBLICATION_EXECUTION_KEY_VERSION}\0`, 'utf8')
    .update(input.authorizationKind, 'utf8')
    .update('\0', 'utf8')
    .update(input.planId, 'utf8')
    .update('\0', 'utf8')
    .update(input.authorizationId, 'utf8')
    .update('\0', 'utf8')
    .update(input.planHash, 'utf8')
    .digest('hex');
}

function isUniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function executionMatches(
  execution: PublicationExecution,
  expected: {
    projectId: string;
    planId: string;
    approvalId: string | null;
    automationAuthorizationId: string | null;
    executionKey: string;
  }
): boolean {
  return execution.projectId === expected.projectId
    && execution.planId === expected.planId
    && execution.approvalId === expected.approvalId
    && execution.automationAuthorizationId === expected.automationAuthorizationId
    && execution.executionKey === expected.executionKey;
}

async function createOrGetExecution(input: {
  projectId: string;
  planId: string;
  approvalId: string | null;
  automationAuthorizationId: string | null;
  executionKey: string;
  status: 'APPROVED' | 'AUTOMATION_AUTHORIZED';
}): Promise<PublicationExecution> {
  const existing = await prisma.publicationExecution.findUnique({
    where: { executionKey: input.executionKey }
  });
  if (existing) {
    if (!executionMatches(existing, input)) {
      fail('PUBLICATION_EXECUTION_IDENTITY_COLLISION', 'Existing publication execution does not match the typed authorization binding');
    }
    return existing;
  }

  try {
    return await prisma.publicationExecution.create({
      data: {
        projectId: input.projectId,
        planId: input.planId,
        approvalId: input.approvalId,
        automationAuthorizationId: input.automationAuthorizationId,
        executionKey: input.executionKey,
        status: input.status
      }
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const raced = await prisma.publicationExecution.findUnique({
      where: { executionKey: input.executionKey }
    });
    if (!raced || !executionMatches(raced, input)) {
      fail('PUBLICATION_EXECUTION_IDENTITY_COLLISION', 'Concurrent publication execution does not match the typed authorization binding');
    }
    return raced;
  }
}

export class PublicationExecutionService {
  async createHumanApprovedExecution(input: {
    projectId: string;
    planId: string;
  }): Promise<PublicationExecution> {
    const plan = await prisma.publicationPlan.findFirst({
      where: { id: input.planId, projectId: input.projectId },
      select: { id: true, version: true, planHash: true }
    });
    if (!plan) fail('PUBLICATION_PLAN_NOT_FOUND', 'Publication plan was not found');

    const approval = await prisma.publicationApproval.findFirst({
      where: { projectId: input.projectId, planId: plan.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }]
    });
    if (!approval) fail('APPROVAL_REQUIRED', 'Publication plan requires human approval before execution');
    if (approval.planVersion !== plan.version || approval.planHash !== plan.planHash) {
      fail('APPROVAL_STALE', 'Latest human publication approval does not match the current immutable plan');
    }

    const executionKey = buildPublicationExecutionKeyV2({
      authorizationKind: 'HUMAN_APPROVAL',
      planId: plan.id,
      authorizationId: approval.id,
      planHash: plan.planHash
    });
    return createOrGetExecution({
      projectId: input.projectId,
      planId: plan.id,
      approvalId: approval.id,
      automationAuthorizationId: null,
      executionKey,
      status: 'APPROVED'
    });
  }

  async createAutomationAuthorizedExecution(input: {
    projectId: string;
    planId: string;
    automationAuthorizationId: string;
  }): Promise<PublicationExecution> {
    const plan = await prisma.publicationPlan.findFirst({
      where: { id: input.planId, projectId: input.projectId },
      select: { id: true, version: true, planHash: true }
    });
    if (!plan) fail('PUBLICATION_PLAN_NOT_FOUND', 'Publication plan was not found');

    const authorization = await prisma.publicationAutomationAuthorization.findUnique({
      where: { id: input.automationAuthorizationId }
    });
    if (
      !authorization
      || authorization.projectId !== input.projectId
      || authorization.planId !== plan.id
      || authorization.planVersion !== plan.version
      || authorization.planHash !== plan.planHash
      || authorization.authorizedRiskClass !== 'LOW'
      || authorization.automationSource !== 'CONTROLLED_AUTOPILOT'
    ) {
      fail('AUTOMATION_AUTHORIZATION_STALE', 'Machine publication authorization does not match the current immutable plan');
    }

    const executionKey = buildPublicationExecutionKeyV2({
      authorizationKind: 'AUTOMATION_AUTHORIZATION',
      planId: plan.id,
      authorizationId: authorization.id,
      planHash: plan.planHash
    });
    return createOrGetExecution({
      projectId: input.projectId,
      planId: plan.id,
      approvalId: null,
      automationAuthorizationId: authorization.id,
      executionKey,
      status: 'AUTOMATION_AUTHORIZED'
    });
  }
}

export const publicationExecutionService = new PublicationExecutionService();
