import { describe, expect, it } from 'vitest';
import {
  approvalHashV1,
  canonicalPublicationJson,
  contentHashV1,
  planHashV1,
  previewHashV1
} from '../../src/modules/publication/publication.hash.js';

describe('P8-A canonical publication hashes', () => {
  it('canonicalizes object keys while preserving semantic array order by default', () => {
    const left = canonicalPublicationJson({
      z: 1,
      a: { y: 2, x: 1 },
      paragraphs: ['first', 'second']
    });
    const right = canonicalPublicationJson({
      paragraphs: ['first', 'second'],
      a: { x: 1, y: 2 },
      z: 1
    });

    expect(left).toBe(right);
    expect(canonicalPublicationJson({ paragraphs: ['first', 'second'] }))
      .not.toBe(canonicalPublicationJson({ paragraphs: ['second', 'first'] }));
  });

  it('makes plan hashes independent of set-like file and operation ordering', () => {
    const a = { type: 'SET_TITLE', path: 'content/a.md', value: 'A' };
    const b = { type: 'UPSERT_JSON_LD', path: 'content/b.md', value: { '@type': 'Article' } };

    expect(planHashV1({ operations: [a, b], files: ['content/b.md', 'content/a.md'], baseSha: 'abc' }))
      .toBe(planHashV1({ files: ['content/a.md', 'content/b.md'], operations: [b, a], baseSha: 'abc' }));
    expect(planHashV1({ files: ['content/a.md'], operations: [a], baseSha: 'abc' }))
      .not.toBe(planHashV1({ files: ['content/a.md'], operations: [a], baseSha: 'def' }));
  });

  it('uses distinct version domains for content, preview, plan and approval hashes', () => {
    const samePayload = { value: 'same' };
    const hashes = new Set([
      contentHashV1(samePayload),
      previewHashV1(samePayload),
      planHashV1(samePayload),
      approvalHashV1(samePayload)
    ]);

    expect(hashes.size).toBe(4);
    for (const hash of hashes) expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('binds approval hash to exact reviewed target state', () => {
    const binding = {
      planHash: 'plan',
      contentHash: 'content',
      contentVersion: 3,
      previewHash: 'preview',
      baseSha: 'base',
      targetRepository: 'owner/site',
      targetBranch: 'main',
      targetBlobHashes: { 'content/a.md': 'blob-a' },
      approvedRiskClass: 'LOW',
      confirmedWarningCodes: ['META_DESCRIPTION_LONG']
    };

    expect(approvalHashV1(binding)).not.toBe(approvalHashV1({ ...binding, baseSha: 'new-base' }));
    expect(approvalHashV1(binding)).not.toBe(approvalHashV1({
      ...binding,
      targetBlobHashes: { 'content/a.md': 'changed-blob' }
    }));
  });
});
