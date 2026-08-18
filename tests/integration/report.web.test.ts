import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';

describe('P5-C Report Center web', () => {
  const projects: string[] = [];

  afterAll(async () => {
    for (const id of projects) await prisma.project.delete({ where: { id } }).catch(() => undefined);
  });

  it('renders report facts separately from advisory summaries', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({
      data: { name: 'Report Web', slug: `report-web-${suffix}`, primaryDomain: `report-web-${suffix}.example.com`, planLevel: 'STANDARD' }
    });
    projects.push(project.id);
    const report = await prisma.reportSnapshot.create({
      data: {
        projectId: project.id,
        reportType: 'PROJECT_SUMMARY',
        reportVersion: 'PROJECT_REPORT_V1',
        factSnapshot: {
          project: { id: project.id, name: project.name, primaryDomain: project.primaryDomain },
          seo: { score: { value: 91 }, openIssues: { total: 2, bySeverity: { CRITICAL: 0, HIGH: 1, MEDIUM: 1, LOW: 0 } } },
          geo: { auditId: null, score: null },
          content: { documentCount: 8, openOpportunityCount: 3, byPriority: { HIGH: 1, MEDIUM: 2, LOW: 0 } },
          competitors: { count: 2, comparedCount: 1, gapStates: { AHEAD: 2, BEHIND: 1, EVEN: 3, UNKNOWN: 1 } }
        },
        advisorySnapshot: { ai: [{ taskId: 'task-1', taskType: 'SEO_AUDIT_ANALYSIS', resultId: 'result-1', summary: 'Advisory SEO summary', sourceReferences: [] }] },
        sourceReferences: [{ type: 'PROJECT', id: project.id }]
      }
    });

    const app = createApp();
    const center = await request(app).get(`/projects/${project.id}/reports`).expect(200);
    expect(center.text).toContain('报告中心');
    expect(center.text).toContain('PROJECT_REPORT_V1');

    const detail = await request(app).get(`/projects/${project.id}/reports/${report.id}`).expect(200);
    expect(detail.text).toContain('确定性事实');
    expect(detail.text).toContain('AI 建议 / Executive Summary');
    expect(detail.text).toContain('91');
    expect(detail.text).toContain('Advisory SEO summary');
    expect(detail.text).toContain('UNKNOWN');
  });
});
