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

describe('P11-02B official search provider binding API authorization', () => {
  it('requires authentication for binding reads', async () => {
    const response = await request(createApp())
      .get('/api/v1/projects/00000000-0000-0000-0000-000000000001/search-provider-bindings')
      .expect(401);

    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('lets VIEWER read project bindings but denies mutation', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'VIEWER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const app = createApp();
      const read = await request(app)
        .get(`/api/v1/projects/${fixture.project.id}/search-provider-bindings`)
        .set('Cookie', fixture.sessionCookie)
        .expect(200);
      expect(read.body.data).toEqual([]);

      const denied = await request(app)
        .post(`/api/v1/projects/${fixture.project.id}/search-provider-bindings`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrfFor(fixture))
        .send({
          provider: 'GOOGLE_SEARCH_CONSOLE',
          propertyRef: 'sc-domain:xingshantang.org',
          marketCode: 'HK',
          locale: 'zh-Hant',
        })
        .expect(403);
      expect(denied.body.error.code).toBe('PROJECT_CAPABILITY_REQUIRED');
    } finally {
      await fixture.cleanup();
    }
  });

  it('also denies OPERATOR because provider settings require PROJECT_SETTINGS_WRITE', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OPERATOR',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const denied = await request(createApp())
        .post(`/api/v1/projects/${fixture.project.id}/search-provider-bindings`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrfFor(fixture))
        .send({
          provider: 'BING_WEBMASTER',
          propertyRef: 'https://xingshantang.org/',
          marketCode: 'GLOBAL',
          locale: 'zh-Hant',
        })
        .expect(403);
      expect(denied.body.error.code).toBe('PROJECT_CAPABILITY_REQUIRED');
    } finally {
      await fixture.cleanup();
    }
  });

  it('requires CSRF before an ADMIN provider-setting mutation', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'ADMIN',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const response = await request(createApp())
        .post(`/api/v1/projects/${fixture.project.id}/search-provider-bindings`)
        .set('Cookie', fixture.sessionCookie)
        .send({
          provider: 'GOOGLE_SEARCH_CONSOLE',
          propertyRef: 'sc-domain:xingshantang.org',
          marketCode: 'HK',
          locale: 'zh-Hant',
        })
        .expect(403);
      expect(response.body.error.code).toBe('CSRF_INVALID');
    } finally {
      await fixture.cleanup();
    }
  });

  it('lets ADMIN create, list, and deactivate a non-secret lane binding', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'ADMIN',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const app = createApp();
      const csrf = csrfFor(fixture);
      const api = `/api/v1/projects/${fixture.project.id}/search-provider-bindings`;

      const created = await request(app)
        .post(api)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrf)
        .send({
          provider: 'GOOGLE_SEARCH_CONSOLE',
          propertyRef: 'sc-domain:xingshantang.org',
          marketCode: 'HK',
          locale: 'zh-Hant',
        })
        .expect(201);

      expect(created.body.data).toMatchObject({
        projectId: fixture.project.id,
        provider: 'GOOGLE_SEARCH_CONSOLE',
        propertyRef: 'sc-domain:xingshantang.org',
        marketCode: 'HK',
        locale: 'zh-Hant',
        isActive: true,
      });
      expect(JSON.stringify(created.body)).not.toMatch(/credentialRef|accessToken|refreshToken|apiKey|authorization/i);

      const duplicate = await request(app)
        .post(api)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrf)
        .send({
          provider: 'GOOGLE_SEARCH_CONSOLE',
          propertyRef: 'sc-domain:xingshantang.org',
          marketCode: 'HK',
          locale: 'zh-Hant',
        })
        .expect(200);
      expect(duplicate.body.data.id).toBe(created.body.data.id);

      const listed = await request(app)
        .get(api)
        .set('Cookie', fixture.sessionCookie)
        .expect(200);
      expect(listed.body.data).toEqual([
        expect.objectContaining({ id: created.body.data.id, isActive: true }),
      ]);
      expect(JSON.stringify(listed.body)).not.toMatch(/credentialRef|accessToken|refreshToken|apiKey|authorization/i);

      const patched = await request(app)
        .patch(`${api}/${created.body.data.id}`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrf)
        .send({ isActive: false })
        .expect(200);
      expect(patched.body.data.isActive).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  });

  it('fails closed for a foreign project and a foreign binding id', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'ADMIN',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const foreignProject = await prisma.project.create({
      data: {
        name: `Foreign binding project ${suffix}`,
        slug: `foreign-binding-${suffix}`,
        primaryDomain: `foreign-binding-${suffix}.example.com`,
        planLevel: 'ENTERPRISE',
      },
    });
    const foreignBinding = await prisma.searchProviderLaneBinding.create({
      data: {
        projectId: foreignProject.id,
        provider: 'BING_WEBMASTER',
        propertyRef: 'https://foreign.example.com/',
        marketCode: 'GLOBAL',
        locale: 'en-US',
      },
    });

    try {
      const csrf = csrfFor(fixture);
      const foreignProjectRead = await request(createApp())
        .get(`/api/v1/projects/${foreignProject.id}/search-provider-bindings`)
        .set('Cookie', fixture.sessionCookie)
        .expect(404);
      expect(foreignProjectRead.body.error.code).toBe('PROJECT_NOT_FOUND');

      const foreignBindingPatch = await request(createApp())
        .patch(`/api/v1/projects/${fixture.project.id}/search-provider-bindings/${foreignBinding.id}`)
        .set('Cookie', fixture.sessionCookie)
        .set('X-CSRF-Token', csrf)
        .send({ isActive: false })
        .expect(404);
      expect(foreignBindingPatch.body.error.code).toBe('SEARCH_PROVIDER_BINDING_NOT_FOUND');

      const unchanged = await prisma.searchProviderLaneBinding.findUnique({ where: { id: foreignBinding.id } });
      expect(unchanged?.isActive).toBe(true);
    } finally {
      await prisma.searchProviderLaneBinding.deleteMany({ where: { projectId: foreignProject.id } });
      await prisma.project.delete({ where: { id: foreignProject.id } }).catch(() => undefined);
      await fixture.cleanup();
    }
  });
});
