import { z } from 'zod';

export class AiOutputValidationError extends Error {
  readonly name = 'AiOutputValidationError';
  readonly code = 'INVALID_AI_OUTPUT' as const;

  constructor(message = 'AI output is not valid structured output') {
    super(message);
  }
}

export function parseStructuredOutput<T>(content: string, schema: z.ZodType<T>): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new AiOutputValidationError('AI output is not valid JSON');
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new AiOutputValidationError('AI output does not match the required schema');
  }

  return result.data;
}
