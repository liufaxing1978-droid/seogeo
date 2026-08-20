import { afterAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { generateProjectReportV2 } from '../../src/modules/reporting/report-builder.js';
import { VisibilityHistoryObservability } from '../../src/modules/visibility/visibility-history.observability.js';

const projectIds: string[] = [];

afterAll(async () => {
  for (const projectId of projectIds) {
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  }
});

describe('PROJECT_REPORT_V2 safe observability', () => {
  it('emits report.v2.generated only after the report snapshot is durable', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({
      data: {
        name: 'Report V2 Observability',
        slug: `report-v2-observability-${suffix}`,
        primaryDomain: `report-v2-observability-${suffix}.example.com`,
        planLevel: 'STANDARD'
      }
    });
    projectIds.push(project.id);

    const sink = vi.fn();
    const report = await generateProjectReportV2(project.id, {
      p6dObservability: new VisibilityHistoryObservability(sink)
    });
    const persisted = await prisma.reportSnapshot.findUnique({ where: { id: report.id } });

    expect(persisted?.reportVersion).toBe('PROJECT_REPORT_V2');
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith(expect.objectContaining({
      event: 'report.v2.generated',
      projectId: project.id,
      status: 'COMPLETED',
      durationMs: expect.any(Number)
    }));
    expect(JSON.stringify(sink.mock.calls)).not.toMatch(/factSnapshot|advisorySnapshot|reportJson|promptText|answerText|citationUrl/);
  });

  it('does not emit a success event when report generation cannot persist', async () => {
    const sink = vi.fn();
    await expect(generateProjectReportV2('missing-project', {
      p6dObservability: new VisibilityHistoryObservability(sink)
    })).rejects.toMatchObject({ code: 'PROJECT_NOT_FOUND' });
    expect(sink).not.toHaveBeenCalled();
  });
});
