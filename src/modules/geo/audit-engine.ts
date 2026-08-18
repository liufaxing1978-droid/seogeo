import type { GeoRuleOutcome } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { calculateCitabilityForAudit } from './citability.js';
import { extractEntitiesForAudit } from './entity-extractor.js';
import { evaluateAiCrawlersForAudit } from './ai-crawler-evaluator.js';
import { analyzeAndPersistBrandReadiness } from './brand-readiness.js';
import { loadCitabilityPageFacts } from './geo-input.repository.js';
import { BUILTIN_GEO_RULES } from './rule-catalog.js';
import { syncBuiltinGeoRules } from './rule-sync.js';
import {
  getGeoAuditContext,
  replaceGeoRuleResults,
  updateGeoAuditStatus,
  type GeoRuleResultWrite
} from './geo.repository.js';
import { calculateAndPersistGeoReadinessScore } from './score-engine.js';

const ENGINE_VERSION = 'geo-readiness-1';

function safeError(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/[\r\n\t]+/g, ' ').slice(0, 1000)
    : 'Unknown GEO audit failure';
}

function successfulHtml(fact: { statusCode: number | null; contentType: string | null }): boolean {
  const contentType = fact.contentType?.toLowerCase() ?? '';
  return (
    fact.statusCode !== null &&
    fact.statusCode >= 200 &&
    fact.statusCode < 300 &&
    (contentType === 'text/html' || contentType === 'application/xhtml+xml')
  );
}

function normalizeValue(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US');
}

