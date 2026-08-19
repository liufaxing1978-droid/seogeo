import { Router } from 'express';
import { z } from 'zod';
import { hasFeature, type Feature } from '../../auth/feature-flags.js';
import { AppError, NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import {
  visibilityPromptService,
  type VisibilityPromptService
} from './visibility-prompts.service.js';
import {
  visibilityRunService,
  type VisibilityRunService
} from './visibility-run.service.js';
import {
  visibilitySettingsService,
  type VisibilitySettingsService
} from './visibility-settings.service.js';

const settingsUpdateSchema = z.object({
  dailyBudgetMicros: z.number().int().nonnegative().nullable().optional(),
  defaultRunBudgetMicros: z.number().int().nonnegative().nullable().optional(),
  maxObservationsPerRun: z.number().int().min(1).max(500).optional(),
  defaultCurrency: z.string().regex(/^[A-Z]{3}$/).optional(),
  schedulingEnabled: z.boolean().optional()
}).strict();

const providerConfigSchema = z.object({
  provider: z.enum(['OPENAI', 'GEMINI', 'PERPLEXITY', 'ANTHROPIC', 'DEEPSEEK']),
  enabled: z.boolean(),
  model: z.string().min(1),
  channel: z.enum(['API', 'CONSUMER_UI']),
  groundingMode: z.enum([
    'WEB_SEARCH',
    'SEARCH_GROUNDING',
    'SONAR',
    'WEB_SEARCH_TOOL',
    'UNSUPPORTED_WEB_GROUNDING'
  ]),
  maxConcurrency: z.number().int().min(1).max(10),
  defaultLocale: z.string().min(1).nullable().optional(),
  defaultCountry: z.string().min(1).nullable().optional(),
  providerOptionsJson: z.record(z.string(), z.unknown())
}).strict();

const promptSetSchema = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  defaultLocale: z.string().min(1).nullable().optional(),
  defaultCountry: z.string().min(1).nullable().optional()
}).strict();

const promptVersionSchema = z.object({
  promptSetId: z.string().uuid(),
  promptKey: z.string().min(1),
  promptText: z.string().min(1),
  locale: z.string().min(1).nullable().optional(),
  country: z.string().min(1).nullable().optional()
}).strict();

const createRunSchema = z.object({
  promptSetId: z.string().uuid(),
  providerConfigIds: z.array(z.string().uuid()).min(1),
  maxObservations: z.number().int().min(1).max(500),
  budgetCeilingMicros: z.number().int().nonnegative().nullable().optional()
}).strict();

async function requireVisibilityProject(projectId: string, feature: Feature) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, planLevel: true }
  });
  if (!project) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
  if (!hasFeature(project.planLevel, feature)) {
    throw new AppError(
      'This feature requires a higher plan',
      403,
      'FEATURE_NOT_AVAILABLE'
    );
  }
  return project;
}

