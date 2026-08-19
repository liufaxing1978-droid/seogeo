import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('P6-B persistence schema boundary', () => {
  it('persists replay evidence while excluding P6-C metric models', async () => {
    const [visibility, intelligence] = await Promise.all([
      readFile('prisma/models/visibility.prisma', 'utf8'),
      readFile('prisma/models/visibility-intelligence.prisma', 'utf8')
    ]);

    expect(visibility).toContain('citationEvidenceState CitationEvidenceState');
    expect(visibility).toContain('@default(UNKNOWN)');
    expect(intelligence).toContain('subjectSnapshotJson');
    expect(intelligence).toContain('subjectSetHash');
    expect(intelligence).not.toContain('VisibilitySnapshot');
    expect(intelligence).not.toContain('MentionRate');
    expect(intelligence).not.toContain('CitationRate');
    expect(intelligence).not.toContain('ShareOfVoice');
  });
});
