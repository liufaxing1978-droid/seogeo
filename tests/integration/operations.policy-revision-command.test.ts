import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import {
  reviseAutopilotPolicy,
  type PolicyRevisionCommandEvent,
} from '../../src/modules/optimization-operations/policy-revision.command.js';

const projectIds: string[] = [];

async function createProject(label: string) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.project.create({
    data: {
      name: `P9-F command ${label} ${suffix}`,
      slug: `p9f-command-${label}-${suffix}`,
      primaryDomain: `p9f-command-${label}-${suffix}.example.com`,
      planLevel: 'ADVANCED',
    },
  });
  projectIds.push(project.id);
  return project;
}

async function installForcedRevisionFailureTrigger(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION "p9f_test_reject_policy_revision_insert"()
    RETURNS trigger AS $$
    BEGIN
      IF NEW."actorId" = 'operator:force-revision-failure' THEN
        RAISE EXCEPTION 'forced revision insert failure';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await prisma.$executeRawUnsafe(`
    DROP TRIGGER IF EXISTS "p9f_test_reject_policy_revision_insert" ON "AutopilotPolicyRevision";
    CREATE TRIGGER "p9f_test_reject_policy_revision_insert"
    BEFORE INSERT ON "AutopilotPolicyRevision"
    FOR EACH ROW EXECUTE FUNCTION "p9f_test_reject_policy_revision_insert"();
  `);
}

async function removeForcedRevisionFailureTrigger(): Promise<void> {
  await prisma.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS "p9f_test_reject_policy_revision_insert" ON "AutopilotPolicyRevision"',
  ).catch(() => undefined);
  await prisma.$executeRawUnsafe(
    'DROP FUNCTION IF EXISTS "p9f_test_reject_policy_revision_insert"()',
  ).catch(() => undefined);
}

afterAll(async () => {
  await removeForcedRevisionFailureTrigger();
  if (projectIds.length === 0) return;

  await prisma.$executeRawUnsafe(
    'ALTER TABLE "AutopilotPolicyRevision" DISABLE TRIGGER "AutopilotPolicyRevision_immutable"',
  ).catch(() => undefined);
  await prisma.autopilotPolicyRevision.deleteMany({
    where: { projectId: { in: projectIds } },
  }).catch(() => undefined);
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "AutopilotPolicyRevision" ENABLE TRIGGER "AutopilotPolicyRevision_immutable"',
  ).catch(() => undefined);
  await prisma.autopilotPolicy.deleteMany({
    where: { projectId: { in: projectIds } },
  }).catch(() => undefined);
  await prisma.project.deleteMany({
    where: { id: { in: projectIds } },
  }).catch(() => undefined);
});

