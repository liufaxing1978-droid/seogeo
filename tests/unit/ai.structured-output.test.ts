import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AiOutputValidationError, parseStructuredOutput } from '../../src/modules/ai/structured-output.js';

const schema = z.object({
  summary: z.string().min(1),
  priorities: z.array(z.object({ title: z.string().min(1) })).max(3)
});

describe('structured AI output validation', () => {
  it('parses and validates compliant JSON', () => {
    expect(parseStructuredOutput('{"summary":"ok","priorities":[{"title":"Fix title"}]}', schema)).toEqual({
      summary: 'ok',
      priorities: [{ title: 'Fix title' }]
    });
  });

  it('parses compliant JSON wrapped in a Markdown json code fence', () => {
    expect(parseStructuredOutput('```json\n{"summary":"ok","priorities":[{"title":"Fix title"}]}\n```', schema)).toEqual({
      summary: 'ok',
      priorities: [{ title: 'Fix title' }]
    });
  });

  it('rejects malformed JSON with a stable INVALID_AI_OUTPUT error', () => {
    expect(() => parseStructuredOutput('{not-json', schema)).toThrow(AiOutputValidationError);
    try {
      parseStructuredOutput('{not-json', schema);
    } catch (error) {
      expect(error).toMatchObject({ code: 'INVALID_AI_OUTPUT' });
      expect(String(error)).not.toContain('{not-json');
    }
  });

  it('rejects schema-invalid JSON without returning partial model output', () => {
    expect(() => parseStructuredOutput('{"summary":"","priorities":[{"bad":"shape"}]}', schema)).toThrow(
      AiOutputValidationError
    );
    try {
      parseStructuredOutput('{"summary":"","priorities":[{"bad":"shape"}]}', schema);
    } catch (error) {
      expect(error).toMatchObject({ code: 'INVALID_AI_OUTPUT' });
      expect(String(error)).not.toContain('bad');
    }
  });
});
