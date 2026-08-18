import type { ContentFacts, ContentPageSource } from './content.types.js';

function clean(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function sumKnown(values: Array<number | null>): number | null {
  if (values.some((value) => value === null)) return null;
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function isExplicitlyIneligible(source: ContentPageSource): boolean {
  if (source.statusCode !== null && (source.statusCode < 200 || source.statusCode >= 300)) return true;
  if (source.contentType !== null && !/^(text\/html|application\/xhtml\+xml)\b/i.test(source.contentType.trim())) return true;
  return false;
}

export function buildContentFacts(source: ContentPageSource): ContentFacts {
  const unavailable = isExplicitlyIneligible(source);
  return {
    projectId: source.projectId,
    pageId: source.pageId,
    latestPageSnapshotId: source.snapshotId,
    canonicalUrl: clean(source.canonicalUrl) ?? source.normalizedUrl,
    title: unavailable ? null : clean(source.title),
    metaDescription: unavailable ? null : clean(source.metaDescription),
    h1: unavailable ? null : clean(source.h1),
    language: unavailable ? null : clean(source.language),
    wordCount: unavailable ? null : source.wordCount,
    paragraphCount: null,
    headingCount: unavailable ? null : sumKnown([source.h1Count, source.h2Count, source.h3Count]),
    listCount: null,
    tableCount: null,
    imageCount: unavailable ? null : source.imagesCount,
    internalLinkCount: unavailable ? null : source.internalLinksCount,
    externalLinkCount: unavailable ? null : source.externalLinksCount,
    schemaTypes: unavailable ? [] : [...new Set(source.schemaTypes)].sort(),
    contentHash: source.contentHash ?? `missing:${source.snapshotId}`,
    extractedAt: source.capturedAt
  };
}
