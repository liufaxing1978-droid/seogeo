import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';

describe('P5-C report API', () => {
  const projects: string[] = [];

  afterAll(async () => {
    for (const id of projects) await prisma.project.delete({ where: { id } }).catch(() => undefined);
  });

  it('generates, lists, reads and exports a Standard-plan project report', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({
      data: { name: 'Report API', slug: `report-api-${suffix}`, primaryDomain: `report-api-${suffix}.example.com`, planLevel: 'STANDARD' }
    });
    projects.push(project.id);

    const app = createApp();
    const generated = await request(app).post(`/api/v1/projects/${project.id}/reports`).send({}).expect(201);
    expect(generated.body.data.reportVersion).toBe('PROJECT_REPORT_V1');
    const reportId = generated.body.data.id;

    const listed = await request(app).get(`/api/v1/projects/${project.id}/reports`).expect(200);
    expect(listed.body.data).toHaveLength(1);

    const detail = await request(app).get(`/api/v1/projects/${project.id}/reports/${reportId}`).expect(200);
    expect(detail.body.data.id).toBe(reportId);
    expect(detail.body.data.factSnapshot.project.id).toBe(project.id);

    const exported = await request(app).get(`/api/v1/projects/${project.id}/reports/${reportId}/export.json`).expect(200);
    expect(exported.headers['content-disposition']).toContain(`report-${reportId}.json`);
    expect(exported.body.reportVersion).toBe('PROJECT_REPORT_V1');
    expect(JSON.stringify(exported.body.factSnapshot)).not.toContain('aiVisibility');
  });
});
