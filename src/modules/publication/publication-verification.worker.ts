import {
  Prisma,
  type PublicationExecutionEventType,
  type PublicationExecutionStatus,
  type PublicationVerificationStatus
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import {
  fetchPublicationHtml,
  verifyPublishedTarget,
  type PublicationHtmlResponse,
  type PublicationVerificationExpectation,
  type PublicationVerificationResult
} from './publication-verifier.js';

export type PublicationVerificationJobData = {
  executionId: string;
};

type PublicationVerificationJobLike = {
  name: string;
  data: PublicationVerificationJobData;
};

export class PublicationVerificationWorkerError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'PublicationVerificationWorkerError';
  }
}

export interface PublicationVerificationContext {
  execution: {
    id: string;
    projectId: string;
    status: PublicationExecutionStatus;
  };
  expectation: PublicationVerificationExpectation;
}

interface PublicationVerificationTransition {
  executionId: string;
  fromStatus: PublicationExecutionStatus;
  toStatus: PublicationExecutionStatus;
  eventType: PublicationExecutionEventType;
  reasonCode: string;
}

export interface PublicationVerificationWorkerDeps {
  loadContext?: (executionId: string) => Promise<PublicationVerificationContext>;
  fetchTarget?: (url: string) => Promise<PublicationHtmlResponse>;
  transition?: (transition: PublicationVerificationTransition) => Promise<boolean>;
  persistObservation?: (
    context: PublicationVerificationContext,
    status: PublicationVerificationStatus,
    reasonCode: string,
    result: PublicationVerificationResult,
    observedAt: Date
  ) => Promise<void>;
  persistFinal?: (
    context: PublicationVerificationContext,
    fromStatus: 'VERIFYING',
    toStatus: 'VERIFIED' | 'VERIFICATION_FAILED' | 'DEPLOYED',
    eventType: 'VERIFIED' | 'VERIFICATION_FAILED' | 'DEPLOYED',
    reasonCode: string,
    verificationStatus: PublicationVerificationStatus,
    result: PublicationVerificationResult,
    observedAt: Date
  ) => Promise<boolean>;
  emit?: (event: Record<string, unknown>) => void;
  now?: () => Date;
}

const NOOP_STATES = new Set<PublicationExecutionStatus>([
  'VERIFIED',
  'VERIFICATION_FAILED',
  'APPROVAL_STALE',
  'TARGET_REVISION_CHANGED',
  'STALE_REVIEW_REQUIRED',
  'FAILED',
  'ROLLBACK_PROPOSED',
  'ROLLED_BACK'
]);

function fail(code: string, message: string): never {
  throw new PublicationVerificationWorkerError(code, message);
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim()))].sort();
}

function parseExpectation(targetPublicUrl: string, value: unknown): PublicationVerificationExpectation {
  const record = objectRecord(value);
  if (!record) return fail('VALIDATION_FAILED', 'Publication expected outcomes are invalid');
  const url = optionalString(record, 'publicUrl') ?? targetPublicUrl;
  const contentFingerprint = optionalString(record, 'contentFingerprint');
  if (!url || !contentFingerprint) {
    return fail('VALIDATION_FAILED', 'Publication verification requires publicUrl and contentFingerprint');
  }
  const indexable = record.indexable;
  if (typeof indexable !== 'boolean') {
    return fail('VALIDATION_FAILED', 'Publication verification requires an indexability expectation');
  }
  return {
    url,
    title: optionalString(record, 'title'),
    metaDescription: optionalString(record, 'metaDescription'),
    canonical: optionalString(record, 'canonical'),
    h1: optionalString(record, 'h1'),
    indexable,
    schemaTypes: stringArray(record.schemaTypes),
    contentFingerprint
  };
}

async function defaultLoadContext(executionId: string): Promise<PublicationVerificationContext> {
  const execution = await prisma.publicationExecution.findUnique({
    where: { id: executionId },
    include: { plan: true }
  });
  if (!execution) return fail('TARGET_NOT_FOUND', 'Publication execution was not found');
  return {
    execution: {
      id: execution.id,
      projectId: execution.projectId,
      status: execution.status
    },
    expectation: parseExpectation(execution.plan.targetPublicUrl, execution.plan.expectedOutcomes)
  };
}

async function defaultTransition(transition: PublicationVerificationTransition): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.publicationExecution.updateMany({
      where: { id: transition.executionId, status: transition.fromStatus },
      data: { status: transition.toStatus }
    });
    if (updated.count !== 1) return false;
    await tx.publicationExecutionEvent.create({
      data: {
        executionId: transition.executionId,
        eventType: transition.eventType,
        fromStatus: transition.fromStatus,
        toStatus: transition.toStatus,
        reasonCode: transition.reasonCode
      }
    });
    return true;
  });
}

function verificationData(
  context: PublicationVerificationContext,
  status: PublicationVerificationStatus,
  reasonCode: string | null,
  result: PublicationVerificationResult,
  observedAt: Date
): Prisma.PublicationVerificationUncheckedCreateInput {
  return {
    projectId: context.execution.projectId,
    executionId: context.execution.id,
    status,
    observedUrl: result.observedUrl,
    observedAt,
    httpStatus: result.httpStatus,
    titleMatches: result.titleMatches,
    descriptionMatches: result.descriptionMatches,
    canonicalMatches: result.canonicalMatches,
    h1Matches: result.h1Matches,
    indexable: result.indexable,
    schemaValid: result.schemaValid,
    contentFingerprintOk: result.contentFingerprintOk,
    regressionFindings: result.regressionFindings,
    reasonCode
  };
}

