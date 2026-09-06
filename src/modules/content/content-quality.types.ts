import type { ContentFacts } from './content.types.js';

export type ContentQualityStatus = 'PASS' | 'FAIL' | 'UNKNOWN';
export type ContentQualityPriority = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH';
export type ContentQualityCategory = 'INTERNAL_LINK_SUPPORT' | 'CONTENT_DECAY' | 'CONTENT_QA';

export interface ContentQualitySourceReference {
  type: 'PAGE_SNAPSHOT' | 'CONTENT_OPPORTUNITY' | 'CONTENT_SIGNAL';
  id: string;
}

export interface ContentQualityEvidence {
  status: ContentQualityStatus;
  sourceReferences: ContentQualitySourceReference[];
  observedInternalLinkCount?: number;
  requiredInternalLinkCount?: number;
  previousSnapshotId?: string;
  currentSnapshotId?: string;
  previousWordCount?: number;
  currentWordCount?: number;
  minimumWordCountDrop?: number;
  minimumWordCountDropFraction?: number;
  p5OpportunityId?: string;
  p5OpportunityKey?: string;
  p5OpportunityVersion?: number;
  p5OpportunityStatus?: P5ContentOpportunityStatus;
  p5SignalId?: string;
  p5SignalRuleKey?: string;
  p5SignalRuleVersion?: number;
  p5SignalStatus?: ContentQualityStatus;
}

export interface ContentQualityEvaluation {
  findingKey: string;
  ruleVersion: 1;
  status: ContentQualityStatus;
  category: ContentQualityCategory;
  priority: ContentQualityPriority;
  summary: string;
  evidence: ContentQualityEvidence;
}

export type InternalLinkSupportFacts = Pick<ContentFacts, 'latestPageSnapshotId' | 'internalLinkCount'>;

export interface ComparableSnapshot {
  id: string;
  capturedAt: Date;
  statusCode: number | null;
  contentType: string | null;
  indexable: boolean | null;
  wordCount: number | null;
  title: string | null;
  h1: string | null;
}

export type P5ContentOpportunityStatus = 'OPEN' | 'IN_PROGRESS' | 'IGNORED' | 'VERIFIED_FIXED';

export interface P5ContentOpportunityReference {
  id: string;
  opportunityKey: string;
  opportunityVersion: number;
  status: P5ContentOpportunityStatus;
  priority: ContentQualityPriority;
}

export interface P5ContentSignalReference {
  id: string;
  ruleKey: string;
  ruleVersion: number;
  status: ContentQualityStatus;
}
