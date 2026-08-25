import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';
import { seedGrowthDashboardFacts } from '../helpers/growth-dashboard-fixture.js';

const app = createApp();

beforeEach(async () => {
  await prisma.project.deleteMany();
});

async function createProject(
  planLevel: 'STANDARD' | 'ADVANCED' | 'ENTERPRISE',
  label: string
) {
  const suffix = `${label}-${Date.now()}-${Math.random()}`;
  return prisma.project.create({
    data: {
      name: `Web ${label}`,
      slug: `web-${suffix}`,
      primaryDomain: `web-${suffix}.example.com`,
      planLevel
    }
  });
}

describe('admin web UI', () => {
  it('renders the approved dashboard shell', async () => {
    const response = await request(app).get('/');
    expect(response.status).toBe(200);
    for (const text of ['SEO GEO', '概览', '项目', 'SEO', 'GEO', 'AI Visibility', 'DeepSeek', '报告', '系统']) {
      expect(response.text).toContain(text);
    }
    expect(response.text).toContain('尚无项目');
    expect(response.text).toContain('所有数值均来自已持久化项目数据');
  });

  it('renders project list and new project form', async () => {
    const list = await request(app).get('/projects');
    expect(list.status).toBe(200);
    for (const heading of ['项目', '域名', '套餐', '状态', '更新时间', '操作']) expect(list.text).toContain(heading);

    const form = await request(app).get('/projects/new');
    expect(form.status).toBe(200);
    expect(form.text).toContain('新建项目');
    expect(form.text).toContain('primaryDomain');
  });

  it('creates a project and redirects to detail', async () => {
    const response = await request(app).post('/projects').type('form').send({ name: 'Example Project', slug: 'example-project', primaryDomain: 'example.com', planLevel: 'ADVANCED' });
    expect(response.status).toBe(303);
    expect(response.headers.location).toMatch(/^\/projects\//);

    const detail = await request(app).get(response.headers.location);
    expect(detail.status).toBe(200);
    expect(detail.text).toContain('Example Project');
    expect(detail.text).toContain('example.com');
    expect(detail.text).toContain('ADVANCED');
  });

  it('renders a full Advanced Growth summary from persisted facts without private provenance', async () => {
    const project = await createProject('ADVANCED', 'growth-advanced');
    await seedGrowthDashboardFacts(project.id, { includeEligible: true, includeAdvancedTypes: true, resolvedCount: 1 });

    const response = await request(app).get(`/projects/${project.id}`);

    expect(response.status).toBe(200);
    expect(response.text).toContain('Growth Intelligence · 持久化事实');
    expect(response.text).toContain('Top Growth Score');
    expect(response.text).toContain('91');
    expect(response.text).toContain('CRITICAL');
    expect(response.text).toContain('Resolved');
    expect(response.text).toContain('declining opportunity');
    expect(response.text).toContain('ranking opportunity');
    expect(response.text).toContain('cannibal opportunity');
    expect(response.text).toContain('Impressions +100.0%');
    expect(response.text).toContain('Clicks +100.0%');
    expect(response.text).toContain('连接状态');
    expect(response.text).toContain('CONNECTED');
    expect(response.text).toContain('数据新鲜度');
    expect(response.text).toContain('2026-08-02');
    expect(response.text).not.toContain('SHOULD_NOT_RENDER');
    expect(response.text).not.toContain('fixture-ciphertext');
  });

  it('renders safe bounded Standard Growth facts without leaking Advanced-only details', async () => {
    const project = await createProject('STANDARD', 'growth-standard');
    await seedGrowthDashboardFacts(project.id, { includeEligible: true, includeAdvancedTypes: true, resolvedCount: 1 });

    const response = await request(app).get(`/projects/${project.id}`);

    expect(response.status).toBe(200);
    expect(response.text).toContain('Growth Intelligence · 基础版');
    expect(response.text).toContain('增长机会');
    expect(response.text).toContain('CRITICAL');
    expect(response.text).toContain('Resolved');
    expect(response.text).not.toContain('Top Growth Score');
    expect(response.text).not.toContain('declining opportunity');
    expect(response.text).not.toContain('ranking opportunity');
    expect(response.text).not.toContain('cannibal opportunity');
    expect(response.text).not.toContain('Impressions +100.0%');
    expect(response.text).not.toContain('Clicks +100.0%');
    expect(response.text).not.toContain('SHOULD_NOT_RENDER');
    expect(response.text).not.toContain('fixture-ciphertext');
  });
});
