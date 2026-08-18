import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { analyzeAndPersistBrandReadiness } from '../../src/modules/geo/brand-readiness.js';

beforeEach(async () => {
  await prisma.project.deleteMany();
});

describe('analyzeAndPersistBrandReadiness', () => {
  it('persists owned identity readiness without treating unavailable contact consistency as evidence', async () => {
    const project = await prisma.project.create({
      data: {
        name: 'Example Brand',
        slug: `brand-${Date.now()}`,
        primaryDomain: 'example.com'
      }
    });

    const crawl = await prisma.crawlRun.create({
      data: {
        projectId: project.id,
        runType: 'MANUAL',
        status: 'COMPLETED',
        seedUrl: 'https://example.com/',
        maxPages: 10,
        crawlerVersion: 'test'
      }
    });

    const rootPage = await prisma.page.create({
      data: {
        projectId: project.id,
        url: 'https://example.com/',
        normalizedUrl: 'https://example.com/',
        host: 'example.com',
        path: '/'
      }
    });

    await prisma.page.create({
      data: {
        projectId: project.id,
        url: 'https://example.com/about',
        normalizedUrl: 'https://example.com/about',
        host: 'example.com',
        path: '/about'
      }
    });

    const audit = await prisma.geoAuditRun.create({
      data: {
        projectId: project.id,
        crawlRunId: crawl.id,
        status: 'RUNNING',
        engineVersion: 'p3-test'
      }
    });

    const organization = await prisma.entity.create({
      data: {
        projectId: project.id,
        entityType: 'ORGANIZATION',
        canonicalName: 'Example Brand',
        normalizedName: 'example brand',
        officialUrl: 'https://example.com/',
        confidence: 1
      }
    });

    await prisma.entityObservation.createMany({
      data: [
        {
          geoAuditRunId: audit.id,
          entityId: organization.id,
          pageId: rootPage.id,
          sourceType: 'SCHEMA',
          property: '@type',
          value: 'Organization'
        },
        {
          geoAuditRunId: audit.id,
          entityId: organization.id,
          pageId: rootPage.id,
          sourceType: 'SCHEMA',
          property: 'sameAs',
          value: 'https://www.facebook.com/example'
        },
        {
          geoAuditRunId: audit.id,
          entityId: organization.id,
          pageId: rootPage.id,
          sourceType: 'SCHEMA',
          property: 'sameAs',
          value: 'https://www.instagram.com/example'
        }
      ]
    });

    await prisma.pageEntity.create({
      data: {
        pageId: rootPage.id,
        entityId: organization.id,
        role: 'PUBLISHER',
        confidence: 1,
        sourceType: 'SCHEMA'
      }
    });

    const result = await analyzeAndPersistBrandReadiness(audit.id);

    expect(result.officialIdentityPresent).toBe(true);
    expect(result.organizationSchemaPresent).toBe(true);
    expect(result.sameAsCount).toBe(2);
    expect(result.publisherConsistency).toBe(100);
    expect(result.contactIdentityConsistency).toBeNull();
    expect(result.aboutPagePresent).toBe(true);
    expect(result.overallScore).toBeGreaterThan(0);

    const persisted = await prisma.brandAuthorityResult.findUniqueOrThrow({
      where: { geoAuditRunId: audit.id }
    });
    expect(persisted.contactIdentityConsistency).toBe(0);
    expect(persisted.evidence).toMatchObject({
      availability: { contactIdentityConsistency: false }
    });

    await analyzeAndPersistBrandReadiness(audit.id);
    expect(await prisma.brandAuthorityResult.count({ where: { geoAuditRunId: audit.id } })).toBe(1);
  });
});
