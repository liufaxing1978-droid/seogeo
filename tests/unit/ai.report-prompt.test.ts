import { describe, expect, it } from 'vitest';
import { getPromptDefinition } from '../../src/modules/ai/prompts/prompt-registry.js';

describe('project report summary prompt', () => {
  it('uses the persisted report source reference instead of an example placeholder', () => {
    const prompt = getPromptDefinition('project-report-summary-v1');
    const message = prompt.buildUserMessage({ report: { sourceRef: 'REPORT_SNAPSHOT:report-123' } });

    expect(message).toContain('REPORT_SNAPSHOT:report-123');
    expect(message).not.toContain('REPORT_SNAPSHOT:<id>');
    expect(message).toContain('Use [] for an empty list');
  });
});
