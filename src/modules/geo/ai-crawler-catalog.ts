export type AiCrawlerProvider = 'OPENAI' | 'GOOGLE' | 'ANTHROPIC' | 'PERPLEXITY';

export type AiCrawlerPurpose =
  | 'SEARCH_DISCOVERY'
  | 'MODEL_TRAINING'
  | 'AI_TRAINING_AND_GROUNDING_CONTROL';

export type MetaDirectiveSemantics = 'NONE' | 'OPENAI_SEARCH_NOINDEX';

export interface AiCrawlerCatalogEntry {
  crawlerCode: string;
  provider: AiCrawlerProvider;
  productName: string;
  robotsToken: string;
  httpUserAgent: string | null;
  purpose: AiCrawlerPurpose;
  metaDirectiveSemantics: MetaDirectiveSemantics;
  catalogVersion: string;
  verifiedOn: string;
  officialSource: string;
}

const CATALOG_VERSION = '2026-08-18';

export const AI_CRAWLER_CATALOG = [
  {
    crawlerCode: 'OAI_SEARCHBOT',
    provider: 'OPENAI',
    productName: 'OAI-SearchBot',
    robotsToken: 'OAI-SearchBot',
    httpUserAgent: 'OAI-SearchBot',
    purpose: 'SEARCH_DISCOVERY',
    metaDirectiveSemantics: 'OPENAI_SEARCH_NOINDEX',
    catalogVersion: CATALOG_VERSION,
    verifiedOn: '2026-08-18',
    officialSource: 'https://help.openai.com/en/articles/12627856-publishers-and-developers-faq'
  },
  {
    crawlerCode: 'GPTBOT',
    provider: 'OPENAI',
    productName: 'GPTBot',
    robotsToken: 'GPTBot',
    httpUserAgent: 'GPTBot',
    purpose: 'MODEL_TRAINING',
    metaDirectiveSemantics: 'NONE',
    catalogVersion: CATALOG_VERSION,
    verifiedOn: '2026-08-18',
    officialSource: 'https://help.openai.com/en/articles/7842364-how-chatgpt-and-our-foundation-models-are-developed'
  },
  {
    crawlerCode: 'GOOGLE_EXTENDED',
    provider: 'GOOGLE',
    productName: 'Google-Extended',
    robotsToken: 'Google-Extended',
    httpUserAgent: null,
    purpose: 'AI_TRAINING_AND_GROUNDING_CONTROL',
    metaDirectiveSemantics: 'NONE',
    catalogVersion: CATALOG_VERSION,
    verifiedOn: '2026-08-18',
    officialSource: 'https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers'
  },
  {
    crawlerCode: 'CLAUDEBOT',
    provider: 'ANTHROPIC',
    productName: 'ClaudeBot',
    robotsToken: 'ClaudeBot',
    httpUserAgent: 'ClaudeBot',
    purpose: 'MODEL_TRAINING',
    metaDirectiveSemantics: 'NONE',
    catalogVersion: CATALOG_VERSION,
    verifiedOn: '2026-08-18',
    officialSource: 'https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler'
  },
  {
    crawlerCode: 'CLAUDE_SEARCHBOT',
    provider: 'ANTHROPIC',
    productName: 'Claude-SearchBot',
    robotsToken: 'Claude-SearchBot',
    httpUserAgent: 'Claude-SearchBot',
    purpose: 'SEARCH_DISCOVERY',
    metaDirectiveSemantics: 'NONE',
    catalogVersion: CATALOG_VERSION,
    verifiedOn: '2026-08-18',
    officialSource: 'https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler'
  },
  {
    crawlerCode: 'PERPLEXITYBOT',
    provider: 'PERPLEXITY',
    productName: 'PerplexityBot',
    robotsToken: 'PerplexityBot',
    httpUserAgent: 'PerplexityBot',
    purpose: 'SEARCH_DISCOVERY',
    metaDirectiveSemantics: 'NONE',
    catalogVersion: CATALOG_VERSION,
    verifiedOn: '2026-08-18',
    officialSource: 'https://docs.perplexity.ai/docs/resources/perplexity-crawlers'
  }
] as const satisfies readonly AiCrawlerCatalogEntry[];
