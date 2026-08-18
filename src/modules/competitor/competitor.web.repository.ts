import { prisma } from '../../db/prisma.js';

export class CompetitorWebRepository {
  async getCenter(projectId: string) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, primaryDomain: true, planLevel: true }
    });
    if (!project) return null;

    const competitors = await prisma.competitor.findMany({
      where: { projectId },
      include: {
        crawls: { orderBy: { createdAt: 'desc' }, take: 1 },
        comparisons: { orderBy: { createdAt: 'desc' }, take: 1 }
      },
      orderBy: { createdAt: 'asc' }
    });

    return { project, competitors };
  }

  async getDetail(projectId: string, competitorId: string) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, primaryDomain: true, planLevel: true }
    });
    if (!project) return null;

    const competitor = await prisma.competitor.findFirst({
      where: { id: competitorId, projectId },
      include: {
        crawls: {
          include: { snapshots: { orderBy: { fetchedAt: 'desc' }, take: 25 } },
          orderBy: { createdAt: 'desc' },
          take: 10
        },
        comparisons: { orderBy: { createdAt: 'desc' }, take: 10 }
      }
    });
    if (!competitor) return null;

    return { project, competitor };
  }
}

export const competitorWebRepository = new CompetitorWebRepository();
