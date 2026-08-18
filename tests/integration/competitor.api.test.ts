import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';

describe('P5-B competitor API', () => {
  const projects: string[] = [];

  afterAll(async () => {
    for (const id of projects) await prisma.project.delete({ where: { id } }).catch(() => undefined);
  });

  it('registers and lists deterministic competitors for a Standard project', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({
      data: {
        name: 'Competitor API',
        slug: `competitor-api-${suffix}`,
        primaryDomain: `owned-${suffix}.example.com`,
        planLevel: 'STANDARD'
      }
    });
    projects.push(project.id);

    const app = createApp();
    const created = await request(app)
      .post(`/api/v1/projects/${project.id}/competitors`)
      .send({ name: 'Reference Site', domain: `reference-${suffix}.example.com` })
      .expect(201);

    expect(created.body.data.domain).toBe(`reference-${suffix}.example.com`);

    const listed = await request(app)
      .get(`/api/v1/projects/${project.id}/competitors`)
      .expect(200);

    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].name).toBe('Reference Site');
  });
});
