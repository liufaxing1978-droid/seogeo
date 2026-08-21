import { Router } from 'express';
import { z } from 'zod';
import { AppError } from '../../core/errors.js';
import { MarketService } from './market.service.js';
import { marketRepository } from './market.repository.js';
import {
  MarketValidationError,
  type MarketSelection,
  type MarketWriteInput
} from './market.types.js';

const marketWriteSchema = z.object({
  markets: z.array(z.object({
    marketCode: z.enum(['CN', 'GLOBAL', 'HK', 'TW', 'SG', 'MY']),
    locale: z.string().trim().min(1).max(64),
    enabled: z.boolean().default(true)
  }).strict()).max(20)
}).strict();

export interface MarketApiPort {
  listResolvedMarkets(projectId: string): Promise<MarketSelection[]>;
  replaceMarkets(projectId: string, input: MarketWriteInput[]): Promise<MarketSelection[]>;
}

function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0]! : value;
}

function asAppError(error: unknown): never {
  if (error instanceof MarketValidationError) {
    const status = error.code === 'PROJECT_NOT_FOUND' ? 404 : 400;
    throw new AppError(error.message, status, error.code);
  }
  throw error;
}

export function createMarketRoutes(injectedService?: MarketApiPort) {
  const router = Router();
  const service: MarketApiPort = injectedService ?? new MarketService(marketRepository);

  router.get('/projects/:projectId/markets', async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      res.json({ data: await service.listResolvedMarkets(projectId) });
    } catch (error) {
      try { asAppError(error); } catch (mapped) { next(mapped); }
    }
  });

  router.put('/projects/:projectId/markets', async (req, res, next) => {
    try {
      const input = marketWriteSchema.parse(req.body);
      const projectId = routeParam(req.params.projectId);
      res.json({ data: await service.replaceMarkets(projectId, input.markets) });
    } catch (error) {
      try { asAppError(error); } catch (mapped) { next(mapped); }
    }
  });

  return router;
}
