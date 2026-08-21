export interface SafeMetricValue {
  status: string;
  numerator: number | null;
  denominator: number | null;
  ratio: number | null;
}

export interface VisibilityDashboardFacts {
  snapshotId: string;
  mentionRate: SafeMetricValue;
  citationRate: SafeMetricValue;
  ownedSov: SafeMetricValue;
  openAlertCount: number;
}

export interface GrowthDashboardOpportunity {
  id: string;
  normalizedQuery: string;
  canonicalPage: string | null;
  primaryType: string;
  score: number;
  priority: string;
}

export interface GrowthDashboardTrend {
  current: { impressions: number; clicks: number };
  previous: { impressions: number; clicks: number };
  impressionChangePct: number | null;
  clickChangePct: number | null;
}

export interface GrowthDashboardGscHealth {
  connectionStatus: string;
  propertyUri: string | null;
  latestCompletedDate: string | null;
  sourceFreshness: Date | null;
  sourceCompletenessState: string | null;
  completedDayCount: number;
}

export interface GrowthDashboardFacts {
  state: 'AVAILABLE' | 'NO_DATA';
  surface: 'BASIC' | 'FULL';
  currentWindowEnd: Date | null;
  topEligibleScore: number | null;
  criticalCount: number;
  highCount: number;
  resolvedCount: number;
  topDeclining: GrowthDashboardOpportunity | null;
  topRankingUpside: GrowthDashboardOpportunity | null;
  topCannibalizationRisk: GrowthDashboardOpportunity | null;
  searchTrend: GrowthDashboardTrend | null;
  gsc: GrowthDashboardGscHealth;
}

export interface EnterpriseGrowthProjectSummary {
  projectId: string;
  projectName: string;
  primaryDomain: string;
  topEligibleScore: number | null;
  criticalCount: number;
  resolvedCount: number;
  connectionStatus: string;
  latestCompletedDate: string | null;
  sourceFreshness: Date | null;
}

export interface ProjectDashboardFacts {
  seoScore: number | null;
  geoScore: number | null;
  citability: { status: string; value: number | null } | null;
  criticalIssueCount: number;
  visibility: VisibilityDashboardFacts | null;
  growth: GrowthDashboardFacts;
}

export interface PortfolioDashboardViewModel {
  projectCount: number;
  advancedProjectCount: number;
  criticalIssueCount: number;
  enterpriseGrowthProjects: EnterpriseGrowthProjectSummary[];
  projects: Array<{
    project: {
      id: string;
      name: string;
      primaryDomain: string;
      planLevel: 'STANDARD' | 'ADVANCED' | 'ENTERPRISE';
      status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
      defaultLanguage: string;
      targetCountry: string;
      timezone: string;
      industry: string | null;
      createdAt: Date;
      updatedAt: Date;
    };
    facts: ProjectDashboardFacts;
  }>;
}

export function formatPercentMetric(metric: SafeMetricValue): string {
  return metric.ratio === null ? metric.status : `${(metric.ratio * 100).toFixed(1)}%`;
}

export const projectTabs = [
  '概览', 'SEO', 'GEO', 'AI 可见性', '引用与提及', '关键词', '内容', '页面', '技术 SEO', '竞争对手', '历史记录', '设置'
] as const;
