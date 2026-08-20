import type { Project } from '@prisma/client';
import { hasFeature } from '../auth/feature-flags.js';
import { prisma } from '../db/prisma.js';
import type {
  PortfolioDashboardViewModel,
  ProjectDashboardFacts,
  SafeMetricValue,
  VisibilityDashboardFacts
} from './view-models.js';

export interface DashboardVisibilityReader {
  getLatest(projectId: string): Promise<VisibilityDashboardFacts | null>;
}

class PrismaDashboardVisibilityReader implements DashboardVisibilityReader {
  async getLatest(projectId: string): Promise<VisibilityDashboardFacts | null> {
    const snapshot = await prisma.visibilityMetricSnapshot.findFirst({
      where: { projectId, status: 'COMPLETED' },
      orderBy: [{ windowEnd: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true }
    });
    if (!snapshot) return null;

    const [rows, openAlertCount] = await Promise.all([
      prisma.visibilityMetricRow.findMany({
        where: {
          projectId,
          visibilityMetricSnapshotId: snapshot.id,
          dimensionType: 'OVERALL',
          dimensionKey: 'OVERALL',
          actorKey: 'OWNED_ROLLUP',
          metricType: { in: ['MENTION_RATE', 'CITATION_RATE', 'MENTION_SHARE_OF_VOICE'] }
        },
        select: {
          metricType: true,
          metricStatus: true,
          numerator: true,
          denominator: true
        }
      }),
      prisma.visibilityAlertEvent.count({ where: { projectId, status: 'OPEN' } })
    ]);

    const valueFor = (metricType: 'MENTION_RATE' | 'CITATION_RATE' | 'MENTION_SHARE_OF_VOICE'): SafeMetricValue => {
      const row = rows.find((candidate) => candidate.metricType === metricType);
      if (!row) {
        return { status: 'NO_DATA', numerator: null, denominator: null, ratio: null };
      }
      return {
        status: row.metricStatus,
        numerator: row.numerator,
        denominator: row.denominator,
        ratio: row.metricStatus === 'CALCULATED' && row.denominator > 0
          ? row.numerator / row.denominator
          : null
      };
    };

    return {
      snapshotId: snapshot.id,
      mentionRate: valueFor('MENTION_RATE'),
      citationRate: valueFor('CITATION_RATE'),
      ownedSov: valueFor('MENTION_SHARE_OF_VOICE'),
      openAlertCount
    };
  }
}

export interface DashboardRepositoryOptions {
  visibilityReader?: DashboardVisibilityReader;
}

export type DashboardProject = Pick<
  Project,
  'id' | 'name' | 'primaryDomain' | 'planLevel' | 'status' | 'defaultLanguage' | 'targetCountry' | 'timezone' | 'industry' | 'createdAt' | 'updatedAt'
>;

export class DashboardRepository {
  private readonly visibilityReader: DashboardVisibilityReader;

  constructor(options: DashboardRepositoryOptions = {}) {
    this.visibilityReader = options.visibilityReader ?? new PrismaDashboardVisibilityReader();
  }

  async getProjectFacts(project: DashboardProject): Promise<ProjectDashboardFacts> {
    const [seoScore, geoScore, criticalIssueCount] = await Promise.all([
      prisma.seoScore.findFirst({
        where: { projectId: project.id },
        orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
        select: { score: true }
      }),
      prisma.geoScore.findFirst({
        where: { projectId: project.id, scoreType: 'GEO_READINESS_V1' },
        orderBy: [{ calculatedAt: 'desc' }, { id: 'desc' }],
        select: {
          score: true,
          components: {
            where: { componentCode: 'CITABILITY' },
            take: 1,
            select: { rawScore: true }
          }
        }
      }),
      prisma.seoIssue.count({
        where: {
          projectId: project.id,
          currentSeverity: 'CRITICAL',
          status: { notIn: ['RESOLVED', 'IGNORED'] }
        }
      })
    ]);

    const citability = geoScore
      ? geoScore.components[0]
        ? { status: 'CALCULATED', value: geoScore.components[0].rawScore }
        : { status: 'NO_DATA', value: null }
      : null;

    const visibility = hasFeature(project.planLevel, 'AI_VISIBILITY')
      ? await this.visibilityReader.getLatest(project.id)
      : null;

    return {
      seoScore: seoScore?.score ?? null,
      geoScore: geoScore?.score ?? null,
      citability,
      criticalIssueCount,
      visibility
    };
  }

  async getPortfolio(input: { limit?: number } = {}): Promise<PortfolioDashboardViewModel> {
    const requested = Number.isInteger(input.limit) ? input.limit! : 25;
    const limit = Math.max(1, Math.min(50, requested));
    const projects = await prisma.project.findMany({
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: limit,
      select: {
        id: true,
        name: true,
        primaryDomain: true,
        planLevel: true,
        status: true,
        defaultLanguage: true,
        targetCountry: true,
        timezone: true,
        industry: true,
        createdAt: true,
        updatedAt: true
      }
    });
    const rows = await Promise.all(projects.map(async (project) => ({
      project,
      facts: await this.getProjectFacts(project)
    })));

    return {
      projectCount: rows.length,
      advancedProjectCount: rows.filter(({ project }) => project.planLevel !== 'STANDARD').length,
      criticalIssueCount: rows.reduce((sum, { facts }) => sum + facts.criticalIssueCount, 0),
      projects: rows
    };
  }
}

export const dashboardRepository = new DashboardRepository();
