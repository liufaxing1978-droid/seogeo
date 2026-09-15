import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { competitorWebRoutes } from '../../src/modules/competitor/competitor.web.routes.js';
import { reportWebRoutes } from '../../src/modules/reporting/report.web.routes.js';
import { visibilityWebRoutes } from '../../src/modules/visibility/visibility.web.routes.js';

function appFor(router: express.Router) {
  const app = express();
  app.use(router);
  app.use((error: { status?: number; code?: string }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(error.status ?? 500).json({ error: { code: error.code } });
  });
  return app;
}

describe('project web access guards', () => {
  it('requires authentication before exposing project centers', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    for (const [router, path] of [
      [reportWebRoutes, `/projects/${id}/reports`],
      [visibilityWebRoutes, `/projects/${id}/visibility`],
      [competitorWebRoutes, `/projects/${id}/competitors`],
    ] as const) {
      const response = await request(appFor(router)).get(path).expect(401);
      expect(response.body).toEqual({ error: { code: 'AUTHENTICATION_REQUIRED' } });
    }
  });
});
