import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function readRepoFile(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('Release-01 Codex staging handoff contract', () => {
  it('records the merged main integration identity instead of stale Draft PR state', () => {
    const acceptance = readRepoFile('docs/development/release-01-staging-acceptance.md');

    expect(acceptance).toContain('main@d33e8f4e16876f0d50c7c4e5c9313a9270b87f32');
    expect(acceptance).toContain('CI #2251');
    expect(acceptance).toContain('PR #173 merged');
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
