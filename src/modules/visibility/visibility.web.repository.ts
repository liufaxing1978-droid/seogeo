import { prisma } from '../../db/prisma.js';

function normalizeCitations(value: unknown) {
  if (!Array.isArray(value)) return [] as Array<{ url: string; title: string | null; position: number | null; sourceType: string | null }>;
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const source = item as Record<string, unknown>;
    if (typeof source.url !== 'string') return [];
    return [{
      url: source.url,
      title: typeof source.title === 'string' ? source.title : null,
      position: typeof source.position === 'number' ? source.position : null,
      sourceType: typeof source.sourceType === 'string' ? source.sourceType : null
    }];
  });
}

export class VisibilityWebRepository {
  async getOverview(projectId: string) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, primaryDomain: true, planLevel: true }
    });
    if (!project) return null;

    const [settings, providers, promptSetCount, promptCount, recentRuns, observationCount, spend] = await Promise.all([
      prisma.visibilityProjectSettings.findUnique({ where: { projectId } }),
      prisma.visibilityProviderConfig.findMany({
        where: { projectId },
        orderBy: [{ provider: 'asc' }, { model: 'asc' }, { id: 'asc' }]
      }),
      prisma.visibilityPromptSet.count({ where: { projectId } }),
      prisma.visibilityPrompt.count({ where: { projectId } }),
      prisma.visibilityRun.findMany({
        where: { projectId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 10,
        include: { _count: { select: { observations: true } } }
      }),
      prisma.platformObservation.count({ where: { projectId } }),
      prisma.platformObservation.aggregate({
        where: { projectId, status: 'COMPLETED' },
        _sum: { costMicros: true }
      })
    ]);

    return {
      project,
      settings,
      providers,
      promptSetCount,
      promptCount,
      recentRuns,
      observationCount,
      recordedSpendMicros: spend._sum.costMicros ?? 0
    };
  }

  async getPromptMonitor(projectId: string) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, primaryDomain: true, planLevel: true }
    });
    if (!project) return null;

    const [promptSets, prompts] = await Promise.all([
      prisma.visibilityPromptSet.findMany({
        where: { projectId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
      }),
      prisma.visibilityPrompt.findMany({
        where: { projectId },
        orderBy: [{ promptKey: 'asc' }, { version: 'desc' }, { id: 'desc' }]
      })
    ]);

    return { project, promptSets, prompts };
  }

  async getRunDetail(projectId: string, runId: string) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, primaryDomain: true, planLevel: true }
    });
    if (!project) return null;

    const run = await prisma.visibilityRun.findFirst({
      where: { id: runId, projectId },
      include: {
        promptSet: true,
        observations: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: { prompt: true }
        }
      }
    });
    if (!run) return null;

    return {
      project,
      run: {
        ...run,
        observations: run.observations.map((observation) => ({
          ...observation,
          citations: normalizeCitations(observation.citationsJson)
        }))
      }
    };
  }
}

export const visibilityWebRepository = new VisibilityWebRepository();
