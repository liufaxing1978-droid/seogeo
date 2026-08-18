import { createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import { isInProjectScope, normalizeCrawlUrl } from './url-normalizer.js';

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
  htmlHash: string;
  contentHash: string;
  indexable: boolean;
}

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
  const source = $('body').length ? $('body').first().clone() : $.root().clone();
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
    schemaCount: $('script[type]').filter((_, element) => {
      return ($(element).attr('type') ?? '').trim().toLowerCase() === 'application/ld+json';
    }).length,
    htmlHash: sha256(normalizedHtml($)),
    contentHash: sha256(text),
    indexable
  };
}
