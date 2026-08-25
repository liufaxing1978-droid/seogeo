import type { ProjectRole } from '@prisma/client';
import { Router } from 'express';
import { requireAuthentication } from '../../auth/authentication.js';
import { requireCsrf } from '../../auth/csrf.js';
import {
  requireProjectCapability,
  requireProjectMembership,
} from '../../auth/project-access.js';
import { ProjectMembershipService } from './project-membership.service.js';

export function createProjectMembershipRoutes(
  service = new ProjectMembershipService(),
) {
  const router = Router();

  router.get(
    '/:projectId/members',
    requireAuthentication(),
    requireProjectMembership(),
    requireProjectCapability('PROJECT_MEMBER_READ'),
    async (req, res, next) => {
      try {
        res.json({ data: await service.list(req.params.projectId) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/:projectId/members',
    requireAuthentication(),
    requireCsrf(),
    requireProjectMembership(),
    requireProjectCapability('PROJECT_MEMBER_MANAGE_BASIC'),
    async (req, res, next) => {
      try {
        const result = await service.addOrReactivate({
          actorUserId: req.auth!.userId,
          actorRole: res.locals.projectMembership.role as ProjectRole,
          projectId: req.params.projectId,
          email: req.body?.email,
          role: req.body?.role,
        });
        res.status(result.created ? 201 : 200).json({ data: result.membership });
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch(
    '/:projectId/members/:membershipId',
    requireAuthentication(),
    requireCsrf(),
    requireProjectMembership(),
    requireProjectCapability('PROJECT_MEMBER_MANAGE_BASIC'),
    async (req, res, next) => {
      try {
        const membership = await service.changeRole({
          actorUserId: req.auth!.userId,
          actorRole: res.locals.projectMembership.role as ProjectRole,
          projectId: req.params.projectId,
          membershipId: req.params.membershipId,
          role: req.body?.role,
        });
        res.json({ data: membership });
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    '/:projectId/members/:membershipId',
    requireAuthentication(),
    requireCsrf(),
    requireProjectMembership(),
    requireProjectCapability('PROJECT_MEMBER_MANAGE_BASIC'),
    async (req, res, next) => {
      try {
        await service.revoke({
          actorUserId: req.auth!.userId,
          actorRole: res.locals.projectMembership.role as ProjectRole,
          projectId: req.params.projectId,
          membershipId: req.params.membershipId,
        });
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
