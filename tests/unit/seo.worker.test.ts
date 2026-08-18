import { describe, expect, it, vi } from 'vitest';
import { processSeoAuditJob } from '../../src/modules/seo/seo.worker.js';

describe('processSeoAuditJob', () => {
  it('calls the deterministic SEO audit executor with the audit id', async () => {
    const execute = vi.fn(async () => undefined);

    await processSeoAuditJob({ data: { auditRunId: 'audit-123' } }, execute);

    expect(execute).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith('audit-123');
  });

  it('rejects malformed jobs before calling the engine', async () => {
    const execute = vi.fn(async () => undefined);

    await expect(
      processSeoAuditJob({ data: { auditRunId: '' } }, execute)
    ).rejects.toThrow(/auditRunId is required/i);
    expect(execute).not.toHaveBeenCalled();
  });
});
