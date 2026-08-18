import { chromium } from 'playwright';
import { env } from '../../config/env.js';
import type { FetchResult } from './crawl.types.js';
import type { ParsedPageSignals } from './html-parser.js';
import { assertPublicHttpTarget } from './network-policy.js';
import { isInProjectScope } from './url-normalizer.js';

const DEFAULT_RENDER_TIMEOUT_MS = 20_000;
const DEFAULT_USER_AGENT = 'SEOGEO-Bot/0.1 (+https://seo.xingshantang.org)';

export interface BrowserFallbackContext {
  enabled?: boolean;
  robotsAllowed?: boolean | null;
}

export interface BrowserRenderOptions {
  enabled?: boolean;
  primaryDomain: string;
  timeoutMs?: number;
  userAgent?: string;
  publicTargetGuard?: (url: URL) => Promise<void>;
}

export interface RenderedPageResult {
  succeeded: boolean;
  html: string | null;
  finalUrl: string;
  statusCode: number | null;
  renderTimeMs: number;
  browserVersion: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

function isHtmlResponse(fetchResult: FetchResult): boolean {
  const contentType = fetchResult.contentType?.toLowerCase() ?? '';
  return contentType === 'text/html' || contentType === 'application/xhtml+xml';
}

function scriptCount(html: string): number {
  return html.match(/<script\b/gi)?.length ?? 0;
}

export function shouldRenderFallback(
  fetchResult: FetchResult,
  parsedSignals: ParsedPageSignals,
  context: BrowserFallbackContext = {}
): boolean {
  const enabled = context.enabled ?? env.CRAWLER_BROWSER_ENABLED;
  const robotsAllowed = context.robotsAllowed ?? true;

  if (!enabled || robotsAllowed !== true) return false;
  if (fetchResult.errorCode !== null) return false;
  if (fetchResult.statusCode < 200 || fetchResult.statusCode > 299) return false;
  if (!isHtmlResponse(fetchResult) || fetchResult.body === null) return false;

  const body = fetchResult.body;
  const scripts = scriptCount(body);

  if (body.length < 500) return true;
  if (parsedSignals.wordCount < 20 && scripts > 0) return true;
  if (!parsedSignals.title && !parsedSignals.h1 && scripts >= 3) return true;

  return false;
}

function failureResult(
  url: string,
  startedAt: number,
  errorCode: string,
  errorMessage: string | null,
  browserVersion: string | null = null
): RenderedPageResult {
  return {
    succeeded: false,
    html: null,
    finalUrl: url,
    statusCode: null,
    renderTimeMs: Math.round(performance.now() - startedAt),
    browserVersion,
    errorCode,
    errorMessage
  };
}

export async function renderPage(url: string, options: BrowserRenderOptions): Promise<RenderedPageResult> {
  const startedAt = performance.now();
  const enabled = options.enabled ?? env.CRAWLER_BROWSER_ENABLED;
  const timeoutMs = options.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS;
  const publicTargetGuard = options.publicTargetGuard ?? assertPublicHttpTarget;

  if (!enabled) {
    return failureResult(url, startedAt, 'BROWSER_DISABLED', null);
  }

  let initialUrl: URL;
  try {
    initialUrl = new URL(url);
    if (!isInProjectScope(initialUrl, options.primaryDomain)) {
      return failureResult(url, startedAt, 'TARGET_OUT_OF_SCOPE', 'Browser target is outside project scope');
    }
    await publicTargetGuard(initialUrl);
  } catch (error) {
    return failureResult(
      url,
      startedAt,
      'TARGET_BLOCKED',
      error instanceof Error ? error.message : 'Browser target was blocked'
    );
  }

  let browser;
  let browserVersion: string | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    browserVersion = browser.version();
    const context = await browser.newContext({
      javaScriptEnabled: true,
      serviceWorkers: 'block',
      userAgent: options.userAgent ?? DEFAULT_USER_AGENT
    });
    const page = await context.newPage();

    await page.route('**/*', async (route) => {
      const request = route.request();
      const resourceType = request.resourceType();

      if (resourceType === 'image' || resourceType === 'font' || resourceType === 'media') {
        await route.abort('blockedbyclient');
        return;
      }

      let requestUrl: URL;
      try {
        requestUrl = new URL(request.url());
      } catch {
        await route.abort('blockedbyclient');
        return;
      }

      if (requestUrl.protocol === 'data:' || requestUrl.protocol === 'blob:') {
        await route.continue();
        return;
      }

      if (requestUrl.protocol !== 'http:' && requestUrl.protocol !== 'https:') {
        await route.abort('blockedbyclient');
        return;
      }

      if (resourceType === 'document' && !isInProjectScope(requestUrl, options.primaryDomain)) {
        await route.abort('blockedbyclient');
        return;
      }

      try {
        await publicTargetGuard(requestUrl);
        await route.continue();
      } catch {
        await route.abort('blockedbyclient');
      }
    });

    const response = await page.goto(initialUrl.toString(), {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs
    });

    try {
      await page.waitForLoadState('networkidle', { timeout: Math.min(5_000, timeoutMs) });
    } catch {
      // DOMContentLoaded is sufficient for the fallback; network-idle is best-effort only.
    }

    const finalUrl = new URL(page.url());
    if (!isInProjectScope(finalUrl, options.primaryDomain)) {
      await context.close();
      return failureResult(
        finalUrl.toString(),
        startedAt,
        'TARGET_OUT_OF_SCOPE',
        'Browser navigation left project scope',
        browserVersion
      );
    }
    await publicTargetGuard(finalUrl);

    const renderedHtml = await page.content();
    const result: RenderedPageResult = {
      succeeded: true,
      html: renderedHtml,
      finalUrl: finalUrl.toString(),
      statusCode: response?.status() ?? null,
      renderTimeMs: Math.round(performance.now() - startedAt),
      browserVersion,
      errorCode: null,
      errorMessage: null
    };

    await context.close();
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Browser render failed';
    const timeout = error instanceof Error && error.name === 'TimeoutError';
    return failureResult(
      url,
      startedAt,
      timeout ? 'BROWSER_TIMEOUT' : 'BROWSER_ERROR',
      message,
      browserVersion
    );
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
