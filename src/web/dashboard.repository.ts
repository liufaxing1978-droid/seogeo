import type { GrowthOpportunityType, Project } from '@prisma/client';
import { hasFeature } from '../auth/feature-flags.js';
import { prisma } from '../db/prisma.js';
import type {
  EnterpriseGrowthProjectSummary,
  GrowthDashboardFacts,
  GrowthDashboardOpportunity,
  GrowthDashboardTrend,
  PortfolioDashboardViewModel,
  ProjectDashboardFacts,
  SafeMetricValue,
  VisibilityDashboardFacts
} from './view-models.js';

const BASIC_GROWTH_TYPES: readonly GrowthOpportunityType[] = [
  'RANKING_UPSIDE',
  'CTR_UNDERPERFORMANCE'
];

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

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

function safeOpportunity(row: {
  opportunityIdentityId: string;
  primaryType: GrowthOpportunityType;
  score: number | null;
  priority: string;
  identity: { normalizedQuery: string; canonicalPage: string | null };
}): GrowthDashboardOpportunity | null {
  if (row.score === null) return null;
  return {
    id: row.opportunityIdentityId,
    normalizedQuery: row.identity.normalizedQuery,
    canonicalPage: row.identity.canonicalPage,
    primaryType: row.primaryType,
    score: row.score,
    priority: row.priority
  };
}

export class DashboardRepository {
  private readonly visibilityReader: DashboardVisibilityReader;

  constructor(options: DashboardRepositoryOptions = {}) {
    this.visibilityReader = options.visibilityReader ?? new PrismaDashboardVisibilityReader();
  }

  private async getGrowthSummary(project: DashboardProject): Promise<GrowthDashboardFacts> {
    const surface: GrowthDashboardFacts['surface'] = project.planLevel === 'STANDARD' ? 'BASIC' : 'FULL';
    const visibleTypes = surface === 'BASIC' ? [...BASIC_GROWTH_TYPES] : undefined;

    const [activeProperty, latestConnection, latestGrowthSnapshot] = await Promise.all([
      prisma.searchConsoleProperty.findFirst({
        where: { projectId: project.id, isActive: true },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          propertyUri: true,
          connection: { select: { status: true } }
        }
      }),
      prisma.searchConsoleConnection.findFirst({
        where: { projectId: project.id },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        select: { status: true }
      }),
      prisma.growthOpportunitySnapshot.findFirst({
        where: { projectId: project.id },
        orderBy: [{ currentWindowEnd: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        select: {
          currentWindowStart: true,
          currentWindowEnd: true,
          previousWindowStart: true,
          previousWindowEnd: true
        }
      })
    ]);

    const latestCompletedSnapshot = activeProperty
      ? await prisma.gscDailySnapshot.findFirst({
          where: { projectId: project.id, propertyId: activeProperty.id, status: 'COMPLETED' },
          orderBy: [{ date: 'desc' }, { syncVersion: 'desc' }, { id: 'desc' }],
          select: {
            date: true,
            sourceFreshness: true,
            sourceCompletenessState: true
          }
        })
      : null;

    const gscBase = {
      connectionStatus: activeProperty?.connection.status ?? latestConnection?.status ?? 'NOT_CONNECTED',
      propertyUri: activeProperty?.propertyUri ?? null,
      latestCompletedDate: latestCompletedSnapshot ? dateKey(latestCompletedSnapshot.date) : null,
      sourceFreshness: latestCompletedSnapshot?.sourceFreshness ?? null,
      sourceCompletenessState: latestCompletedSnapshot?.sourceCompletenessState ?? null,
      completedDayCount: 0
    };

    if (!latestGrowthSnapshot) {
      return {
        state: 'NO_DATA',
        surface,
        currentWindowEnd: null,
        topEligibleScore: null,
        criticalCount: 0,
        highCount: 0,
        resolvedCount: 0,
        topDeclining: null,
        topRankingUpside: null,
        topCannibalizationRisk: null,
        searchTrend: null,
        gsc: gscBase
      };
    }

    const opportunityWhere = {
      projectId: project.id,
      currentWindowEnd: latestGrowthSnapshot.currentWindowEnd,
      rankingEligible: true,
      scoreState: 'KNOWN' as const,
      score: { not: null },
      ...(visibleTypes ? { primaryType: { in: visibleTypes } } : {})
    };

    const [eligibleRows, resolvedCount] = await Promise.all([
      prisma.growthOpportunitySnapshot.findMany({
        where: opportunityWhere,
        select: {
          opportunityIdentityId: true,
          primaryType: true,
          score: true,
          priority: true,
          identity: {
            select: {
              normalizedQuery: true,
              canonicalPage: true
            }
          }
        },
        orderBy: [{ score: 'desc' }, { id: 'asc' }],
        take: 100
      }),
      prisma.growthOpportunityLifecycle.count({
        where: {
          status: 'RESOLVED',
          identity: {
            projectId: project.id,
            ...(visibleTypes ? {
              snapshots: {
                some: {
                  currentWindowEnd: latestGrowthSnapshot.currentWindowEnd,
                  primaryType: { in: visibleTypes }
                }
              }
            } : {})
          }
        }
      })
    ]);

    let searchTrend: GrowthDashboardTrend | null = null;
    let completedDayCount = 0;
    if (activeProperty) {
      const completedSnapshots = await prisma.gscDailySnapshot.findMany({
        where: {
          projectId: project.id,
          propertyId: activeProperty.id,
          status: 'COMPLETED',
          date: {
            gte: latestGrowthSnapshot.previousWindowStart,
            lte: latestGrowthSnapshot.currentWindowEnd
          }
        },
        select: { id: true, date: true, syncVersion: true },
        orderBy: [{ date: 'asc' }, { syncVersion: 'desc' }, { id: 'desc' }]
      });

      const selectedByDate = new Map<string, { id: string; date: Date; syncVersion: number }>();
      for (const snapshot of completedSnapshots) {
        const key = dateKey(snapshot.date);
        if (!selectedByDate.has(key)) selectedByDate.set(key, snapshot);
      }
      const selectedSnapshots = [...selectedByDate.values()];
      completedDayCount = selectedSnapshots.length;

      if (selectedSnapshots.length > 0) {
        const selectedIds = selectedSnapshots.map((snapshot) => snapshot.id);
        const facts = await prisma.gscQueryPageFact.findMany({
          where: { projectId: project.id, snapshotId: { in: selectedIds } },
          select: { date: true, clicks: true, impressions: true }
        });
        const current = { impressions: 0, clicks: 0 };
        const previous = { impressions: 0, clicks: 0 };
        for (const fact of facts) {
          if (fact.date >= latestGrowthSnapshot.currentWindowStart && fact.date <= latestGrowthSnapshot.currentWindowEnd) {
            current.impressions += fact.impressions;
            current.clicks += fact.clicks;
          } else if (fact.date >= latestGrowthSnapshot.previousWindowStart && fact.date <= latestGrowthSnapshot.previousWindowEnd) {
            previous.impressions += fact.impressions;
            previous.clicks += fact.clicks;
          }
        }
        searchTrend = {
          current,
          previous,
          impressionChangePct: percentChange(current.impressions, previous.impressions),
          clickChangePct: percentChange(current.clicks, previous.clicks)
        };
      }
    }

    const topFor = (type: GrowthOpportunityType) => {
      const row = eligibleRows.find((candidate) => candidate.primaryType === type);
      return row ? safeOpportunity(row) : null;
    };
    const topEligible = eligibleRows[0] ? safeOpportunity(eligibleRows[0]) : null;

    return {
      state: topEligible ? 'AVAILABLE' : 'NO_DATA',
      surface,
      currentWindowEnd: latestGrowthSnapshot.currentWindowEnd,
      topEligibleScore: topEligible?.score ?? null,
      criticalCount: eligibleRows.filter((row) => row.priority === 'CRITICAL').length,
      highCount: eligibleRows.filter((row) => row.priority === 'HIGH').length,
      resolvedCount,
      topDeclining: surface === 'FULL' ? topFor('DECLINING_PERFORMANCE') : null,
      topRankingUpside: topFor('RANKING_UPSIDE'),
      topCannibalizationRisk: surface === 'FULL' ? topFor('KEYWORD_CANNIBALIZATION') : null,
      searchTrend,
      gsc: { ...gscBase, completedDayCount }
    };
  }

  async getProjectFacts(project: DashboardProject): Promise<ProjectDashboardFacts> {
    const [seoScore, geoScore, criticalIssueCount, growth] = await Promise.all([
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
      }),
      this.getGrowthSummary(project)
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
      visibility,
      growth
    };
  }