describe('P9-F Policy Revision command', () => {
  it('atomically applies a normalized policy revision and emits structured observability', async () => {
    const project = await createProject('apply');
    const requestId = '10000000-0000-4000-8000-000000000001';
    const events: PolicyRevisionCommandEvent[] = [];

    const result = await reviseAutopilotPolicy({
      projectId: project.id,
      requestId,
      expectedUpdatedAt: null,
      actorId: 'operator:task-34',
      policy: {
        enabled: true,
        allowedOperationClasses: ['CREATE_CONTENT_PAGE', 'CREATE_CONTENT_PAGE'],
        dailyDraftPrLimit: 4,
        maxConcurrentRuns: 2,
      },
    }, { observe: (event) => events.push(event) });

    expect(result.status).toBe('APPLIED');
    expect(result.commandFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.revisionKey).toMatch(/^[a-f0-9]{64}$/);

    const policy = await prisma.autopilotPolicy.findUniqueOrThrow({
      where: { projectId: project.id },
    });
    expect(policy.allowedOperationClasses).toEqual(['CREATE_CONTENT_PAGE']);
    expect(policy.allowedRiskClass).toBe('LOW');
    expect(policy.dailyDraftPrLimit).toBe(4);
    expect(policy.maxConcurrentRuns).toBe(2);
    expect(policy.requireFreshEvidence).toBe(true);
    expect(policy.minimumEvidenceCoverage).toBe(70);
    expect(policy.pauseOnVerificationFailure).toBe(true);
    expect(policy.killSwitch).toBe(false);
    expect(policy.updatedBy).toBe('operator:task-34');

    const revision = await prisma.autopilotPolicyRevision.findUniqueOrThrow({
      where: { projectId_requestId: { projectId: project.id, requestId } },
    });
    expect(revision.policyId).toBe(policy.id);
    expect(revision.previousPolicyUpdatedAt).toBeNull();
    expect(revision.appliedPolicyUpdatedAt.toISOString()).toBe(policy.updatedAt.toISOString());
    expect(revision.revisionKey).toBe(result.revisionKey);
    expect(revision.beforeSnapshotJson).toBeNull();
    expect(revision.afterSnapshotJson).toMatchObject({
      version: 'CONTROLLED_AUTOPILOT_POLICY_V1',
      enabled: true,
      allowedRiskClass: 'LOW',
      allowedOperationClasses: ['CREATE_CONTENT_PAGE'],
      dailyDraftPrLimit: 4,
      maxConcurrentRuns: 2,
    });

    expect(events).toEqual([
      expect.objectContaining({
        type: 'AUTOPILOT_POLICY_REVISION_APPLIED',
        projectId: project.id,
        requestId,
        actorId: 'operator:task-34',
        revisionKey: result.revisionKey,
        commandFingerprint: result.commandFingerprint,
      }),
    ]);
  });

  it('fails stale optimistic concurrency before any policy or revision mutation', async () => {
    const project = await createProject('cas');
    const existing = await prisma.autopilotPolicy.create({
      data: {
        projectId: project.id,
        enabled: false,
        updatedBy: 'fixture',
      },
    });
    const events: PolicyRevisionCommandEvent[] = [];

    await expect(reviseAutopilotPolicy({
      projectId: project.id,
      requestId: '20000000-0000-4000-8000-000000000001',
      expectedUpdatedAt: '2026-01-01T00:00:00.000Z',
      actorId: 'operator:task-34',
      policy: { enabled: true },
    }, { observe: (event) => events.push(event) })).rejects.toThrow(
      'AUTOPILOT_POLICY_REVISION_CONFLICT',
    );

    const unchanged = await prisma.autopilotPolicy.findUniqueOrThrow({
      where: { projectId: project.id },
    });
    expect(unchanged.updatedAt.toISOString()).toBe(existing.updatedAt.toISOString());
    expect(unchanged.enabled).toBe(false);
    await expect(prisma.autopilotPolicyRevision.count({
      where: { projectId: project.id },
    })).resolves.toBe(0);
    expect(events).toEqual([
      expect.objectContaining({
        type: 'AUTOPILOT_POLICY_REVISION_REJECTED',
        reasonCode: 'OPTIMISTIC_CONCURRENCY_CONFLICT',
        projectId: project.id,
      }),
    ]);
  });

  it('replays the same request idempotently and rejects request-id payload collisions', async () => {
    const project = await createProject('idempotency');
    const requestId = '30000000-0000-4000-8000-000000000001';
    const events: PolicyRevisionCommandEvent[] = [];
    const input = {
      projectId: project.id,
      requestId,
      expectedUpdatedAt: null,
      actorId: 'operator:task-34',
      policy: { enabled: true, dailyDraftPrLimit: 5 },
    } as const;

    const first = await reviseAutopilotPolicy(input, {
      observe: (event) => events.push(event),
    });
    const firstPolicy = await prisma.autopilotPolicy.findUniqueOrThrow({
      where: { projectId: project.id },
    });
    const second = await reviseAutopilotPolicy(input, {
      observe: (event) => events.push(event),
    });
    const secondPolicy = await prisma.autopilotPolicy.findUniqueOrThrow({
      where: { projectId: project.id },
    });

    expect(first.status).toBe('APPLIED');
    expect(second.status).toBe('IDEMPOTENT_REPLAY');
    expect(second.revisionId).toBe(first.revisionId);
    expect(second.revisionKey).toBe(first.revisionKey);
    expect(secondPolicy.updatedAt.toISOString()).toBe(firstPolicy.updatedAt.toISOString());
    await expect(prisma.autopilotPolicyRevision.count({
      where: { projectId: project.id },
    })).resolves.toBe(1);

    await expect(reviseAutopilotPolicy({
      ...input,
      policy: { enabled: true, dailyDraftPrLimit: 6 },
    }, { observe: (event) => events.push(event) })).rejects.toThrow(
      'AUTOPILOT_POLICY_REVISION_IDEMPOTENCY_CONFLICT',
    );
    await expect(prisma.autopilotPolicyRevision.count({
      where: { projectId: project.id },
    })).resolves.toBe(1);

    expect(events.map((event) => event.type)).toEqual([
      'AUTOPILOT_POLICY_REVISION_APPLIED',
      'AUTOPILOT_POLICY_REVISION_IDEMPOTENT_REPLAY',
      'AUTOPILOT_POLICY_REVISION_REJECTED',
    ]);
    expect(events.at(-1)).toMatchObject({
      reasonCode: 'IDEMPOTENCY_CONFLICT',
      projectId: project.id,
      requestId,
    });
  });

  it('fails closed on a missing actor without touching policy state', async () => {
    const project = await createProject('actor');
    const events: PolicyRevisionCommandEvent[] = [];

    await expect(reviseAutopilotPolicy({
      projectId: project.id,
      requestId: '40000000-0000-4000-8000-000000000001',
      expectedUpdatedAt: null,
      actorId: '   ',
      policy: { enabled: true },
    }, { observe: (event) => events.push(event) })).rejects.toThrow(
      'AUTOPILOT_POLICY_REVISION_ACTOR_REQUIRED',
    );

    await expect(prisma.autopilotPolicy.count({
      where: { projectId: project.id },
    })).resolves.toBe(0);
    await expect(prisma.autopilotPolicyRevision.count({
      where: { projectId: project.id },
    })).resolves.toBe(0);
    expect(events).toEqual([
      expect.objectContaining({
        type: 'AUTOPILOT_POLICY_REVISION_REJECTED',
        reasonCode: 'ACTOR_REQUIRED',
        projectId: project.id,
        requestId: '40000000-0000-4000-8000-000000000001',
        actorId: null,
      }),
    ]);
  });

  it('rolls back the policy write when immutable revision persistence fails', async () => {
    const project = await createProject('rollback');
    await installForcedRevisionFailureTrigger();

    await expect(reviseAutopilotPolicy({
      projectId: project.id,
      requestId: '50000000-0000-4000-8000-000000000001',
      expectedUpdatedAt: null,
      actorId: 'operator:force-revision-failure',
      policy: { enabled: true },
    })).rejects.toThrow(/forced revision insert failure/i);

    await expect(prisma.autopilotPolicy.count({
      where: { projectId: project.id },
    })).resolves.toBe(0);
    await expect(prisma.autopilotPolicyRevision.count({
      where: { projectId: project.id },
    })).resolves.toBe(0);

    await removeForcedRevisionFailureTrigger();
  });
});
