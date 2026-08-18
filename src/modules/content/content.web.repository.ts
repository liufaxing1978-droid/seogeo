import { prisma } from '../../db/prisma.js';

export const contentWebRepository = {
  async getCenter(projectId: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return null;
    const [documents, openOpportunities, briefs] = await Promise.all([
      prisma.contentDocument.findMany({
        where: { projectId },
        include: { _count: { select: { signals: true, opportunities: true, briefs: true } } },
        orderBy: [{ extractedAt: 'desc' }, { canonicalUrl: 'asc' }],
        take: 100
      }),
      prisma.contentOpportunity.findMany({
        where: { projectId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
        include: { document: { select: { id: true, canonicalUrl: true, title: true } } },
        orderBy: [{ priority: 'desc' }, { lastDetectedAt: 'desc' }],
        take: 50
      }),
      prisma.contentBrief.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 20 })
    ]);
    return { project, documents, openOpportunities, briefs };
  },

  async getDocument(projectId: string, documentId: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return null;
    const document = await prisma.contentDocument.findFirst({
      where: { id: documentId, projectId },
      include: {
        signals: { orderBy: { ruleKey: 'asc' } },
        opportunities: { orderBy: [{ priority: 'desc' }, { lastDetectedAt: 'desc' }] },
        briefs: { orderBy: { createdAt: 'desc' } }
      }
    });
    return document ? { project, document } : null;
  },

  async getBrief(projectId: string, briefId: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return null;
    const brief = await prisma.contentBrief.findFirst({ where: { id: briefId, projectId } });
    return brief ? { project, brief } : null;
  }
};
