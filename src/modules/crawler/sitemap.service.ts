import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { isInProjectScope, normalizeCrawlUrl } from './url-normalizer.js';

export interface SitemapPageEntry {
  url: string;
  lastmod: string | null;
  changefreq: string | null;
  priority: number | null;
}

export interface ParsedSitemap {
  type: 'URLSET' | 'INDEX' | null;
  urls: SitemapPageEntry[];
  sitemapUrls: string[];
  parseError: string | null;
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim() || null;
  if (value && typeof value === 'object' && '#text' in value) {
    const text = (value as { '#text'?: unknown })['#text'];
    return typeof text === 'string' || typeof text === 'number' ? String(text).trim() || null : null;
  }
  return null;
}

function normalizedScopedUrl(value: unknown, primaryDomain: string): string | null {
  const text = textValue(value);
  if (!text) return null;

  try {
    const normalized = normalizeCrawlUrl(text);
    return isInProjectScope(new URL(normalized), primaryDomain) ? normalized : null;
  } catch {
    return null;
  }
}

function empty(parseError: string): ParsedSitemap {
  return { type: null, urls: [], sitemapUrls: [], parseError };
}

export function parseSitemap(xml: string, sourceUrl: string): ParsedSitemap {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    const message = typeof validation === 'object' && validation.err?.msg ? validation.err.msg : 'invalid XML';
    return empty(`sitemap XML malformed: ${message}`);
  }

  const primaryDomain = new URL(sourceUrl).hostname;
  const parser = new XMLParser({
    removeNSPrefix: true,
    ignoreAttributes: false,
    trimValues: true,
    parseTagValue: false
  });

  let document: Record<string, unknown>;
  try {
    document = parser.parse(xml) as Record<string, unknown>;
  } catch (error) {
    return empty(`sitemap XML malformed: ${error instanceof Error ? error.message : 'parse failure'}`);
  }

  if (document.urlset && typeof document.urlset === 'object') {
    const root = document.urlset as { url?: unknown };
    const seen = new Set<string>();
    const urls: SitemapPageEntry[] = [];

    for (const rawEntry of asArray(root.url)) {
      if (!rawEntry || typeof rawEntry !== 'object') continue;
      const entry = rawEntry as Record<string, unknown>;
      const url = normalizedScopedUrl(entry.loc, primaryDomain);
      if (!url || seen.has(url)) continue;
      seen.add(url);

      const priorityRaw = textValue(entry.priority);
      const priority = priorityRaw === null ? null : Number(priorityRaw);
      urls.push({
        url,
        lastmod: textValue(entry.lastmod),
        changefreq: textValue(entry.changefreq),
        priority: priority !== null && Number.isFinite(priority) ? priority : null
      });
    }

    return { type: 'URLSET', urls, sitemapUrls: [], parseError: null };
  }

  if (document.sitemapindex && typeof document.sitemapindex === 'object') {
    const root = document.sitemapindex as { sitemap?: unknown };
    const seen = new Set<string>();
    const sitemapUrls: string[] = [];

    for (const rawEntry of asArray(root.sitemap)) {
      if (!rawEntry || typeof rawEntry !== 'object') continue;
      const entry = rawEntry as Record<string, unknown>;
      const url = normalizedScopedUrl(entry.loc, primaryDomain);
      if (!url || seen.has(url)) continue;
      seen.add(url);
      sitemapUrls.push(url);
    }

    return { type: 'INDEX', urls: [], sitemapUrls, parseError: null };
  }

  return empty('sitemap root must be urlset or sitemapindex');
}

export function limitSitemapDocuments(urls: string[], maxDocuments = 50): string[] {
  return urls.slice(0, Math.max(0, maxDocuments));
}