export function createVisibilityRoutes(
  runService: VisibilityRunService = visibilityRunService,
  settingsService: VisibilitySettingsService = visibilitySettingsService,
  promptService: VisibilityPromptService = visibilityPromptService
) {
  const router = Router();

  router.get('/projects/:projectId/visibility/settings', async (req, res, next) => {
    try {
      await requireVisibilityProject(req.params.projectId, 'AI_VISIBILITY');
      res.json({ data: await settingsService.getOrCreate(req.params.projectId) });
    } catch (error) { next(error); }
  });

  router.patch('/projects/:projectId/visibility/settings', async (req, res, next) => {
    try {
      await requireVisibilityProject(req.params.projectId, 'AI_VISIBILITY');
      const input = settingsUpdateSchema.parse(req.body);
      res.json({ data: await settingsService.update(req.params.projectId, input) });
    } catch (error) { next(error); }
  });

  router.get('/projects/:projectId/visibility/providers', async (req, res, next) => {
    try {
      await requireVisibilityProject(req.params.projectId, 'AI_VISIBILITY');
      const data = await prisma.visibilityProviderConfig.findMany({
        where: { projectId: req.params.projectId },
        orderBy: [{ provider: 'asc' }, { model: 'asc' }, { id: 'asc' }]
      });
      res.json({ data });
    } catch (error) { next(error); }
  });

  router.put('/projects/:projectId/visibility/providers/:providerConfigId', async (req, res, next) => {
    try {
      await requireVisibilityProject(req.params.projectId, 'AI_VISIBILITY');
      const existing = await prisma.visibilityProviderConfig.findFirst({
        where: {
          id: req.params.providerConfigId,
          projectId: req.params.projectId
        }
      });
      if (!existing) {
        throw new NotFoundError(
          'Visibility provider config not found',
          'VISIBILITY_PROVIDER_CONFIG_NOT_FOUND'
        );
      }
      const input = providerConfigSchema.parse(req.body);
      if (
        input.provider !== existing.provider ||
        input.model.trim() !== existing.model ||
        input.channel !== existing.channel ||
        input.groundingMode !== existing.groundingMode
      ) {
        throw new AppError(
          'Provider identity fields are immutable for this endpoint',
          400,
          'VISIBILITY_PROVIDER_IDENTITY_IMMUTABLE'
        );
      }
      const data = await settingsService.upsertProviderConfig(req.params.projectId, input);
      res.json({ data });
    } catch (error) { next(error); }
  });

  router.get('/projects/:projectId/visibility/prompt-sets', async (req, res, next) => {
    try {
      await requireVisibilityProject(req.params.projectId, 'PROMPT_MONITOR');
      const data = await prisma.visibilityPromptSet.findMany({
        where: { projectId: req.params.projectId },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }]
      });
      res.json({ data });
    } catch (error) { next(error); }
  });

  router.post('/projects/:projectId/visibility/prompt-sets', async (req, res, next) => {
    try {
      await requireVisibilityProject(req.params.projectId, 'PROMPT_MONITOR');
      const input = promptSetSchema.parse(req.body);
      const data = await promptService.createPromptSet(req.params.projectId, input);
      res.status(201).json({ data });
    } catch (error) { next(error); }
  });

  router.get('/projects/:projectId/visibility/prompts', async (req, res, next) => {
    try {
      await requireVisibilityProject(req.params.projectId, 'PROMPT_MONITOR');
      const promptSetId = typeof req.query.promptSetId === 'string' ? req.query.promptSetId : undefined;
      const data = await prisma.visibilityPrompt.findMany({
        where: {
          projectId: req.params.projectId,
          ...(promptSetId ? { promptSetId } : {})
        },
        orderBy: [{ promptKey: 'asc' }, { version: 'desc' }, { id: 'asc' }]
      });
      res.json({ data });
    } catch (error) { next(error); }
  });

  router.post('/projects/:projectId/visibility/prompts', async (req, res, next) => {
    try {
      await requireVisibilityProject(req.params.projectId, 'PROMPT_MONITOR');
      const input = promptVersionSchema.parse(req.body);
      const data = await promptService.createPromptVersion(req.params.projectId, input);
      res.status(201).json({ data });
    } catch (error) { next(error); }
  });

  router.post('/projects/:projectId/visibility/runs', async (req, res, next) => {
    try {
      await requireVisibilityProject(req.params.projectId, 'AI_VISIBILITY');
      const input = createRunSchema.parse(req.body);
      const data = await runService.createManualRun(req.params.projectId, input);
      res.status(202).json({ data });
    } catch (error) { next(error); }
  });

  router.get('/projects/:projectId/visibility/runs', async (req, res, next) => {
    try {
      await requireVisibilityProject(req.params.projectId, 'AI_VISIBILITY');
      const data = await prisma.visibilityRun.findMany({
        where: { projectId: req.params.projectId },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }]
      });
      res.json({ data });
    } catch (error) { next(error); }
  });

  router.get('/projects/:projectId/visibility/runs/:runId', async (req, res, next) => {
    try {
      await requireVisibilityProject(req.params.projectId, 'AI_VISIBILITY');
      const data = await prisma.visibilityRun.findFirst({
        where: {
          id: req.params.runId,
          projectId: req.params.projectId
        },
        include: {
          observations: {
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
          }
        }
      });
      if (!data) throw new NotFoundError('Visibility run not found', 'VISIBILITY_RUN_NOT_FOUND');
      res.json({ data });
    } catch (error) { next(error); }
  });

  router.get('/projects/:projectId/visibility/observations', async (req, res, next) => {
    try {
      await requireVisibilityProject(req.params.projectId, 'AI_VISIBILITY');
      const runId = typeof req.query.runId === 'string' ? req.query.runId : undefined;
      const data = await prisma.platformObservation.findMany({
        where: {
          projectId: req.params.projectId,
          ...(runId ? { visibilityRunId: runId } : {})
        },
        orderBy: [{ observedAt: 'desc' }, { id: 'asc' }]
      });
      res.json({ data });
    } catch (error) { next(error); }
  });

  return router;
}

export const visibilityRoutes = createVisibilityRoutes();
