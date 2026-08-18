import { prisma } from '../../db/prisma.js';

const SEVERITY_ORDER = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3
} as const;

export const seoWebRepository = {
  async getAuditDashboard(projectId: string) {
    const project = await prisma.project.findUnique({
      where: { id: projectId }
    });
    if (!project) return null;

    const [latestAudit, latestCompletedCrawl] = await Promise.all([
      prisma.seoAuditRun.findFirst({
        where: { projectId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: {
          crawlRun: {
            select: {
              id: true,
              runType: true,
              seedUrl: true,
              finishedAt: true
            }
          },
          seoScore: {
            include: {
              components: {
                include: {
                  ruleVersion: {
                    include: {
                      seoRule: {
                        select: {
                          ruleCode: true,
                          name: true,
                          category: true
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          issueOccurrences: {
            include: {
              seoIssue: true,
              ruleVersion: {
                include: {
                  seoRule: {
                    select: {
                      ruleCode: true,
                      name: true,
                      category: true
                    }
                  }
                }
              }
            }
          }
        }
      }),
      prisma.crawlRun.findFirst({
        where: { projectId, status: 'COMPLETED' },
        orderBy: [{ finishedAt: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          runType: true,
          finishedAt: true
        }
      })
    ]);

    if (!latestAudit) {
      return {
        project,
        audit: null,
        score: null,
        components: [],
        severityCounts: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
        topIssues: [],
        latestCompletedCrawl
      };
    }

    const severityCounts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const occurrence of latestAudit.issueOccurrences) {
      severityCounts[occurrence.severity] += 1;
    }

    const components = (latestAudit.seoScore?.components ?? [])
      .map((component) => ({
        ...component,
        ruleCode: component.ruleVersion.seoRule.ruleCode,
        ruleName: component.ruleVersion.seoRule.name,
        category: component.ruleVersion.seoRule.category,
        severity: component.ruleVersion.severity,
        detectionType: component.ruleVersion.detectionType,
        scopeLabel:
          component.ruleVersion.detectionType === 'CRAWL_FACT'
            ? '全站'
            : `${component.affectedPages} 页面`
      }))
      .sort((a, b) => b.penalty - a.penalty);

    const topIssues = latestAudit.issueOccurrences
      .map((occurrence) => ({
        id: occurrence.seoIssue.id,
        title: occurrence.seoIssue.title,
        status: occurrence.seoIssue.status,
        severity: occurrence.severity,
        category: occurrence.seoIssue.category,
        affectedPagesCount: occurrence.affectedPagesCount,
        comparison: occurrence.comparison,
        ruleCode: occurrence.ruleVersion.seoRule.ruleCode,
        detectionType: occurrence.ruleVersion.detectionType
      }))
      .sort((a, b) => {
        const severityDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
        if (severityDiff !== 0) return severityDiff;
        return b.affectedPagesCount - a.affectedPagesCount;
      })
      .slice(0, 10);

    return {
      project,
      audit: latestAudit,
      score: latestAudit.seoScore,
      components,
      severityCounts,
      topIssues,
      latestCompletedCrawl
    };
  },

  async listProjectIssues(projectId: string) {
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return null;

    const issues = await prisma.seoIssue.findMany({
      where: { projectId },
      include: {
        rule: {
          select: {
            ruleCode: true,
            name: true,
            category: true
          }
        },
        occurrences: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            ruleVersion: {
              select: {
                version: true,
                detectionType: true
              }
            }
          }
        }
      },
      orderBy: { lastSeenAt: 'desc' }
    });

    const data = issues
      .map((issue) => {
        const latest = issue.occurrences[0] ?? null;
        return {
          ...issue,
          latestOccurrence: latest,
          affectedLabel:
            latest?.ruleVersion.detectionType === 'CRAWL_FACT'
              ? '全站'
              : `${latest?.affectedPagesCount ?? 0} 页面`
        };
      })
      .sort((a, b) => {
        const severityDiff = SEVERITY_ORDER[a.currentSeverity] - SEVERITY_ORDER[b.currentSeverity];
        if (severityDiff !== 0) return severityDiff;
        return b.lastSeenAt.getTime() - a.lastSeenAt.getTime();
      });

    return { project, issues: data };
  },

  async getIssuePage(issueId: string) {
    const issue = await prisma.seoIssue.findUnique({
      where: { id: issueId },
      include: {
        project: true,
        rule: {
          select: {
            ruleCode: true,
            name: true,
            category: true,
            description: true
          }
        },
        occurrences: {
          orderBy: { createdAt: 'desc' },
          include: {
            ruleVersion: true,
            auditRun: {
              select: {
                id: true,
                finishedAt: true,
                createdAt: true
              }
            },
            pages: {
              include: {
                page: {
                  select: {
                    id: true,
                    normalizedUrl: true
                  }
                },
                ruleResult: {
                  select: {
                    outcome: true,
                    evidence: true
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!issue) return null;
    const latestOccurrence = issue.occurrences[0] ?? null;

    return {
      issue,
      project: issue.project,
      rule: issue.rule,
      latestOccurrence,
      ruleVersion: latestOccurrence?.ruleVersion ?? null,
      affectedPages: latestOccurrence?.pages ?? []
    };
  }
};
