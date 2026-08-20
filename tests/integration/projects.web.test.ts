import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';

const app = createApp();

beforeEach(async () => {
  await prisma.project.deleteMany();
});

describe('admin web UI', () => {
  it('renders the approved dashboard shell', async () => {
    const response = await request(app).get('/');
    expect(response.status).toBe(200);
    for (const text of ['SEO GEO', '概览', '项目', 'SEO', 'GEO', 'AI Visibility', 'DeepSeek', '报告', '系统']) {
      expect(response.text).toContain(text);
    }
    expect(response.text).toContain('尚无项目');
    expect(response.text).toContain('只展示已持久化的项目事实');
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
});
