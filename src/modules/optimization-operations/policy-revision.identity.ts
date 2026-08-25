import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { NormalizedAutopilotPolicy } from '../optimization-autopilot/autopilot.types.js';

export const AUTOPILOT_POLICY_REVISION_VERSION = 'AUTOPILOT_POLICY_REVISION_V1' as const;

const uuidSchema = z.string().uuid();
const canonicalIsoSchema = z.string().datetime({ offset: true }).refine(
  (value) => new Date(value).toISOString() === value,
  'Expected timestamp must be canonical ISO-8601 UTC',
);
const actorIdSchema = z.string().trim().min(1).max(160);
const safeInteger = (min: number, max: number) => z.number()
  .int()
  .min(min)
  .max(max)
  .refine((value) => !Object.is(value, -0), 'Negative zero is not allowed');

const normalizedPolicySchema = z.object({
  enabled: z.boolean(),
  allowedRiskClass: z.literal('LOW'),
  allowedOperationClasses: z.tuple([z.literal('CREATE_CONTENT_PAGE')]),
  dailyDraftPrLimit: safeInteger(1, 10),
  maxConcurrentRuns: safeInteger(1, 3),
  requireFreshEvidence: z.boolean(),
  minimumEvidenceCoverage: safeInteger(70, 100),
  pauseOnVerificationFailure: z.boolean(),
  killSwitch: z.boolean(),
}).strict();

const identityInputSchema = z.object({
  revisionVersion: z.literal(AUTOPILOT_POLICY_REVISION_VERSION),
  projectId: uuidSchema,
  requestId: uuidSchema,
  expectedUpdatedAt: canonicalIsoSchema.nullable(),
  actorId: actorIdSchema,
  normalizedPolicy: normalizedPolicySchema,
}).strict();

export type PolicyRevisionIdentityInput = {
  revisionVersion: typeof AUTOPILOT_POLICY_REVISION_VERSION;
  projectId: string;
  requestId: string;
  expectedUpdatedAt: string | null;
  actorId: string;
  normalizedPolicy: NormalizedAutopilotPolicy;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}

function sha256(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

export function buildAutopilotPolicyRevisionIdentity(
  input: PolicyRevisionIdentityInput,
): { revisionKey: string; commandFingerprint: string } {
  const parsed = identityInputSchema.parse(input);
  const commandFingerprint = sha256({
    revisionVersion: parsed.revisionVersion,
    projectId: parsed.projectId,
    expectedUpdatedAt: parsed.expectedUpdatedAt,
    actorId: parsed.actorId,
    normalizedPolicy: parsed.normalizedPolicy,
  });
  const revisionKey = sha256({
    revisionVersion: parsed.revisionVersion,
    projectId: parsed.projectId,
    requestId: parsed.requestId,
    commandFingerprint,
  });

  return { revisionKey, commandFingerprint };
}
