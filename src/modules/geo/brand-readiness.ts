import { prisma } from '../../db/prisma.js';

export interface BrandReadinessInput {
  officialIdentityPresent: boolean;
  organizationSchemaPresent: boolean;
  sameAsCount: number;
  publisherConsistency: number | null;
  contactIdentityConsistency: number | null;
  aboutPagePresent: boolean;
}

export interface BrandReadinessResult extends BrandReadinessInput {
  overallScore: number;
  availableWeight: number;
}

const WEIGHTS = {
  officialIdentity: 25,
  organizationSchema: 25,
  sameAs: 15,
  publisherConsistency: 15,
  contactIdentityConsistency: 10,
  aboutPage: 10
} as const;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeConsistency(value: number | null): number | null {
  if (value === null) return null;
  return Math.max(0, Math.min(100, value));
}

export function calculateBrandReadiness(input: BrandReadinessInput): BrandReadinessResult {
  const publisherConsistency = normalizeConsistency(input.publisherConsistency);
  const contactIdentityConsistency = normalizeConsistency(input.contactIdentityConsistency);
  const sameAsScore = Math.max(0, Math.min(100, input.sameAsCount * 25));

  let availableWeight =
    WEIGHTS.officialIdentity + WEIGHTS.organizationSchema + WEIGHTS.sameAs + WEIGHTS.aboutPage;
  let weighted =
    (input.officialIdentityPresent ? 100 : 0) * WEIGHTS.officialIdentity +
    (input.organizationSchemaPresent ? 100 : 0) * WEIGHTS.organizationSchema +
    sameAsScore * WEIGHTS.sameAs +
    (input.aboutPagePresent ? 100 : 0) * WEIGHTS.aboutPage;

  if (publisherConsistency !== null) {
    availableWeight += WEIGHTS.publisherConsistency;
    weighted += publisherConsistency * WEIGHTS.publisherConsistency;
  }

  if (contactIdentityConsistency !== null) {
    availableWeight += WEIGHTS.contactIdentityConsistency;
    weighted += contactIdentityConsistency * WEIGHTS.contactIdentityConsistency;
  }

  return {
    ...input,
    publisherConsistency,
    contactIdentityConsistency,
    overallScore: availableWeight === 0 ? 0 : round2(weighted / availableWeight),
    availableWeight
  };
}

function bareHost(value: string): string {
  return value.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
}

function officialUrlMatchesProject(url: string | null, primaryDomain: string): boolean {
  if (!url) return false;
  try {
    return bareHost(new URL(url).hostname) === bareHost(primaryDomain);
  } catch {
    return false;
  }
}

function looksLikeAboutPage(path: string): boolean {
  const normalized = path.toLowerCase().replace(/\/+$/, '') || '/';
  return (
    normalized === '/about' ||
    normalized === '/about-us' ||
    normalized === '/about.html' ||
    normalized === '/about-us.html' ||
    normalized.startsWith('/about/')
  );
}

function publisherConsistency(names: string[]): number | null {
  const normalized = names
    .map((name) => name.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US'))
    .filter(Boolean);
  if (normalized.length === 0) return null;
  const counts = new Map<string, number>();
  for (const name of normalized) counts.set(name, (counts.get(name) ?? 0) + 1);
  const max = Math.max(...counts.values());
  return round2((max / normalized.length) * 100);
}

export async function analyzeAndPersistBrandReadiness(
  geoAuditRunId: string
): Promise<BrandReadinessResult> {
  const audit = await prisma.geoAuditRun.findUnique({
    where: { id: geoAuditRunId },
    include: { project: true }
  });
  if (!audit) throw new Error(`GeoAuditRun not found: ${geoAuditRunId}`);

  const organizations = await prisma.entity.findMany({
    where: { projectId: audit.projectId, entityType: 'ORGANIZATION', status: 'ACTIVE' },
    select: { id: true, canonicalName: true, officialUrl: true }
  });
  const organizationIds = organizations.map((entity) => entity.id);

  const observations = organizationIds.length
    ? await prisma.entityObservation.findMany({
        where: { geoAuditRunId, entityId: { in: organizationIds } },
        select: { entityId: true, sourceType: true, property: true, value: true }
      })
    : [];

  const observedOrganizationIds = new Set(observations.map((observation) => observation.entityId));
  const officialIdentityPresent = organizations.some(
    (entity) =>
      observedOrganizationIds.has(entity.id) &&
      officialUrlMatchesProject(entity.officialUrl, audit.project.primaryDomain)
  );
  const organizationSchemaPresent = observations.some(
    (observation) =>
      observation.sourceType === 'SCHEMA' &&
      observation.property === '@type' &&
      /organization|corporation|localbusiness/i.test(observation.value)
  );
  const sameAsCount = new Set(
    observations.filter((observation) => observation.property === 'sameAs').map((observation) => observation.value)
  ).size;

  const publisherLinks = await prisma.pageEntity.findMany({
    where: {
      role: 'PUBLISHER',
      page: { projectId: audit.projectId },
      entityId: organizationIds.length ? { in: organizationIds } : undefined
    },
    include: { entity: { select: { canonicalName: true } } }
  });
  const publisherScore = publisherConsistency(publisherLinks.map((link) => link.entity.canonicalName));

  const pages = await prisma.page.findMany({
    where: { projectId: audit.projectId, isActive: true },
    select: { path: true }
  });
  const aboutPagePresent = pages.some((page) => looksLikeAboutPage(page.path));

  // P3 does not yet persist explicit structured contact identity fields. Keep this unavailable
  // in the returned metric instead of pretending that an absent signal is inconsistent.
  const contactIdentityConsistency: number | null = null;

  const result = calculateBrandReadiness({
    officialIdentityPresent,
    organizationSchemaPresent,
    sameAsCount,
    publisherConsistency: publisherScore,
    contactIdentityConsistency,
    aboutPagePresent
  });

  const evidence = {
    availability: {
      officialIdentityPresent: true,
      organizationSchemaPresent: true,
      sameAsCount: true,
      publisherConsistency: publisherScore !== null,
      contactIdentityConsistency: false,
      aboutPagePresent: true
    },
    organizationEntityIds: organizationIds,
    sameAsCount,
    publisherIdentities: publisherLinks.map((link) => link.entity.canonicalName),
    aboutPagePresent,
    scoreAvailableWeight: result.availableWeight,
    scope: 'OWNED_SITE_READINESS_ONLY'
  };

  await prisma.brandAuthorityResult.upsert({
    where: { geoAuditRunId },
    create: {
      geoAuditRunId,
      officialIdentityPresent: result.officialIdentityPresent,
      organizationSchemaPresent: result.organizationSchemaPresent,
      sameAsCount: result.sameAsCount,
      publisherConsistency: result.publisherConsistency ?? 0,
      contactIdentityConsistency: result.contactIdentityConsistency ?? 0,
      aboutPagePresent: result.aboutPagePresent,
      overallScore: result.overallScore,
      evidence
    },
    update: {
      officialIdentityPresent: result.officialIdentityPresent,
      organizationSchemaPresent: result.organizationSchemaPresent,
      sameAsCount: result.sameAsCount,
      publisherConsistency: result.publisherConsistency ?? 0,
      contactIdentityConsistency: result.contactIdentityConsistency ?? 0,
      aboutPagePresent: result.aboutPagePresent,
      overallScore: result.overallScore,
      evidence
    }
  });

  return result;
}
