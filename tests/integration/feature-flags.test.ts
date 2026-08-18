import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';

const app = createApp();

beforeEach(async () => {
  await prisma.project.deleteMany();
});

describe('AI Visibility feature gate', () => {
  it('denies STANDARD projects', async () => {
    const project = await prisma.project.create({ data: { name: 'Standard', slug: 'standard', primaryDomain: 'standard.com', planLevel: 'STANDARD' } });
    const response = await request(app).get(`/api/projects/${project.id}/features/ai-visibility`);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FEATURE_NOT_AVAILABLE');
  });

  it('allows ADVANCED projects', async () => {
    const project = await prisma.project.create({ data: { name: 'Advanced', slug: 'advanced', primaryDomain: 'advanced.com', planLevel: 'ADVANCED' } });
    const response = await request(app).get(`/api/projects/${project.id}/features/ai-visibility`);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ enabled: true });
  });
});
