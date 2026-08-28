import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { deriveCsrfToken } from '../../src/auth/csrf.js';
import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { keywordService } from '../../src/modules/keywords/keyword.service.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

function csrfFor(fixture: Awaited<ReturnType<typeof seedAuthenticatedUser>>) {
  return deriveCsrfToken(
    env.SESSION_SECRET,
    fixture.csrfInput.sessionId,
    fixture.csrfInput.tokenHash,
  );
}

describe('P11-01 keyword center web UI', () => {
  it('renders keyword facts without fabricated ranking', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OWNER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      await keywordService.createManual({
        actorUserId: fixture.user.id,
        projectId: fixture.project.id,
        text: '符纸',
        type: 'CORE',
        priority: 'HIGH',
        locked: true,
      });

      const response = await request(createApp())
        .get(`/projects/${fixture.project.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .expect(200);

      expect(response.text).toContain('关键词中心');
      expect(response.text).toContain('符纸');
      expect(response.text).toContain('站内内容覆盖');
      expect(response.text).toContain('排名数据：未接入');
      expect(response.text).not.toContain('Google 排名：1');
      expect(response.text).toContain('data-ui="keyword-center"');
    } finally {
      await fixture.cleanup();
    }
  });

  it('requires authentication', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OWNER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      await request(createApp())
        .get(`/projects/${fixture.project.id}/keywords`)
        .expect(401);
    } finally {
      await fixture.cleanup();
    }
  });

  it('hides project existence from a non-member', async () => {
    const member = await seedAuthenticatedUser({
      role: 'VIEWER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
    const foreign = await seedAuthenticatedUser({
      role: 'OWNER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      await request(createApp())
        .get(`/projects/${foreign.project.id}/keywords`)
        .set('Cookie', member.sessionCookie)
        .expect(404);
    } finally {
      await member.cleanup();
      await foreign.cleanup();
    }
  });

  it('allows VIEWER read access but does not render mutation controls', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'VIEWER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      await keywordService.createManual({
        actorUserId: fixture.user.id,
        projectId: fixture.project.id,
        text: '六壬符纸',
        type: 'LONG_TAIL',
      });

      const response = await request(createApp())
        .get(`/projects/${fixture.project.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .expect(200);

      expect(response.text).toContain('六壬符纸');
      expect(response.text).not.toContain('data-ui="keyword-create-form"');
    } finally {
      await fixture.cleanup();
    }
  });

  it('denies VIEWER mutation even with a valid CSRF token', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'VIEWER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      await request(createApp())
        .post(`/projects/${fixture.project.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .type('form')
        .send({
          _csrf: csrfFor(fixture),
          text: '符纸文化',
          type: 'CORE',
        })
        .expect(403);
    } finally {
      await fixture.cleanup();
    }
  });

  it('rejects keyword mutations with invalid CSRF', async () => {
    const fixture = await seedAuthenticatedUser({
      role: 'OWNER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });

    try {
      const response = await request(createApp())
        .post(`/projects/${fixture.project.id}/keywords`)
        .set('Cookie', fixture.sessionCookie)
        .type('form')
        .send({ _csrf: 'invalid-token', text: '符纸文化', type: 'CORE' })
        .expect(403);

      expect(response.body.error.code).toBe('CSRF_INVALID');
    } finally {
      await fixture.cleanup();
    }
  });
});
