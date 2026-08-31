import { z } from 'zod';

const DEFAULT_BASE_URL = 'https://api.dataforseo.com';
const DEFAULT_TIMEOUT_MS = 30_000;

const MARKET_LOCATION_NAMES: Readonly<Record<string, string>> = Object.freeze({
  CN: 'China',
  HK: 'Hong Kong',
  MY: 'Malaysia',
  SG: 'Singapore',
  TW: 'Taiwan',
});

const ResponseSchema = z.object({
  status_code: z.literal(20000),
  tasks: z.array(z.object({
    id: z.string().min(1),
    status_code: z.literal(20000),
    result: z.array(z.object({
      items: z.array(z.unknown()),
    }).passthrough()).min(1),
  }).passthrough()).min(1),
}).passthrough();

const OrganicItemSchema = z.object({
  type: z.literal('organic'),
  rank_group: z.number().int().positive(),
  url: z.string().url(),
}).passthrough();

type FetchLike = typeof fetch;

type DataForSeoCurrentSerpCredentials = {
  username: string;
  password: string;
};

type DataForSeoCurrentSerpObserveInput = {
  keyword: string;
  searchEngine: 'GOOGLE' | 'BING';
  marketCode: string;
  locale: string;
  device: 'DESKTOP' | 'MOBILE';
  searchDepth: number;
  credentials: DataForSeoCurrentSerpCredentials;
};

export type DataForSeoCurrentSerpObservation = {
  observationRef: string;
  observedAt: Date;
  results: Array<{
    position: number;
    url: string;
  }>;
};

export async function resolveDataForSeoCurrentSerpCredentials(input: {
  DATAFORSEO_LOGIN?: string;
  DATAFORSEO_PASSWORD?: string;
}): Promise<Record<string, string> | null> {
  const username = input.DATAFORSEO_LOGIN?.trim();
  const password = input.DATAFORSEO_PASSWORD?.trim();
  if (!username || !password) return null;
  return { username, password };
}

function invalidInput(): never {
  throw new Error('DATAFORSEO_CURRENT_SERP_INPUT_INVALID');
}

function parseObserveInput(input: Record<string, unknown>): DataForSeoCurrentSerpObserveInput {
  const keyword = typeof input.keyword === 'string' ? input.keyword.trim() : '';
  const searchEngine = input.searchEngine;
  const marketCode = typeof input.marketCode === 'string' ? input.marketCode.trim() : '';
  const locale = typeof input.locale === 'string' ? input.locale.trim() : '';
  const device = input.device;
  const searchDepth = input.searchDepth;
  const credentials = input.credentials;

  if (
    !keyword
    || (searchEngine !== 'GOOGLE' && searchEngine !== 'BING')
    || !marketCode
    || !locale
    || (device !== 'DESKTOP' && device !== 'MOBILE')
    || !Number.isInteger(searchDepth)
    || Number(searchDepth) < 1
    || Number(searchDepth) > 700
    || typeof credentials !== 'object'
    || credentials === null
  ) {
    return invalidInput();
  }

  const username = 'username' in credentials && typeof credentials.username === 'string'
    ? credentials.username.trim()
    : '';
  const password = 'password' in credentials && typeof credentials.password === 'string'
    ? credentials.password.trim()
    : '';
  if (!username || !password) {
    throw new Error('DATAFORSEO_CURRENT_SERP_AUTH_INVALID');
  }

  return {
    keyword,
    searchEngine,
    marketCode,
    locale,
    device,
    searchDepth: Number(searchDepth),
    credentials: { username, password },
  };
}

function resolveLocationName(marketCode: string): string {
  const locationName = MARKET_LOCATION_NAMES[marketCode];
  if (!locationName) {
    throw new Error('DATAFORSEO_CURRENT_SERP_MARKET_UNSUPPORTED');
  }
  return locationName;
}

function resolveLanguageCode(locale: string): string {
  const normalized = locale.toLocaleLowerCase('und');
  if (['zh-hant', 'zh-tw', 'zh-hk'].includes(normalized)) return 'zh-TW';
  if (['zh-hans', 'zh-cn', 'zh-sg'].includes(normalized)) return 'zh-CN';
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
  throw new Error('DATAFORSEO_CURRENT_SERP_LOCALE_UNSUPPORTED');
}

function normalizeBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('DATAFORSEO_CURRENT_SERP_CONFIG_INVALID');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('DATAFORSEO_CURRENT_SERP_CONFIG_INVALID');
  }
  return parsed.toString().replace(/\/+$/u, '');
}

async function parseJson(response: Response): Promise<unknown> {
  if (!response.ok) {
    throw new Error('DATAFORSEO_CURRENT_SERP_REQUEST_FAILED');
  }
  try {
    return await response.json();
  } catch {
    throw new Error('DATAFORSEO_CURRENT_SERP_INVALID_RESPONSE');
  }
}

export function createDataForSeoCurrentSerpProvider(options: {
  fetchImpl?: FetchLike;
  now?: () => Date;
  baseUrl?: string;
  timeoutMs?: number;
} = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
    throw new Error('DATAFORSEO_CURRENT_SERP_CONFIG_INVALID');
  }

  return {
    async observe(input: Record<string, unknown>): Promise<DataForSeoCurrentSerpObservation> {
      const parsedInput = parseObserveInput(input);
      const locationName = resolveLocationName(parsedInput.marketCode);
      const languageCode = resolveLanguageCode(parsedInput.locale);
      const engine = parsedInput.searchEngine.toLocaleLowerCase('und');
      const endpoint = `${baseUrl}/v3/serp/${engine}/organic/live/advanced`;
      const authorization = Buffer.from(
        `${parsedInput.credentials.username}:${parsedInput.credentials.password}`,
        'utf8',
      ).toString('base64');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            authorization: `Basic ${authorization}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify([{
            keyword: parsedInput.keyword,
            location_name: locationName,
            language_code: languageCode,
            device: parsedInput.device.toLocaleLowerCase('und'),
            depth: parsedInput.searchDepth,
          }]),
          signal: controller.signal,
        });
      } catch {
        throw new Error('DATAFORSEO_CURRENT_SERP_NETWORK_ERROR');
      } finally {
        clearTimeout(timeout);
      }

      const payload = await parseJson(response);
      const parsed = ResponseSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error('DATAFORSEO_CURRENT_SERP_INVALID_RESPONSE');
      }

      const task = parsed.data.tasks[0]!;
      const items = task.result[0]!.items;
      const results: DataForSeoCurrentSerpObservation['results'] = [];
      for (const item of items) {
        if (!item || typeof item !== 'object' || !('type' in item) || item.type !== 'organic') {
          continue;
        }
        const organic = OrganicItemSchema.safeParse(item);
        if (!organic.success) {
          throw new Error('DATAFORSEO_CURRENT_SERP_INVALID_RESPONSE');
        }
        results.push({
          position: organic.data.rank_group,
          url: organic.data.url,
        });
      }

      const observedAt = now();
      if (!(observedAt instanceof Date) || Number.isNaN(observedAt.getTime())) {
        throw new Error('DATAFORSEO_CURRENT_SERP_CLOCK_INVALID');
      }

      return {
        observationRef: task.id,
        observedAt,
        results,
      };
    },
  };
}
