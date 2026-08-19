import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { VisibilitySubjectService } from '../../src/modules/visibility/visibility-subject.service.js';

describe('P6-B visibility subject registry', () => {
  const projectIds: string[] = [];
  afterAll(async () => {
    for (const id of projectIds) await prisma.project.delete({ where: { id } }).catch(() => undefined);
  });

  async function project(label: string, domain?: string) {
    const suffix = `${label}-${Date.now()}-${Math.random()}`;
    const created = await prisma.project.create({
      data: {
        name: `Subject ${label}`,
        slug: `subject-${suffix}`,
        primaryDomain: domain ?? `www.${suffix}.example.com`,
        planLevel: 'ADVANCED'
      }
    });
    projectIds.push(created.id);
    return created;
  }

  it('bootstraps exactly one owned-domain subject and does not over-infer P3 entities or P5 competitors', async () => {
    const owner = await project('bootstrap', 'www.XingShanTang.org');
    await prisma.entity.create({ data: { projectId: owner.id, entityType: 'ORGANIZATION', canonicalName: '兴善堂', normalizedName: '兴善堂' } });
    await prisma.competitor.create({ data: { projectId: owner.id, name: 'Reference', domain: 'reference.example.com' } });

    const service = new VisibilitySubjectService();
    const subject = await service.bootstrapOwnedDomain(owner.id);
    expect(subject).toMatchObject({
      projectId: owner.id,
      subjectType: 'OWNED_DOMAIN',
      canonicalValue: 'xingshantang.org',
      normalizedValue: 'xingshantang.org',
      sourceType: 'PRIMARY_DOMAIN'
    });

    await service.bootstrapOwnedDomain(owner.id);
    const subjects = await prisma.visibilitySubject.findMany({ where: { projectId: owner.id } });
    expect(subjects).toHaveLength(1);
    expect(subjects[0]?.subjectType).toBe('OWNED_DOMAIN');
  });

  it('links selected same-project P3 entities and P5 competitors explicitly', async () => {
    const owner = await project('links');
    const entity = await prisma.entity.create({ data: { projectId: owner.id, entityType: 'ORGANIZATION', canonicalName: '兴善堂', normalizedName: '兴善堂' } });
    const competitor = await prisma.competitor.create({ data: { projectId: owner.id, name: 'Reference Site', domain: 'reference.example.com' } });
    const service = new VisibilitySubjectService();

    const ownedEntity = await service.createSubject(owner.id, { subjectType: 'OWNED_ENTITY', entityId: entity.id });
    const competitorSubject = await service.createSubject(owner.id, { subjectType: 'COMPETITOR', competitorId: competitor.id });

    expect(ownedEntity).toMatchObject({ canonicalValue: '兴善堂', normalizedValue: '兴善堂', entityId: entity.id, sourceType: 'P3_ENTITY' });
    expect(competitorSubject).toMatchObject({ canonicalValue: 'reference.example.com', normalizedValue: 'reference.example.com', competitorId: competitor.id, sourceType: 'P5_COMPETITOR' });
  });

  it('rejects cross-project entity and competitor links', async () => {
    const owner = await project('owner');
    const stranger = await project('stranger');
    const foreignEntity = await prisma.entity.create({ data: { projectId: stranger.id, entityType: 'ORGANIZATION', canonicalName: 'Foreign', normalizedName: 'foreign' } });
    const foreignCompetitor = await prisma.competitor.create({ data: { projectId: stranger.id, name: 'Foreign Competitor', domain: 'foreign.example.com' } });
    const service = new VisibilitySubjectService();

    await expect(service.createSubject(owner.id, { subjectType: 'OWNED_ENTITY', entityId: foreignEntity.id }))
      .rejects.toMatchObject({ code: 'VISIBILITY_ENTITY_NOT_FOUND' });
    await expect(service.createSubject(owner.id, { subjectType: 'COMPETITOR', competitorId: foreignCompetitor.id }))
      .rejects.toMatchObject({ code: 'VISIBILITY_COMPETITOR_NOT_FOUND' });
  });

  it('rejects new ambiguous aliases and excludes legacy ambiguous aliases from the authoritative snapshot', async () => {
    const owner = await project('aliases');
    const service = new VisibilitySubjectService();
    const first = await service.createSubject(owner.id, { subjectType: 'OWNED_BRAND', canonicalValue: '兴善堂' });
    const second = await service.createSubject(owner.id, { subjectType: 'OWNED_BRAND', canonicalValue: '六壬伏英馆' });

    await service.addAlias(owner.id, first.id, { alias: 'XST', aliasType: 'NAME' });
    await expect(service.addAlias(owner.id, second.id, { alias: 'xst', aliasType: 'NAME' }))
      .rejects.toMatchObject({ code: 'AMBIGUOUS_ALIAS' });

    await prisma.visibilitySubjectAlias.create({
      data: {
        projectId: owner.id,
        subjectId: second.id,
        alias: 'ＸＳＴ',
        normalizedAlias: 'xst',
        aliasType: 'NAME',
        sourceType: 'PROJECT_CONFIG'
      }
    });

    const snapshot = await service.buildActiveSnapshot(owner.id);
    const firstSnapshot = snapshot.subjects.find((item) => item.id === first.id);
    const secondSnapshot = snapshot.subjects.find((item) => item.id === second.id);
    expect(firstSnapshot?.aliases).not.toContain('xst');
    expect(secondSnapshot?.aliases).not.toContain('xst');
    expect(snapshot.ambiguousAliases).toContain('xst');
    expect(snapshot.subjectSetHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('archives subjects without deleting them from persistence', async () => {
    const owner = await project('archive');
    const service = new VisibilitySubjectService();
    const subject = await service.createSubject(owner.id, { subjectType: 'OWNED_BRAND', canonicalValue: '兴善堂' });
    await service.archiveSubject(owner.id, subject.id);
    expect(await prisma.visibilitySubject.findUniqueOrThrow({ where: { id: subject.id } })).toMatchObject({ status: 'ARCHIVED' });
  });
});
