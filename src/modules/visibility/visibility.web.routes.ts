import { Router } from 'express';
import { hasFeature, type Feature } from '../../auth/feature-flags.js';
import { AppError, NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { visibilityPromptService } from './visibility-prompts.service.js';
import { visibilityRunService } from './visibility-run.service.js';
import { visibilitySettingsService } from './visibility-settings.service.js';
import { visibilityWebRepository } from './visibility.web.repository.js';

async function requireVisibilityProject(projectId: string, feature: Feature) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, planLevel: true }
  });
  if (!project) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
  if (!hasFeature(project.planLevel, feature)) {
    throw new AppError('This feature requires a higher plan', 403, 'FEATURE_NOT_AVAILABLE');
  }
  return project;
}

function optionalText(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function parseUsdMicros(value: unknown, field: string) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(text);
  if (!match) throw new AppError(`${field} must be a non-negative USD amount with at most 6 decimal places`, 400, 'INVALID_VISIBILITY_BUDGET');
  const whole = Number(match[1]);
  const fraction = Number((match[2] ?? '').padEnd(6, '0'));
  if (!Number.isSafeInteger(whole) || whole > 9_000_000_000 || !Number.isSafeInteger(whole * 1_000_000 + fraction)) {
    throw new AppError(`${field} is too large`, 400, 'INVALID_VISIBILITY_BUDGET');
  }
  return whole * 1_000_000 + fraction;
}

function parseInteger(value: unknown, field: string, min: number, max: number) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^\d+$/.test(text)) throw new AppError(`${field} must be an integer`, 400, 'INVALID_VISIBILITY_FORM');
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new AppError(`${field} must be between ${min} and ${max}`, 400, 'INVALID_VISIBILITY_FORM');
  }
  return parsed;
}

export const visibilityWebRoutes = Router();

visibilityWebRoutes.get('/projects/:id/visibility', async (req, res, next) => {
  try {
    await requireVisibilityProject(req.params.id, 'AI_VISIBILITY');
    const data = await visibilityWebRepository.getOverview(req.params.id);
    if (!data) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
    res.render('layout', {
      title: `AI Visibility · ${data.project.name}`,
      activeNav: 'visibility',
      currentProjectId: data.project.id,
      breadcrumbs: ['项目', data.project.name, 'AI Visibility'],
      bodyTemplate: 'visibility/index',
      ...data
    });
  } catch (error) { next(error); }
});

visibilityWebRoutes.post('/projects/:id/visibility/settings', async (req, res, next) => {
  try {
    await requireVisibilityProject(req.params.id, 'AI_VISIBILITY');
    await visibilitySettingsService.update(req.params.id, {
      dailyBudgetMicros: parseUsdMicros(req.body.dailyBudgetUsd, 'dailyBudgetUsd'),
      defaultRunBudgetMicros: parseUsdMicros(req.body.defaultRunBudgetUsd, 'defaultRunBudgetUsd'),
      maxObservationsPerRun: parseInteger(req.body.maxObservationsPerRun, 'maxObservationsPerRun', 1, 500),
      defaultCurrency: 'USD',
      schedulingEnabled: req.body.schedulingEnabled === 'on'
    });
    res.redirect(303, `/projects/${req.params.id}/visibility`);
  } catch (error) { next(error); }
});

visibilityWebRoutes.post('/projects/:id/visibility/runs', async (req, res, next) => {
  try {
    await requireVisibilityProject(req.params.id, 'AI_VISIBILITY');
    const settings = await visibilitySettingsService.getOrCreate(req.params.id);
    const budgetCeilingMicros = parseUsdMicros(req.body.budgetCeilingUsd, 'budgetCeilingUsd');
    if (budgetCeilingMicros === null && settings.defaultRunBudgetMicros === null) {
      throw new AppError('Configure a run budget before starting paid sampling', 400, 'VISIBILITY_BUDGET_REQUIRED');
    }
    const providerConfigId = typeof req.body.providerConfigId === 'string' ? req.body.providerConfigId : '';
    const run = await visibilityRunService.createManualRun(req.params.id, {
      promptSetId: typeof req.body.promptSetId === 'string' ? req.body.promptSetId : '',
      providerConfigIds: [providerConfigId],
      maxObservations: parseInteger(req.body.maxObservations, 'maxObservations', 1, 500),
      budgetCeilingMicros
    });
    res.redirect(303, `/projects/${req.params.id}/visibility/runs/${run.id}`);
  } catch (error) { next(error); }
});

visibilityWebRoutes.get('/projects/:id/visibility/prompts', async (req, res, next) => {
  try {
    await requireVisibilityProject(req.params.id, 'PROMPT_MONITOR');
    const data = await visibilityWebRepository.getPromptMonitor(req.params.id);
    if (!data) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
    res.render('layout', {
      title: `Prompt 监控 · ${data.project.name}`,
      activeNav: 'visibility-prompts',
      currentProjectId: data.project.id,
      breadcrumbs: ['项目', data.project.name, 'AI Visibility', 'Prompt 监控'],
      bodyTemplate: 'visibility/prompts',
      ...data
    });
  } catch (error) { next(error); }
});

visibilityWebRoutes.post('/projects/:id/visibility/prompt-sets', async (req, res, next) => {
  try {
    await requireVisibilityProject(req.params.id, 'PROMPT_MONITOR');
    await visibilityPromptService.createPromptSet(req.params.id, {
      name: typeof req.body.name === 'string' ? req.body.name : '',
      description: optionalText(req.body.description),
      defaultLocale: optionalText(req.body.defaultLocale),
      defaultCountry: optionalText(req.body.defaultCountry)
    });
    res.redirect(303, `/projects/${req.params.id}/visibility/prompts`);
  } catch (error) { next(error); }
});

visibilityWebRoutes.post('/projects/:id/visibility/prompts', async (req, res, next) => {
  try {
    await requireVisibilityProject(req.params.id, 'PROMPT_MONITOR');
    await visibilityPromptService.createPromptVersion(req.params.id, {
      promptSetId: typeof req.body.promptSetId === 'string' ? req.body.promptSetId : '',
      promptKey: typeof req.body.promptKey === 'string' ? req.body.promptKey : '',
      promptText: typeof req.body.promptText === 'string' ? req.body.promptText : '',
      locale: optionalText(req.body.locale),
      country: optionalText(req.body.country)
    });
    res.redirect(303, `/projects/${req.params.id}/visibility/prompts`);
  } catch (error) { next(error); }
});

visibilityWebRoutes.get('/projects/:id/visibility/runs/:runId', async (req, res, next) => {
  try {
    await requireVisibilityProject(req.params.id, 'AI_VISIBILITY');
    const data = await visibilityWebRepository.getRunDetail(req.params.id, req.params.runId);
    if (!data) throw new NotFoundError('Visibility run not found', 'VISIBILITY_RUN_NOT_FOUND');
    res.render('layout', {
      title: `采样运行详情 · ${data.project.name}`,
      activeNav: 'visibility',
      currentProjectId: data.project.id,
      breadcrumbs: ['项目', data.project.name, 'AI Visibility', '采样运行详情'],
      bodyTemplate: 'visibility/runs/show',
      ...data
    });
  } catch (error) { next(error); }
});
