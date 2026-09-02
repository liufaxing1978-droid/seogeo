import { describe, expect, it } from 'vitest';
import {
  keywordBulkCreateSchema,
  keywordCreateSchema,
  keywordGroupCreateSchema,
  keywordGroupMembershipSchema,
  keywordListQuerySchema,
  keywordLockSchema,
  keywordParentSchema,
  keywordSuggestionDecisionSchema,
  keywordUpdateSchema,
} from '../../src/modules/keywords/keyword.schema.js';

describe('keyword request schemas', () => {
  it('rejects invalid enum values before they reach Prisma', () => {
    const result = keywordCreateSchema.safeParse({
      text: '符纸',
      type: 'MADE_UP',
      priority: 'URGENT',
    });

    expect(result.success).toBe(false);
  });

  it('accepts explicit lifecycle updates but rejects unknown lifecycle states', () => {
    expect(keywordUpdateSchema.safeParse({ lifecycleStatus: 'EVALUATING' }).success).toBe(true);
    expect(keywordUpdateSchema.safeParse({ lifecycleStatus: 'ACTIVE' }).success).toBe(false);
  });

  it('parses a bounded multiline bulk request without discarding item defaults', () => {
    const result = keywordBulkCreateSchema.parse({
      text: '符纸\n六壬法教\n民间信仰',
      type: 'CORE',
      priority: 'HIGH',
      lifecycleStatus: 'DISCOVERED',
      language: 'zh-Hans',
      targetCountry: 'CN',
    });

    expect(result).toEqual({
      text: '符纸\n六壬法教\n民间信仰',
      type: 'CORE',
      priority: 'HIGH',
      lifecycleStatus: 'DISCOVERED',
      language: 'zh-Hans',
      targetCountry: 'CN',
    });
  });

  it('rejects a bulk request with more than 100 non-empty lines', () => {
    const text = Array.from({ length: 101 }, (_, index) => `关键词 ${index + 1}`).join('\n');
    expect(keywordBulkCreateSchema.safeParse({ text, type: 'CORE' }).success).toBe(false);
  });

  it('normalizes combined list filters and rejects unknown query keys', () => {
    expect(keywordListQuerySchema.parse({
      q: '  符纸  ',
      type: 'CORE',
      intent: 'INFORMATIONAL',
      priority: 'HIGH',
      lifecycleStatus: 'APPROVED',
      groupId: '550e8400-e29b-41d4-a716-446655440000',
      language: 'zh-Hans',
      region: 'CN',
    })).toEqual({
      q: '符纸',
      type: 'CORE',
      intent: 'INFORMATIONAL',
      priority: 'HIGH',
      lifecycleStatus: 'APPROVED',
      groupId: '550e8400-e29b-41d4-a716-446655440000',
      language: 'zh-Hans',
      region: 'CN',
    });

    expect(keywordListQuerySchema.safeParse({ madeUp: 'value' }).success).toBe(false);
  });

  it('strictly validates the remaining keyword mutation commands', () => {
    expect(keywordLockSchema.parse({ locked: true })).toEqual({ locked: true });
    expect(keywordParentSchema.safeParse({ parentKeywordId: 'not-a-uuid' }).success).toBe(false);
    expect(keywordGroupCreateSchema.safeParse({ name: '   ' }).success).toBe(false);
    expect(keywordGroupMembershipSchema.safeParse({ groupIds: ['not-a-uuid'] }).success).toBe(false);
    expect(keywordSuggestionDecisionSchema.safeParse({ editedText: '符纸', surprise: true }).success).toBe(false);
  });
});
