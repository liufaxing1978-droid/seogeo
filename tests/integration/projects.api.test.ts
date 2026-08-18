import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';

const app = createApp();

beforeEach(async () => {
  await prisma.project.deleteMany();
});

describe('project API', () => {
  it('creates a project and returns 201', async () => {
    const response = await request(app).post('/api/projects').send({ name: 'Example Project', slug: 'example-project', primaryDomain: 'example.com' });
    expect(response.status).toBe(201);
    expect(response.body.data.primaryDomain).toBe('example.com');
  });

  it('rejects an invalid slug', async () => {
    const response = await request(app).post('/api/projects').send({ name: 'Example Project', slug: 'Bad Slug', primaryDomain: 'example.com' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns projects newest first', async () => {
    await prisma.project.create({ data: { name: 'Older', slug: 'older', primaryDomain: 'older.com', createdAt: new Date('2026-08-17T00:00:00Z') } });
    await prisma.project.create({ data: { name: 'Newer', slug: 'newer', primaryDomain: 'newer.com', createdAt: new Date('2026-08-18T00:00:00Z') } });
    const response = await request(app).get('/api/projects');
    expect(response.status).toBe(200);
    expect(response.body.data.map((item: any) => item.slug)).toEqual(['newer', 'older']);
  });

  it('returns 404 for an unknown UUID', async () => {
    const response = await request(app).get('/api/projects/00000000-0000-4000-8000-000000000999');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('PROJECT_NOT_FOUND');
  });
});
