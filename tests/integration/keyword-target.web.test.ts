import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { deriveCsrfToken } from '../../src/auth/csrf.js';
import { env } from '../../src/config/env.js';
import { prisma } from '../../src/db/prisma.js';
import { keywordService } from '../../src/modules/keywords/keyword.service.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

function csrfFor(fixture: Awaited<ReturnType<typeof seedAuthenticatedUser>>) {
  return deriveCsrfToken(env.SESSION_SECRET, fixture.csrfInput.sessionId, fixture.csrfInput.tokenHash);
}

describe('keyword Target URL web controls', () => {
  it('renders a mapping form for every writable keyword', async () => {
    const fixture = await seedAuthenticatedUser({ role: 'OWNER', planLevel: 'ENTERPRISE', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE' });
    try {
      const keyword = await keywordService.createManual({ actorUserId: fixture.user.id, projectId: fixture.project.id, text: '伏英馆', type: 'CORE' });
      const response = await request(createApp())
        .get(`/projects/${fixture.project.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .expect(200);

      expect(response.text).toContain(`action="/projects/${fixture.project.id}/keywords/${keyword.id}/target-url"`);
      expect(response.text).toContain('保存映射');
    } finally { await fixture.cleanup(); }
  });

  it('persists an in-scope mapping from the web form and redirects', async () => {
    const fixture = await seedAuthenticatedUser({ role: 'OWNER', planLevel: 'ENTERPRISE', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE' });
    try {
      const keyword = await keywordService.createManual({ actorUserId: fixture.user.id, projectId: fixture.project.id, text: '兴善堂', type: 'CORE', lifecycleStatus: 'APPROVED' });
      const targetUrl = `https://${fixture.project.primaryDomain}/`;
      const response = await request(createApp())
        .post(`/projects/${fixture.project.id}/keywords/${keyword.id}/target-url`)
        .set('Cookie', fixture.sessionCookie)
        .type('form')
        .send({ _csrf: csrfFor(fixture), targetUrl })
        .expect(303);

      expect(response.headers.location).toBe(`/projects/${fixture.project.id}/keywords`);
      expect(await prisma.keywordTargetMapping.findUnique({ where: { keywordId: keyword.id } }))
        .toMatchObject({ projectId: fixture.project.id, targetUrl });
      expect(await prisma.keyword.findUniqueOrThrow({ where: { id: keyword.id } }))
        .toMatchObject({ lifecycleStatus: 'MAPPED' });
    } finally { await fixture.cleanup(); }
  });

  it('requires explicit acknowledgement before mapping a locked keyword', async () => {
    const fixture = await seedAuthenticatedUser({ role: 'OWNER', planLevel: 'ENTERPRISE', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE' });
    try {
      const keyword = await keywordService.createManual({ actorUserId: fixture.user.id, projectId: fixture.project.id, text: '六壬伏英馆', type: 'CORE', locked: true });
      await request(createApp())
        .post(`/projects/${fixture.project.id}/keywords/${keyword.id}/target-url`)
        .set('Cookie', fixture.sessionCookie)
        .type('form')
        .send({ _csrf: csrfFor(fixture), targetUrl: `https://${fixture.project.primaryDomain}/` })
        .expect(409);

      expect(await prisma.keywordTargetMapping.findUnique({ where: { keywordId: keyword.id } })).toBeNull();
    } finally { await fixture.cleanup(); }
  });

  it('returns a validation error for unsafe or out-of-scope URLs without persisting them', async () => {
    const fixture = await seedAuthenticatedUser({ role: 'OWNER', planLevel: 'ENTERPRISE', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE' });
    try {
      const keyword = await keywordService.createManual({ actorUserId: fixture.user.id, projectId: fixture.project.id, text: '站外映射', type: 'CORE' });
      for (const targetUrl of [
        'https://example.net/outside',
        `ftp://${fixture.project.primaryDomain}/archive`,
        `https://user:pass@${fixture.project.primaryDomain}/private`,
      ]) {
        const response = await request(createApp())
          .post(`/projects/${fixture.project.id}/keywords/${keyword.id}/target-url`)
          .set('Cookie', fixture.sessionCookie)
          .type('form')
          .send({ _csrf: csrfFor(fixture), targetUrl })
          .expect(400);

        expect(response.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
      }
      expect(await prisma.keywordTargetMapping.findUnique({ where: { keywordId: keyword.id } })).toBeNull();
    } finally { await fixture.cleanup(); }
  });

  it('enforces CSRF and CONTENT_WRITE before accepting a mapping', async () => {
    const owner = await seedAuthenticatedUser({ role: 'OWNER', planLevel: 'ENTERPRISE', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE' });
    const viewer = await seedAuthenticatedUser({ role: 'VIEWER', planLevel: 'ENTERPRISE', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE' });
    try {
      const ownerKeyword = await keywordService.createManual({ actorUserId: owner.user.id, projectId: owner.project.id, text: 'CSRF 映射', type: 'CORE' });
      const viewerKeyword = await keywordService.createManual({ actorUserId: viewer.user.id, projectId: viewer.project.id, text: '只读映射', type: 'CORE' });
      await request(createApp())
        .post(`/projects/${owner.project.id}/keywords/${ownerKeyword.id}/target-url`)
        .set('Cookie', owner.sessionCookie)
        .type('form')
        .send({ targetUrl: `https://${owner.project.primaryDomain}/` })
        .expect(403);
      await request(createApp())
        .post(`/projects/${viewer.project.id}/keywords/${viewerKeyword.id}/target-url`)
        .set('Cookie', viewer.sessionCookie)
        .type('form')
        .send({ _csrf: csrfFor(viewer), targetUrl: `https://${viewer.project.primaryDomain}/` })
        .expect(403);
    } finally {
      await owner.cleanup();
      await viewer.cleanup();
    }
  });

  it('does not map a keyword that belongs to another project', async () => {
    const owner = await seedAuthenticatedUser({ role: 'OWNER', planLevel: 'ENTERPRISE', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE' });
    const foreign = await seedAuthenticatedUser({ role: 'OWNER', planLevel: 'ENTERPRISE', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE' });
    try {
      const keyword = await keywordService.createManual({ actorUserId: foreign.user.id, projectId: foreign.project.id, text: '外部项目词', type: 'CORE' });
      await request(createApp())
        .post(`/projects/${owner.project.id}/keywords/${keyword.id}/target-url`)
        .set('Cookie', owner.sessionCookie)
        .type('form')
        .send({ _csrf: csrfFor(owner), targetUrl: `https://${owner.project.primaryDomain}/` })
        .expect(404);

      expect(await prisma.keywordTargetMapping.findUnique({ where: { keywordId: keyword.id } })).toBeNull();
    } finally {
      await owner.cleanup();
      await foreign.cleanup();
    }
  });
});
