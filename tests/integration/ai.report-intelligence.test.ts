import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { buildReportExecutiveTaskInput, createReportExecutiveSummaryTask, parseReportExecutiveOutput } from '../../src/modules/ai/report-intelligence.js';

describe('P5-C report executive intelligence', () => {
  const projects: string[] = [];

  afterAll(async () => {
    for (const id of projects) await prisma.project.delete({ where: { id } }).catch(() => undefined);
  });

  it('builds a bounded report-only AI task and attaches the queued task to the report', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({ data: { name: 'Report AI', slug: `report-ai-${suffix}`, primaryDomain: `report-ai-${suffix}.example.com` } });
    projects.push(project.id);
    const report = await prisma.reportSnapshot.create({
      data: { projectId: project.id, reportType: 'PROJECT_SUMMARY', reportVersion: 'PROJECT_REPORT_V1', factSnapshot: { seo: { score: { value: 80 } }, geo: { score: null } }, advisorySnapshot: { ai: [] }, sourceReferences: [{ type: 'PROJECT', id: project.id }] }
    });

    const input = await buildReportExecutiveTaskInput(project.id, report.id);
    expect(input.taskType).toBe('REPORT_EXECUTIVE_SUMMARY');
    expect(input.promptVersion).toBe('project-report-summary-v1');
    expect(JSON.stringify(input.factSnapshot)).not.toContain('reasoning_content');

    const fakeTask = { id: '11111111-1111-1111-1111-111111111111', projectId: project.id, taskType: 'REPORT_EXECUTIVE_SUMMARY', status: 'QUEUED', requestKey: input.requestKey, promptVersion: input.promptVersion } as any;
    const task = await createReportExecutiveSummaryTask(project.id, report.id, { createAndEnqueue: async () => fakeTask } as any);
    expect(task.id).toBe(fakeTask.id);
    expect((await prisma.reportSnapshot.findUniqueOrThrow({ where: { id: report.id } })).executiveAiTaskId).toBe(fakeTask.id);
  });

  it('rejects executive output that invents source references', () => {
    const refs = [{ type: 'REPORT_SNAPSHOT', id: 'report-1' }, { type: 'PROJECT', id: 'project-1' }];
    const valid = JSON.stringify({
      summary: 'Summary',
      keyFindings: [{ category: 'SEO', finding: 'Finding', sourceRefs: ['REPORT_SNAPSHOT:report-1'] }],
      priorities: [{ priority: 'HIGH', action: 'Action', rationale: 'Reason', sourceRefs: ['PROJECT:project-1'] }],
      unavailableFacts: ['AI Visibility'],
      sourceReferences: ['REPORT_SNAPSHOT:report-1', 'PROJECT:project-1']
    });
    expect(parseReportExecutiveOutput(valid, refs).summary).toBe('Summary');

    const invalid = valid.replace('PROJECT:project-1', 'AI_VISIBILITY:invented');
    expect(() => parseReportExecutiveOutput(invalid, refs)).toThrow();
  });
});
