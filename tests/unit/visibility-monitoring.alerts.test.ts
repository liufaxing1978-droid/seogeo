import { describe, expect, it, vi } from 'vitest';
import { processVisibilityMonitoringJob } from '../../src/modules/visibility/visibility-monitoring.worker.js';

describe('P6-D visibility monitoring alert handoff', () => {
  it('evaluates alerts only after a comparison exists', async () => {
    const historyService = { materializeForSnapshot: vi.fn().mockResolvedValue({ outcome: 'COMPLETED', comparisonId: 'comparison-1' }) };
    const alertsService = { evaluateComparison: vi.fn().mockResolvedValue({ triggered: 2, resolved: 1 }) };
    const result = await processVisibilityMonitoringJob(
      { name: 'evaluate-snapshot', data: { projectId: 'project-1', snapshotId: 'snapshot-1' } },
      { historyService, alertsService }
    );
    expect(alertsService.evaluateComparison).toHaveBeenCalledWith('project-1', 'comparison-1');
    expect(result).toEqual({ outcome: 'COMPLETED', comparisonId: 'comparison-1', alerts: { triggered: 2, resolved: 1 } });
  });

  it('does not evaluate alerts when there is no compatible predecessor', async () => {
    const historyService = { materializeForSnapshot: vi.fn().mockResolvedValue({ outcome: 'NO_COMPATIBLE_PREVIOUS', comparisonId: null }) };
    const alertsService = { evaluateComparison: vi.fn() };
    const result = await processVisibilityMonitoringJob(
      { name: 'evaluate-snapshot', data: { projectId: 'project-1', snapshotId: 'snapshot-1' } },
      { historyService, alertsService }
    );
    expect(alertsService.evaluateComparison).not.toHaveBeenCalled();
    expect(result).toEqual({ outcome: 'NO_COMPATIBLE_PREVIOUS', comparisonId: null, alerts: { triggered: 0, resolved: 0 } });
  });
});