  private async buildPortfolio(
    projects: DashboardProject[],
    limit: number,
  ): Promise<PortfolioDashboardViewModel> {
    const rows = await Promise.all(projects.map(async (project) => ({
      project,
      facts: await this.getProjectFacts(project)
    })));

    const enterpriseGrowthProjects: EnterpriseGrowthProjectSummary[] = rows
      .filter(({ project }) => hasFeature(project.planLevel, 'PORTFOLIO_GROWTH'))
      .map(({ project, facts }) => ({
        projectId: project.id,
        projectName: project.name,
        primaryDomain: project.primaryDomain,
        topEligibleScore: facts.growth.topEligibleScore,
        criticalCount: facts.growth.criticalCount,
        resolvedCount: facts.growth.resolvedCount,
        connectionStatus: facts.growth.gsc.connectionStatus,
        latestCompletedDate: facts.growth.gsc.latestCompletedDate,
        sourceFreshness: facts.growth.gsc.sourceFreshness
      }))
      .sort((left, right) =>
        right.criticalCount - left.criticalCount ||
        (right.topEligibleScore ?? -1) - (left.topEligibleScore ?? -1) ||
        left.projectId.localeCompare(right.projectId)
      )
      .slice(0, limit);

    return {
      projectCount: rows.length,
      advancedProjectCount: rows.filter(({ project }) => project.planLevel !== 'STANDARD').length,
      criticalIssueCount: rows.reduce((sum, { facts }) => sum + facts.criticalIssueCount, 0),
      enterpriseGrowthProjects,
      projects: rows
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
    return this.buildPortfolio(projects, limit);
  }

  async getPortfolioForUser(
    userId: string,
    input: { limit?: number } = {},
  ): Promise<PortfolioDashboardViewModel> {
    const requested = Number.isInteger(input.limit) ? input.limit! : 25;
    const limit = Math.max(1, Math.min(50, requested));
    const projects = await prisma.project.findMany({
      where: {
        memberships: {
          some: {
            userId,
            status: 'ACTIVE'
          }
        }
      },
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
    return this.buildPortfolio(projects, limit);
  }
}

export const dashboardRepository = new DashboardRepository();
