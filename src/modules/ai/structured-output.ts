import { z } from 'zod';

export class AiOutputValidationError extends Error {
  readonly name = 'AiOutputValidationError';
  readonly code = 'INVALID_AI_OUTPUT' as const;

  constructor(message = 'AI output is not valid structured output') {
    super(message);
  }
}

function jsonCandidate(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  return fenced ? fenced[1].trim() : content;
}

export function parseStructuredOutput<T>(content: string, schema: z.ZodType<T>): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonCandidate(content));
  } catch {
    throw new AiOutputValidationError('AI output is not valid JSON');
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new AiOutputValidationError('AI output does not match the required schema');
  }

  return result.data;
}
