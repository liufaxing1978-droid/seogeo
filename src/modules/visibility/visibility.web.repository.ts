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

function metricValue(row: { metricStatus: string; numerator: number; denominator: number } | undefined) {
  if (!row) return null;
  return {
    status: row.metricStatus,
    numerator: row.numerator,
    denominator: row.denominator,
    ratio: row.metricStatus === 'CALCULATED' && row.denominator > 0 ? row.numerator / row.denominator : null
  };
}

export class VisibilityWebRepository {
  async getOverview(projectId: string) {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, name: true, primaryDomain: true, planLevel: true }
    });
    if (!project) return null;

    const [settings, providers, promptSetCount, promptCount, recentRuns, observationCount, spend, latestSnapshot, openAlertCount] = await Promise.all([
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
      }),
      prisma.visibilityMetricSnapshot.findFirst({
        where: { projectId, status: 'COMPLETED' },
        select: {
          id: true,
          formulaVersion: true,
          extractorVersion: true,
          subjectSetHash: true,
          scopeHash: true,
          windowStart: true,
          windowEnd: true,
          inputCutoffAt: true,
          completedAt: true,
          candidateObservationCount: true,
          completedExtractionCount: true
        },
        orderBy: [{ windowEnd: 'desc' }, { createdAt: 'desc' }]
      }),
      prisma.visibilityAlertEvent.count({ where: { projectId, status: 'OPEN' } })
    ]);

    let visibilitySummary = null;
    if (latestSnapshot) {
      const [rows, comparison, providerRows] = await Promise.all([
        prisma.visibilityMetricRow.findMany({
          where: {
            projectId,
            visibilityMetricSnapshotId: latestSnapshot.id,
            dimensionType: 'OVERALL',
            dimensionKey: 'OVERALL'
          },
          select: {
            metricType: true,
            metricStatus: true,
            actorType: true,
            actorKey: true,
            numerator: true,
            denominator: true
          }
        }),
        prisma.visibilityMetricComparison.findFirst({
          where: { projectId, currentSnapshotId: latestSnapshot.id },
          select: {
            id: true,
            previousSnapshotId: true,
            gapDurationMs: true,
            rows: {
              where: { dimensionType: 'OVERALL', dimensionKey: 'OVERALL', actorKey: 'OWNED_ROLLUP' },
              select: { metricType: true, deltaBasisPoints: true, previousMetricStatus: true, currentMetricStatus: true }
            }
          },
          orderBy: { createdAt: 'desc' }
        }),
        prisma.visibilityMetricRow.findMany({
          where: { projectId, visibilityMetricSnapshotId: latestSnapshot.id, dimensionType: 'PROVIDER' },
          distinct: ['dimensionKey'],
          select: { dimensionKey: true }
        })
      ]);
      const owned = (metricType: 'MENTION_RATE' | 'CITATION_RATE' | 'MENTION_SHARE_OF_VOICE') =>
        rows.find((row) => row.metricType === metricType && row.actorKey === 'OWNED_ROLLUP');
      visibilitySummary = {
        snapshot: latestSnapshot,
        mentionRate: metricValue(owned('MENTION_RATE')),
        citationRate: metricValue(owned('CITATION_RATE')),
        ownedSov: metricValue(owned('MENTION_SHARE_OF_VOICE')),
        evidenceCoverageRatio: latestSnapshot.candidateObservationCount > 0
          ? latestSnapshot.completedExtractionCount / latestSnapshot.candidateObservationCount
          : null,
        comparison: comparison ? {
          id: comparison.id,
          previousSnapshotId: comparison.previousSnapshotId,
          gapDurationMs: comparison.gapDurationMs.toString(),
          deltas: comparison.rows
        } : null,
        providerCoverageCount: providerRows.length,
        openAlertCount
      };
    }

    return {
      project,
      settings,
      providers,
      promptSetCount,
      promptCount,
      recentRuns,
      observationCount,
      recordedSpendMicros: spend._sum.costMicros ?? 0,
      visibilitySummary
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
