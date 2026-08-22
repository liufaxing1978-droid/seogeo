import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { GSC_QUERY_NORMALIZATION_VERSION } from '../../src/modules/search-console/search-console.types.js';

describe('P9-0B existing GSC compatibility', () => {
  it('keeps the existing GSC query normalization version unchanged', () => {
    expect(GSC_QUERY_NORMALIZATION_VERSION).toBe('GSC_QUERY_NORMALIZATION_V1');
  });

  it('keeps existing GSC Prisma persistence delegates available', () => {
    expect(typeof prisma.gscDailySnapshot.findMany).toBe('function');
    expect(typeof prisma.gscQueryPageFact.findMany).toBe('function');
  });
});
