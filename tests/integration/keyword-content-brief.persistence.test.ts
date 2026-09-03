import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';

describe('Keyword content brief request persistence', () => {
  it('has an additive bridge table for Keyword content brief requests', async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ relation: string | null }>>(
      `SELECT to_regclass('"KeywordContentBriefRequest"')::text AS relation`,
    );

    expect(rows[0]?.relation).toBe('"KeywordContentBriefRequest"');
  });
});
