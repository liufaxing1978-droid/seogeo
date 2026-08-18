import { Router } from 'express';
import { checkReadiness } from './health.service.js';

export const healthRoutes = Router();

healthRoutes.get('/live', (_req, res) => {
  res.json({ status: 'ok' });
});

healthRoutes.get('/ready', async (_req, res) => {
  try {
    res.json(await checkReadiness());
  } catch (error) {
    console.error('Readiness check failed', error);
    res.status(503).json({ status: 'unavailable' });
  }
});
