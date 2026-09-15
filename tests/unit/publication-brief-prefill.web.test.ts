import express from 'express';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

const PROJECT_ID = '00000000-0000-4000-8000-000000000041';
const BRIEF_ID = '00000000-0000-4000-8000-000000000042';

const repository = vi.hoisted(() => ({
  getCenter: vi.fn(async () => ({
    project: { id: PROJECT_ID, name: '兴善堂网站', primaryDomain: 'xingshantang.org', planLevel: 'ENTERPRISE' },
    sites: [],
    proposals: [],
    drafts: [
      { id: 'draft-active', status: 'DRAFT' },
      { id: 'draft-archived', status: 'ARCHIVED' },
    ],
    plans: [],
    executions: [],
    verifications: [],
  })),
  listDrafts: vi.fn(async () => ({
    project: { id: PROJECT_ID, name: '兴善堂网站', primaryDomain: 'xingshantang.org', planLevel: 'ENTERPRISE' },
    drafts: [],
  })),
  getBriefDraftSeed: vi.fn(async () => ({
    id: BRIEF_ID,
    projectId: PROJECT_ID,
    briefJson: {
      primaryTopic: '妈祖信俗资料导读',
      objective: '整理地方祭祀到跨地域交流的资料。',
      recommendedOutline: ['地方祭祀', '航海记忆', '跨地域交流'],
      questionsToAnswer: ['资料如何呈现地方祭祀？'],
    },
    document: {
      title: '妈祖信俗资料导读：从地方祭祀到跨地域交流',
      canonicalUrl: 'https://xingshantang.org/articles/mazu-belief-document-guide',
      metaDescription: '整理妈祖信俗相关资料。',
      language: 'zh-CN',
    },
  })),
}));

vi.mock('../../src/modules/publication/publication.web.repository.js', () => ({
  publicationWebRepository: repository,
}));
vi.mock('../../src/auth/authentication.js', () => ({
  requireAuthentication: () => (req: express.Request, res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { auth: unknown }).auth = { userId: 'user-1', sessionId: 'session-1' };
    res.locals.authSessionTokenHash = 'token-hash';
    next();
  },
}));
vi.mock('../../src/auth/project-access.js', () => ({
  requireProjectMembership: () => (_req: express.Request, res: express.Response, next: express.NextFunction) => {
    res.locals.projectMembership = { role: 'OWNER' };
    next();
  },
  requireProjectCapability: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));
vi.mock('../../src/auth/csrf.js', () => ({
  deriveCsrfToken: () => 'csrf-token',
  requireCsrf: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));
vi.mock('../../src/db/prisma.js', () => ({
  prisma: { contentDraft: { findFirst: vi.fn() } },
}));
vi.mock('../../src/modules/publication/publication.service.js', () => ({
  PublicationServiceError: class PublicationServiceError extends Error {},
  publicationService: {},
}));

describe('publication draft form seeded from a content brief', () => {
  it('renders the selected brief as an unpublished editable draft seed', async () => {
    const { publicationWebRoutes } = await import('../../src/modules/publication/publication.web.routes.js');
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', fileURLToPath(new URL('../../src/views', import.meta.url)));
    app.use(publicationWebRoutes);

    const response = await request(app)
      .get(`/projects/${PROJECT_ID}/publication/drafts/new?briefId=${BRIEF_ID}`);

    expect(response.status).toBe(200);
    expect(response.text).toContain('value="妈祖信俗资料导读"');
    expect(response.text).toContain('# 妈祖信俗资料导读');
    expect(response.text).toContain('## 地方祭祀');
    expect(response.text).toContain('资料如何呈现地方祭祀？');
    expect(response.text).toContain('value="https://xingshantang.org/articles/mazu-belief-document-guide"');
    expect(response.text).toContain(`value="${BRIEF_ID}"`);
    expect(response.text).toContain('只创建内部草稿');
  });

  it('reports only non-archived drafts as active drafts in the publication center', async () => {
    const { publicationWebRoutes } = await import('../../src/modules/publication/publication.web.routes.js');
    const app = express();
    app.set('view engine', 'ejs');
    app.set('views', fileURLToPath(new URL('../../src/views', import.meta.url)));
    app.use(publicationWebRoutes);

    const response = await request(app).get(`/projects/${PROJECT_ID}/publication`);

    expect(response.status).toBe(200);
    expect(response.text).toContain('<div class="metric-title">活跃草稿</div><div class="metric-value">1</div>');
    expect(response.text).not.toContain('<div class="metric-value">2</div><div class="metric-caption">版本化内容</div>');
  });
});
