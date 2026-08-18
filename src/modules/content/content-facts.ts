import type { ContentFacts, ContentPageSource } from './content.types.js';

function clean(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function sumKnown(values: Array<number | null>): number | null {
  if (values.some((value) => value === null)) return null;
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

export function buildContentFacts(source: ContentPageSource): ContentFacts {
  return {
    projectId: source.projectId,
    pageId: source.pageId,
    latestPageSnapshotId: source.snapshotId,
    canonicalUrl: clean(source.canonicalUrl) ?? source.normalizedUrl,
    title: clean(source.title),
    metaDescription: clean(source.metaDescription),
    h1: clean(source.h1),
    language: clean(source.language),
    wordCount: source.wordCount,
    paragraphCount: null,
    headingCount: sumKnown([source.h1Count, source.h2Count, source.h3Count]),
    listCount: null,
    tableCount: null,
    imageCount: source.imagesCount,
    internalLinkCount: source.internalLinksCount,
    externalLinkCount: source.externalLinksCount,
    schemaTypes: [...new Set(source.schemaTypes)].sort(),
    contentHash: source.contentHash ?? `missing:${source.snapshotId}`,
    extractedAt: source.capturedAt
  };
}
