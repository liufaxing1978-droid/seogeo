import { z } from 'zod';

export const keywordTypeSchema = z.enum([
  'CORE',
  'LONG_TAIL',
  'BRAND',
  'QUESTION',
  'LOCAL',
  'COMMERCIAL',
]);

export const keywordIntentSchema = z.enum([
  'INFORMATIONAL',
  'NAVIGATIONAL',
  'COMMERCIAL_INVESTIGATION',
  'TRANSACTIONAL',
  'LOCAL',
  'UNKNOWN',
]);

export const keywordPrioritySchema = z.enum(['HIGH', 'MEDIUM', 'LOW']);
export const keywordStatusSchema = z.enum(['ACTIVE', 'DISABLED', 'ARCHIVED']);
export const keywordLifecycleStatusSchema = z.enum([
  'DISCOVERED',
  'EVALUATING',
  'APPROVED',
  'MAPPED',
  'CONTENT_PLANNED',
  'CONTENT_IN_PROGRESS',
  'PUBLISHED',
  'INDEXED',
  'RANKING',
  'AI_CITED',
  'NEEDS_OPTIMIZATION',
  'RETIRED',
]);

const keywordTextSchema = z.string().trim().min(1).max(240);
const optionalTextSchema = z.string().trim().max(240).nullable().optional();
const optionalLongTextSchema = z.string().trim().max(2_000).nullable().optional();
const optionalUuidSchema = z.string().uuid().nullable().optional();

export const keywordCreateSchema = z.object({
  text: keywordTextSchema,
  type: keywordTypeSchema,
  intent: keywordIntentSchema.nullable().optional(),
  priority: keywordPrioritySchema.optional(),
  lifecycleStatus: keywordLifecycleStatusSchema.optional(),
  parentKeywordId: optionalUuidSchema,
  groupIds: z.array(z.string().uuid()).max(100).optional(),
  language: optionalTextSchema,
  targetCountry: optionalTextSchema,
  notes: optionalLongTextSchema,
  locked: z.boolean().optional(),
}).strict();

export const keywordUpdateSchema = z.object({
  text: keywordTextSchema.optional(),
  type: keywordTypeSchema.optional(),
  intent: keywordIntentSchema.nullable().optional(),
  priority: keywordPrioritySchema.optional(),
  status: keywordStatusSchema.optional(),
  lifecycleStatus: keywordLifecycleStatusSchema.optional(),
  language: optionalTextSchema,
  targetCountry: optionalTextSchema,
  notes: optionalLongTextSchema,
  acknowledgeLock: z.boolean().optional(),
}).strict().refine((input) => Object.keys(input).length > 0, {
  message: 'At least one keyword field is required',
});

export const keywordTargetUrlSchema = z.object({
  targetUrl: z.string().url().max(2_000),
  acknowledgeLock: z.boolean().optional(),
}).strict();

export const keywordEntityMappingSchema = z.object({
  entityIds: z.array(z.string().uuid()).max(50),
}).strict();

export const keywordCannibalizationCalculationSchema = z.object({}).strict();

export const keywordBulkCreateSchema = z.object({
  text: z.string().min(1).max(30_000),
  type: keywordTypeSchema,
  intent: keywordIntentSchema.nullable().optional(),
  priority: keywordPrioritySchema.optional(),
  lifecycleStatus: keywordLifecycleStatusSchema.optional(),
  groupIds: z.array(z.string().uuid()).max(100).optional(),
  language: optionalTextSchema,
  targetCountry: optionalTextSchema,
  notes: optionalLongTextSchema,
  locked: z.boolean().optional(),
}).strict().superRefine((input, context) => {
  const lines = input.text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'At least one keyword is required' });
  }
  if (lines.length > 100) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'At most 100 keywords are allowed' });
  }
  lines.forEach((line, index) => {
    if (line.length > 240) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Keyword line ${index + 1} exceeds 240 characters`,
      });
    }
  });
});

export const keywordListQuerySchema = z.object({
  q: z.string().trim().min(1).max(240).optional(),
  type: keywordTypeSchema.optional(),
  intent: keywordIntentSchema.optional(),
  priority: keywordPrioritySchema.optional(),
  status: keywordStatusSchema.optional(),
  lifecycleStatus: keywordLifecycleStatusSchema.optional(),
  groupId: z.string().uuid().optional(),
  language: z.string().trim().min(1).max(240).optional(),
  region: z.string().trim().min(1).max(240).optional(),
}).strict();

export const keywordLockSchema = z.object({
  locked: z.boolean(),
  acknowledgeLock: z.boolean().optional(),
}).strict();

export const keywordStatusCommandSchema = z.object({
  acknowledgeLock: z.boolean().optional(),
}).strict();

export const keywordParentSchema = z.object({
  parentKeywordId: z.string().uuid(),
  acknowledgeLock: z.boolean().optional(),
}).strict();

export const keywordGroupCreateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2_000).nullable().optional(),
}).strict();

export const keywordGroupMembershipSchema = z.object({
  groupIds: z.array(z.string().uuid()).max(100),
  acknowledgeLock: z.boolean().optional(),
}).strict();

export const keywordGroupRenameSchema = z.object({
  name: z.string().trim().min(1).max(160),
}).strict();

export const keywordGroupPrimarySchema = z.object({
  primaryKeywordId: z.string().uuid().nullable(),
  acknowledgeLock: z.boolean().optional(),
}).strict();

export const keywordGroupBulkAssignmentSchema = z.object({
  keywordIds: z.array(z.string().uuid()).min(1).max(100),
  acknowledgeLock: z.boolean().optional(),
}).strict();

export const keywordOpportunityCalculationSchema = z.object({}).strict();

export const keywordSuggestionDecisionSchema = z.object({
  editedText: keywordTextSchema.optional(),
}).strict();

export const keywordSuggestionBulkAcceptSchema = z.object({
  suggestionIds: z.array(z.string().uuid()).min(1).max(50),
}).strict();

export const emptyKeywordMutationSchema = z.object({}).strict();

export type KeywordCreateBody = z.infer<typeof keywordCreateSchema>;
export type KeywordUpdateBody = z.infer<typeof keywordUpdateSchema>;
export type KeywordBulkCreateBody = z.infer<typeof keywordBulkCreateSchema>;
export type KeywordListQuery = z.infer<typeof keywordListQuerySchema>;
