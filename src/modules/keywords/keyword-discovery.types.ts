import type {
  Keyword,
  KeywordDiscoveryCandidate,
  KeywordIntent,
  KeywordPriority,
  KeywordType,
} from '@prisma/client';

export type KeywordDiscoveryWindow = {
  dateFrom: string;
  dateTo: string;
};

export type KeywordDiscoveryProvider =
  | 'GOOGLE_SEARCH_CONSOLE'
  | 'BING_WEBMASTER';

export type KeywordDiscoveryProviderEvidence = {
  provider: KeywordDiscoveryProvider;
  impressions: number | null;
  clicks: number | null;
  searchConsoleAveragePosition: number | null;
  bingAverageClickPosition: number | null;
  bingAverageImpressionPosition: number | null;
  latestSourceDate: string;
};

export type KeywordDiscoveryEvidenceProjection = {
  normalizedQuery: string;
  representativeText: string;
  trackedKeywordId: string | null;
  firstObservedAt: string;
  lastObservedAt: string;
  providers: KeywordDiscoveryProviderEvidence[];
};

export type KeywordDiscoveryReadModel = {
  candidateId: string | null;
  normalizedQuery: string;
  representativeText: string;
  trackedKeywordId: string | null;
  status: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'TRACKED';
  firstObservedAt: string;
  lastObservedAt: string;
  providers: KeywordDiscoveryProviderEvidence[];
};

export type KeywordDiscoveryRefreshResult = {
  created: number;
  updated: number;
  preserved: number;
};

export type AcceptKeywordDiscoveryInput = {
  actorUserId: string;
  projectId: string;
  candidateId: string;
  type: KeywordType;
  intent?: KeywordIntent | null;
  priority?: KeywordPriority;
  language?: string | null;
  targetCountry?: string | null;
};

export type RejectKeywordDiscoveryInput = {
  actorUserId: string;
  projectId: string;
  candidateId: string;
};

export type KeywordDiscoveryDecisionResult = Keyword;
export type KeywordDiscoveryCandidateResult = KeywordDiscoveryCandidate;
