import type { Prisma } from '@prisma/client';
import { normalizeKeywordText } from './keyword-normalize.js';
import type { KeywordListQuery } from './keyword.schema.js';

export function buildKeywordWhere(
  projectId: string,
  filters: KeywordListQuery,
): Prisma.KeywordWhereInput {
  return {
    projectId,
    ...(filters.q
      ? { normalizedText: { contains: normalizeKeywordText(filters.q) } }
      : {}),
    ...(filters.type ? { type: filters.type } : {}),
    ...(filters.intent ? { intent: filters.intent } : {}),
    ...(filters.priority ? { priority: filters.priority } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.lifecycleStatus ? { lifecycleStatus: filters.lifecycleStatus } : {}),
    ...(filters.groupId
      ? { groupMemberships: { some: { groupId: filters.groupId } } }
      : {}),
    ...(filters.language ? { language: filters.language } : {}),
    ...(filters.region ? { targetCountry: filters.region } : {}),
  };
}
