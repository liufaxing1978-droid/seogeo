import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';

type FailResult = {
  id: string;
  pageId: string | null;
  evidence: Prisma.JsonValue | null;
  ruleVersion: {
    id: string;
    severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    seoRule: {
      id: string;
      ruleCode: string;
      name: string;
      category: string;
    };
  };
};

type FailGroup = {
  ruleId: string;
  ruleCode: string;
  name: string;
  category: string;
  ruleVersionId: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  results: FailResult[];
};

function groupFailResults(results: FailResult[]): Map<string, FailGroup> {
  const groups = new Map<string, FailGroup>();

  for (const result of results) {
    const ruleCode = result.ruleVersion.seoRule.ruleCode;
    const existing = groups.get(ruleCode);
    if (existing) {
      existing.results.push(result);
      continue;
    }

    groups.set(ruleCode, {
      ruleId: result.ruleVersion.seoRule.id,
      ruleCode,
      name: result.ruleVersion.seoRule.name,
      category: result.ruleVersion.seoRule.category,
      ruleVersionId: result.ruleVersion.id,
      severity: result.ruleVersion.severity,
      results: [result]
    });
  }

  return groups;
}

function issueKey(ruleCode: string): string {
  return `rule:${ruleCode}`;
}

export async function syncAuditIssues(auditRunId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const audit = await tx.seoAuditRun.findUniqueOrThrow({
      where: { id: auditRunId },
      select: {
        id: true,
        projectId: true
      }
    });

    const previousAudit = await tx.seoAuditRun.findFirst({
      where: {
        projectId: audit.projectId,
        id: { not: audit.id },
        status: 'COMPLETED'
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true }
    });

    const failResults = (await tx.seoRuleResult.findMany({
      where: {
        auditRunId: audit.id,
        outcome: 'FAIL'
      },
      select: {
        id: true,
        pageId: true,
        evidence: true,
        ruleVersion: {
          select: {
            id: true,
            severity: true,
            seoRule: {
              select: {
                id: true,
                ruleCode: true,
                name: true,
                category: true
              }
            }
          }
        }
      }
    })) as FailResult[];

    const failGroups = groupFailResults(failResults);
    const currentIssueKeys = new Set<string>();
    const now = new Date();

    for (const group of failGroups.values()) {
      const stableIssueKey = issueKey(group.ruleCode);
      currentIssueKeys.add(stableIssueKey);

      const existing = await tx.seoIssue.findUnique({
        where: {
          projectId_issueKey: {
            projectId: audit.projectId,
            issueKey: stableIssueKey
          }
        }
      });

      let comparison: 'NEW' | 'PERSISTENT' | 'REGRESSED' = 'NEW';

      if (existing) {
        const previousOccurrence = previousAudit
          ? await tx.seoIssueOccurrence.findUnique({
              where: {
                seoIssueId_auditRunId: {
                  seoIssueId: existing.id,
                  auditRunId: previousAudit.id
                }
              },
              select: { id: true }
            })
          : null;

        if (previousOccurrence) {
          comparison = 'PERSISTENT';
        } else {
          const olderOccurrenceCount = await tx.seoIssueOccurrence.count({
            where: {
              seoIssueId: existing.id,
              auditRunId: { not: audit.id }
            }
          });
          comparison = olderOccurrenceCount > 0 ? 'REGRESSED' : 'NEW';
        }
      }

      const status = existing?.status === 'IGNORED'
        ? 'IGNORED'
        : comparison === 'REGRESSED'
          ? 'REGRESSED'
          : existing?.status === 'IN_PROGRESS' || existing?.status === 'PARTIALLY_FIXED'
            ? existing.status
            : 'OPEN';

      const stableIssue = existing
        ? await tx.seoIssue.update({
            where: { id: existing.id },
            data: {
              ruleId: group.ruleId,
              title: group.name,
              category: group.category,
              currentSeverity: group.severity,
              status,
              lastSeenAt: now,
              resolvedAt: null
            }
          })
        : await tx.seoIssue.create({
            data: {
              projectId: audit.projectId,
              ruleId: group.ruleId,
              issueKey: stableIssueKey,
              title: group.name,
              category: group.category,
              currentSeverity: group.severity,
              status: 'OPEN',
              firstSeenAt: now,
              lastSeenAt: now
            }
          });

      const uniquePageIds = new Set(
        group.results.flatMap((result) => (result.pageId ? [result.pageId] : []))
      );

      const occurrence = await tx.seoIssueOccurrence.upsert({
        where: {
          seoIssueId_auditRunId: {
            seoIssueId: stableIssue.id,
            auditRunId: audit.id
          }
        },
        create: {
          seoIssueId: stableIssue.id,
          auditRunId: audit.id,
          ruleVersionId: group.ruleVersionId,
          comparison,
          severity: group.severity,
          affectedPagesCount: uniquePageIds.size,
          evidenceSummary: { failedResults: group.results.length }
        },
        update: {
          ruleVersionId: group.ruleVersionId,
          comparison,
          severity: group.severity,
          affectedPagesCount: uniquePageIds.size,
          evidenceSummary: { failedResults: group.results.length }
        }
      });

      await tx.seoIssuePage.deleteMany({
        where: { issueOccurrenceId: occurrence.id }
      });

      const pageResults = group.results.filter(
        (result): result is FailResult & { pageId: string } => result.pageId !== null
      );

      if (pageResults.length > 0) {
        await tx.seoIssuePage.createMany({
          data: pageResults.map((result) => ({
            issueOccurrenceId: occurrence.id,
            pageId: result.pageId,
            ruleResultId: result.id,
            ...(result.evidence === null
              ? {}
              : { evidence: result.evidence as Prisma.InputJsonValue })
          }))
        });
      }
    }

    if (previousAudit) {
      const previouslyFailingIssues = await tx.seoIssue.findMany({
        where: {
          projectId: audit.projectId,
          occurrences: {
            some: { auditRunId: previousAudit.id }
          }
        },
        select: {
          id: true,
          issueKey: true,
          status: true
        }
      });

      for (const issue of previouslyFailingIssues) {
        if (currentIssueKeys.has(issue.issueKey) || issue.status === 'IGNORED') continue;

        await tx.seoIssue.update({
          where: { id: issue.id },
          data: {
            status: 'RESOLVED',
            resolvedAt: now
          }
        });
      }
    }
  });
}
