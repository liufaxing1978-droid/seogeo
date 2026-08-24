import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const ROUTES_PATH = new URL('../../src/modules/publication/publication.routes.ts', import.meta.url);

describe('P9-C typed publication execution route authority', () => {
  it('keeps public execute human-only and delegates creation to the V2 typed execution service', async () => {
    const source = await readFile(ROUTES_PATH, 'utf8');

    expect(source).not.toContain('PUBLICATION_EXECUTION_KEY_V1');
    expect(source).not.toMatch(/function\s+executionKey\s*\(/);
    expect(source).toContain("from './publication-execution.service.js'");
    expect(source).toContain('publicationExecutionService.createHumanApprovedExecution({');
    expect(source).not.toContain('createAutomationAuthorizedExecution({');
  });
});
