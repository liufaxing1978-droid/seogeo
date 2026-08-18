import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';

const app = createApp();

describe('GEO overview web page', () => {
  beforeEach(async () => {
    await prisma.project.deleteMany();
  });

  it('renders a factual empty state and keeps AI Visibility waiting for P6 sampling', async () => {
    const project = await prisma.project.create({
      data: {
        name: 'GEO Project',
        slug: `geo-web-${Date.now()}`,
        primaryDomain: 'example.com'
      }
    });

    const response = await request(app).get(`/projects/${project.id}/geo`);

    expect(response.status).toBe(200);
    expect(response.text).toContain('GEO Readiness');
    expect(response.text).toContain('尚无 GEO 审计');
    expect(response.text).toContain('等待 P6 真实采样');
    expect(response.text).not.toContain('AI Visibility</div><div class="metric-value">0');
  });
});
