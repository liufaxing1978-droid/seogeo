import { Router } from 'express';
import { requireAuthentication } from '../../auth/authentication.js';
import { deriveCsrfToken, requireCsrf } from '../../auth/csrf.js';
import { hasFeature } from '../../auth/feature-flags.js';
import { requireProjectCapability, requireProjectMembership } from '../../auth/project-access.js';
import { env } from '../../config/env.js';
import { AppError, NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import {
  GROWTH_WINDOW_V1,
  assessStableWindowCoverage,
  resolveStableWindows
} from '../growth/gsc-window.js';
import { searchConsoleSyncService, type SearchConsoleSyncService } from './search-console-sync.service.js';

type SearchConsoleUiState =
  | 'NOT_CONNECTED'
  | 'CONNECTED'
  | 'PROPERTY_SELECTED'
  | 'SYNCING'
  | 'READY'
  | 'TOKEN_REVOKED'
  | 'PERMISSION_DENIED'
  | 'PROPERTY_UNAVAILABLE'
  | 'SYNC_FAILED';

function addUtcDays(value: Date, days: number): Date {
  const next = new Date(value.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

async function requireSearchConsoleProject(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, primaryDomain: true, planLevel: true }
  });
  if (!project) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
  if (!hasFeature(project.planLevel, 'SEARCH_CONSOLE')) {
    throw new AppError('This feature requires a higher plan', 403, 'FEATURE_NOT_AVAILABLE');
  }
  return project;
}

function csrfTokenFor(req: any, res: any): string | null {
  const tokenHash = res.locals.authSessionTokenHash;
  if (!req.auth || typeof tokenHash !== 'string') return null;
  return deriveCsrfToken(env.SESSION_SECRET, req.auth.sessionId, tokenHash);
}

export function createSearchConsoleWebRoutes(
  syncService: Pick<SearchConsoleSyncService, 'enqueueStableWindow'> = searchConsoleSyncService
) {
  const router = Router();

  router.post(
    '/projects/:id/search-console/sync',
    requireAuthentication(),
    requireCsrf(),
    requireProjectMembership(),
    requireProjectCapability('SEO_RUN'),
    async (req, res, next) => {
      try {
        const projectId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        if (!projectId) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
        const project = await requireSearchConsoleProject(projectId);
        const queued = await syncService.enqueueStableWindow(project.id);
        res.redirect(303, `/projects/${encodeURIComponent(project.id)}/search-console?syncQueued=${queued.queuedDateCount}`);
      } catch (error) { next(error); }
    }
  );

  router.get('/projects/:id/search-console', async (req, res, next) => {
    try {
      const project = await requireSearchConsoleProject(req.params.id);
      const connection = await prisma.searchConsoleConnection.findFirst({
        where: { projectId: project.id, status: { not: 'DISCONNECTED' } },
        select: {
          id: true,
          status: true,
          connectedAt: true,
          revokedAt: true,
          lastVerifiedAt: true
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }]
      });

      const property = connection
        ? await prisma.searchConsoleProperty.findFirst({
            where: { projectId: project.id, connectionId: connection.id, isActive: true },
            select: {
              id: true,
              propertyUri: true,
              propertyType: true,
              permissionState: true,
              isActive: true,
              lastSyncAt: true
            },
            orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }]
          })
        : null;

      const snapshots = property
        ? await prisma.gscDailySnapshot.findMany({
            where: { projectId: project.id, propertyId: property.id },
            select: {
              id: true,
              date: true,
              status: true,
              syncVersion: true,
              rowCount: true,
              sourceFreshness: true,
              sourceCompletenessState: true,
              errorCode: true,
              startedAt: true,
              completedAt: true
            },
            orderBy: [{ date: 'desc' }, { syncVersion: 'desc' }, { id: 'asc' }],
            take: 120
          })
        : [];

      const latestSnapshot = snapshots[0] ?? null;
      const latestCompleted = snapshots.find((row) => row.status === 'COMPLETED') ?? null;
      const coverage = latestCompleted
        ? assessStableWindowCoverage(
            resolveStableWindows(addUtcDays(latestCompleted.date, GROWTH_WINDOW_V1.excludeRecentDays)),
            snapshots
          )
        : null;

      let uiState: SearchConsoleUiState = 'NOT_CONNECTED';
      if (connection?.status === 'TOKEN_REVOKED') uiState = 'TOKEN_REVOKED';
      else if (connection?.status === 'PERMISSION_DENIED') uiState = 'PERMISSION_DENIED';
      else if (connection?.status === 'CONNECTED' && !property) uiState = 'CONNECTED';
      else if (connection?.status === 'CONNECTED' && property) {
        if (latestSnapshot?.status === 'RUNNING' || latestSnapshot?.status === 'PENDING') uiState = 'SYNCING';
        else if (latestSnapshot?.status === 'FAILED') uiState = 'SYNC_FAILED';
        else if (coverage?.state === 'ELIGIBLE') uiState = 'READY';
        else uiState = 'PROPERTY_SELECTED';
      }

      res.render('layout', {
        title: `Google Search Console · ${project.name}`,
        activeNav: 'search-console',
        currentProjectId: project.id,
        breadcrumbs: ['项目', project.name, 'Google Search Console'],
        bodyTemplate: 'search-console/settings',
        project,
        connection,
        property,
        latestSnapshot,
        coverage,
        uiState,
        csrfToken: csrfTokenFor(req, res),
        syncQueuedDateCount: req.query.syncQueued === '56' ? 56 : null,
        pageScripts: ['/assets/js/search-console-settings.js']
      });
    } catch (error) { next(error); }
  });

  return router;
}

export const searchConsoleWebRoutes = createSearchConsoleWebRoutes();