function hostOf(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function brandAvailability(evidence: unknown, key: string): boolean {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return false;
  const availability = (evidence as Record<string, unknown>).availability;
  if (!availability || typeof availability !== 'object' || Array.isArray(availability)) return false;
  return (availability as Record<string, unknown>)[key] === true;
}

async function evaluateRules(
  geoAuditRunId: string,
  identities: Map<string, { ruleVersionId: string }>
): Promise<GeoRuleResultWrite[]> {
  const audit = await getGeoAuditContext(geoAuditRunId);
  const pageFacts = await loadCitabilityPageFacts(geoAuditRunId);
  const pageIds = pageFacts.map((page) => page.pageId);
  const citability = await prisma.citabilityResult.findMany({
    where: { geoAuditRunId },
    select: { pageId: true, headingStructureScore: true }
  });
  const citabilityByPage = new Map(citability.map((row) => [row.pageId, row]));

  const entities = await prisma.entity.findMany({
    where: { projectId: audit.projectId, status: 'ACTIVE' },
    include: {
      observations: { where: { geoAuditRunId } }
    }
  });
  const currentEntities = entities.filter((entity) => entity.observations.length > 0);
  const currentEntityIds = currentEntities.map((entity) => entity.id);
  const organizations = currentEntities.filter((entity) => entity.entityType === 'ORGANIZATION');

  const pageEntities = pageIds.length
    ? await prisma.pageEntity.findMany({
        where: { pageId: { in: pageIds }, entityId: currentEntityIds.length ? { in: currentEntityIds } : undefined },
        select: { pageId: true, entityId: true, role: true }
      })
    : [];
  const relationCount = currentEntityIds.length
    ? await prisma.entityRelation.count({
        where: { sourceEntityId: { in: currentEntityIds }, targetEntityId: { in: currentEntityIds } }
      })
    : 0;

  const brand = await prisma.brandAuthorityResult.findUnique({
    where: { geoAuditRunId }
  });
  const aiCrawlerRows = await prisma.aiCrawlerResult.findMany({ where: { geoAuditRunId } });

  const projectPages = await prisma.page.findMany({
    where: { projectId: audit.projectId, isActive: true },
    select: { path: true }
  });
  const aboutPagePresent = projectPages.some((page) => {
    const path = page.path.toLowerCase().replace(/\/+$/, '') || '/';
    return path === '/about' || path === '/about-us' || path === '/about.html' || path.startsWith('/about/');
  });

  const snapshotIds = await prisma.pageSnapshot.findMany({
    where: { crawlRunId: audit.crawlRunId },
    select: { id: true }
  });
  const structured = snapshotIds.length
    ? await prisma.pageStructuredSignal.findMany({
        where: { pageSnapshotId: { in: snapshotIds.map((row) => row.id) } },
        select: { openGraphSiteName: true }
      })
    : [];
  const siteNames = structured
    .map((row) => row.openGraphSiteName)
    .filter((value): value is string => Boolean(value?.trim()))
    .map(normalizeValue);

  const results: GeoRuleResultWrite[] = [];
  const add = (
    ruleCode: string,
    resultKey: string,
    outcome: GeoRuleOutcome,
    evidence: Record<string, unknown>,
    refs: { pageId?: string; entityId?: string } = {}
  ) => {
    const identity = identities.get(ruleCode);
    if (!identity) return;
    results.push({
      ruleVersionId: identity.ruleVersionId,
      resultKey,
      outcome,
      evidence,
      pageId: refs.pageId,
      entityId: refs.entityId
    });
  };

  for (const page of pageFacts) {
    const html = successfulHtml(page);
    const cit = citabilityByPage.get(page.pageId);
    const eligibility = html && page.indexable !== false;
    const pageKey = (ruleCode: string) => `${ruleCode}:page:${page.pageId}`;

    add('CITABILITY_NO_CLEAR_H1', pageKey('CITABILITY_NO_CLEAR_H1'), eligibility ? (page.h1Count === 1 ? 'PASS' : 'FAIL') : 'UNKNOWN', { h1Count: page.h1Count, eligible: eligibility }, { pageId: page.pageId });
    add('CITABILITY_HEADING_STRUCTURE_WEAK', pageKey('CITABILITY_HEADING_STRUCTURE_WEAK'), eligibility ? ((cit?.headingStructureScore ?? 0) >= 60 ? 'PASS' : 'FAIL') : 'UNKNOWN', { headingStructureScore: cit?.headingStructureScore ?? null, eligible: eligibility }, { pageId: page.pageId });
    add('CITABILITY_NO_SUMMARY_BLOCK', pageKey('CITABILITY_NO_SUMMARY_BLOCK'), 'UNKNOWN', { reason: 'summary block is not a persisted deterministic P1 fact' }, { pageId: page.pageId });
    add('CITABILITY_LONG_UNBROKEN_SECTION', pageKey('CITABILITY_LONG_UNBROKEN_SECTION'), eligibility ? (page.wordCount >= 1200 && page.h2Count + page.h3Count < 2 ? 'FAIL' : 'PASS') : 'UNKNOWN', { wordCount: page.wordCount, sectionHeadings: page.h2Count + page.h3Count }, { pageId: page.pageId });
    add('CITABILITY_LOW_FACT_SIGNAL', pageKey('CITABILITY_LOW_FACT_SIGNAL'), 'UNKNOWN', { reason: 'factual density is not persisted deterministically in P1' }, { pageId: page.pageId });
    add('CITABILITY_NO_SOURCE_LINKS', pageKey('CITABILITY_NO_SOURCE_LINKS'), eligibility ? (page.externalLinksCount > 0 ? 'PASS' : 'FAIL') : 'UNKNOWN', { externalLinksCount: page.externalLinksCount }, { pageId: page.pageId });
    add('CITABILITY_NO_DEFINITION_PATTERN', pageKey('CITABILITY_NO_DEFINITION_PATTERN'), 'UNKNOWN', { reason: 'definition semantics are not persisted deterministically in P1' }, { pageId: page.pageId });
    add('CITABILITY_TABLE_LIST_ABSENT_WHEN_STRUCTURED_CONTENT_EXISTS', pageKey('CITABILITY_TABLE_LIST_ABSENT_WHEN_STRUCTURED_CONTENT_EXISTS'), 'UNKNOWN', { reason: 'list/table applicability is not persisted as a deterministic fact' }, { pageId: page.pageId });
    add('CITABILITY_PAGE_TOO_THIN', pageKey('CITABILITY_PAGE_TOO_THIN'), eligibility ? (page.wordCount < 200 ? 'FAIL' : 'PASS') : 'UNKNOWN', { wordCount: page.wordCount, minimumWords: 200 }, { pageId: page.pageId });
    add('CITABILITY_CANONICAL_IDENTITY_WEAK', pageKey('CITABILITY_CANONICAL_IDENTITY_WEAK'), html ? (page.indexable === null ? 'UNKNOWN' : page.canonicalUrl && page.indexable ? 'PASS' : 'FAIL') : 'UNKNOWN', { canonicalUrl: page.canonicalUrl, indexable: page.indexable }, { pageId: page.pageId });

    add('CONTENT_GEO_HEADING_STRUCTURE_WEAK', pageKey('CONTENT_GEO_HEADING_STRUCTURE_WEAK'), html ? (page.h1Count === 1 && (page.wordCount < 400 || page.h2Count >= 1) ? 'PASS' : 'FAIL') : 'UNKNOWN', { h1Count: page.h1Count, h2Count: page.h2Count, wordCount: page.wordCount }, { pageId: page.pageId });
    add('CONTENT_GEO_SUMMARY_ABSENT', pageKey('CONTENT_GEO_SUMMARY_ABSENT'), 'UNKNOWN', { reason: 'summary signal is not persisted deterministically in P1' }, { pageId: page.pageId });
    add('CONTENT_GEO_STRUCTURED_ELEMENTS_ABSENT', pageKey('CONTENT_GEO_STRUCTURED_ELEMENTS_ABSENT'), 'UNKNOWN', { reason: 'list/table structure is not persisted deterministically in P1' }, { pageId: page.pageId });
    add('CONTENT_GEO_SOURCE_LINKS_MISSING', pageKey('CONTENT_GEO_SOURCE_LINKS_MISSING'), html ? (page.externalLinksCount > 0 ? 'PASS' : 'FAIL') : 'UNKNOWN', { externalLinksCount: page.externalLinksCount }, { pageId: page.pageId });
    const authorship = pageEntities.some((row) => row.pageId === page.pageId && (row.role === 'AUTHOR' || row.role === 'PUBLISHER'));
    add('CONTENT_GEO_AUTHOR_PUBLISHER_MISSING', pageKey('CONTENT_GEO_AUTHOR_PUBLISHER_MISSING'), authorship ? 'PASS' : 'UNKNOWN', { authoredOrPublisherIdentityObserved: authorship, applicabilityKnown: false }, { pageId: page.pageId });
    add('CONTENT_GEO_STRUCTURED_DATA_MISSING', pageKey('CONTENT_GEO_STRUCTURED_DATA_MISSING'), html ? (page.schemaCount > 0 ? 'PASS' : 'FAIL') : 'UNKNOWN', { schemaCount: page.schemaCount }, { pageId: page.pageId });
    add('CONTENT_GEO_CANONICAL_MISSING', pageKey('CONTENT_GEO_CANONICAL_MISSING'), html && page.indexable !== false ? (page.canonicalUrl ? 'PASS' : 'FAIL') : 'UNKNOWN', { canonicalUrl: page.canonicalUrl, indexable: page.indexable }, { pageId: page.pageId });
    add('CONTENT_GEO_NOT_INDEXABLE', pageKey('CONTENT_GEO_NOT_INDEXABLE'), html ? (page.indexable === null ? 'UNKNOWN' : page.indexable ? 'PASS' : 'FAIL') : 'UNKNOWN', { indexable: page.indexable }, { pageId: page.pageId });
  }

  add('ENTITY_ORGANIZATION_MISSING', 'ENTITY_ORGANIZATION_MISSING:project', organizations.length > 0 ? 'PASS' : 'FAIL', { organizationCount: organizations.length });

  const orgNamesByHost = new Map<string, Set<string>>();
  for (const org of organizations) {
    const host = hostOf(org.officialUrl);
    if (!host) continue;
    const names = orgNamesByHost.get(host) ?? new Set<string>();
    names.add(org.normalizedName);
    orgNamesByHost.set(host, names);
  }
  const inconsistentOrgName = [...orgNamesByHost.values()].some((names) => names.size > 1);
  add('ENTITY_CANONICAL_NAME_INCONSISTENT', 'ENTITY_CANONICAL_NAME_INCONSISTENT:project', organizations.length === 0 ? 'UNKNOWN' : inconsistentOrgName ? 'FAIL' : 'PASS', { organizationCount: organizations.length, inconsistentOwnedHostIdentity: inconsistentOrgName });

  for (const entity of currentEntities) {
    const key = (ruleCode: string) => `${ruleCode}:entity:${entity.id}`;
    const sameAs = entity.observations.filter((row) => row.property === 'sameAs').length;
    const schemaId = entity.observations.some((row) => row.property === '@id');
    add('ENTITY_OFFICIAL_URL_MISSING', key('ENTITY_OFFICIAL_URL_MISSING'), entity.officialUrl ? 'PASS' : 'FAIL', { officialUrl: entity.officialUrl }, { entityId: entity.id });
    add('ENTITY_SAMEAS_MISSING', key('ENTITY_SAMEAS_MISSING'), sameAs > 0 ? 'PASS' : 'FAIL', { sameAsCount: sameAs }, { entityId: entity.id });
    add('ENTITY_SCHEMA_ID_MISSING', key('ENTITY_SCHEMA_ID_MISSING'), schemaId ? 'PASS' : 'FAIL', { schemaIdObserved: schemaId }, { entityId: entity.id });
  }
  if (currentEntities.length === 0) {
    for (const ruleCode of ['ENTITY_OFFICIAL_URL_MISSING', 'ENTITY_SAMEAS_MISSING', 'ENTITY_SCHEMA_ID_MISSING']) {
      add(ruleCode, `${ruleCode}:project`, 'UNKNOWN', { reason: 'no deterministic entities observed' });
    }
  }

  const publisherObserved = pageEntities.some((row) => row.role === 'PUBLISHER');
  add('ENTITY_PUBLISHER_MISSING', 'ENTITY_PUBLISHER_MISSING:project', publisherObserved ? 'PASS' : 'FAIL', { publisherObserved });
  add('ENTITY_AUTHOR_UNCLEAR', 'ENTITY_AUTHOR_UNCLEAR:project', 'UNKNOWN', { reason: 'authored-content applicability is not persisted deterministically' });

  const duplicateEntityIdentity = currentEntities.some((entity, index) => {
    const host = hostOf(entity.officialUrl);
    if (!host) return false;
    return currentEntities.some((other, otherIndex) => otherIndex !== index && other.entityType === entity.entityType && hostOf(other.officialUrl) === host && other.normalizedName !== entity.normalizedName);
  });
  add('ENTITY_DUPLICATE_IDENTITY', 'ENTITY_DUPLICATE_IDENTITY:project', duplicateEntityIdentity ? 'FAIL' : 'PASS', { duplicateOwnedIdentityObserved: duplicateEntityIdentity });
  add('ENTITY_RELATIONSHIP_SPARSE', 'ENTITY_RELATIONSHIP_SPARSE:project', currentEntities.length <= 1 ? 'UNKNOWN' : relationCount > 0 ? 'PASS' : 'FAIL', { entityCount: currentEntities.length, relationCount });
  add('ENTITY_ABOUT_PAGE_MISSING', 'ENTITY_ABOUT_PAGE_MISSING:project', aboutPagePresent ? 'PASS' : 'FAIL', { aboutPagePresent });

  const uniqueSiteNames = new Set(siteNames);
  add('BRAND_SITE_NAME_INCONSISTENT', 'BRAND_SITE_NAME_INCONSISTENT:project', uniqueSiteNames.size === 0 ? 'UNKNOWN' : uniqueSiteNames.size === 1 ? 'PASS' : 'FAIL', { observedSiteNames: [...uniqueSiteNames] });
  add('BRAND_ORGANIZATION_SCHEMA_MISSING', 'BRAND_ORGANIZATION_SCHEMA_MISSING:project', brand ? (brand.organizationSchemaPresent ? 'PASS' : 'FAIL') : 'UNKNOWN', { organizationSchemaPresent: brand?.organizationSchemaPresent ?? null });
  add('BRAND_CONTACT_IDENTITY_MISSING', 'BRAND_CONTACT_IDENTITY_MISSING:project', 'UNKNOWN', { reason: 'explicit contact identity facts are not persisted in P3 yet' });
  add('BRAND_SOCIAL_IDENTITY_UNLINKED', 'BRAND_SOCIAL_IDENTITY_UNLINKED:project', brand ? (brand.sameAsCount > 0 ? 'PASS' : 'FAIL') : 'UNKNOWN', { sameAsCount: brand?.sameAsCount ?? null });
  add('BRAND_ABOUT_PAGE_MISSING', 'BRAND_ABOUT_PAGE_MISSING:project', brand ? (brand.aboutPagePresent ? 'PASS' : 'FAIL') : 'UNKNOWN', { aboutPagePresent: brand?.aboutPagePresent ?? null });
  const publisherAvailable = brand ? brandAvailability(brand.evidence, 'publisherConsistency') : false;
  add('BRAND_PUBLISHER_IDENTITY_INCONSISTENT', 'BRAND_PUBLISHER_IDENTITY_INCONSISTENT:project', !brand || !publisherAvailable ? 'UNKNOWN' : brand.publisherConsistency >= 100 ? 'PASS' : 'FAIL', { publisherConsistency: brand?.publisherConsistency ?? null, available: publisherAvailable });

  for (const crawler of aiCrawlerRows) {
    const key = (ruleCode: string) => `${ruleCode}:crawler:${crawler.crawlerCode}`;
    add('AI_CRAWLER_ROBOTS_BLOCKED', key('AI_CRAWLER_ROBOTS_BLOCKED'), crawler.robotsAllowed === null ? 'UNKNOWN' : crawler.robotsAllowed ? 'PASS' : 'FAIL', { crawlerCode: crawler.crawlerCode, robotsAllowed: crawler.robotsAllowed });
    const pageDirectiveKnown = crawler.metaRobotsAllowed !== null || crawler.xRobotsAllowed !== null;
    const pageDirectiveBlocked = crawler.metaRobotsAllowed === false || crawler.xRobotsAllowed === false;
    add('AI_CRAWLER_META_BLOCKED', key('AI_CRAWLER_META_BLOCKED'), !pageDirectiveKnown ? 'UNKNOWN' : pageDirectiveBlocked ? 'FAIL' : 'PASS', { crawlerCode: crawler.crawlerCode, metaRobotsAllowed: crawler.metaRobotsAllowed, xRobotsAllowed: crawler.xRobotsAllowed });
    add('AI_CRAWLER_POLICY_UNKNOWN', key('AI_CRAWLER_POLICY_UNKNOWN'), crawler.status === 'UNKNOWN' ? 'FAIL' : 'PASS', { crawlerCode: crawler.crawlerCode, readinessStatus: crawler.status });
    add('AI_CRAWLER_UNREACHABLE', key('AI_CRAWLER_UNREACHABLE'), crawler.reachable === null ? 'UNKNOWN' : crawler.reachable ? 'PASS' : 'FAIL', { crawlerCode: crawler.crawlerCode, reachable: crawler.reachable });
  }
  if (aiCrawlerRows.length === 0) {
    for (const ruleCode of ['AI_CRAWLER_ROBOTS_BLOCKED', 'AI_CRAWLER_META_BLOCKED', 'AI_CRAWLER_POLICY_UNKNOWN', 'AI_CRAWLER_UNREACHABLE']) {
      add(ruleCode, `${ruleCode}:project`, 'UNKNOWN', { reason: 'AI crawler policy has not been evaluated' });
    }
  }

  return results;
}

export async function runGeoAudit(geoAuditRunId: string): Promise<{
  status: 'COMPLETED';
  geoScore: Awaited<ReturnType<typeof calculateAndPersistGeoReadinessScore>>;
}> {
  const audit = await getGeoAuditContext(geoAuditRunId);
  if (audit.crawlRun.status !== 'COMPLETED') {
    throw new Error('GEO audit requires a completed crawl run');
  }

  await updateGeoAuditStatus(geoAuditRunId, 'RUNNING', {
    startedAt: new Date(),
    finishedAt: null,
    errorMessage: null
  });

  try {
    const identities = await syncBuiltinGeoRules();
    const citability = await calculateCitabilityForAudit(geoAuditRunId, ENGINE_VERSION);
    await updateGeoAuditStatus(geoAuditRunId, 'RUNNING', {
      eligiblePages: citability.eligiblePages
    });

    await extractEntitiesForAudit(geoAuditRunId);
    await evaluateAiCrawlersForAudit(geoAuditRunId);
    await analyzeAndPersistBrandReadiness(geoAuditRunId);

    const ruleResults = await evaluateRules(geoAuditRunId, identities);
    await replaceGeoRuleResults(geoAuditRunId, ruleResults);
    await updateGeoAuditStatus(geoAuditRunId, 'RUNNING', {
      eligiblePages: citability.eligiblePages,
      rulesEvaluated: ruleResults.length
    });

    const geoScore = await calculateAndPersistGeoReadinessScore(geoAuditRunId, ENGINE_VERSION);
    await updateGeoAuditStatus(geoAuditRunId, 'COMPLETED', {
      eligiblePages: citability.eligiblePages,
      rulesEvaluated: ruleResults.length,
      finishedAt: new Date(),
      errorMessage: null
    });

    return { status: 'COMPLETED', geoScore };
  } catch (error) {
    await updateGeoAuditStatus(geoAuditRunId, 'FAILED', {
      finishedAt: new Date(),
      errorMessage: safeError(error)
    });
    throw error;
  }
}

export { BUILTIN_GEO_RULES };
