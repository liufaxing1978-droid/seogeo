import { prisma } from '../../db/prisma.js';

const PROJECT_SELECT = {
  id: true,
  name: true,
  primaryDomain: true,
  planLevel: true
} as const;

export const publicationWebRepository = {
  async getCenter(projectId: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: PROJECT_SELECT });
    if (!project) return null;
    const [sites, proposals, drafts, plans, executions, verifications] = await Promise.all([
      prisma.publicationSite.findMany({
        where: { projectId },
        include: { channels: { where: { enabled: true }, orderBy: [{ pathPrefix: 'asc' }, { id: 'asc' }], take: 20 } },
        orderBy: [{ enabled: 'desc' }, { createdAt: 'asc' }],
        take: 20
      }),
      prisma.publicationProposal.findMany({
        where: { projectId },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: 50
      }),
      prisma.contentDraft.findMany({
        where: { projectId },
        include: { sourceProposal: true },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        take: 50
      }),
      prisma.publicationPlan.findMany({
        where: { projectId },
        include: { preview: true, draft: true, site: true, channel: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: 50
      }),
      prisma.publicationExecution.findMany({
        where: { projectId },
        include: { plan: { include: { draft: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: 50
      }),
      prisma.publicationVerification.findMany({
        where: { projectId },
        include: { execution: { include: { plan: { include: { draft: true } } } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: 50
      })
    ]);
    return { project, sites, proposals, drafts, plans, executions, verifications };
  },

  async listOpportunities(projectId: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: PROJECT_SELECT });
    if (!project) return null;
    const proposals = await prisma.publicationProposal.findMany({
      where: { projectId },
      include: { drafts: { select: { id: true, title: true, status: true }, take: 10 } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 100
    });
    return { project, proposals };
  },

  async listDrafts(projectId: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: PROJECT_SELECT });
    if (!project) return null;
    const drafts = await prisma.contentDraft.findMany({
      where: { projectId },
      include: { sourceProposal: true, _count: { select: { versions: true, sourceRefs: true, plans: true } } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: 100
    });
    return { project, drafts };
  },

  async getDraft(projectId: string, draftId: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: PROJECT_SELECT });
    if (!project) return null;
    const draft = await prisma.contentDraft.findFirst({
      where: { id: draftId, projectId },
      include: {
        sourceProposal: true,
        versions: { orderBy: [{ version: 'desc' }, { id: 'asc' }], take: 20 },
        sourceRefs: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 50 },
        plans: {
          include: { preview: true, site: true, channel: true, executions: { orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 10 } },
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: 20
        }
      }
    });
    return draft ? { project, draft } : null;
  },

  async getPlan(projectId: string, planId: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: PROJECT_SELECT });
    if (!project) return null;
    const plan = await prisma.publicationPlan.findFirst({
      where: { id: planId, projectId },
      include: {
        proposal: true,
        draft: true,
        site: true,
        channel: true,
        preview: true,
        approvals: { orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 10 },
        executions: { orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 20 }
      }
    });
    return plan ? { project, plan } : null;
  },

  async getExecution(projectId: string, executionId: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: PROJECT_SELECT });
    if (!project) return null;
    const execution = await prisma.publicationExecution.findFirst({
      where: { id: executionId, projectId },
      include: {
        plan: { include: { draft: true, site: true, channel: true, preview: true } },
        approval: true,
        events: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 100 },
        verifications: { orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 50 },
        rollbackProposals: { orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 20 }
      }
    });
    return execution ? { project, execution } : null;
  },

  async getVerification(projectId: string, verificationId: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: PROJECT_SELECT });
    if (!project) return null;
    const verification = await prisma.publicationVerification.findFirst({
      where: { id: verificationId, projectId },
      include: {
        execution: {
          include: {
            plan: { include: { draft: true, site: true, channel: true } }
          }
        }
      }
    });
    return verification ? { project, verification } : null;
  }
};
