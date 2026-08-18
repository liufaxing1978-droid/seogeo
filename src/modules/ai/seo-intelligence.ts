import type { AiTask, Prisma, SeoSeverity } from '@prisma/client';
import { z } from 'zod';
import { AppError, NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { aiGatewayConfig } from './ai.config.js';
import { aiTaskService, type AiTaskService, type CreateAiTaskInput } from './ai.service.js';
import { AiOutputValidationError, parseStructuredOutput } from './structured-output.js';

const PROMPT_ID = 'seo-audit-analysis-v1';
const MAX_ISSUES = 30;
const MAX_URLS_PER_ISSUE = 10;

export const SeoAnalysisSchema = z.object({
  summary: z.string().min(1),
  priorities: z
    .array(
      z.object({
        priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
        title: z.string().min(1),
        reason: z.string().min(1),
        sourceRefs: z.array(z.string().min(1)).min(1)
      })
    )
    .max(10),
  recommendations: z
    .array(
      z.object({
        title: z.string().min(1),
        action: z.string().min(1),
        sourceRefs: z.array(z.string().min(1)).min(1)
      })
    )
    .max(12)
});

export type SeoAnalysis = z.infer<typeof SeoAnalysisSchema>;

interface SourceReference {
  type: string;
  id: string;
}

interface SeoFactPacket {
  audit: {
    sourceRef: string;
    id: string;
    status: 'COMPLETED';
    score: number | null;
    previousScore: number | null;
    change: number | null;
    eligiblePages: number;
    rulesEvaluated: number;
    engineVersion: string;
  };
  scoreComponents: Array<{
    sourceRef: string;
    ruleCode: string;
    ruleName: string;
    category: string;
    severity: SeoSeverity;
    affectedPages: number;
    eligiblePages: number;
    penalty: number;
  }>;
  issues: Array<{
    sourceRef: string;
    ruleCode: string;
    ruleName: string;
    title: string;
    category: string;
    severity: SeoSeverity;
    status: string;
    comparison: string;
    affectedPagesCount: number;
    fixGuide: string;
    affectedPages: Array<{ sourceRef: string; url: string }>;
  }>;
}

const SEVERITY_RANK: Record<SeoSeverity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3
};

function sourceRef(type: string, id: string): string {
  return `${type}:${id}`;
}

function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return value.split(/[?#]/, 1)[0] ?? value;
  }
}

