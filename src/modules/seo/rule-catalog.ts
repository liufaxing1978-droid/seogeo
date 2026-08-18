import type { SeoRuleDefinition } from './seo.types.js';

export const BUILTIN_PAGE_RULES = [
  {
    ruleCode: 'HTTP_5XX', name: 'Server error response', category: 'HTTP',
    description: 'The page returned a 5xx server error.', version: 1, severity: 'CRITICAL', weight: 4,
    detectionType: 'PAGE_FACT', seoImpact: 'Server errors can prevent search engines and users from accessing the page.',
    fixGuide: 'Resolve the server-side error and verify the URL returns the intended response.'
  },
  {
    ruleCode: 'HTTP_4XX', name: 'Client error response', category: 'HTTP',
    description: 'The page returned a 4xx response.', version: 1, severity: 'HIGH', weight: 3,
    detectionType: 'PAGE_FACT', seoImpact: 'Broken or unavailable URLs waste crawl paths and may remove content from search results.',
    fixGuide: 'Restore the intended page, correct internal links, or redirect obsolete URLs to a relevant replacement.'
  },
  {
    ruleCode: 'HTTP_REDIRECT', name: 'Redirected URL', category: 'HTTP',
    description: 'The requested URL followed one or more HTTP redirects.', version: 1, severity: 'MEDIUM', weight: 1,
    detectionType: 'PAGE_FACT', seoImpact: 'Unnecessary redirect chains add latency and can weaken crawl efficiency.',
    fixGuide: 'Update internal references to the final canonical destination and remove unnecessary redirect hops.'
  },
  {
    ruleCode: 'TITLE_MISSING', name: 'Missing title', category: 'Metadata',
    description: 'An eligible HTML page has no title.', version: 1, severity: 'HIGH', weight: 3,
    detectionType: 'PAGE_FACT', seoImpact: 'A missing title weakens relevance signals and search result presentation.',
    fixGuide: 'Add a unique, descriptive title that reflects the page content and search intent.'
  },
  {
    ruleCode: 'TITLE_TOO_SHORT', name: 'Title too short', category: 'Metadata',
    description: 'The title contains fewer than 20 characters.', version: 1, severity: 'LOW', weight: 1,
    detectionType: 'PAGE_FACT', detectionConfig: { minLength: 20 },
    seoImpact: 'Very short titles may not communicate enough page context.',
    fixGuide: 'Expand the title when needed so it clearly describes the page without keyword stuffing.'
  },
  {
    ruleCode: 'TITLE_TOO_LONG', name: 'Title too long', category: 'Metadata',
    description: 'The title is longer than 60 characters.', version: 1, severity: 'MEDIUM', weight: 1.5,
    detectionType: 'PAGE_FACT', detectionConfig: { maxLength: 60 },
    seoImpact: 'Long titles may be truncated and can dilute the primary topic.',
    fixGuide: 'Rewrite the title to prioritize the primary topic within a concise length.'
  },
  {
    ruleCode: 'META_DESCRIPTION_MISSING', name: 'Missing meta description', category: 'Metadata',
    description: 'An eligible HTML page has no meta description.', version: 1, severity: 'MEDIUM', weight: 2,
    detectionType: 'PAGE_FACT', seoImpact: 'Missing descriptions reduce control over search-result messaging.',
    fixGuide: 'Add a concise, unique description that accurately summarizes the page.'
  },
  {
    ruleCode: 'META_DESCRIPTION_TOO_LONG', name: 'Meta description too long', category: 'Metadata',
    description: 'The meta description is longer than 160 characters.', version: 1, severity: 'LOW', weight: 1,
    detectionType: 'PAGE_FACT', detectionConfig: { maxLength: 160 },
    seoImpact: 'Overlong descriptions may be truncated in search interfaces.',
    fixGuide: 'Shorten the description while preserving its useful summary and intent.'
  },
  {
    ruleCode: 'H1_MISSING', name: 'Missing H1', category: 'Headings',
    description: 'An eligible HTML page has no H1 heading.', version: 1, severity: 'MEDIUM', weight: 2,
    detectionType: 'PAGE_FACT', seoImpact: 'A missing primary heading can reduce structural clarity for users and crawlers.',
    fixGuide: 'Add one clear primary heading that represents the page topic.'
  },
  {
    ruleCode: 'H1_MULTIPLE', name: 'Multiple H1 headings', category: 'Headings',
    description: 'An eligible HTML page has more than one H1.', version: 1, severity: 'LOW', weight: 1,
    detectionType: 'PAGE_FACT', seoImpact: 'Multiple primary headings can make document hierarchy less clear.',
    fixGuide: 'Use a clear heading hierarchy and keep one primary H1 when the template permits.'
  },
  {
    ruleCode: 'CANONICAL_MISSING', name: 'Missing canonical', category: 'Indexability',
    description: 'An indexable HTML page has no canonical URL.', version: 1, severity: 'MEDIUM', weight: 1.5,
    detectionType: 'PAGE_FACT', seoImpact: 'Missing canonical signals can make duplicate URL consolidation less explicit.',
    fixGuide: 'Add a valid canonical URL that points to the preferred indexable version of the page.'
  },
  {
    ruleCode: 'THIN_CONTENT', name: 'Thin content', category: 'Content',
    description: 'An indexable HTML page contains fewer than 200 words.', version: 1, severity: 'MEDIUM', weight: 1.5,
    detectionType: 'PAGE_FACT', detectionConfig: { minWords: 200 },
    seoImpact: 'Very limited page content may not adequately satisfy the intended topic or query.',
    fixGuide: 'Improve useful, original coverage where the page purpose requires more substantive content.'
  },
  {
    ruleCode: 'IMAGE_ALT_MISSING', name: 'Images missing alt text', category: 'Images',
    description: 'One or more images lack alt text.', version: 1, severity: 'LOW', weight: 1,
    detectionType: 'PAGE_FACT', seoImpact: 'Missing alt text reduces accessibility and image-context signals.',
    fixGuide: 'Add meaningful alt text to informative images; use empty alt text for purely decorative images.'
  },
  {
    ruleCode: 'SLOW_RESPONSE', name: 'Slow server response', category: 'Performance',
    description: 'The factual HTTP response time exceeds 3000 ms.', version: 1, severity: 'MEDIUM', weight: 1.5,
    detectionType: 'PAGE_FACT', detectionConfig: { thresholdMs: 3000 },
    seoImpact: 'Slow responses reduce crawl efficiency and user experience.',
    fixGuide: 'Investigate server, application, cache, database and network latency before changing page content.'
  },
  {
    ruleCode: 'HTML_TOO_LARGE', name: 'HTML document too large', category: 'Performance',
    description: 'The fetched HTML document exceeds 2,000,000 bytes.', version: 1, severity: 'MEDIUM', weight: 1.5,
    detectionType: 'PAGE_FACT', detectionConfig: { maxBytes: 2000000 },
    seoImpact: 'Very large HTML increases transfer and parsing cost for crawlers and users.',
    fixGuide: 'Reduce unnecessary markup, inline payloads and duplicated template output while preserving content.'
  }
] as const satisfies readonly SeoRuleDefinition[];
