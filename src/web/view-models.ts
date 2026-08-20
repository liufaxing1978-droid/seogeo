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

export interface ProjectDashboardFacts {
  seoScore: number | null;
  geoScore: number | null;
  citability: { status: string; value: number | null } | null;
  criticalIssueCount: number;
  visibility: VisibilityDashboardFacts | null;
}

export interface PortfolioDashboardViewModel {
  projectCount: number;
  advancedProjectCount: number;
  criticalIssueCount: number;
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
