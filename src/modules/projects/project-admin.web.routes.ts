import type { ProjectRole } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuthentication } from '../../auth/authentication.js';
import { deriveCsrfToken, requireCsrf } from '../../auth/csrf.js';
import { hasFeature, type Feature } from '../../auth/feature-flags.js';
import {
  requireProjectCapability,
  requireProjectMembership,
} from '../../auth/project-access.js';
import {
  hasProjectCapability,
  type ProjectCapability,
} from '../../auth/project-capabilities.js';
import { env } from '../../config/env.js';
import { AppError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { ProjectMembershipService } from './project-membership.service.js';
import { projectRepository } from './project.repository.js';
import { ProjectService } from './project.service.js';

const projectIdSchema = z.string().uuid();
const membershipIdSchema = z.string().uuid();
const membershipService = new ProjectMembershipService();
const projectService = new ProjectService(projectRepository);

const CAPABILITIES: ProjectCapability[] = [
  'PROJECT_READ',
  'PROJECT_SETTINGS_WRITE',
  'PROJECT_MEMBER_READ',
  'PROJECT_MEMBER_MANAGE_BASIC',
  'PROJECT_MEMBER_MANAGE_ALL',
  'CRAWL_RUN',
  'SEO_RUN',
  'GEO_RUN',
  'AI_RUN',
  'CONTENT_WRITE',
  'PUBLICATION_PREPARE',
  'PUBLICATION_EXECUTE',
  'DISTRIBUTION_EXECUTE',
  'OPTIMIZATION_RUN',
  'AUTOPILOT_POLICY_REVISE',
  'EXPERIMENT_READ',
  'FEEDBACK_READ',
];

const SETTINGS_FEATURES: Array<{ feature: Feature; label: string }> = [
  { feature: 'SEO_AUDIT', label: 'SEO Audit' },
  { feature: 'AI_ANALYSIS', label: 'AI Analysis' },
  { feature: 'AI_VISIBILITY', label: 'AI Visibility' },
  { feature: 'SEARCH_CONSOLE', label: 'Search Console' },
  { feature: 'OPTIMIZATION_OPERATIONS_CENTER', label: 'Optimization Operations' },
  { feature: 'OPTIMIZATION_EXPERIMENTS', label: 'Optimization Experiments' },
  { feature: 'PUBLICATION_WORKSPACE', label: 'Publication Workspace' },
  { feature: 'PUBLICATION_DISTRIBUTION', label: 'Publication Distribution' },
];

function csrfTokenFor(req: any, res: any): string {
  const tokenHash = res.locals.authSessionTokenHash;
  if (!req.auth || typeof tokenHash !== 'string') {
    throw new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED');
  }
  return deriveCsrfToken(env.SESSION_SECRET, req.auth.sessionId, tokenHash);
}

function actorRole(res: any): ProjectRole {
  return res.locals.projectMembership.role as ProjectRole;
}

function projectId(req: any): string {
  return projectIdSchema.parse(req.params.id);
}

function renderMembers(req: any, res: any, members: Awaited<ReturnType<ProjectMembershipService['list']>>) {
  const project = res.locals.project;
  const role = actorRole(res);
  const capabilityRows = CAPABILITIES.map((capability) => ({
    capability,
    enabled: hasProjectCapability(role, capability),
  }));

  return res.render('layout', {
    title: `成员与权限 · ${project.name}`,
    activeNav: 'members',
    currentProjectId: project.id,
    bodyTemplate: 'project-admin/members',
    project,
    membership: res.locals.projectMembership,
    members,
    capabilityRows,
    canManageBasic: hasProjectCapability(role, 'PROJECT_MEMBER_MANAGE_BASIC'),
    canManageAll: hasProjectCapability(role, 'PROJECT_MEMBER_MANAGE_ALL'),
    csrfToken: csrfTokenFor(req, res),
  });
}

export function createProjectAdminWebRoutes() {
  const router = Router();

  router.get(
    '/projects/:id/members',
    requireAuthentication(),
    requireProjectMembership(),
    requireProjectCapability('PROJECT_MEMBER_READ'),
    async (req, res, next) => {
      try {
        renderMembers(req, res, await membershipService.list(projectId(req)));
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/projects/:id/members',
    requireAuthentication(),
    requireCsrf(),
    requireProjectMembership(),
    requireProjectCapability('PROJECT_MEMBER_MANAGE_BASIC'),
    async (req, res, next) => {
      try {
        const id = projectId(req);
        await membershipService.addOrReactivate({
          actorUserId: req.auth!.userId,
          actorRole: actorRole(res),
          projectId: id,
          email: req.body?.email,
          role: req.body?.role,
        });
        res.redirect(303, `/projects/${id}/members`);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/projects/:id/members/:membershipId/role',
    requireAuthentication(),
    requireCsrf(),
    requireProjectMembership(),
    requireProjectCapability('PROJECT_MEMBER_MANAGE_BASIC'),
    async (req, res, next) => {
      try {
        const id = projectId(req);
        await membershipService.changeRole({
          actorUserId: req.auth!.userId,
          actorRole: actorRole(res),
          projectId: id,
          membershipId: membershipIdSchema.parse(req.params.membershipId),
          role: req.body?.role,
        });
        res.redirect(303, `/projects/${id}/members`);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/projects/:id/members/:membershipId/revoke',
    requireAuthentication(),
    requireCsrf(),
    requireProjectMembership(),
    requireProjectCapability('PROJECT_MEMBER_MANAGE_BASIC'),
    async (req, res, next) => {
      try {
        const id = projectId(req);
        await membershipService.revoke({
          actorUserId: req.auth!.userId,
          actorRole: actorRole(res),
          projectId: id,
          membershipId: membershipIdSchema.parse(req.params.membershipId),
        });
        res.redirect(303, `/projects/${id}/members`);
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/projects/:id/settings',
    requireAuthentication(),
    requireProjectMembership(),
    requireProjectCapability('PROJECT_READ'),
    async (req, res, next) => {
      try {
        const project = res.locals.project;
        const role = actorRole(res);
        const [user, session] = await Promise.all([
          prisma.user.findFirst({
            where: { id: req.auth!.userId, status: 'ACTIVE' },
            select: { id: true, email: true, displayName: true, status: true },
          }),
          prisma.userSession.findFirst({
            where: {
              id: req.auth!.sessionId,
              userId: req.auth!.userId,
              revokedAt: null,
              expiresAt: { gt: new Date() },
            },
            select: { id: true, createdAt: true, expiresAt: true },
          }),
        ]);

        const deepseekConfigured = Boolean(env.DEEPSEEK_API_KEY);
        const searchConsoleConfigured = Boolean(
          env.GOOGLE_OAUTH_CLIENT_ID
          && env.GOOGLE_OAUTH_CLIENT_SECRET
          && env.GOOGLE_OAUTH_REDIRECT_URI
          && env.OAUTH_CREDENTIAL_ENCRYPTION_KEY,
        );

        res.render('layout', {
          title: `设置 · ${project.name}`,
          activeNav: 'settings',
          currentProjectId: project.id,
          bodyTemplate: 'project-admin/settings',
          project,
          membership: res.locals.projectMembership,
          canWriteSettings: hasProjectCapability(role, 'PROJECT_SETTINGS_WRITE'),
          csrfToken: csrfTokenFor(req, res),
          user,
          session,
          featureRows: SETTINGS_FEATURES.map(({ feature, label }) => ({
            feature,
            label,
            enabled: hasFeature(project.planLevel, feature),
          })),
          providerState: {
            deepseek: {
              configured: deepseekConfigured,
              baseUrl: env.DEEPSEEK_BASE_URL,
              fastModel: env.DEEPSEEK_FAST_MODEL,
              reasoningModel: env.DEEPSEEK_REASONING_MODEL,
              timeoutMs: env.DEEPSEEK_TIMEOUT_MS,
            },
            searchConsole: {
              configured: searchConsoleConfigured,
              redirectUriConfigured: Boolean(env.GOOGLE_OAUTH_REDIRECT_URI),
            },
          },
          runtimeState: {
            nodeEnv: env.NODE_ENV,
            crawlerUserAgent: env.CRAWLER_USER_AGENT,
            crawlerMaxPages: env.CRAWLER_MAX_PAGES,
            crawlerConcurrency: env.CRAWLER_CONCURRENCY,
            crawlerRequestTimeoutMs: env.CRAWLER_REQUEST_TIMEOUT_MS,
            crawlerMaxResponseBytes: env.CRAWLER_MAX_RESPONSE_BYTES,
            crawlerBrowserEnabled: env.CRAWLER_BROWSER_ENABLED,
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/projects/:id/settings',
    requireAuthentication(),
    requireCsrf(),
    requireProjectMembership(),
    requireProjectCapability('PROJECT_SETTINGS_WRITE'),
    async (req, res, next) => {
      try {
        const id = projectId(req);
        await projectService.update(id, {
          name: req.body?.name,
          primaryDomain: req.body?.primaryDomain,
          industry: req.body?.industry,
          defaultLanguage: req.body?.defaultLanguage,
          targetCountry: req.body?.targetCountry,
          timezone: req.body?.timezone,
        });
        res.redirect(303, `/projects/${id}/settings`);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
