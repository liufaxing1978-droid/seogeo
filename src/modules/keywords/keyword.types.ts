import type {
  KeywordIntent,
  KeywordPriority,
  KeywordSource,
  KeywordStatus,
  KeywordType,
} from '@prisma/client';

export interface CreateManualKeywordInput {
  actorUserId: string;
  projectId: string;
  text: string;
  type: KeywordType;
  intent?: KeywordIntent | null;
  priority?: KeywordPriority;
  parentKeywordId?: string | null;
  groupIds?: string[];
  language?: string | null;
  targetCountry?: string | null;
  notes?: string | null;
  locked?: boolean;
}

export interface CoveragePageFact {
  pageId: string;
  url: string;
  path: string;
  title: string | null;
  h1: string | null;
  metaDescription: string | null;
}

export interface KeywordCoverageEvidence {
  pageId: string;
  url: string;
  titleMatch: boolean;
  h1Match: boolean;
  metaDescriptionMatch: boolean;
  pathMatch: boolean;
  score: number;
}

export type KeywordCoverageStatus = 'STRONG' | 'PARTIAL' | 'NONE' | 'UNKNOWN';
export type KeywordCoverageEmptyReason = 'NO_ACTIVE_PAGE_EVIDENCE' | 'NO_USABLE_SNAPSHOT_EVIDENCE';

export interface KeywordCoverageResult {
  status: KeywordCoverageStatus;
  reason: 'MATCHED' | 'NO_MATCH' | KeywordCoverageEmptyReason;
  matches: KeywordCoverageEvidence[];
}

export interface KeywordListRecord {
  id: string;
  projectId: string;
  text: string;
  normalizedText: string;
  type: KeywordType;
  intent: KeywordIntent | null;
  priority: KeywordPriority;
  status: KeywordStatus;
  locked: boolean;
  source: KeywordSource;
}
