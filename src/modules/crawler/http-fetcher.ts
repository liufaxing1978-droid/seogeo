import { env } from '../../config/env.js';
import { assertPublicHttpTarget } from './network-policy.js';
import type { FetchOptions, FetchResult, RedirectHop } from './crawl.types.js';

const DEFAULT_MAX_REDIRECTS = 10;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function headersToRecord(headers: Headers): Record<string, string> {
  return Object.fromEntries([...headers.entries()].map(([name, value]) => [name.toLowerCase(), value]));
}

function contentTypeOf(headers: Record<string, string>): string | null {
  return headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() || null;
}

function isTextualContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  return (
    contentType.startsWith('text/') ||
    contentType === 'application/xhtml+xml' ||
    contentType === 'application/xml' ||
    contentType === 'application/json' ||
    contentType.endsWith('+xml') ||
    contentType.endsWith('+json')
  );
}

function timeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === 'TimeoutError' || error.name === 'AbortError';
}

function emptyResult(
  requestUrl: string,
  finalUrl: string,
  redirectChain: RedirectHop[],
  responseTimeMs: number,
  errorCode: string,
  statusCode = 0,
  headers: Record<string, string> = {},
  bytes = 0
): FetchResult {
  return {
    requestUrl,
    finalUrl,
    statusCode,
    headers,
    body: null,
    contentType: contentTypeOf(headers),
    bytes,
    responseTimeMs,
    redirectChain,
    errorCode
  };
}

async function readBoundedBody(
  response: Response,
  maxResponseBytes: number
): Promise<{ bytes: number; body: Uint8Array | null; tooLarge: boolean }> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
    await response.body?.cancel();
    return { bytes: declaredLength, body: null, tooLarge: true };
  }

  if (!response.body) return { bytes: 0, body: new Uint8Array(), tooLarge: false };

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      bytes += value.byteLength;
      if (bytes > maxResponseBytes) {
        await reader.cancel();
        return { bytes, body: null, tooLarge: true };
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { bytes, body, tooLarge: false };
}

export async function fetchPage(url: string, options: FetchOptions = {}): Promise<FetchResult> {
  const requestUrl = url;
  const requestTimeoutMs = options.requestTimeoutMs ?? env.CRAWLER_REQUEST_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxResponseBytes = options.maxResponseBytes ?? env.CRAWLER_MAX_RESPONSE_BYTES;
  const userAgent = options.userAgent ?? env.CRAWLER_USER_AGENT;
  const publicTargetGuard = options.publicTargetGuard ?? assertPublicHttpTarget;
  const redirectChain: RedirectHop[] = [];
  const startedAt = performance.now();
  let currentUrl = new URL(url);

  while (true) {
    try {
      await publicTargetGuard(currentUrl);
    } catch {
      return emptyResult(
        requestUrl,
        currentUrl.toString(),
        redirectChain,
        Math.round(performance.now() - startedAt),
        'TARGET_BLOCKED'
      );
    }

    let response: Response;
    try {
      response = await fetch(currentUrl, {
        redirect: 'manual',
        signal: AbortSignal.timeout(requestTimeoutMs),
        headers: {
          'user-agent': userAgent,
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5'
        }
      });
    } catch (error) {
      return emptyResult(
        requestUrl,
        currentUrl.toString(),
        redirectChain,
        Math.round(performance.now() - startedAt),
        timeoutError(error) ? 'TIMEOUT' : 'FETCH_ERROR'
      );
    }

    const headers = headersToRecord(response.headers);

    if (REDIRECT_STATUSES.has(response.status)) {
      if (redirectChain.length >= maxRedirects) {
        await response.body?.cancel();
        return emptyResult(
          requestUrl,
          currentUrl.toString(),
          redirectChain,
          Math.round(performance.now() - startedAt),
          'MAX_REDIRECTS',
          response.status,
          headers
        );
      }

      const location = response.headers.get('location');
      if (!location) {
        await response.body?.cancel();
        return emptyResult(
          requestUrl,
          currentUrl.toString(),
          redirectChain,
          Math.round(performance.now() - startedAt),
          'REDIRECT_LOCATION_MISSING',
          response.status,
          headers
        );
      }

      const nextUrl = new URL(location, currentUrl);
      redirectChain.push({ from: currentUrl.toString(), to: nextUrl.toString(), statusCode: response.status });
      await response.body?.cancel();
      currentUrl = nextUrl;
      continue;
    }

    let bodyResult: Awaited<ReturnType<typeof readBoundedBody>>;
    try {
      bodyResult = await readBoundedBody(response, maxResponseBytes);
    } catch (error) {
      return emptyResult(
        requestUrl,
        currentUrl.toString(),
        redirectChain,
        Math.round(performance.now() - startedAt),
        timeoutError(error) ? 'TIMEOUT' : 'FETCH_ERROR',
        response.status,
        headers
      );
    }

    const elapsed = Math.round(performance.now() - startedAt);
    const contentType = contentTypeOf(headers);

    if (bodyResult.tooLarge) {
      return emptyResult(
        requestUrl,
        currentUrl.toString(),
        redirectChain,
        elapsed,
        'RESPONSE_TOO_LARGE',
        response.status,
        headers,
        bodyResult.bytes
      );
    }

    const body = bodyResult.body && isTextualContentType(contentType)
      ? new TextDecoder().decode(bodyResult.body)
      : null;

    return {
      requestUrl,
      finalUrl: currentUrl.toString(),
      statusCode: response.status,
      headers,
      body,
      contentType,
      bytes: bodyResult.bytes,
      responseTimeMs: elapsed,
      redirectChain,
      errorCode: null
    };
  }
}
