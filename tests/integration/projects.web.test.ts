import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { deriveCsrfToken } from '../../src/auth/csrf.js';
import { env } from '../../src/config/env.js';
import { prisma } from '../../src/db/prisma.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';
import { seedGrowthDashboardFacts } from '../helpers/growth-dashboard-fixture.js';

const app = createApp();
const fixtures: Awaited<ReturnType<typeof seedAuthenticatedUser>>[] = [];
const directProjectIds: string[] = [];

async function seed(
  planLevel: 'STANDARD' | 'ADVANCED' | 'ENTERPRISE',
  membershipStatus: 'ACTIVE' | 'REVOKED' = 'ACTIVE',
) {
  const fixture = await seedAuthenticatedUser({
    role: 'OWNER',
    planLevel,
    userStatus: 'ACTIVE',
    membershipStatus,
  });
  fixtures.push(fixture);
  return fixture;
}

function csrfFor(fixture: Awaited<ReturnType<typeof seedAuthenticatedUser>>) {
  return deriveCsrfToken(
    env.SESSION_SECRET,
    fixture.csrfInput.sessionId,
    fixture.csrfInput.tokenHash,
  );
}

async function createProjectForUser(
  userId: string,
  planLevel: 'STANDARD' | 'ADVANCED' | 'ENTERPRISE',
  label: string,
) {
  const suffix = `${label}-${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: `Web ${label}`,
      slug: `web-${suffix}`,
      primaryDomain: `web-${suffix}.example.com`,
      planLevel,
      memberships: {
        create: {
          userId,
          role: 'OWNER',
          status: 'ACTIVE',
        },
      },
    },
  });
  directProjectIds.push(project.id);
  return project;
}

afterEach(async () => {
  for (const projectId of directProjectIds.splice(0).reverse()) {
    await prisma.projectMembership.deleteMany({ where: { projectId } });
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  }
  for (const fixture of fixtures.splice(0).reverse()) {
    await fixture.cleanup();
  }
});

describe('admin web UI', () => {
  it('renders the approved dashboard shell', async () => {
    const fixture = await seed('ADVANCED', 'REVOKED');
    const response = await request(app).get('/').set('Cookie', fixture.sessionCookie);
    expect(response.status).toBe(200);
    for (const text of ['SEO GEO', '概览', '项目', 'SEO', 'GEO', 'AI Visibility', 'DeepSeek', '报告', '系统']) {
      expect(response.text).toContain(text);
    }
    expect(response.text).toContain('尚无项目');
    expect(response.text).toContain('所有数值均来自已持久化项目数据');
  });

  it('renders project list and new project form', async () => {
    const fixture = await seed('ADVANCED');
    const list = await request(app).get('/projects').set('Cookie', fixture.sessionCookie);
    expect(list.status).toBe(200);
    for (const heading of ['项目', '域名', '套餐', '状态', '更新时间', '操作']) expect(list.text).toContain(heading);

    const form = await request(app).get('/projects/new').set('Cookie', fixture.sessionCookie);
    expect(form.status).toBe(200);
    expect(form.text).toContain('新建项目');
    expect(form.text).toContain('primaryDomain');
    expect(form.text).toContain('name="_csrf"');
  });

  it('creates a project and redirects to detail', async () => {
    const fixture = await seed('ADVANCED');
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const response = await request(app)
      .post('/projects')
      .set('Cookie', fixture.sessionCookie)
      .type('form')
      .send({
        name: 'Example Project',
        slug: `example-project-${suffix}`,
        primaryDomain: `example-${suffix}.com`,
        planLevel: 'ADVANCED',
        _csrf: csrfFor(fixture),
      });
    expect(response.status).toBe(303);
    expect(response.headers.location).toMatch(/^\/projects\//);

    const projectId = response.headers.location.split('/').pop()!;
    directProjectIds.push(projectId);
    const detail = await request(app)
      .get(response.headers.location)
      .set('Cookie', fixture.sessionCookie);
    expect(detail.status).toBe(200);
    expect(detail.text).toContain('Example Project');
    expect(detail.text).toContain(`example-${suffix}.com`);
    expect(detail.text).toContain('ADVANCED');
  });

  it('renders a full Advanced Growth summary from persisted facts without private provenance', async () => {
    const fixture = await seed('ADVANCED');
    await seedGrowthDashboardFacts(fixture.project.id, { includeEligible: true, includeAdvancedTypes: true, resolvedCount: 1 });

    const response = await request(app)
      .get(`/projects/${fixture.project.id}`)
      .set('Cookie', fixture.sessionCookie);

    expect(response.status).toBe(200);
    expect(response.text).toContain('Growth Intelligence · 持久化事实');
    expect(response.text).toContain('Top Growth Score');
    expect(response.text).toContain('91');
    expect(response.text).toContain('declining opportunity');
    expect(response.text).toContain('ranking opportunity');
    expect(response.text).toContain('cannibal opportunity');
    expect(response.text).toContain('Impressions +100.0%');
    expect(response.text).toContain('Clicks +100.0%');
    expect(response.text).toContain('CONNECTED');
    expect(response.text).not.toContain('SHOULD_NOT_RENDER');
    expect(response.text).not.toContain('fixture-ciphertext');
  });

  it('keeps Standard project rendering on BASIC Growth opportunity types', async () => {
    const fixture = await seed('STANDARD');
    await seedGrowthDashboardFacts(fixture.project.id, { includeEligible: true, includeAdvancedTypes: true, resolvedCount: 1 });

    const response = await request(app)
      .get(`/projects/${fixture.project.id}`)
      .set('Cookie', fixture.sessionCookie);

    expect(response.status).toBe(200);
    expect(response.text).toContain('Growth Intelligence · 持久化事实');
    expect(response.text).toContain('84');
    expect(response.text).toContain('ranking opportunity');
    expect(response.text).not.toContain('declining opportunity');
    expect(response.text).not.toContain('cannibal opportunity');
  });

  it('renders explicit Growth no-data text instead of fabricating score zero', async () => {
    const fixture = await seed('ADVANCED');
    await seedGrowthDashboardFacts(fixture.project.id, { includeEligible: false, includeAdvancedTypes: false, resolvedCount: 0 });

    const response = await request(app)
      .get(`/projects/${fixture.project.id}`)
      .set('Cookie', fixture.sessionCookie);

    expect(response.status).toBe(200);
    expect(response.text).toContain('暂无可排名机会');
    expect(response.text).not.toContain('Top Growth Score</div><div class="metric-value">0');
  });

  it('renders an Enterprise-only Growth portfolio section from safe project summaries', async () => {
    const fixture = await seed('ENTERPRISE');
    const advanced = await createProjectForUser(fixture.user.id, 'ADVANCED', 'advanced-growth');
    await seedGrowthDashboardFacts(fixture.project.id, { includeEligible: true, includeAdvancedTypes: true, resolvedCount: 2 });
    await seedGrowthDashboardFacts(advanced.id, { includeEligible: true, includeAdvancedTypes: true, resolvedCount: 3 });

    const response = await request(app).get('/').set('Cookie', fixture.sessionCookie);

    expect(response.status).toBe(200);
    expect(response.text).toContain('Enterprise Growth Portfolio');
    expect(response.text).toContain(`data-growth-project="${fixture.project.id}"`);
    expect(response.text).not.toContain(`data-growth-project="${advanced.id}"`);
    expect(response.text).not.toContain('SHOULD_NOT_RENDER');
    expect(response.text).not.toContain('fixture-ciphertext');
  });
});
