import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { isInProjectScope, normalizeCrawlUrl } from './url-normalizer.js';

export type StructuredEntityRole =
  | 'ROOT'
  | 'AUTHOR'
  | 'PUBLISHER'
  | 'ABOUT'
  | 'BRAND'
  | 'MAIN_ENTITY'
  | 'PROVIDER'
  | 'OFFERS'
  | 'ITEM_OFFERED';

export interface StructuredEntitySignal {
  schemaTypes: string[];
  id: string | null;
  name: string | null;
  alternateNames: string[];
  url: string | null;
  sameAs: string[];
  role: StructuredEntityRole;
  sourcePath: string;
  parentSourcePath: string | null;
}

export interface ParsedPageSignals {
  title: string | null;
  metaDescription: string | null;
  canonicalUrl: string | null;
  metaRobots: string | null;
  xRobotsTag: string | null;
  h1: string | null;
  h1Count: number;
  h2Count: number;
  h3Count: number;
  wordCount: number;
  visibleText: string;
  language: string | null;
  internalLinks: string[];
  externalLinks: string[];
  internalLinksCount: number;
  externalLinksCount: number;
  imagesCount: number;
  imagesWithoutAlt: number;
  schemaCount: number;
  openGraphSiteName?: string | null;
  entitySignals?: StructuredEntitySignal[];
  htmlHash: string;
  contentHash: string;
  indexable: boolean;
}

const MAX_ENTITY_SIGNALS = 200;
const MAX_STRING_LENGTH = 2048;
const MAX_NAME_LENGTH = 500;
const MAX_ARRAY_VALUES = 50;

const RELATION_ROLES: Readonly<Record<string, StructuredEntityRole>> = {
  author: 'AUTHOR',
  publisher: 'PUBLISHER',
  about: 'ABOUT',
  brand: 'BRAND',
  mainEntity: 'MAIN_ENTITY',
  provider: 'PROVIDER',
  offers: 'OFFERS',
  itemOffered: 'ITEM_OFFERED'
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function firstMetaContent($: cheerio.CheerioAPI, name: string): string | null {
  let found: string | null = null;
  $('meta[name]').each((_, element) => {
    if (found !== null) return;
    if (($(element).attr('name') ?? '').trim().toLowerCase() !== name.toLowerCase()) return;
    const content = normalizeWhitespace($(element).attr('content') ?? '');
    if (content) found = content;
  });
  return found;
}

function firstMetaProperty($: cheerio.CheerioAPI, property: string): string | null {
  let found: string | null = null;
  $('meta[property]').each((_, element) => {
    if (found !== null) return;
    if (($(element).attr('property') ?? '').trim().toLowerCase() !== property.toLowerCase()) return;
    const content = normalizeWhitespace($(element).attr('content') ?? '');
    if (content) found = content.slice(0, MAX_NAME_LENGTH);
  });
  return found;
}

function firstCanonical($: cheerio.CheerioAPI, pageUrl: string): string | null {
  let canonical: string | null = null;
  $('link[rel][href]').each((_, element) => {
    if (canonical !== null) return;
    const rel = ($(element).attr('rel') ?? '')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (!rel.includes('canonical')) return;
    const href = $(element).attr('href');
    if (!href) return;
    try {
      canonical = normalizeCrawlUrl(new URL(href, pageUrl).toString());
    } catch {
      canonical = null;
    }
  });
  return canonical;
}

function headerValue(headers: Record<string, string>, name: string): string | null {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return normalizeWhitespace(value) || null;
  }
  return null;
}

function containsNoindex(value: string | null): boolean {
  return value !== null && /\bnoindex\b/i.test(value);
}

function visibleText($: cheerio.CheerioAPI): string {
  const source = $('body').length ? $('body').first().clone() : $('html').first().clone();
  source
    .find(
      'script,style,noscript,template,svg,head,meta,link,title,[hidden],[aria-hidden="true"],input[type="hidden"]'
    )
    .remove();
  return normalizeWhitespace(source.text());
}

