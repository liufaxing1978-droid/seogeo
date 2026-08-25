import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';

const projectIds: string[] = [];

async function tableExists(): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string | null }>>(
    `SELECT to_regclass('public."AutopilotPolicyRevision"')::text AS name`,
  );
  return rows[0]?.name !== null;
}

afterAll(async () => {
  if (!(await tableExists()).valueOf()) return;
  await prisma.$executeRawUnsafe('ALTER TABLE "AutopilotPolicyRevision" DISABLE TRIGGER "AutopilotPolicyRevision_immutable"').catch(() => undefined);
  await prisma.$executeRawUnsafe('DELETE FROM "AutopilotPolicyRevision"').catch(() => undefined);
  await prisma.$executeRawUnsafe('ALTER TABLE "AutopilotPolicyRevision" ENABLE TRIGGER "AutopilotPolicyRevision_immutable"').catch(() => undefined);
  if (projectIds.length > 0) {
    await prisma.autopilotPolicy.deleteMany({ where: { projectId: { in: projectIds } } }).catch(() => undefined);
    await prisma.project.deleteMany({ where: { id: { in: projectIds } } }).catch(() => undefined);
  }
});

describe('P9-F Autopilot Policy Revision persistence', () => {
  it('deploys the immutable revision table and required unique/index contracts', async () => {
    expect(await tableExists()).toBe(true);

    const indexes = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'AutopilotPolicyRevision' ORDER BY indexname`,
    );
    const names = indexes.map((row) => row.indexname);
    expect(names).toContain('AutopilotPolicyRevision_projectId_requestId_key');
    expect(names).toContain('AutopilotPolicyRevision_projectId_revisionKey_key');
    expect(names).toContain('AutopilotPolicyRevision_projectId_createdAt_idx');

    const triggers = await prisma.$queryRawUnsafe<Array<{ tgname: string }>>(
      `SELECT tgname FROM pg_trigger WHERE tgrelid = '"AutopilotPolicyRevision"'::regclass AND NOT tgisinternal ORDER BY tgname`,
    );
    expect(triggers.map((row) => row.tgname)).toContain('AutopilotPolicyRevision_immutable');
  });

  it('rejects UPDATE and DELETE after a revision is inserted', async () => {
    expect(await tableExists()).toBe(true);

    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const project = await prisma.project.create({
      data: {
        name: `P9-F persistence ${suffix}`,
        slug: `p9f-persistence-${suffix}`,
        primaryDomain: `p9f-persistence-${suffix}.example.com`,
        planLevel: 'ADVANCED',
      },
    });
    projectIds.push(project.id);
    const policy = await prisma.autopilotPolicy.create({
      data: {
        projectId: project.id,
        enabled: true,
        enabledBy: 'fixture',
        updatedBy: 'fixture',
      },
    });
    const revisionId = '11111111-1111-4111-8111-111111111111';
    const requestId = '22222222-2222-4222-8222-222222222222';

    await prisma.$executeRawUnsafe(
      `INSERT INTO "AutopilotPolicyRevision" (
        "id", "projectId", "policyId", "revisionVersion", "requestId", "revisionKey",
        "previousPolicyUpdatedAt", "appliedPolicyUpdatedAt", "beforeSnapshotJson", "afterSnapshotJson",
        "actorId", "createdAt"
      ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6, NULL, $7, NULL, $8::jsonb, $9, $7)`,
      revisionId,
      project.id,
      policy.id,
      'AUTOPILOT_POLICY_REVISION_V1',
      requestId,
      'a'.repeat(64),
      new Date('2026-08-25T12:00:00.000Z'),
      JSON.stringify({ enabled: true }),
      'operator:fixture',
    );

    await expect(prisma.$executeRawUnsafe(
      'UPDATE "AutopilotPolicyRevision" SET "actorId" = $1 WHERE "id" = $2::uuid',
      'mutated',
      revisionId,
    )).rejects.toThrow(/immutable/i);

    await expect(prisma.$executeRawUnsafe(
      'DELETE FROM "AutopilotPolicyRevision" WHERE "id" = $1::uuid',
      revisionId,
    )).rejects.toThrow(/immutable/i);
  });
});
