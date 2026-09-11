import { createHash, createHmac, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { renderMainSiteArticleHtml } from './main-site-article-html.js';

export const MAIN_SITE_SECTIONS = [
  '最新消息', '六壬文化', '民宗文献', '会员专区', '购物专区', '联系我们',
] as const;
export type MainSiteSection = typeof MAIN_SITE_SECTIONS[number];
export type XingshantangCmsConfig = { baseUrl: string; clientId: string; secret: string };
export type CreateMainSiteDraftInput = {
  title: string; slug: string; section: MainSiteSection; summary: string; body: string;
};
type FetchLike = typeof fetch;
type ClientRuntime = { now?: () => number; nonce?: () => string };

const successSchema = z.object({ article: z.object({ id: z.string().min(1), status: z.literal('draft') }) });
const errorSchema = z.object({ error: z.object({ code: z.string().min(1) }).passthrough() });

export class XingshantangCmsError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'XingshantangCmsError';
  }
}

function baseUrl(value: string): URL {
  let parsed: URL;
  try { parsed = new URL(value); } catch {
    throw new XingshantangCmsError('Main-site CMS URL is invalid', 'XINGSHANTANG_CMS_CONFIG_INVALID', null, false);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new XingshantangCmsError('Main-site CMS URL must be an HTTPS origin', 'XINGSHANTANG_CMS_CONFIG_INVALID', null, false);
  }
  return parsed;
}

function sign(secret: string, method: string, path: string, timestamp: string, nonce: string, body: string): string {
  const bodyHash = createHash('sha256').update(body).digest('hex');
  return createHmac('sha256', secret)
    .update([method.toUpperCase(), path, timestamp, nonce, bodyHash].join('\n'))
    .digest('hex');
}

async function errorCode(response: Response): Promise<string | null> {
  try {
    const parsed = errorSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.error.code : null;
  } catch { return null; }
}

export class XingshantangCmsClient {
  private readonly origin: URL;
  private readonly now: () => number;
  private readonly nonce: () => string;

  constructor(
    private readonly config: XingshantangCmsConfig,
    private readonly fetchImpl: FetchLike = fetch,
    runtime: ClientRuntime = {},
  ) {
    this.origin = baseUrl(config.baseUrl);
    this.now = runtime.now ?? Date.now;
    this.nonce = runtime.nonce ?? randomUUID;
  }

  async createDraft(input: CreateMainSiteDraftInput): Promise<{ articleId: string; status: 'draft' }> {
    const path = '/api/v1/articles';
    const body = JSON.stringify({
      title: input.title, slug: input.slug, section: input.section, summary: input.summary,
      body: renderMainSiteArticleHtml(input.body),
      status: 'draft', isPinned: false, isRecommended: false, membersOnly: false,
    });
    const timestamp = String(this.now());
    const nonce = this.nonce();
    const headers = new Headers({
      accept: 'application/json', 'content-type': 'application/json', 'x-client-id': this.config.clientId,
      'x-timestamp': timestamp, 'x-nonce': nonce,
      'x-signature': sign(this.config.secret, 'POST', path, timestamp, nonce, body),
    });
    let response: Response;
    try {
      response = await this.fetchImpl(new URL(path, this.origin), {
        method: 'POST', headers, body, signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new XingshantangCmsError('Main-site CMS request failed', 'XINGSHANTANG_CMS_NETWORK_ERROR', null, true);
    }
    if (response.status === 409 && await errorCode(response) === 'slug_conflict') {
      throw new XingshantangCmsError('A main-site article already uses this slug', 'XINGSHANTANG_CMS_SLUG_CONFLICT', 409, false);
    }
    if (response.status !== 201) {
      throw new XingshantangCmsError(
        'Main-site CMS rejected the draft', 'XINGSHANTANG_CMS_REQUEST_FAILED', response.status,
        response.status >= 500 || response.status === 429,
      );
    }
    let payload: unknown;
    try { payload = await response.json(); } catch {
      throw new XingshantangCmsError('Main-site CMS returned an invalid response', 'XINGSHANTANG_CMS_INVALID_RESPONSE', response.status, false);
    }
    const parsed = successSchema.safeParse(payload);
    if (!parsed.success) {
      throw new XingshantangCmsError('Main-site CMS returned an invalid response', 'XINGSHANTANG_CMS_INVALID_RESPONSE', response.status, false);
    }
    return { articleId: parsed.data.article.id, status: parsed.data.article.status };
  }
}
