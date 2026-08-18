import { prisma } from '../../db/prisma.js';

export class ReportWebRepository {
  async getCenter(projectId: string) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, primaryDomain: true, planLevel: true }
    });
    if (!project) return null;
    const reports = await prisma.reportSnapshot.findMany({
      where: { projectId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    });
    return { project, reports };
  }

  async getDetail(projectId: string, reportId: string) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, primaryDomain: true, planLevel: true }
    });
    if (!project) return null;
    const report = await prisma.reportSnapshot.findFirst({ where: { id: reportId, projectId } });
    if (!report) return null;

    const executiveTask = report.executiveAiTaskId
      ? await prisma.aiTask.findUnique({
          where: { id: report.executiveAiTaskId },
          include: {
            runs: {
              orderBy: { attemptNo: 'desc' },
              take: 1,
              include: { result: true }
            }
          }
        })
      : null;

    return { project, report, executiveTask };
  }
}

export const reportWebRepository = new ReportWebRepository();
