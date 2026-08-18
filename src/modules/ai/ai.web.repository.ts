import { prisma } from '../../db/prisma.js';
import { AiRepository } from './ai.repository.js';

const aiRepository = new AiRepository();

export const aiWebRepository = {
  async getCenter(projectId: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return null;

    const [latestSeoAudit, latestGeoAudit, tasks] = await Promise.all([
      prisma.seoAuditRun.findFirst({
        where: { projectId, status: 'COMPLETED' },
        orderBy: [{ finishedAt: 'desc' }, { createdAt: 'desc' }],
        select: { id: true, engineVersion: true, finishedAt: true, eligiblePages: true, rulesEvaluated: true }
      }),
      prisma.geoAuditRun.findFirst({
        where: { projectId, status: 'COMPLETED' },
        orderBy: [{ finishedAt: 'desc' }, { createdAt: 'desc' }],
        select: { id: true, engineVersion: true, finishedAt: true, eligiblePages: true, rulesEvaluated: true }
      }),
      prisma.aiTask.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          taskType: true,
          status: true,
          promptVersion: true,
          errorCode: true,
          errorMessage: true,
          createdAt: true,
          updatedAt: true,
          runs: {
            orderBy: { attemptNo: 'desc' },
            take: 1,
            select: {
              status: true,
              provider: true,
              model: true,
              mode: true,
              result: { select: { summary: true, createdAt: true } }
            }
          }
        }
      })
    ]);

    return { project, latestSeoAudit, latestGeoAudit, tasks };
  },

  async getTaskPage(projectId: string, taskId: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return null;
    const task = await aiRepository.getTaskDetail(taskId);
    if (!task || task.projectId !== projectId) return null;
    return { project, task };
  }
};
