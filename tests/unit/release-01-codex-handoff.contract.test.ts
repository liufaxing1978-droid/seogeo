import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('Release-01 Codex staging handoff contract', () => {
  it('records an exact integrated main identity instead of stale Draft PR state', () => {
    const acceptance = readRepoFile('docs/development/release-01-staging-acceptance.md');

    expect(acceptance).toMatch(/Integrated main: `main@[0-9a-f]{40}`/u);
    expect(acceptance).toMatch(/Main CI: CI #\d+, workflow run `\d+`/u);
    expect(acceptance).toContain('PR #173');
    expect(acceptance).not.toContain('still Draft and unmerged');
  });

  it('provides a Codex handoff without embedding server credentials', () => {
    const handoff = readRepoFile('docs/development/release-01-codex-staging-handoff.md');

    expect(handoff).toContain('Gate 5');
    expect(handoff).toContain('Gate 25');
    expect(handoff).toContain('prisma migrate deploy');
    expect(handoff).toContain('/health/live');
    expect(handoff).toContain('/health/ready');
    expect(handoff).toContain('STAGING DEPLOYABLE — external staging acceptance pending');
    expect(handoff).toContain('Do not start P11');
    expect(handoff).toContain('Do not deploy Production');
    expect(handoff).toContain('supply server connection details out-of-band');
    expect(handoff).not.toMatch(/(?:password|passwd)\s*[:=]\s*\S+/iu);
    expect(handoff).not.toMatch(/\b\d{1,3}(?:\.\d{1,3}){3}\b/u);
  });
});
