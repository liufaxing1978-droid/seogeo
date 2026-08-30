import type { KeywordType, ProjectRole } from '@prisma/client';
import { Router } from 'express';
import { requireAuthentication } from '../../auth/authentication.js';
import { deriveCsrfToken, requireCsrf } from '../../auth/csrf.js';
import { hasProjectCapability } from '../../auth/project-capabilities.js';
import {
  requireProjectCapability,
  requireProjectMembership,
} from '../../auth/project-access.js';
import { env } from '../../config/env.js';
import { AppError, NotFoundError } from '../../core/errors.js';
import {
  keywordCoverageService,
  type KeywordCoverageService,
} from './keyword-coverage.service.js';
import { KeywordDiscoveryRepository } from './keyword-discovery.repository.js';
import { KeywordDiscoveryService } from './keyword-discovery.service.js';
import {
  keywordSearchEvidenceService,
  type KeywordSearchEvidenceService,
} from './keyword-search-evidence.service.js';
import { KeywordWebRepository } from './keyword.web.repository.js';

export type KeywordDiscoveryWebService = Pick<
  KeywordDiscoveryService,
  'list' | 'accept' | 'reject'
>;

const keywordTypes = new Set<KeywordType>([
  'CORE',
  'LONG_TAIL',
  'BRAND',
  'QUESTION',
  'LOCAL',
  'COMMERCIAL',
]);

function routeParam(value: string | string[] | undefined): string {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (!normalized) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
  return normalized;
}

function csrfTokenFor(req: any, res: any): string {
  const tokenHash = res.locals.authSessionTokenHash;
  if (!req.auth || typeof tokenHash !== 'string') {
    throw new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED');
  }
  return deriveCsrfToken(env.SESSION_SECRET, req.auth.sessionId, tokenHash);
}

function parseKeywordType(value: unknown): KeywordType {
  const normalized = String(value ?? 'LONG_TAIL') as KeywordType;
  if (!keywordTypes.has(normalized)) {
    throw new AppError('Keyword type is invalid', 400, 'KEYWORD_TYPE_INVALID');
  }
  return normalized;
}

function defaultKeywordDiscoveryService(): KeywordDiscoveryService {
  return new KeywordDiscoveryService({
    repository: new KeywordDiscoveryRepository(),
  });
}

export function createKeywordDiscoveryWebRoutes(
  coverageService: KeywordCoverageService = keywordCoverageService,
  searchEvidenceService: Pick<KeywordSearchEvidenceService, 'evaluateProject'> = keywordSearchEvidenceService,
  discoveryService: KeywordDiscoveryWebService = defaultKeywordDiscoveryService(),
) {
  const router = Router();
  const readGuards = [
    requireAuthentication(),
    requireProjectMembership(),
    requireProjectCapability('PROJECT_READ'),
  ];
  const writeGuards = [
    requireAuthentication(),
    requireCsrf(),
    requireProjectMembership(),
    requireProjectCapability('CONTENT_WRITE'),
  ];
  const webRepository = new KeywordWebRepository(coverageService, undefined, searchEvidenceService);

  router.get('/projects/:projectId/keywords', ...readGuards, async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const [model, discoveryRows] = await Promise.all([
        webRepository.load(projectId),
        discoveryService.list({ projectId }),
      ]);
      const membership = res.locals.projectMembership as { role: ProjectRole };

      res.render('layout', {
        title: `关键词中心 · ${model.project.name}`,
        heading: '关键词中心',
        activeNav: 'keywords',
        currentProjectId: projectId,
        currentProjectName: model.project.name,
        bodyTemplate: 'keywords/index-discovery',
        csrfToken: csrfTokenFor(req, res),
        canWriteKeywords: hasProjectCapability(membership.role, 'CONTENT_WRITE'),
        canRunKeywordAi: hasProjectCapability(membership.role, 'AI_RUN'),
        keywordCenter: model,
        keywordDiscoveries: discoveryRows.filter((row) => row.status === 'PENDING'),
      });
    } catch (error) {
      next(error);
    }
  });

  router.post(
    '/projects/:projectId/keyword-discoveries/:candidateId/accept',
    ...writeGuards,
    async (req, res, next) => {
      try {
        const projectId = routeParam(req.params.projectId);
        await discoveryService.accept({
          actorUserId: req.auth!.userId,
          projectId,
          candidateId: routeParam(req.params.candidateId),
          type: parseKeywordType(req.body?.type),
        });
        res.redirect(303, `/projects/${projectId}/keywords`);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/projects/:projectId/keyword-discoveries/:candidateId/reject',
    ...writeGuards,
    async (req, res, next) => {
      try {
        const projectId = routeParam(req.params.projectId);
        await discoveryService.reject({
          actorUserId: req.auth!.userId,
          projectId,
          candidateId: routeParam(req.params.candidateId),
        });
        res.redirect(303, `/projects/${projectId}/keywords`);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
