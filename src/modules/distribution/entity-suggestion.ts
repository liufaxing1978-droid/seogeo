import { z } from 'zod';
import { AiOutputValidationError, parseStructuredOutput } from '../ai/structured-output.js';

const sourceRefs = z.array(z.string().min(1).max(300)).max(40);
const nonEmptySourceRefs = z.array(z.string().min(1).max(300)).min(1).max(40);

function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

const LocalizedTextSchema = z.object({
  language: z.string().trim().min(1).max(35),
  value: z.string().trim().min(1).max(1000)
}).strict();

const AttributeSchema = z.object({
  property: z.string().trim().min(1).max(200),
  value: z.string().trim().min(1).max(4000),
  sourceRefs: nonEmptySourceRefs
}).strict();

const SameAsSchema = z.object({
  url: z.string().trim().url().max(2048).refine(isHttpUrl, 'SameAs URL must use HTTP or HTTPS'),
  sourceRefs: nonEmptySourceRefs
}).strict();

const RelationshipSchema = z.object({
  relation: z.string().trim().min(1).max(200),
  target: z.string().trim().min(1).max(500),
  sourceRefs: nonEmptySourceRefs
}).strict();

export const EntitySuggestionOutputSchema = z.object({
  entityName: z.string().trim().min(1).max(300),
  labels: z.array(LocalizedTextSchema.extend({ value: z.string().trim().min(1).max(300) })).max(50),
  descriptions: z.array(LocalizedTextSchema).max(50),
  attributes: z.array(AttributeSchema).max(100),
  sameAs: z.array(SameAsSchema).max(50),
  relationships: z.array(RelationshipSchema).max(100),
  reliableSourceRefs: sourceRefs,
  missingData: z.array(z.string().trim().min(1).max(300)).max(50),
  policyReminders: z.array(z.string().trim().min(1).max(1000)).max(30),
  humanChecklist: z.array(z.string().trim().min(1).max(1000)).max(50)
}).strict();

export type EntitySuggestionOutput = z.infer<typeof EntitySuggestionOutputSchema>;

type SourceReference = { type: string; id: string };

function ref(type: string, id: string): string {
  return `${type}:${id}`;
}

function suppliedRefSet(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  const refs = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.type !== 'string' || typeof record.id !== 'string') continue;
    refs.add(ref(record.type, record.id));
  }
  return refs;
}

function assertSuppliedRefs(refs: string[], supplied: Set<string>): void {
  if (refs.some((item) => !supplied.has(item))) {
    throw new AiOutputValidationError('Entity suggestion contains a source reference that was not supplied');
  }
}

export function parseEntitySuggestionOutput(
  content: string,
  suppliedSourceReferences: unknown
): EntitySuggestionOutput {
  const output = parseStructuredOutput(content, EntitySuggestionOutputSchema);
  const supplied = suppliedRefSet(suppliedSourceReferences);

  assertSuppliedRefs(output.reliableSourceRefs, supplied);
  const reliable = new Set(output.reliableSourceRefs);
  const factualRefGroups = [
    ...output.attributes.map((item) => item.sourceRefs),
    ...output.sameAs.map((item) => item.sourceRefs),
    ...output.relationships.map((item) => item.sourceRefs)
  ];

  if (factualRefGroups.length > 0 && output.reliableSourceRefs.length === 0) {
    throw new AiOutputValidationError('Entity suggestion factual output requires reliable source references');
  }

  for (const refs of factualRefGroups) {
    assertSuppliedRefs(refs, supplied);
    if (refs.some((item) => !reliable.has(item))) {
      throw new AiOutputValidationError('Entity suggestion factual output must use reliable source references');
    }
  }

  return output;
}

function line(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

export function renderEntitySuggestionBody(output: EntitySuggestionOutput): string {
  const sections: string[] = [`# ${line(output.entityName)}`];

  sections.push('## Labels');
  sections.push(...(output.labels.length > 0
    ? output.labels.map((item) => `- ${line(item.language)}: ${line(item.value)}`)
    : ['- None supplied']));

  sections.push('## Descriptions');
  sections.push(...(output.descriptions.length > 0
    ? output.descriptions.map((item) => `- ${line(item.language)}: ${line(item.value)}`)
    : ['- None supplied']));

  sections.push('## Attributes');
  sections.push(...(output.attributes.length > 0
    ? output.attributes.map((item) => `- ${line(item.property)}: ${line(item.value)} [${item.sourceRefs.map(line).join(', ')}]`)
    : ['- None supplied']));

  sections.push('## SameAs candidates');
  sections.push(...(output.sameAs.length > 0
    ? output.sameAs.map((item) => `- ${line(item.url)} [${item.sourceRefs.map(line).join(', ')}]`)
    : ['- None supplied']));

  sections.push('## Relationships');
  sections.push(...(output.relationships.length > 0
    ? output.relationships.map((item) => `- ${line(item.relation)} -> ${line(item.target)} [${item.sourceRefs.map(line).join(', ')}]`)
    : ['- None supplied']));

  sections.push('## Missing data');
  sections.push(...(output.missingData.length > 0 ? output.missingData.map((item) => `- ${line(item)}`) : ['- None reported']));

  sections.push('## Policy reminders');
  sections.push(...(output.policyReminders.length > 0 ? output.policyReminders.map((item) => `- ${line(item)}`) : ['- Human review required']));

  sections.push('## Human checklist');
  sections.push(...(output.humanChecklist.length > 0 ? output.humanChecklist.map((item) => `- ${line(item)}`) : ['- Verify every factual claim against reliable cited sources']));

  return sections.join('\n');
}
