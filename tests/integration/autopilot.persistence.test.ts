import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';

type RegclassRow = {
  policy: string | null;
  decision: string | null;
  reservation: string | null;
  authorization: string | null;
};

type NameRow = { name: string };

describe('P9-C persistence foundation', () => {
  it('installs the controlled-autopilot durable tables', async () => {
    const [row] = await prisma.$queryRawUnsafe<RegclassRow[]>(`
      SELECT
        to_regclass('public."AutopilotPolicy"')::text AS policy,
        to_regclass('public."OptimizationAutopilotDecision"')::text AS decision,
        to_regclass('public."AutopilotExecutionReservation"')::text AS reservation,
        to_regclass('public."PublicationAutomationAuthorization"')::text AS authorization
    `);

    expect(row).toBeDefined();
    expect(row?.policy).not.toBeNull();
    expect(row?.decision).not.toBeNull();
    expect(row?.reservation).not.toBeNull();
    expect(row?.authorization).not.toBeNull();
  });

  it('enforces exactly one publication execution authorization source', async () => {
    const rows = await prisma.$queryRawUnsafe<NameRow[]>(`
      SELECT conname AS name
      FROM pg_constraint
      WHERE conrelid = to_regclass('public."PublicationExecution"')
        AND contype = 'c'
    `);

    expect(rows.map((row) => row.name)).toContain('PublicationExecution_one_authorization_source');
  });

  it('installs immutable decision and machine-authorization triggers', async () => {
    const rows = await prisma.$queryRawUnsafe<NameRow[]>(`
      SELECT t.tgname AS name
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      WHERE NOT t.tgisinternal
        AND c.relname IN ('OptimizationAutopilotDecision', 'PublicationAutomationAuthorization')
      ORDER BY t.tgname ASC
    `);

    expect(rows.map((row) => row.name)).toEqual(expect.arrayContaining([
      'OptimizationAutopilotDecision_immutable',
      'PublicationAutomationAuthorization_immutable'
    ]));
  });

  it('adds a unique automation preparation identity to PublicationProposal', async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ indexdef: string }>>(`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'PublicationProposal'
    `);

    expect(rows.some((row) =>
      row.indexdef.includes('UNIQUE') && row.indexdef.includes('automationPreparationKey')
    )).toBe(true);
  });
});
