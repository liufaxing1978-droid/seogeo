import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient, type GrowthLifecycleStatus } from '@prisma/client';
import { GrowthRepository } from '../../src/modules/growth/growth.repository.js';
import { reconcileOpportunityLifecycle } from '../../src/modules/growth/growth.service.js';

const prisma = new PrismaClient();
const repository = new GrowthRepository();

describe('P7-A Growth lifecycle reconciliation', () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let projectId = '';

  beforeAll(async () => {
    const project = await prisma.project.create({
      data: {
        name: `Growth lifecycle ${suffix}`,
        slug: `growth-lifecycle-${suffix}`,
        primaryDomain: `growth-lifecycle-${suffix}.example.com`
      }
    });
    projectId = project.id;
  });

  afterAll(async () => {
    if (projectId) {
      await prisma.growthOpportunityLifecycleEvent.deleteMany({ where: { identity: { projectId } } });
      await prisma.growthOpportunityLifecycle.deleteMany({ where: { identity: { projectId } } });
      await prisma.growthOpportunityIdentity.deleteMany({ where: { projectId } });
      await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  async function identity(status: GrowthLifecycleStatus) {
    const row = await repository.getOrCreateOpportunityIdentity({
      projectId,
      identityType: 'QUERY_PAGE_GROWTH',
      normalizedQuery: `q-${randomUUID()}`,
      canonicalPage: `https://example.com/${randomUUID()}`
    });
    await prisma.growthOpportunityLifecycle.create({
      data: { opportunityIdentityId: row.id, status }
    });
    return row;
  }

  it('advances latestSnapshotId without rewriting the stable identity', async () => {
    const row = await identity('NEW');
    const snapshotId = randomUUID();
    await reconcileOpportunityLifecycle(row.id, { id: snapshotId, actionable: true }, [{ actionable: true }]);
    const lifecycle = await prisma.growthOpportunityLifecycle.findUniqueOrThrow({ where: { opportunityIdentityId: row.id } });
    expect(lifecycle.status).toBe('NEW');
    expect(lifecycle.latestSnapshotId).toBe(snapshotId);
  });

  it('AUTO_RESOLVES after two consecutive non-actionable stable windows', async () => {
    const row = await identity('REVIEWED');
    await reconcileOpportunityLifecycle(row.id, { id: null, actionable: false }, [
      { actionable: false }, { actionable: false }
    ]);
    const lifecycle = await prisma.growthOpportunityLifecycle.findUniqueOrThrow({ where: { opportunityIdentityId: row.id } });
    expect(lifecycle.status).toBe('RESOLVED');
    expect(await prisma.growthOpportunityLifecycleEvent.findFirst({
      where: { opportunityIdentityId: row.id, eventType: 'AUTO_RESOLVED' }
    })).not.toBeNull();
  });

  it.each(['DONE', 'RESOLVED'] as const)('AUTO_REOPENs recurrence after %s', async (status) => {
    const row = await identity(status);
    const snapshotId = randomUUID();
    await reconcileOpportunityLifecycle(row.id, { id: snapshotId, actionable: true }, [{ actionable: true }]);
    const lifecycle = await prisma.growthOpportunityLifecycle.findUniqueOrThrow({ where: { opportunityIdentityId: row.id } });
    expect(lifecycle.status).toBe('REOPENED');
    expect(lifecycle.latestSnapshotId).toBe(snapshotId);
    expect(await prisma.growthOpportunityLifecycleEvent.findFirst({
      where: { opportunityIdentityId: row.id, eventType: 'AUTO_REOPENED' }
    })).not.toBeNull();
  });

  it('keeps DISMISSED dismissed even if the opportunity recurs', async () => {
    const row = await identity('DISMISSED');
    await reconcileOpportunityLifecycle(row.id, { id: randomUUID(), actionable: true }, [{ actionable: true }]);
    const lifecycle = await prisma.growthOpportunityLifecycle.findUniqueOrThrow({ where: { opportunityIdentityId: row.id } });
    expect(lifecycle.status).toBe('DISMISSED');
  });

  it.each(['PLANNED', 'IN_PROGRESS'] as const)('never auto-marks %s as DONE', async (status) => {
    const row = await identity(status);
    await reconcileOpportunityLifecycle(row.id, { id: randomUUID(), actionable: true }, [{ actionable: true }]);
    const lifecycle = await prisma.growthOpportunityLifecycle.findUniqueOrThrow({ where: { opportunityIdentityId: row.id } });
    expect(lifecycle.status).toBe(status);
    expect(lifecycle.status).not.toBe('DONE');
  });
});
