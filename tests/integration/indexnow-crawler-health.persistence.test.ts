import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';

describe('P9 IndexNow and crawler-health persistence', () => {
  it('has additive durable submission and health relations', async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ relation: string | null }>>(
      `SELECT to_regclass('"IndexNowSubmissionBatch"')::text AS relation
       UNION ALL SELECT to_regclass('"CrawlerHealthSnapshot"')::text AS relation`,
    );

    expect(rows.map((row) => row.relation)).toEqual([
      '"IndexNowSubmissionBatch"',
      '"CrawlerHealthSnapshot"',
    ]);
  });
});
