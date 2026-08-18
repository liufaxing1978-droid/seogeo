import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { extractEntitiesForAudit } from '../../src/modules/geo/entity-extractor.js';

beforeEach(async () => {
  await prisma.project.deleteMany();
  await prisma.geoRuleVersion.deleteMany();
  await prisma.geoRule.deleteMany();
});

describe('deterministic GEO entity extraction', () => {
  it('builds stable entities, aliases, observations and explicit structured relations', async () => {
    const project = await prisma.project.create({
      data: {
        name: 'Entity Fixture',
        slug: `entity-${Date.now()}`,
        primaryDomain: 'example.com'
      }
    });

    const crawlRun = await prisma.crawlRun.create({
      data: {
        projectId: project.id,
        runType: 'MANUAL',
        status: 'COMPLETED',
        seedUrl: 'https://example.com/',
        crawlerVersion: '0.1.0'
      }
    });

    const page = await prisma.page.create({
      data: {
        projectId: project.id,
        url: 'https://example.com/service',
        normalizedUrl: 'https://example.com/service',
        host: 'example.com',
        path: '/service'
      }
    });

    const snapshot = await prisma.pageSnapshot.create({
      data: {
        pageId: page.id,
        crawlRunId: crawlRun.id,
        finalUrl: 'https://example.com/service',
        statusCode: 200,
        contentType: 'text/html',
        title: 'Example Service',
        h1: 'Example Service',
        h1Count: 1,
        wordCount: 400,
        schemaCount: 1,
        parserVersion: '0.2.0'
      }
    });

    await prisma.pageStructuredSignal.create({
      data: {
        pageSnapshotId: snapshot.id,
        openGraphSiteName: 'Example Site',
        entitySignals: [
          {
            schemaTypes: ['Organization'],
            id: 'https://example.com/#org',
            name: 'Example Organization',
            alternateNames: ['Example Org', 'Example'],
            url: 'https://example.com/',
            sameAs: ['https://social.example/example'],
            role: 'ROOT',
            sourcePath: '$.@graph[0]',
            parentSourcePath: null
          },
          {
            schemaTypes: ['Service'],
            id: 'https://example.com/#service',
            name: 'Example Service',
            alternateNames: [],
            url: 'https://example.com/service',
            sameAs: [],
            role: 'ROOT',
            sourcePath: '$.@graph[1]',
            parentSourcePath: null
          },
          {
            schemaTypes: ['Organization'],
            id: 'https://example.com/#org',
            name: 'Example Organization',
            alternateNames: [],
            url: 'https://example.com/',
            sameAs: [],
            role: 'PROVIDER',
            sourcePath: '$.@graph[1].provider',
            parentSourcePath: '$.@graph[1]'
          }
        ]
      }
    });

    const firstAudit = await prisma.geoAuditRun.create({
      data: {
        projectId: project.id,
        crawlRunId: crawlRun.id,
        status: 'RUNNING',
        engineVersion: 'geo-0.1.0'
      }
    });

    const first = await extractEntitiesForAudit(firstAudit.id);
    const retry = await extractEntitiesForAudit(firstAudit.id);

    expect(first.entitiesObserved).toBe(2);
    expect(retry.entitiesObserved).toBe(2);
    expect(await prisma.entity.count({ where: { projectId: project.id } })).toBe(2);

    const organization = await prisma.entity.findFirstOrThrow({
      where: { projectId: project.id, entityType: 'ORGANIZATION' }
    });
    const service = await prisma.entity.findFirstOrThrow({
      where: { projectId: project.id, entityType: 'SERVICE' }
    });

    expect(organization).toMatchObject({
      canonicalName: 'Example Organization',
      normalizedName: 'example organization',
      officialUrl: 'https://example.com/'
    });
    expect(service).toMatchObject({
      canonicalName: 'Example Service',
      normalizedName: 'example service',
      officialUrl: 'https://example.com/service'
    });

    const aliases = await prisma.entityAlias.findMany({
      where: { entityId: organization.id },
      orderBy: { normalizedAlias: 'asc' }
    });
    expect(aliases.map((item) => item.alias)).toEqual(['Example', 'Example Org']);

    const sameAsObservation = await prisma.entityObservation.findFirstOrThrow({
      where: {
        geoAuditRunId: firstAudit.id,
        entityId: organization.id,
        property: 'sameAs'
      }
    });
    expect(sameAsObservation.value).toBe('https://social.example/example');

    const relation = await prisma.entityRelation.findFirstOrThrow({
      where: {
        projectId: project.id,
        sourceEntityId: service.id,
        relationType: 'PROVIDER',
        targetEntityId: organization.id,
        sourcePageId: page.id
      }
    });
    expect(relation.evidence).toMatchObject({ sourceType: 'SCHEMA' });

    expect(
      await prisma.pageEntity.count({ where: { pageId: page.id, entityId: organization.id } })
    ).toBeGreaterThan(0);
    expect(
      await prisma.pageEntity.count({ where: { pageId: page.id, entityId: service.id } })
    ).toBeGreaterThan(0);

    const observationCountAfterRetry = await prisma.entityObservation.count({
      where: { geoAuditRunId: firstAudit.id }
    });
    expect(observationCountAfterRetry).toBeGreaterThan(0);

    const secondAudit = await prisma.geoAuditRun.create({
      data: {
        projectId: project.id,
        crawlRunId: crawlRun.id,
        status: 'RUNNING',
        engineVersion: 'geo-0.1.0'
      }
    });

    await extractEntitiesForAudit(secondAudit.id);

    expect(await prisma.entity.count({ where: { projectId: project.id } })).toBe(2);
    expect(await prisma.entityObservation.count({ where: { geoAuditRunId: firstAudit.id } })).toBe(
      observationCountAfterRetry
    );
    expect(await prisma.entityObservation.count({ where: { geoAuditRunId: secondAudit.id } })).toBe(
      observationCountAfterRetry
    );
  });

  it('does not create entities from Open Graph site name or page prose alone', async () => {
    const project = await prisma.project.create({
      data: {
        name: 'No Schema Fixture',
        slug: `no-schema-${Date.now()}`,
        primaryDomain: 'example.net'
      }
    });
    const crawlRun = await prisma.crawlRun.create({
      data: {
        projectId: project.id,
        runType: 'MANUAL',
        status: 'COMPLETED',
        seedUrl: 'https://example.net/',
        crawlerVersion: '0.1.0'
      }
    });
    const page = await prisma.page.create({
      data: {
        projectId: project.id,
        url: 'https://example.net/',
        normalizedUrl: 'https://example.net/',
        host: 'example.net',
        path: '/'
      }
    });
    const snapshot = await prisma.pageSnapshot.create({
      data: {
        pageId: page.id,
        crawlRunId: crawlRun.id,
        finalUrl: 'https://example.net/',
        statusCode: 200,
        contentType: 'text/html',
        title: 'Person Name in Title',
        parserVersion: '0.2.0'
      }
    });
    await prisma.pageStructuredSignal.create({
      data: {
        pageSnapshotId: snapshot.id,
        openGraphSiteName: 'Possible Brand Name',
        entitySignals: []
      }
    });
    const audit = await prisma.geoAuditRun.create({
      data: {
        projectId: project.id,
        crawlRunId: crawlRun.id,
        status: 'RUNNING',
        engineVersion: 'geo-0.1.0'
      }
    });

    const result = await extractEntitiesForAudit(audit.id);

    expect(result.entitiesObserved).toBe(0);
    expect(await prisma.entity.count({ where: { projectId: project.id } })).toBe(0);
  });
});
