import type { AiTask, Prisma } from '@prisma/client';
import { z } from 'zod';
import { NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { aiTaskService, type AiTaskService, type CreateAiTaskInput } from './ai.service.js';
import { AiOutputValidationError, parseStructuredOutput } from './structured-output.js';

export const REPORT_EXECUTIVE_PROMPT_ID = 'project-report-summary-v1';

const ReportExecutiveSchema = z.object({
  summary: z.string().min(1),
  keyFindings: z.array(z.object({
    category: z.enum(['SEO', 'GEO', 'CONTENT', 'COMPETITOR', 'AI_ADVISORY']),
    finding: z.string().min(1),
    sourceRefs: z.array(z.string().min(1)).min(1).max(20)
  })).max(12),
  priorities: z.array(z.object({
    priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
    action: z.string().min(1),
    rationale: z.string().min(1),
    sourceRefs: z.array(z.string().min(1)).min(1).max(20)
  })).max(12),
  unavailableFacts: z.array(z.string().min(1)).max(12),
  sourceReferences: z.array(z.string().min(1)).min(1).max(80)
});

export type ReportExecutiveOutput = z.infer<typeof ReportExecutiveSchema>;

type Ref = { type: string; id: string };
function ref(type: string, id: string) { return `${type}:${id}`; }

function refsFromJson(value: unknown): Ref[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const type = (item as Record<string, unknown>).type;
    const id = (item as Record<string, unknown>).id;
    return typeof type === 'string' && typeof id === 'string' ? [{ type, id }] : [];
  });
}

function allowedSet(sourceReferences: unknown): Set<string> {
  return new Set(refsFromJson(sourceReferences).map((item) => ref(item.type, item.id)));
}

export function parseReportExecutiveOutput(content: string, sourceReferences: unknown): ReportExecutiveOutput {
  const output = parseStructuredOutput(content, ReportExecutiveSchema);
  const allowed = allowedSet(sourceReferences);
  const returned = [
    ...output.sourceReferences,
    ...output.keyFindings.flatMap((item) => item.sourceRefs),
    ...output.priorities.flatMap((item) => item.sourceRefs)
  ];
  if (returned.some((item) => !allowed.has(item))) throw new AiOutputValidationError('AI output contains a source reference that was not supplied');
  return output;
}

export async function buildReportExecutiveTaskInput(projectId: string, reportId: string): Promise<CreateAiTaskInput> {
  const report = await prisma.reportSnapshot.findFirst({ where: { id: reportId, projectId } });
  if (!report) throw new NotFoundError('Report not found', 'REPORT_NOT_FOUND');

  const refs: Ref[] = [{ type: 'REPORT_SNAPSHOT', id: report.id }, ...refsFromJson(report.sourceReferences)];
  return {
    projectId,
    taskType: 'REPORT_EXECUTIVE_SUMMARY',
    requestKey: `report-summary:${report.id}:${REPORT_EXECUTIVE_PROMPT_ID}`,
    promptVersion: REPORT_EXECUTIVE_PROMPT_ID,
    factSnapshot: {
      report: {
        sourceRef: ref('REPORT_SNAPSHOT', report.id),
        reportVersion: report.reportVersion,
        deterministicFacts: report.factSnapshot,
        advisoryFacts: report.advisorySnapshot
      },
      boundaries: {
        deterministicFactsAreAuthoritative: true,
        advisoryFactsMustStayAdvisory: true
      },
      unavailableFacts: ['AI visibility', 'prompt rank', 'citation share', 'share of voice', 'search rankings', 'organic traffic']
    } as unknown as Prisma.InputJsonValue,
    sourceReferences: refs as unknown as Prisma.InputJsonValue
  };
}

export async function createReportExecutiveSummaryTask(
  projectId: string,
  reportId: string,
  service: Pick<AiTaskService, 'createAndEnqueue'> = aiTaskService
): Promise<AiTask> {
  const existingReport = await prisma.reportSnapshot.findFirst({ where: { id: reportId, projectId } });
  if (!existingReport) throw new NotFoundError('Report not found', 'REPORT_NOT_FOUND');
  if (existingReport.executiveAiTaskId) {
    const existingTask = await prisma.aiTask.findUnique({ where: { id: existingReport.executiveAiTaskId } });
    if (existingTask) return existingTask;
  }

  const task = await service.createAndEnqueue(await buildReportExecutiveTaskInput(projectId, reportId));
  await prisma.reportSnapshot.update({ where: { id: reportId }, data: { executiveAiTaskId: task.id } });
  return task;
}
