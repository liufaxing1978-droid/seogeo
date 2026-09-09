import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { deriveCsrfToken } from '../../src/auth/csrf.js';
import { env } from '../../src/config/env.js';
import { prisma } from '../../src/db/prisma.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

const app = createApp();
const fixtures: Awaited<ReturnType<typeof seedAuthenticatedUser>>[] = [];

afterEach(async () => {
  for (const fixture of fixtures.splice(0).reverse()) await fixture.cleanup();
});

describe('manual publication drafts web UI', () => {
  it('renders a human-only draft form with no publication action', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OWNER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE'
    });
    fixtures.push(fixture);

    const response = await request(app)
      .get(`/projects/${fixture.project.id}/publication/drafts/new`)
      .set('Cookie', fixture.sessionCookie);

    expect(response.status).toBe(200);
    expect(response.text).toContain('新建人工草稿');
    expect(response.text).toContain('name="title"');
    expect(response.text).toContain('name="body"');
    expect(response.text).toContain('保存后仅创建内部草稿，不会发布到网站。');
    expect(response.text).not.toContain('DeepSeek');
    expect(response.text).not.toContain('执行发布');
  });

  it('saves a manual proposal and an unpublished HUMAN draft without creating a plan', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OWNER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE'
    });
    fixtures.push(fixture);
    const csrf = deriveCsrfToken(
      env.SESSION_SECRET,
      fixture.csrfInput.sessionId,
      fixture.csrfInput.tokenHash
    );

    const response = await request(app)
      .post(`/projects/${fixture.project.id}/publication/drafts`)
      .set('Cookie', fixture.sessionCookie)
      .type('form')
      .send({
        _csrf: csrf,
        title: '伏英馆：六壬文化与民宗文献的传承与整理',
        slugCandidate: 'fuyingguan',
        body: '# 伏英馆\n\n这是人工审核的品牌页草稿。',
        excerpt: '伏英馆不是实体场所。',
        metaTitle: '伏英馆是什么｜兴善堂',
        metaDescription: '介绍伏英馆与兴善堂的文化内容关系。',
        canonicalCandidate: 'https://xingshantang.org/fuyingguan',
        author: '兴善堂',
        language: 'zh-CN',
        reason: '为品牌词伏英馆创建独立的人工草稿。'
      });

    expect(response.status).toBe(303);
    expect(response.headers.location).toMatch(new RegExp(`^/projects/${fixture.project.id}/publication/drafts/`));
    const draft = await prisma.contentDraft.findFirstOrThrow({
      where: { projectId: fixture.project.id, slugCandidate: 'fuyingguan' },
      include: { sourceProposal: true, plans: true }
    });
    expect(draft).toMatchObject({ status: 'DRAFT', generatedBy: 'HUMAN', currentVersion: 1 });
    expect(draft.sourceProposal).toMatchObject({ sourceType: 'MANUAL', reason: '为品牌词伏英馆创建独立的人工草稿。' });
    expect(draft.plans).toHaveLength(0);
  });
});
