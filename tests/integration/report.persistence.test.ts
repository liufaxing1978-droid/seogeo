import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';

describe('P5-C report persistence', () => {
  const projects: string[] = [];

  afterAll(async () => {
    for (const id of projects) await prisma.project.delete({ where: { id } }).catch(() => undefined);
  });

  it('persists versioned project report snapshots with facts and advisory data separated', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({
      data: { name: 'Report Persistence', slug: `report-${suffix}`, primaryDomain: `report-${suffix}.example.com` }
    });
    projects.push(project.id);

    const first = await prisma.reportSnapshot.create({
      data: {
        projectId: project.id,
        reportType: 'PROJECT_SUMMARY',
        reportVersion: 'PROJECT_REPORT_V1',
        factSnapshot: { seo: { score: 88 }, geo: { score: 72 } },
        advisorySnapshot: { ai: [{ taskId: 'advisory-1', summary: 'advisory only' }] },
        sourceReferences: [{ type: 'PROJECT', id: project.id }]
      }
    });
    const second = await prisma.reportSnapshot.create({
      data: {
        projectId: project.id,
        reportType: 'PROJECT_SUMMARY',
        reportVersion: 'PROJECT_REPORT_V1',
        factSnapshot: { seo: { score: 90 } },
        advisorySnapshot: { ai: [] },
        sourceReferences: [{ type: 'PROJECT', id: project.id }]
      }
    });

    expect(first.id).not.toBe(second.id);
    expect(first.executiveAiTaskId).toBeNull();
    expect(await prisma.reportSnapshot.count({ where: { projectId: project.id } })).toBe(2);
  });

  it('deleting a project removes report snapshots', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({
      data: { name: 'Report Cascade', slug: `report-cascade-${suffix}`, primaryDomain: `report-cascade-${suffix}.example.com` }
    });
    const report = await prisma.reportSnapshot.create({
      data: {
        projectId: project.id,
        reportType: 'PROJECT_SUMMARY',
        reportVersion: 'PROJECT_REPORT_V1',
        factSnapshot: {},
        advisorySnapshot: {},
        sourceReferences: []
      }
    });

    await prisma.project.delete({ where: { id: project.id } });
    expect(await prisma.reportSnapshot.findUnique({ where: { id: report.id } })).toBeNull();
  });
});