function countWords(value: string): number {
  return value.match(/\p{Script=Han}|[\p{L}\p{M}\p{N}]+/gu)?.length ?? 0;
}

function normalizedHtml($: cheerio.CheerioAPI): string {
  return $.html().replace(/>\s+</g, '><').trim();
}

function collectLinks($: cheerio.CheerioAPI, pageUrl: string) {
  const primaryDomain = new URL(pageUrl).hostname;
  const internalSeen = new Set<string>();
  const externalSeen = new Set<string>();
  const internalLinks: string[] = [];
  const externalLinks: string[] = [];
  let internalLinksCount = 0;
  let externalLinksCount = 0;

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    if (!href) return;

    let normalized: string;
    try {
      normalized = normalizeCrawlUrl(new URL(href, pageUrl).toString());
    } catch {
      return;
    }

    const url = new URL(normalized);
    if (isInProjectScope(url, primaryDomain)) {
      internalLinksCount += 1;
      if (!internalSeen.has(normalized)) {
        internalSeen.add(normalized);
        internalLinks.push(normalized);
      }
      return;
    }

    externalLinksCount += 1;
    if (!externalSeen.has(normalized)) {
      externalSeen.add(normalized);
      externalLinks.push(normalized);
    }
  });

  return { internalLinks, externalLinks, internalLinksCount, externalLinksCount };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength = MAX_STRING_LENGTH): string | null {
  if (typeof value !== 'string') return null;
  const normalized = normalizeWhitespace(value);
  return normalized ? normalized.slice(0, maxLength) : null;
}

