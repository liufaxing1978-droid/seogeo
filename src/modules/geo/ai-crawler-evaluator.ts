import { createRequire } from 'node:module';
import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { normalizeCrawlUrl } from '../crawler/url-normalizer.js';
import {
  AI_CRAWLER_CATALOG,
  type AiCrawlerCatalogEntry
} from './ai-crawler-catalog.js';

interface RobotsParserInstance {
  isAllowed(url: string, userAgent?: string): boolean | undefined;
}

type RobotsParserFactory = (url: string, contents: string) => RobotsParserInstance;

const require = createRequire(import.meta.url);
const robotsParser = require('robots-parser') as RobotsParserFactory;

export interface AiCrawlerPolicyFacts {
  evaluatedUrl: string;
  robotsStatusCode: number | null;
  robotsRawText: string | null;
  robotsParseError: string | null;
  pageReachable: boolean | null;
  metaRobots: string | null;
  xRobotsTag: string | null;
}

export interface AiCrawlerPolicyEvaluation {
  robotsAllowed: boolean | null;
  metaRobotsAllowed: boolean | null;
  xRobotsAllowed: boolean | null;
  reachable: boolean | null;
  status: 'PASS' | 'FAIL' | 'UNKNOWN';
  evidence: Record<string, unknown>;
}

function containsNoindex(value: string | null): boolean {
  return value !== null && /(?:^|[\s,;])noindex(?:$|[\s,;])/i.test(value);
}

function evaluateStoredRobots(
  crawler: AiCrawlerCatalogEntry,
  facts: AiCrawlerPolicyFacts
): boolean | null {
  if (facts.robotsParseError) return null;

  if (facts.robotsStatusCode === 404 || facts.robotsStatusCode === 410) return true;

  if (
    facts.robotsStatusCode === null ||
    facts.robotsStatusCode < 200 ||
    facts.robotsStatusCode >= 300 ||
    facts.robotsRawText === null
  ) {
    return null;
  }

  try {
    const url = new URL(facts.evaluatedUrl);
    const robotsUrl = `${url.protocol}//${url.host}/robots.txt`;
    const parser = robotsParser(robotsUrl, facts.robotsRawText);
    const result = parser.isAllowed(facts.evaluatedUrl, crawler.robotsToken);
    return result ?? true;
  } catch {
    return null;
  }
}

function evaluateMetaDirective(
  crawler: AiCrawlerCatalogEntry,
  facts: AiCrawlerPolicyFacts
): boolean | null {
  if (crawler.metaDirectiveSemantics !== 'OPENAI_SEARCH_NOINDEX') return null;
  if (facts.pageReachable === null) return null;
  return !containsNoindex(facts.metaRobots);
}

function overallStatus(input: {
  robotsAllowed: boolean | null;
  metaRobotsAllowed: boolean | null;
  xRobotsAllowed: boolean | null;
  reachable: boolean | null;
}): 'PASS' | 'FAIL' | 'UNKNOWN' {
  if (
    input.robotsAllowed === false ||
    input.metaRobotsAllowed === false ||
    input.xRobotsAllowed === false ||
    input.reachable === false
  ) {
    return 'FAIL';
  }

  if (input.robotsAllowed === null || input.reachable === null) return 'UNKNOWN';
  return 'PASS';
}

export function evaluateAiCrawlerPolicy(
  crawler: AiCrawlerCatalogEntry,
  facts: AiCrawlerPolicyFacts
): AiCrawlerPolicyEvaluation {
  const robotsAllowed = evaluateStoredRobots(crawler, facts);
  const metaRobotsAllowed = evaluateMetaDirective(crawler, facts);
  const xRobotsAllowed = null;
  const status = overallStatus({
    robotsAllowed,
    metaRobotsAllowed,
    xRobotsAllowed,
    reachable: facts.pageReachable
  });

  return {
    robotsAllowed,
    metaRobotsAllowed,
    xRobotsAllowed,
    reachable: facts.pageReachable,
    status,
    evidence: {
      evaluatedUrl: facts.evaluatedUrl,
      provider: crawler.provider,
      productName: crawler.productName,
      robotsToken: crawler.robotsToken,
      purpose: crawler.purpose,
      catalogVersion: crawler.catalogVersion,
      verifiedOn: crawler.verifiedOn,
      officialSource: crawler.officialSource,
      robotsStatusCode: facts.robotsStatusCode,
      robotsFactAvailable: facts.robotsStatusCode !== null,
      robotsParseError: facts.robotsParseError,
      metaDirectiveSemantics: crawler.metaDirectiveSemantics,
      xRobotsDirectiveSemantics: 'NOT_IMPLEMENTED_FOR_CATALOG_ENTRY',
      pageFactAvailable: facts.pageReachable !== null
    }
  };
}

