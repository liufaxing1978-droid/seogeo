import { describe, expect, it, vi } from 'vitest';
import { processGeoAuditJob } from '../../src/modules/geo/geo.worker.js';

describe('processGeoAuditJob', () => {
  it('requires auditRunId and delegates one job to the GEO audit engine', async () => {
    const execute = vi.fn(async () => undefined);

    await processGeoAuditJob({ data: { auditRunId: 'audit-1' } }, execute);

    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith('audit-1');
  });

  it('rejects malformed jobs', async () => {
    const execute = vi.fn(async () => undefined);

    await expect(processGeoAuditJob({ data: { auditRunId: '' } }, execute)).rejects.toThrow(/auditRunId/i);
    expect(execute).not.toHaveBeenCalled();
  });
});