async function defaultPersistObservation(
  context: PublicationVerificationContext,
  status: PublicationVerificationStatus,
  reasonCode: string,
  result: PublicationVerificationResult,
  observedAt: Date
): Promise<void> {
  await prisma.publicationVerification.create({
    data: verificationData(context, status, reasonCode, result, observedAt)
  });
}

async function defaultPersistFinal(
  context: PublicationVerificationContext,
  fromStatus: 'VERIFYING',
  toStatus: 'VERIFIED' | 'VERIFICATION_FAILED' | 'DEPLOYED',
  eventType: 'VERIFIED' | 'VERIFICATION_FAILED' | 'DEPLOYED',
  reasonCode: string,
  verificationStatus: PublicationVerificationStatus,
  result: PublicationVerificationResult,
  observedAt: Date
): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.publicationExecution.updateMany({
      where: { id: context.execution.id, status: fromStatus },
      data: { status: toStatus }
    });
    if (updated.count !== 1) return false;
    await tx.publicationVerification.create({
      data: verificationData(
        context,
        verificationStatus,
        verificationStatus === 'VERIFIED' ? null : reasonCode,
        result,
        observedAt
      )
    });
    await tx.publicationExecutionEvent.create({
      data: {
        executionId: context.execution.id,
        eventType,
        fromStatus,
        toStatus,
        reasonCode
      }
    });
    return true;
  });
}

function deploymentObserved(
  expectation: PublicationVerificationExpectation,
  response: PublicationHtmlResponse,
  result: PublicationVerificationResult
): boolean {
  return response.status >= 200
    && response.status < 400
    && response.url === expectation.url
    && result.contentFingerprintOk;
}

function deploymentMissing(result: PublicationVerificationResult): boolean {
  return result.reasonCode === 'PAGE_NOT_FOUND'
    || result.reasonCode === 'DEPLOYED_CONTENT_MISMATCH'
    || !result.contentFingerprintOk;
}

export async function processPublicationVerificationJob(
  job: PublicationVerificationJobLike,
  deps: PublicationVerificationWorkerDeps = {}
): Promise<void> {
  if (job.name !== 'verify' || !job.data?.executionId) {
    fail('VALIDATION_FAILED', 'Publication verification job data is invalid');
  }

  const loadContext = deps.loadContext ?? defaultLoadContext;
  const fetchTarget = deps.fetchTarget ?? fetchPublicationHtml;
  const transition = deps.transition ?? defaultTransition;
  const persistObservation = deps.persistObservation ?? defaultPersistObservation;
  const persistFinal = deps.persistFinal ?? defaultPersistFinal;
  const now = deps.now ?? (() => new Date());
  const emit = deps.emit ?? (() => undefined);
  const context = await loadContext(job.data.executionId);

  if (NOOP_STATES.has(context.execution.status)) return;
  if (context.execution.status !== 'PR_CREATED' && context.execution.status !== 'DEPLOYED') {
    return fail('VALIDATION_FAILED', `Publication execution cannot be verified from ${context.execution.status}`);
  }

  let response: PublicationHtmlResponse | null = null;
  let result: PublicationVerificationResult | null = null;

  if (context.execution.status === 'PR_CREATED') {
    response = await fetchTarget(context.expectation.url);
    result = verifyPublishedTarget(context.expectation, response);
    if (!deploymentObserved(context.expectation, response, result)) {
      await persistObservation(
        context,
        'UNKNOWN',
        'DEPLOYMENT_NOT_OBSERVED',
        result,
        now()
      );
      return;
    }

    const observed = await transition({
      executionId: context.execution.id,
      fromStatus: 'PR_CREATED',
      toStatus: 'DEPLOYED',
      eventType: 'DEPLOYED',
      reasonCode: 'DEPLOYMENT_OBSERVED'
    });
    if (!observed) return;
    context.execution.status = 'DEPLOYED';
  }

  const verifying = await transition({
    executionId: context.execution.id,
    fromStatus: 'DEPLOYED',
    toStatus: 'VERIFYING',
    eventType: 'VERIFICATION_STARTED',
    reasonCode: 'VERIFICATION_STARTED'
  });
  if (!verifying) return;
  context.execution.status = 'VERIFYING';
  emit({ event: 'mutation.verification.started', executionId: context.execution.id });

  response ??= await fetchTarget(context.expectation.url);
  result ??= verifyPublishedTarget(context.expectation, response);
  const observedAt = now();

  if (result.status === 'VERIFIED') {
    await persistFinal(
      context,
      'VERIFYING',
      'VERIFIED',
      'VERIFIED',
      'VERIFICATION_PASSED',
      'VERIFIED',
      result,
      observedAt
    );
    return;
  }

  if (deploymentMissing(result)) {
    await persistFinal(
      context,
      'VERIFYING',
      'DEPLOYED',
      'DEPLOYED',
      'DEPLOYMENT_NOT_OBSERVED',
      'UNKNOWN',
      result,
      observedAt
    );
    return;
  }

  await persistFinal(
    context,
    'VERIFYING',
    'VERIFICATION_FAILED',
    'VERIFICATION_FAILED',
    result.reasonCode ?? 'VERIFICATION_FAILED',
    'FAILED',
    result,
    observedAt
  );
}
