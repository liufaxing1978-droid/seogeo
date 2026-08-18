export interface ContentPageSource {
  projectId: string;
  pageId: string;
  normalizedUrl: string;
  snapshotId: string;
  canonicalUrl: string | null;
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  language: string | null;
  wordCount: number | null;
  h1Count: number | null;
  h2Count: number | null;
  h3Count: number | null;
  imagesCount: number | null;
  internalLinksCount: number | null;
  externalLinksCount: number | null;
  schemaTypes: string[];
  contentHash: string | null;
  capturedAt: Date;
}

export interface ContentFacts {
  projectId: string;
  pageId: string;
  latestPageSnapshotId: string;
  canonicalUrl: string;
  title: string | null;
  metaDescription: string | null;
  h1: string | null;
  language: string | null;
  wordCount: number | null;
  paragraphCount: number | null;
  headingCount: number | null;
  listCount: number | null;
  tableCount: number | null;
  imageCount: number | null;
  internalLinkCount: number | null;
  externalLinkCount: number | null;
  schemaTypes: string[];
  contentHash: string;
  extractedAt: Date;
}

export interface ContentDocumentRecord extends ContentFacts {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}
