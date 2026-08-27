import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('Release-01 staging operations runbook contract', () => {
  it('documents the staging deployment sequence and health checks', () => {
    const staging = readRepoFile('docs/development/release-01-staging-runbook.md');

    expect(staging).toContain('prisma migrate deploy');
    expect(staging).toContain('/health/live');
    expect(staging).toContain('/health/ready');
    expect(staging).toContain('TRUST_PROXY_HOPS');
    expect(staging).toContain('npm start');
    expect(staging).toContain('npm run start:worker');
    expect(staging).toContain('HTTPS');
    expect(staging).toContain('Production');
  });

  it('documents operator-controlled PostgreSQL backup and restore', () => {
    const backup = readRepoFile('docs/development/release-01-backup-restore.md');

    expect(backup).toContain('pg_dump');
    expect(backup).toContain('pg_restore');
    expect(backup).toContain('non-production');
    expect(backup).toContain('candidate SHA');
    expect(backup).toContain('down-migrations');
  });

  it('documents immutable application rollback without autonomous authority', () => {
    const rollback = readRepoFile('docs/development/release-01-rollback.md');

    expect(rollback).toContain('previous known-good');
    expect(rollback).toContain('Web');
    expect(rollback).toContain('Worker');
    expect(rollback).toContain('DeepSeek');
    expect(rollback).toContain('forward-fix');
  });

  it('preserves the 25-gate staging acceptance and truth boundaries', () => {
    const acceptance = readRepoFile('docs/development/release-01-staging-acceptance.md');

    expect(acceptance).toContain('PR_CREATED != DEPLOYED != VERIFIED');
    expect(acceptance).toContain('STAGING DEPLOYABLE — external staging acceptance pending');
    expect(acceptance).toContain('not-configured/not-sampled');

    const gateCount = acceptance.match(/^\s*\d+\.\s+\[[ x-]\]/gmu)?.length ?? 0;
    expect(gateCount).toBe(25);
  });
});
