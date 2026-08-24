import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';

type RegclassRow = {
  experiment: string | null;
  observation: string | null;
};

type NameRow = { name: string };

describe('P9-D experiment persistence', () => {
  it('installs the experiment and observation tables', async () => {
    const [row] = await prisma.$queryRawUnsafe<RegclassRow[]>(`
      SELECT
        to_regclass('public."OptimizationExperiment"')::text AS experiment,
        to_regclass('public."OptimizationExperimentObservation"')::text AS observation
    `);

    expect(row?.experiment).not.toBeNull();
    expect(row?.observation).not.toBeNull();
  });

  it('installs immutable update/delete triggers for both records', async () => {
    const rows = await prisma.$queryRawUnsafe<NameRow[]>(`
      SELECT t.tgname AS name
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      WHERE NOT t.tgisinternal
        AND c.relname IN ('OptimizationExperiment', 'OptimizationExperimentObservation')
      ORDER BY t.tgname ASC
    `);

    expect(rows.map((row) => row.name)).toEqual(expect.arrayContaining([
      'OptimizationExperiment_immutable',
      'OptimizationExperimentObservation_immutable'
    ]));
  });
});
