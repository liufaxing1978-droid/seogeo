import { Router } from 'express';
import { hasFeature } from '../../auth/feature-flags.js';
import { AppError, NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { createReportExecutiveSummaryTask } from '../ai/report-intelligence.js';
import { aiTaskService, type AiTaskService } from '../ai/ai.service.js';
import { generateProjectReport } from './report-builder.js';

async function requireProject(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
  if (!hasFeature(project.planLevel, 'REPORTING')) throw new AppError('Reporting is not available for this project plan', 403, 'FEATURE_NOT_AVAILABLE');
  return project;
}

async function requireReport(projectId: string, reportId: string) {
  await requireProject(projectId);
  const report = await prisma.reportSnapshot.findFirst({ where: { id: reportId, projectId } });
  if (!report) throw new NotFoundError('Report not found', 'REPORT_NOT_FOUND');
  return report;
}

export function createReportRoutes(aiService: AiTaskService = aiTaskService) {
  const router = Router();

  router.post('/projects/:projectId/reports', async (req, res, next) => {
    try {
      await requireProject(req.params.projectId);
      const report = await generateProjectReport(req.params.projectId);
      res.status(201).json({ data: report });
    } catch (error) { next(error); }
  });

  router.get('/projects/:projectId/reports', async (req, res, next) => {
    try {
      await requireProject(req.params.projectId);
      const data = await prisma.reportSnapshot.findMany({ where: { projectId: req.params.projectId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      res.json({ data });
    } catch (error) { next(error); }
  });

  router.get('/projects/:projectId/reports/:reportId', async (req, res, next) => {
    try {
      res.json({ data: await requireReport(req.params.projectId, req.params.reportId) });
    } catch (error) { next(error); }
  });

  router.get('/projects/:projectId/reports/:reportId/export.json', async (req, res, next) => {
    try {
      const report = await requireReport(req.params.projectId, req.params.reportId);
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.setHeader('content-disposition', `attachment; filename="report-${report.id}.json"`);
      res.status(200).send(JSON.stringify(report, null, 2));
    } catch (error) { next(error); }
  });

  router.post('/projects/:projectId/reports/:reportId/ai-summary', async (req, res, next) => {
    try {
      await requireReport(req.params.projectId, req.params.reportId);
      const task = await createReportExecutiveSummaryTask(req.params.projectId, req.params.reportId, aiService);
      res.status(202).json({ data: { id: task.id, taskType: task.taskType, status: task.status, promptVersion: task.promptVersion } });
    } catch (error) { next(error); }
  });

  return router;
}
