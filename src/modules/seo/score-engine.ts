import { prisma } from '../../db/prisma.js';
import type { SeoSeverity } from './seo.types.js';

export const SEVERITY_MULTIPLIER = {
  CRITICAL: 4,
  HIGH: 2.5,
  MEDIUM: 1.5,
  LOW: 0.5
} as const;

export interface RulePenaltyInput {
  weight: number;
  severity: SeoSeverity;
  affectedPages: number;
  eligiblePages: number;
  importanceFactor?: number;
}

export interface ScoreComponentCalculation {
  affectedPages: number;
  eligiblePages: number;
  pageImpactFactor: number;
  severityMultiplier: number;
  weight: number;
  importanceFactor: number;
  penalty: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function stableNumber(value: number): number {
  return Number(value.toFixed(6));
}

export function calculateRulePenalty(input: RulePenaltyInput): ScoreComponentCalculation {
  const eligiblePages = Math.max(0, input.eligiblePages);
  const affectedPages = Math.max(0, input.affectedPages);
  const pageImpactFactor = eligiblePages === 0
    ? 0
    : clamp(affectedPages / Math.max(1, eligiblePages), 0, 1);
  const severityMultiplier = SEVERITY_MULTIPLIER[input.severity];
  const importanceFactor = input.importanceFactor ?? 1;
  const penalty = stableNumber(
    input.weight * severityMultiplier * pageImpactFactor * importanceFactor
  );

  return {
    affectedPages,
    eligiblePages,
    pageImpactFactor: stableNumber(pageImpactFactor),
    severityMultiplier,
    weight: input.weight,
    importanceFactor,
    penalty
  };
}

export function calculateSeoScore(components: ReadonlyArray<{ penalty: number }>): number {
  const totalPenalty = components.reduce((sum, component) => sum + component.penalty, 0);
  return stableNumber(clamp(100 - totalPenalty, 0, 100));
}

export async function calculateAndPersistSeoScore(auditRunId: string): Promise<void> {
  const audit = await prisma.seoAuditRun.findUniqueOrThrow({
    where: { id: auditRunId },
    select: {
      id: true,
      projectId: true,
      createdAt: true,
      engineVersion: true
    }
  });

  const results = await prisma.seoRuleResult.findMany({
    where: { auditRunId },
    select: {
      outcome: true,
      ruleVersionId: true,
      ruleVersion: {
        select: {
          id: true,
          weight: true,
          severity: true,
          seoRule: {
            select: {
              ruleCode: true,
              name: true
            }
          }
        }
      }
    }
  });

  const grouped = new Map<
    string,
    {
      ruleVersionId: string;
      ruleCode: string;
      ruleName: string;
      weight: number;
      severity: SeoSeverity;
      affectedPages: number;
      eligiblePages: number;
    }
  >();

  for (const result of results) {
    const version = result.ruleVersion;
    let group = grouped.get(result.ruleVersionId);
    if (!group) {
      group = {
        ruleVersionId: version.id,
        ruleCode: version.seoRule.ruleCode,
        ruleName: version.seoRule.name,
        weight: version.weight,
        severity: version.severity,
        affectedPages: 0,
        eligiblePages: 0
      };
      grouped.set(result.ruleVersionId, group);
    }

    if (result.outcome === 'PASS' || result.outcome === 'FAIL') {
      group.eligiblePages += 1;
    }
    if (result.outcome === 'FAIL') {
      group.affectedPages += 1;
    }
  }

  const components = [...grouped.values()]
    .filter((group) => group.affectedPages > 0)
    .map((group) => ({
      ...group,
      ...calculateRulePenalty({
        weight: group.weight,
        severity: group.severity,
        affectedPages: group.affectedPages,
        eligiblePages: group.eligiblePages,
        importanceFactor: 1
      })
    }));

  const score = calculateSeoScore(components);

  const previous = await prisma.seoAuditRun.findFirst({
    where: {
      projectId: audit.projectId,
      status: 'COMPLETED',
      createdAt: { lt: audit.createdAt },
      seoScore: { isNot: null }
    },
    orderBy: { createdAt: 'desc' },
    select: {
      seoScore: { select: { score: true } }
    }
  });
  const previousScore = previous?.seoScore?.score ?? null;
  const change = previousScore === null ? null : stableNumber(score - previousScore);

  await prisma.$transaction(async (tx) => {
    const persistedScore = await tx.seoScore.upsert({
      where: { auditRunId },
      create: {
        auditRunId,
        projectId: audit.projectId,
        score,
        previousScore,
        change,
        calculatedAt: new Date(),
        engineVersion: audit.engineVersion
      },
      update: {
        score,
        previousScore,
        change,
        calculatedAt: new Date(),
        engineVersion: audit.engineVersion
      }
    });

    await tx.seoScoreComponent.deleteMany({
      where: { seoScoreId: persistedScore.id }
    });

    if (components.length > 0) {
      await tx.seoScoreComponent.createMany({
        data: components.map((component) => ({
          seoScoreId: persistedScore.id,
          componentCode: component.ruleCode,
          componentName: component.ruleName,
          affectedPages: component.affectedPages,
          eligiblePages: component.eligiblePages,
          pageImpactFactor: component.pageImpactFactor,
          severityMultiplier: component.severityMultiplier,
          weight: component.weight,
          importanceFactor: component.importanceFactor,
          penalty: component.penalty,
          ruleVersionId: component.ruleVersionId
        }))
      });
    }
  });
}
