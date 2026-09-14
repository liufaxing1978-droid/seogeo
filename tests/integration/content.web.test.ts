import request from 'supertest';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { createContentWebRoutes } from '../../src/modules/content/content.web.routes.js';

describe('content center web access', () => {
  it('requires authentication before loading project content facts', async () => {
    const app = express();
    app.use(createContentWebRoutes());
    app.use((error: { status?: number; code?: string }, _req: Request, res: Response, _next: NextFunction) => {
      res.status(error.status ?? 500).json({ error: { code: error.code } });
    });

    const response = await request(app).get('/projects/00000000-0000-4000-8000-000000000001/content').expect(401);

    expect(response.body).toEqual({ error: { code: 'AUTHENTICATION_REQUIRED' } });
    await request(app).post('/projects/00000000-0000-4000-8000-000000000001/content/refresh').expect(401);
  });
});