function uniqueSourceReferences(refs: SourceReference[]): SourceReference[] {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const key = sourceRef(ref.type, ref.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function packetLength(packet: SeoFactPacket): number {
  return JSON.stringify(packet).length;
}

function fitPacket(packet: SeoFactPacket, maxChars: number): SeoFactPacket {
  if (packetLength(packet) <= maxChars) return packet;

  for (const urlLimit of [3, 1, 0]) {
    const candidate: SeoFactPacket = {
      ...packet,
      issues: packet.issues.map((issue) => ({
        ...issue,
        affectedPages: issue.affectedPages.slice(0, urlLimit)
      }))
    };
    if (packetLength(candidate) <= maxChars) return candidate;
  }

  for (const issueLimit of [20, 10, 5, 1]) {
    const candidate: SeoFactPacket = {
      ...packet,
      issues: packet.issues.slice(0, issueLimit).map((issue) => ({ ...issue, affectedPages: [] }))
    };
    if (packetLength(candidate) <= maxChars) return candidate;
  }

  throw new AppError('SEO analysis fact packet exceeds the configured AI input limit', 413, 'AI_INPUT_TOO_LARGE');
}

function collectPacketReferences(packet: SeoFactPacket): SourceReference[] {
  const refs: SourceReference[] = [{ type: 'SEO_AUDIT', id: packet.audit.id }];
  const scoreId = packet.scoreComponents[0]?.sourceRef.split(':').slice(1).join(':');
  if (scoreId) refs.push({ type: 'SEO_SCORE', id: scoreId });

  for (const issue of packet.issues) {
    refs.push({ type: 'SEO_ISSUE', id: issue.sourceRef.slice('SEO_ISSUE:'.length) });
    for (const page of issue.affectedPages) {
      refs.push({ type: 'PAGE', id: page.sourceRef.slice('PAGE:'.length) });
    }
  }
  return uniqueSourceReferences(refs);
}

export async function buildSeoAnalysisTaskInput(
  projectId: string,
  auditRunId: string,
  maxInputChars = aiGatewayConfig.maxInputChars
): Promise<CreateAiTaskInput> {
  const audit = await prisma.seoAuditRun.findFirst({
    where: { id: auditRunId, projectId },
    include: {
      seoScore: {
        include: {
          components: {
            include: {
              ruleVersion: { include: { seoRule: true } }
            },
            orderBy: { penalty: 'desc' }
          }
        }
      },
      issueOccurrences: {
        include: {
          seoIssue: true,
          ruleVersion: { include: { seoRule: true } },
          pages: {
            include: { page: { select: { id: true, normalizedUrl: true } } }
          }
        }
      }
    }
  });

  if (!audit) throw new NotFoundError('SEO audit not found for project', 'SEO_AUDIT_NOT_FOUND');
  if (audit.status !== 'COMPLETED') {
    throw new AppError('SEO analysis requires a completed deterministic audit', 409, 'SEO_AUDIT_NOT_COMPLETED');
  }

  const sortedIssues = [...audit.issueOccurrences]
    .sort((left, right) => {
      const severity = SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
      if (severity !== 0) return severity;
      return right.affectedPagesCount - left.affectedPagesCount;
    })
    .slice(0, MAX_ISSUES);

  const packet: SeoFactPacket = {
    audit: {
      sourceRef: sourceRef('SEO_AUDIT', audit.id),
      id: audit.id,
      status: 'COMPLETED',
      score: audit.seoScore?.score ?? null,
      previousScore: audit.seoScore?.previousScore ?? null,
      change: audit.seoScore?.change ?? null,
      eligiblePages: audit.eligiblePages,
      rulesEvaluated: audit.rulesEvaluated,
      engineVersion: audit.engineVersion
    },
    scoreComponents:
      audit.seoScore?.components.map((component) => ({
        sourceRef: sourceRef('SEO_SCORE', audit.seoScore!.id),
        ruleCode: component.ruleVersion.seoRule.ruleCode,
        ruleName: component.ruleVersion.seoRule.name,
        category: component.ruleVersion.seoRule.category,
        severity: component.ruleVersion.severity,
        affectedPages: component.affectedPages,
        eligiblePages: component.eligiblePages,
        penalty: component.penalty
      })) ?? [],
    issues: sortedIssues.map((occurrence) => ({
      sourceRef: sourceRef('SEO_ISSUE', occurrence.seoIssue.id),
      ruleCode: occurrence.ruleVersion.seoRule.ruleCode,
      ruleName: occurrence.ruleVersion.seoRule.name,
      title: occurrence.seoIssue.title,
      category: occurrence.seoIssue.category,
      severity: occurrence.severity,
      status: occurrence.seoIssue.status,
      comparison: occurrence.comparison,
      affectedPagesCount: occurrence.affectedPagesCount,
      fixGuide: occurrence.ruleVersion.fixGuide,
      affectedPages: occurrence.pages.slice(0, MAX_URLS_PER_ISSUE).map((pageLink) => ({
        sourceRef: sourceRef('PAGE', pageLink.page.id),
        url: safeUrl(pageLink.page.normalizedUrl)
      }))
    }))
  };

  const bounded = fitPacket(packet, maxInputChars);
  const refs = collectPacketReferences(bounded);

  return {
    projectId,
    taskType: 'SEO_AUDIT_ANALYSIS',
    requestKey: `seo-audit:${audit.id}:${PROMPT_ID}`,
    promptVersion: PROMPT_ID,
    factSnapshot: bounded as unknown as Prisma.InputJsonValue,
    sourceReferences: refs as unknown as Prisma.InputJsonValue
  };
}

export async function createSeoAnalysisTask(
  projectId: string,
  auditRunId: string,
  service: Pick<AiTaskService, 'createAndEnqueue'> = aiTaskService
): Promise<AiTask> {
  return service.createAndEnqueue(await buildSeoAnalysisTaskInput(projectId, auditRunId));
}

function allowedReferenceSet(sourceReferences: unknown): Set<string> {
  if (!Array.isArray(sourceReferences)) return new Set();
  const allowed = new Set<string>();
  for (const ref of sourceReferences) {
    if (!ref || typeof ref !== 'object' || Array.isArray(ref)) continue;
    const type = (ref as Record<string, unknown>).type;
    const id = (ref as Record<string, unknown>).id;
    if (typeof type === 'string' && typeof id === 'string') allowed.add(sourceRef(type, id));
  }
  return allowed;
}

export function parseSeoAnalysisOutput(content: string, sourceReferences: unknown): SeoAnalysis {
  const output = parseStructuredOutput(content, SeoAnalysisSchema);
  const allowed = allowedReferenceSet(sourceReferences);
  const returnedRefs = [
    ...output.priorities.flatMap((priority) => priority.sourceRefs),
    ...output.recommendations.flatMap((recommendation) => recommendation.sourceRefs)
  ];

  if (returnedRefs.some((ref) => !allowed.has(ref))) {
    throw new AiOutputValidationError('AI output contains a source reference that was not supplied');
  }

  return output;
}
