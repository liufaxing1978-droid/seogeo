import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

function model(name: string) {
  return Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === name);
}

function fieldNames(name: string): Set<string> {
  const found = model(name);
  expect(found, `missing Prisma model ${name}`).toBeDefined();
  return new Set(found!.fields.map((field) => field.name));
}

describe('OL-2 automation persistence contract', () => {
  it('persists project-scoped automation definitions with bounded execution policy', () => {
    const fields = fieldNames('AutomationDefinition');

    for (const required of [
      'id',
      'projectId',
      'key',
      'actionType',
      'enabled',
      'scheduleCron',
      'overlapPolicy',
      'maxAttempts',
      'timeoutMs',
      'createdAt',
      'updatedAt'
    ]) {
      expect(fields.has(required), `missing AutomationDefinition.${required}`).toBe(true);
    }
  });

  it('persists every manual or scheduled execution with retry, timeout, and overlap audit facts', () => {
    const fields = fieldNames('AutomationRun');

    for (const required of [
      'id',
      'definitionId',
      'projectId',
      'source',
      'requestKey',
      'status',
      'attempt',
      'deadlineAt',
      'blockedByRunId',
      'startedAt',
      'completedAt',
      'lastErrorCode',
      'createdAt',
      'updatedAt'
    ]) {
      expect(fields.has(required), `missing AutomationRun.${required}`).toBe(true);
    }
  });

  it('reserves explicit manual/scheduled sources and terminal timeout/overlap states', () => {
    const sourceEnum = Prisma.dmmf.datamodel.enums.find(
      (candidate) => candidate.name === 'AutomationRunSource'
    );
    const statusEnum = Prisma.dmmf.datamodel.enums.find(
      (candidate) => candidate.name === 'AutomationRunStatus'
    );

    expect(sourceEnum, 'missing AutomationRunSource enum').toBeDefined();
    expect(sourceEnum!.values.map((value) => value.name)).toEqual(
      expect.arrayContaining(['MANUAL', 'SCHEDULED'])
    );

    expect(statusEnum, 'missing AutomationRunStatus enum').toBeDefined();
    expect(statusEnum!.values.map((value) => value.name)).toEqual(
      expect.arrayContaining(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'TIMED_OUT', 'SKIPPED'])
    );
  });
});