function boundedStrings(value: unknown, maxLength = MAX_STRING_LENGTH): string[] {
  const raw = Array.isArray(value) ? value : [value];
  const result: string[] = [];
  const seen = new Set<string>();

  for (const item of raw.slice(0, MAX_ARRAY_VALUES)) {
    const normalized = boundedString(item, maxLength);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function schemaTypes(value: unknown): string[] {
  return boundedStrings(value, 100);
}

function pushEntitySignal(
  signals: StructuredEntitySignal[],
  value: Record<string, unknown>,
  role: StructuredEntityRole,
  sourcePath: string,
  parentSourcePath: string | null
) {
  if (signals.length >= MAX_ENTITY_SIGNALS) return;

  const id = boundedString(value['@id']);
  const name = boundedString(value.name, MAX_NAME_LENGTH);
  const url = boundedString(value.url);
  const types = schemaTypes(value['@type']);

  if (!id && !name && !url) return;

  signals.push({
    schemaTypes: types,
    id,
    name,
    alternateNames: boundedStrings(value.alternateName, MAX_NAME_LENGTH),
    url,
    sameAs: boundedStrings(value.sameAs),
    role,
    sourcePath,
    parentSourcePath
  });
}

function walkRelationValue(
  signals: StructuredEntitySignal[],
  value: unknown,
  role: StructuredEntityRole,
  sourcePath: string,
  parentSourcePath: string
) {
  const values = Array.isArray(value) ? value.slice(0, MAX_ARRAY_VALUES) : [value];

  values.forEach((item, index) => {
    if (!isRecord(item) || signals.length >= MAX_ENTITY_SIGNALS) return;
    const itemPath = Array.isArray(value) ? `${sourcePath}[${index}]` : sourcePath;
    pushEntitySignal(signals, item, role, itemPath, parentSourcePath);
    walkEntityRelations(signals, item, itemPath);
  });
}

function walkEntityRelations(
  signals: StructuredEntitySignal[],
  value: Record<string, unknown>,
  sourcePath: string
) {
  for (const [key, role] of Object.entries(RELATION_ROLES)) {
    if (!(key in value) || signals.length >= MAX_ENTITY_SIGNALS) continue;
    walkRelationValue(signals, value[key], role, `${sourcePath}.${key}`, sourcePath);
  }
}

function collectRootEntity(
  signals: StructuredEntitySignal[],
  value: unknown,
  sourcePath: string
) {
  if (signals.length >= MAX_ENTITY_SIGNALS) return;

  if (Array.isArray(value)) {
    value.slice(0, MAX_ARRAY_VALUES).forEach((item, index) => {
      collectRootEntity(signals, item, `${sourcePath}[${index}]`);
    });
    return;
  }

  if (!isRecord(value)) return;

  if (Array.isArray(value['@graph'])) {
    value['@graph'].slice(0, MAX_ARRAY_VALUES).forEach((item, index) => {
      collectRootEntity(signals, item, `${sourcePath}.@graph[${index}]`);
    });
  }

  pushEntitySignal(signals, value, 'ROOT', sourcePath, null);
  walkEntityRelations(signals, value, sourcePath);
}

function collectStructuredEntitySignals($: cheerio.CheerioAPI): StructuredEntitySignal[] {
  const signals: StructuredEntitySignal[] = [];

  $('script[type]').each((scriptIndex, element) => {
    if (signals.length >= MAX_ENTITY_SIGNALS) return false;
    if (($(element).attr('type') ?? '').trim().toLowerCase() !== 'application/ld+json') return;

    const raw = $(element).text().trim();
    if (!raw) return;

    try {
      collectRootEntity(signals, JSON.parse(raw) as unknown, `$[${scriptIndex}]`);
    } catch {
      // Malformed JSON-LD is not converted into a structured entity fact.
    }
  });

  return signals.slice(0, MAX_ENTITY_SIGNALS);
}

export function parseHtml(
  html: string,
  pageUrl: string,
  responseHeaders: Record<string, string>,
  statusCode = 200
): ParsedPageSignals {
  const $ = cheerio.load(html);
  const title = normalizeWhitespace($('title').first().text()) || null;
  const metaDescription = firstMetaContent($, 'description');
  const metaRobots = firstMetaContent($, 'robots');
  const xRobotsTag = headerValue(responseHeaders, 'x-robots-tag');
  const canonicalUrl = firstCanonical($, pageUrl);
  const h1Elements = $('h1');
  let h1: string | null = null;
  h1Elements.each((_, element) => {
    if (h1 !== null) return;
    const text = normalizeWhitespace($(element).text());
    if (text) h1 = text;
  });

  const text = visibleText($);
  const links = collectLinks($, pageUrl);
  const images = $('img');
  let imagesWithoutAlt = 0;
  images.each((_, element) => {
    const alt = $(element).attr('alt');
    if (alt === undefined || normalizeWhitespace(alt) === '') imagesWithoutAlt += 1;
  });

  const statusAllowsIndexing = statusCode >= 200 && statusCode <= 299;
  const indexable = statusAllowsIndexing && !containsNoindex(metaRobots) && !containsNoindex(xRobotsTag);
  const jsonLdScripts = $('script[type]').filter((_, element) => {
    return ($(element).attr('type') ?? '').trim().toLowerCase() === 'application/ld+json';
  });

  return {
    title,
    metaDescription,
    canonicalUrl,
    metaRobots,
    xRobotsTag,
    h1,
    h1Count: h1Elements.length,
    h2Count: $('h2').length,
    h3Count: $('h3').length,
    wordCount: countWords(text),
    visibleText: text,
    language: normalizeWhitespace($('html').attr('lang') ?? '') || null,
    ...links,
    imagesCount: images.length,
    imagesWithoutAlt,
    schemaCount: jsonLdScripts.length,
    openGraphSiteName: firstMetaProperty($, 'og:site_name'),
    entitySignals: collectStructuredEntitySignals($),
    htmlHash: sha256(normalizedHtml($)),
    contentHash: sha256(text),
    indexable
  };
}
