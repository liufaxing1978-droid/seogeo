import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveCsrfToken } from '../../src/auth/csrf.js';
import { env } from '../../src/config/env.js';
import { errorHandler } from '../../src/core/http.js';
import { prisma } from '../../src/db/prisma.js';
import { createVisibilityHistoryWebRoutes } from '../../src/modules/visibility/visibility-history.web.routes.js';
import { createVisibilityMetricsWebRoutes } from '../../src/modules/visibility/visibility-metrics.web.routes.js';

const UNKNOWN_PROJECT_ID = '00000000-0000-4000-8000-000000000099';

const SESSION_ID = '00000000-0000-4000-8000-000000000201';
const USER_ID = '00000000-0000-4000-8000-000000000202';
const TOKEN_HASH = 'test-session-token-hash';

function isolatedVisibilityApp(options: {
  authenticated?: boolean;
  role?: 'VIEWER' | 'OWNER';
} = {}) {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    req.auth = options.authenticated
      ? { userId: USER_ID, sessionId: SESSION_ID }
      : null;
    res.locals.authSessionTokenHash = options.authenticated ? TOKEN_HASH : null;
    next();
  });
  app.use(createVisibilityMetricsWebRoutes(
    { enqueueSnapshot: async () => { throw new Error('metrics queue must not run'); } } as never,
    { prepareSnapshot: async () => { throw new Error('metrics service must not run'); } } as never,
  ));
  app.use(createVisibilityHistoryWebRoutes({
    createRule: async () => { throw new Error('alerts service must not run'); },
    updateRule: async () => { throw new Error('alerts service must not run'); },
    acknowledge: async () => { throw new Error('alerts service must not run'); },
  } as never));
  app.use(errorHandler);
  return app;
}

function csrfFor(): string {
  return deriveCsrfToken(
    env.SESSION_SECRET,
    SESSION_ID,
    TOKEN_HASH,
  );
}

function stubProjectAccess(role: 'VIEWER' | 'OWNER') {
  vi.spyOn(prisma.projectMembership, 'findFirst').mockResolvedValue({
    id: 'membership-1',
    projectId: UNKNOWN_PROJECT_ID,
    userId: USER_ID,
    role,
    status: 'ACTIVE',
    createdAt: new Date('2026-09-15T00:00:00Z'),
    updatedAt: new Date('2026-09-15T00:00:00Z'),
    project: {
      id: UNKNOWN_PROJECT_ID,
      name: 'Security fixture',
      slug: 'security-fixture',
      primaryDomain: 'example.com',
      status: 'ACTIVE',
      planLevel: 'ENTERPRISE',
      createdAt: new Date('2026-09-15T00:00:00Z'),
      updatedAt: new Date('2026-09-15T00:00:00Z'),
    },
  } as never);
  vi.spyOn(prisma.project, 'findUnique').mockResolvedValue({
    id: UNKNOWN_PROJECT_ID,
    planLevel: 'ENTERPRISE',
  } as never);
}

const writePaths = (projectId: string) => [
  `/projects/${projectId}/visibility/alerts/rules`,
  `/projects/${projectId}/visibility/alerts/rules/00000000-0000-4000-8000-000000000101`,
  `/projects/${projectId}/visibility/alerts/00000000-0000-4000-8000-000000000102/acknowledge`,
  `/projects/${projectId}/visibility/metrics/snapshots`,
];

describe('visibility history, alerts, and metrics web security boundary', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(['history', 'alerts', 'metrics'])(
    'rejects unauthenticated %s access when the route module is mounted independently',
    async (page) => {
      const response = await request(isolatedVisibilityApp())
        .get(`/projects/${UNKNOWN_PROJECT_ID}/visibility/${page}`)
        .expect(401);

      expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    },
  );

  it.each(writePaths(':projectId'))(
    'denies a VIEWER mutation at %s before parsing or executing it',
    async (pathTemplate) => {
      stubProjectAccess('VIEWER');
      const response = await request(isolatedVisibilityApp({ authenticated: true, role: 'VIEWER' }))
        .post(pathTemplate.replace(':projectId', UNKNOWN_PROJECT_ID))
        .set('X-CSRF-Token', csrfFor())
        .type('form')
        .send({})
        .expect(403);

      expect(response.body.error.code).toBe('PROJECT_CAPABILITY_REQUIRED');
    },
  );

  it.each(writePaths(':projectId'))(
    'rejects an authenticated write without CSRF at %s',
    async (pathTemplate) => {
      stubProjectAccess('OWNER');
      const response = await request(isolatedVisibilityApp({ authenticated: true, role: 'OWNER' }))
        .post(pathTemplate.replace(':projectId', UNKNOWN_PROJECT_ID))
        .type('form')
        .send({})
        .expect(403);

      expect(response.body.error.code).toBe('CSRF_INVALID');
    },
  );
});
