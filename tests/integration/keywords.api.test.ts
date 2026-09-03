import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { deriveCsrfToken } from '../../src/auth/csrf.js';
import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { prisma } from '../../src/db/prisma.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

function csrfFor(fixture: Awaited<ReturnType<typeof seedAuthenticatedUser>>): string {
  return deriveCsrfToken(
    env.SESSION_SECRET,
    fixture.csrfInput.sessionId,
    fixture.csrfInput.tokenHash,
  );
}

describe('P11-01 keyword JSON API authorization', () => {
  it('persists an explainable P5 content gap and records its handoff to the existing content center', async () => {
    const fixture = await seedAuthenticatedUser({ role: 'OPERATOR', planLevel: 'ENTERPRISE', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE' });
    try {
      const app = createApp();
      const csrf = csrfFor(fixture);
      const keyword = await request(app)
        .post(`/api/v1/projects/${fixture.project.id}/keywords`)
        .set('Cookie', fixture.sessionCookie).set('X-CSRF-Token', csrf)
        .send({ text: '超度法事', type: 'LONG_TAIL' }).expect(201);

      const evaluated = await request(app)
        .post(`/api/v1/projects/${fixture.project.id}/keywords/${keyword.body.data.id}/content-gap`)
        .set('Cookie', fixture.sessionCookie).set('X-CSRF-Token', csrf)
        .send({}).expect(201);
      expect(evaluated.body.data).toMatchObject({ keywordId: keyword.body.data.id, status: 'OPEN', coverageStatus: 'UNKNOWN' });

      const planned = await request(app)
        .post(`/api/v1/projects/${fixture.project.id}/keywords/${keyword.body.data.id}/content-gap/plan`)
        .set('Cookie', fixture.sessionCookie).set('X-CSRF-Token', csrf)
        .send({}).expect(200);
      expect(planned.body.data).toMatchObject({ keywordId: keyword.body.data.id, status: 'CONTENT_PLANNED' });
      expect(planned.body.data.contentEntryHref).toBe(`/projects/${fixture.project.id}/content`);
    } finally { await fixture.cleanup(); }
  });

  it('does not reveal a foreign keyword content gap through an in-scope project route', async () => {
    const fixture = await seedAuthenticatedUser({ role: 'VIEWER', planLevel: 'ENTERPRISE', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE' });
    const foreign = await prisma.project.create({ data: { name: 'P5 foreign gap', slug: `p5-foreign-gap-${Date.now()}`, primaryDomain: `p5-foreign-gap-${Date.now()}.example.com` } });
    try {
      const keyword = await prisma.keyword.create({ data: { projectId: foreign.id, text: '外部内容缺口', normalizedText: `外部内容缺口-${foreign.id}`, type: 'LONG_TAIL', source: 'MANUAL' } });
      await prisma.keywordContentGap.create({ data: { projectId: foreign.id, keywordId: keyword.id, coverageStatus: 'NONE', status: 'OPEN', reasonCodes: ['NO_MATCH'], sourceProvenance: { coverageStatus: 'NONE' } } });

      const response = await request(createApp())
        .get(`/api/v1/projects/${fixture.project.id}/keywords/${keyword.id}/content-gap`)
        .set('Cookie', fixture.sessionCookie)
        .expect(404);

      expect(response.body.error.code).toBe('KEYWORD_NOT_FOUND');
    } finally {
      await prisma.project.delete({ where: { id: foreign.id } }).catch(() => undefined);
      await fixture.cleanup();
    }
  });

  it('lets a CONTENT_WRITE member set a Cluster Target URL', async () => {
    const fixture = await seedAuthenticatedUser({ role: 'OPERATOR', planLevel: 'ENTERPRISE', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE' });
    try {
      const group = await prisma.keywordGroup.create({ data: { projectId: fixture.project.id, name: 'P4 Cluster' } });
      const url = `https://${fixture.project.primaryDomain}/cluster`;
      const response = await request(createApp()).put(`/api/v1/projects/${fixture.project.id}/keyword-groups/${group.id}/target-url`).set('Cookie', fixture.sessionCookie).set('X-CSRF-Token', csrfFor(fixture)).send({ targetUrl: url }).expect(200);
      expect(response.body.data).toMatchObject({ groupId: group.id, normalizedUrl: url });
    } finally { await fixture.cleanup(); }
  });
  it('lets a CONTENT_WRITE member set an in-scope Target URL and read its P4 analysis', async () => {
    const fixture = await seedAuthenticatedUser({ role: 'OPERATOR', planLevel: 'ENTERPRISE', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE' });
    try {
      const app = createApp();
      const csrf = csrfFor(fixture);
      const created = await request(app).post(`/api/v1/projects/${fixture.project.id}/keywords`).set('Cookie', fixture.sessionCookie).set('X-CSRF-Token', csrf).send({ text: '法事', type: 'CORE' }).expect(201);
      const url = `https://${fixture.project.primaryDomain}/guide`;
      const target = await request(app).put(`/api/v1/projects/${fixture.project.id}/keywords/${created.body.data.id}/target-url`).set('Cookie', fixture.sessionCookie).set('X-CSRF-Token', csrf).send({ targetUrl: url }).expect(200);
      expect(target.body.data).toMatchObject({ keywordId: created.body.data.id, normalizedUrl: url });
      const analysis = await request(app).post(`/api/v1/projects/${fixture.project.id}/keywords/${created.body.data.id}/cannibalization`).set('Cookie', fixture.sessionCookie).set('X-CSRF-Token', csrf).send({}).expect(201);
      expect(analysis.body.data).toMatchObject({ risk: 'NONE' });
    } finally { await fixture.cleanup(); }
  });
  it('rejects anonymous keyword reads', async () => {
    const response = await request(createApp())
      .get('/api/v1/projects/00000000-0000-0000-0000-000000000001/keywords')
      .expect(401);

    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('lets VIEWER read but rejects keyword mutation', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'VIEWER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const app = createApp();
      const read = await request(app)
        .get(`/api/v1/projects/${fixture.project.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .expect(200);

      expect(read.body.data).toEqual([]);

      const response = await request(app)
        .post(`/api/v1/projects/${fixture.project.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrfFor(fixture))
        .send({ text: '符纸', type: 'CORE' })
        .expect(403);

      expect(response.body.error.code).toBe('PROJECT_CAPABILITY_REQUIRED');
    } finally {
      await fixture.cleanup();
    }
  });

  it('fails closed for a project with no active membership', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OPERATOR',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const foreignProject = await prisma.project.create({
      data: {
        name: `Foreign keyword project ${suffix}`,
        slug: `foreign-keyword-${suffix}`,
        primaryDomain: `foreign-keyword-${suffix}.example.com`,
        planLevel: 'ENTERPRISE',
      },
    });

    try {
      const response = await request(createApp())
        .get(`/api/v1/projects/${foreignProject.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .expect(404);

      expect(response.body.error.code).toBe('PROJECT_NOT_FOUND');
    } finally {
      await prisma.project.delete({ where: { id: foreignProject.id } }).catch(() => undefined);
      await fixture.cleanup();
    }
  });

  it('requires a valid CSRF token for OPERATOR mutations', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OPERATOR',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const app = createApp();
      const missing = await request(app)
        .post(`/api/v1/projects/${fixture.project.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .send({ text: '符纸', type: 'CORE' })
        .expect(403);
      expect(missing.body.error.code).toBe('CSRF_INVALID');

      const invalid = await request(app)
        .post(`/api/v1/projects/${fixture.project.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', 'invalid')
        .send({ text: '符纸', type: 'CORE' })
        .expect(403);
      expect(invalid.body.error.code).toBe('CSRF_INVALID');
    } finally {
      await fixture.cleanup();
    }
  });

  it('lets an OPERATOR create and then list a manual keyword', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OPERATOR',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const app = createApp();
      const created = await request(app)
        .post(`/api/v1/projects/${fixture.project.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrfFor(fixture))
        .send({
          text: ' 符纸 ',
          type: 'CORE',
          intent: 'INFORMATIONAL',
          priority: 'HIGH',
        })
        .expect(201);

      expect(created.body.data).toMatchObject({
        text: '符纸',
        normalizedText: '符纸',
        type: 'CORE',
        source: 'MANUAL',
      });

      const listed = await request(app)
        .get(`/api/v1/projects/${fixture.project.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .expect(200);

      expect(listed.body.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: created.body.data.id, normalizedText: '符纸' }),
        ]),
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it('validates keyword enums before persistence and supports bulk create plus filters', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OPERATOR',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const app = createApp();
      const csrf = csrfFor(fixture);
      const api = `/api/v1/projects/${fixture.project.id}`;

      const invalid = await request(app)
        .post(`${api}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrf)
        .send({ text: '符纸', type: 'NOT_REAL' })
        .expect(400);
      expect(invalid.body.error.code).toBe('VALIDATION_ERROR');

      const bulk = await request(app)
        .post(`${api}/keywords/bulk`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrf)
        .send({
          text: '符纸\n六壬法教\n符纸',
          type: 'CORE',
          intent: 'INFORMATIONAL',
          priority: 'HIGH',
          lifecycleStatus: 'APPROVED',
          language: 'zh-Hans',
          targetCountry: 'CN',
        })
        .expect(201);
      expect(bulk.body.data.created).toHaveLength(2);
      expect(bulk.body.data.duplicates).toEqual([
        expect.objectContaining({ line: 3, reason: 'DUPLICATE_IN_REQUEST' }),
      ]);

      const listed = await request(app)
        .get(`${api}/keywords`)
        .query({ q: '六壬', lifecycleStatus: 'APPROVED', intent: 'INFORMATIONAL' })
        .set('Cookie', fixture.sessionCookie)
        .expect(200);
      expect(listed.body.data.map((item: { text: string }) => item.text)).toEqual(['六壬法教']);
    } finally {
      await fixture.cleanup();
    }
  });

  it('exposes the complete manual keyword command surface with lock acknowledgement', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OPERATOR',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const app = createApp();
      const csrf = csrfFor(fixture);
      const api = `/api/v1/projects/${fixture.project.id}`;

      const parent = await request(app)
        .post(`${api}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrf)
        .send({ text: '符纸', type: 'CORE', priority: 'HIGH' })
        .expect(201);

      const child = await request(app)
        .post(`${api}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrf)
        .send({ text: '六壬符纸', type: 'LONG_TAIL' })
        .expect(201);

      const updated = await request(app)
        .patch(`${api}/keywords/${child.body.data.id}`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrf)
        .send({ priority: 'HIGH', status: 'DISABLED', notes: '专题词' })
        .expect(200);
      expect(updated.body.data).toMatchObject({ priority: 'HIGH', status: 'DISABLED', notes: '专题词' });

      const locked = await request(app)
        .put(`${api}/keywords/${child.body.data.id}/lock`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrf)
        .send({ locked: true })
        .expect(200);
      expect(locked.body.data.locked).toBe(true);

      const blocked = await request(app)
        .put(`${api}/keywords/${child.body.data.id}/parent`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrf)
        .send({ parentKeywordId: parent.body.data.id })
        .expect(409);
      expect(blocked.body.error.code).toBe('KEYWORD_LOCKED');

      await request(app)
        .put(`${api}/keywords/${child.body.data.id}/parent`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrf)
        .send({ parentKeywordId: parent.body.data.id, acknowledgeLock: true })
        .expect(200);

      const group = await request(app)
        .post(`${api}/keyword-groups`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrf)
        .send({ name: '符纸专题', description: '专题内容集群' })
        .expect(201);

      const renamedGroup = await request(app)
        .patch(`${api}/keyword-groups/${group.body.data.id}`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrf)
        .send({ name: '符纸内容集群' })
        .expect(200);
      expect(renamedGroup.body.data.name).toBe('符纸内容集群');

      const primaryGroup = await request(app)
        .put(`${api}/keyword-groups/${group.body.data.id}/primary-keyword`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrf)
        .send({ primaryKeywordId: parent.body.data.id })
        .expect(200);
      expect(primaryGroup.body.data.primaryKeywordId).toBe(parent.body.data.id);

      const assigned = await request(app)
        .put(`${api}/keyword-groups/${group.body.data.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrf)
        .send({
          keywordIds: [parent.body.data.id, child.body.data.id],
          acknowledgeLock: true,
        })
        .expect(200);
      expect(assigned.body.data).toEqual(expect.arrayContaining([
        expect.objectContaining({ keywordId: parent.body.data.id }),
        expect.objectContaining({ keywordId: child.body.data.id }),
      ]));

      const groups = await request(app)
        .put(`${api}/keywords/${child.body.data.id}/groups`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrf)
        .send({ groupIds: [group.body.data.id], acknowledgeLock: true })
        .expect(200);
      expect(groups.body.data).toEqual(
        expect.arrayContaining([expect.objectContaining({ groupId: group.body.data.id })]),
      );

      await request(app)
        .delete(`${api}/keywords/${child.body.data.id}/parent`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrf)
        .send({ acknowledgeLock: true })
        .expect(200);

      const archived = await request(app)
        .post(`${api}/keywords/${child.body.data.id}/archive`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrf)
        .send({ acknowledgeLock: true })
        .expect(200);
      expect(archived.body.data.status).toBe('ARCHIVED');

      const restored = await request(app)
        .post(`${api}/keywords/${child.body.data.id}/restore`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrf)
        .send({ acknowledgeLock: true })
        .expect(200);
      expect(restored.body.data.status).toBe('ACTIVE');

      const unlocked = await request(app)
        .put(`${api}/keywords/${child.body.data.id}/lock`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrf)
        .send({ locked: false, acknowledgeLock: true })
        .expect(200);
      expect(unlocked.body.data.locked).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  });

  it('calculates and reads the latest explainable opportunity snapshot without inventing missing facts', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OPERATOR',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const app = createApp();
      const csrf = csrfFor(fixture);
      const api = `/api/v1/projects/${fixture.project.id}`;
      const created = await request(app)
        .post(`${api}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrf)
        .send({ text: '符纸怎么用', type: 'QUESTION', intent: 'INFORMATIONAL' })
        .expect(201);

      const calculated = await request(app)
        .post(`${api}/keywords/${created.body.data.id}/opportunity-score`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrf)
        .send({})
        .expect(201);
      expect(calculated.body.data).toMatchObject({
        keywordId: created.body.data.id,
        score: null,
        dataConfidence: 0.15,
        formulaVersion: 'keyword-opportunity-v1',
        breakdown: {
          relevance: { state: 'UNKNOWN', score: null },
          demand: { state: 'UNKNOWN', score: null },
          rankingOpportunity: { state: 'UNKNOWN', score: null },
          difficulty: { state: 'UNKNOWN', score: null },
        },
      });

      const latest = await request(app)
        .get(`${api}/keywords/${created.body.data.id}/opportunity-score`)
        .set('Cookie', fixture.sessionCookie)
        .expect(200);
      expect(latest.body.data.id).toBe(calculated.body.data.id);
    } finally {
      await fixture.cleanup();
    }
  });
});