function headerValue(headers: Prisma.JsonValue | null, name: string): string | null {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return null;
  const target = name.toLowerCase();

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== target || typeof value !== 'string') continue;
    const normalized = value.replace(/\s+/g, ' ').trim();
    return normalized || null;
  }

  return null;
}

function reachableFromStatus(statusCode: number | null): boolean | null {
  if (statusCode === null) return null;
  return statusCode >= 200 && statusCode < 400;
}

async function loadAuditFacts(geoAuditRunId: string): Promise<AiCrawlerPolicyFacts> {
  const audit = await prisma.geoAuditRun.findUnique({
    where: { id: geoAuditRunId },
    select: {
      crawlRunId: true,
      crawlRun: {
        select: {
          seedUrl: true,
          robotsResults: {
            orderBy: { fetchedAt: 'desc' },
            take: 1,
            select: {
              statusCode: true,
              rawText: true,
              parseError: true
            }
          }
        }
      }
    }
  });

  if (!audit) throw new Error(`GeoAuditRun not found: ${geoAuditRunId}`);

  const evaluatedUrl = normalizeCrawlUrl(audit.crawlRun.seedUrl);
  const rootSnapshot = await prisma.pageSnapshot.findFirst({
    where: {
      crawlRunId: audit.crawlRunId,
      page: { normalizedUrl: evaluatedUrl }
    },
    orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }],
    select: {
      statusCode: true,
      metaRobots: true,
      httpResult: { select: { headers: true, fetchError: true } }
    }
  });
  const robots = audit.crawlRun.robotsResults[0] ?? null;

  return {
    evaluatedUrl,
    robotsStatusCode: robots?.statusCode ?? null,
    robotsRawText: robots?.rawText ?? null,
    robotsParseError: robots?.parseError ?? null,
    pageReachable: rootSnapshot?.httpResult?.fetchError
      ? false
      : reachableFromStatus(rootSnapshot?.statusCode ?? null),
    metaRobots: rootSnapshot?.metaRobots ?? null,
    xRobotsTag: headerValue(rootSnapshot?.httpResult?.headers ?? null, 'x-robots-tag')
  };
}

export async function evaluateAiCrawlersForAudit(geoAuditRunId: string): Promise<{
  evaluatedCrawlers: number;
  passed: number;
  failed: number;
  unknown: number;
}> {
  const facts = await loadAuditFacts(geoAuditRunId);
  const evaluations = AI_CRAWLER_CATALOG.map((crawler) => ({
    crawler,
    result: evaluateAiCrawlerPolicy(crawler, facts)
  }));

  await prisma.$transaction(async (tx) => {
    await tx.aiCrawlerResult.deleteMany({ where: { geoAuditRunId } });

    for (const { crawler, result } of evaluations) {
      await tx.aiCrawlerResult.create({
        data: {
          geoAuditRunId,
          crawlerCode: crawler.crawlerCode,
          robotsAllowed: result.robotsAllowed,
          metaRobotsAllowed: result.metaRobotsAllowed,
          xRobotsAllowed: result.xRobotsAllowed,
          reachable: result.reachable,
          status: result.status,
          evidence: result.evidence as Prisma.InputJsonValue
        }
      });
    }
  });

  return {
    evaluatedCrawlers: evaluations.length,
    passed: evaluations.filter(({ result }) => result.status === 'PASS').length,
    failed: evaluations.filter(({ result }) => result.status === 'FAIL').length,
    unknown: evaluations.filter(({ result }) => result.status === 'UNKNOWN').length
  };
}
