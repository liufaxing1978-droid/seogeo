import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';
import { PROJECT_REPORT_VERSION, PROJECT_REPORT_V2_VERSION } from '../../src/modules/reporting/report-builder.js';

const app = createApp();
const projectIds: string[] = [];

async function createAdvancedProject(label: string) {
  const suffix = `${label}-${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: `Report V2 Route ${label}`,
      slug: `report-v2-route-${suffix}`,
      primaryDomain: `report-v2-route-${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });
  projectIds.push(project.id);
  return project;
}

afterAll(async () => {
  for (const projectId of projectIds) {
    await prisma.reportSnapshot.deleteMany({ where: { projectId } });
    await prisma.project.delete({ where: { id: projectId } });
  }
});

describe('PROJECT_REPORT_V2 routes and rendering', () => {
  it('keeps the legacy API generator on V1 and exposes an explicit V2 generator', async () => {
    const project = await createAdvancedProject('api');

    const legacy = await request(app).post(`/api/v1/projects/${project.id}/reports`);
    expect(legacy.status).toBe(201);
    expect(legacy.body.data.reportVersion).toBe(PROJECT_REPORT_VERSION);

    const v2 = await request(app).post(`/api/v1/projects/${project.id}/reports/v2`);
    expect(v2.status).toBe(201);
    expect(v2.body.data.reportVersion).toBe(PROJECT_REPORT_V2_VERSION);
  });

  it('exposes an explicit V2 web generator without changing the legacy web generator', async () => {
    const project = await createAdvancedProject('web');

    const legacy = await request(app).post(`/projects/${project.id}/reports`);
    expect(legacy.status).toBe(303);
    expect(await prisma.reportSnapshot.count({ where: { projectId: project.id, reportVersion: PROJECT_REPORT_VERSION } })).toBe(1);

    const v2 = await request(app).post(`/projects/${project.id}/reports/v2`);
    expect(v2.status).toBe(303);
    expect(v2.headers.location).toBe(`/projects/${project.id}/reports`);
    expect(await prisma.reportSnapshot.count({ where: { projectId: project.id, reportVersion: PROJECT_REPORT_V2_VERSION } })).toBe(1);
  });

  it('renders a persisted V2 visibility section without converting UNKNOWN into zero', async () => {
    const project = await createAdvancedProject('render');
    const report = await prisma.reportSnapshot.create({
      data: {
        projectId: project.id,
        reportType: 'PROJECT_SUMMARY',
        reportVersion: PROJECT_REPORT_V2_VERSION,
        factSnapshot: {
          project: { id: project.id, name: project.name, primaryDomain: project.primaryDomain },
          seo: { score: null, openIssues: { total: 0, bySeverity: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 } } },
          geo: { score: null },
          content: { documentCount: 0, openOpportunityCount: 0, byPriority: { HIGH: 0, MEDIUM: 0, LOW: 0 } },
          competitors: { count: 0, comparedCount: 0, gapStates: { AHEAD: 0, BEHIND: 0, EVEN: 0, UNKNOWN: 0 } },
          visibility: {
            snapshot: { id: 'snapshot-safe', formulaVersion: 'VISIBILITY_METRICS_V1', extractorVersion: 'P6B_EXTRACTION_V1', windowStart: '2026-08-01T00:00:00.000Z', windowEnd: '2026-08-08T00:00:00.000Z', inputCutoffAt: '2026-08-08T00:00:00.000Z', completedAt: '2026-08-09T00:00:00.000Z' },
            metrics: {
              mentionRate: { status: 'UNKNOWN', numerator: 0, denominator: 0, ratio: null },
              citationRate: { status: 'CALCULATED', numerator: 2, denominator: 10, ratio: 0.2 },
              ownedSov: { status: 'CALCULATED', numerator: 4, denominator: 10, ratio: 0.4 }
            },
            competitorSov: [],
            evidenceCoverage: { completedExtractionCount: 8, candidateObservationCount: 10, ratio: 0.8 },
            comparison: null,
            alerts: { openTotal: 1, bySeverity: { INFO: 0, WARNING: 1, CRITICAL: 0 } }
          }
        },
        advisorySnapshot: { ai: [] },
        sourceReferences: [{ type: 'PROJECT', id: project.id }]
      }
    });

    const response = await request(app).get(`/projects/${project.id}/reports/${report.id}`);
    expect(response.status).toBe(200);
    expect(response.text).toContain('AI Visibility');
    expect(response.text).toContain('Mention Rate');
    expect(response.text).toContain('UNKNOWN');
    expect(response.text).toContain('20.0%');
    expect(response.text).toContain('Evidence Coverage');
    expect(response.text).toContain('80.0%');
  });
});
