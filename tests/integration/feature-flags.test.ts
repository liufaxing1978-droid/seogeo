import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

const app = createApp();
const fixtures: Awaited<ReturnType<typeof seedAuthenticatedUser>>[] = [];

async function seed(planLevel: 'STANDARD' | 'ADVANCED') {
  const fixture = await seedAuthenticatedUser({
    role: 'VIEWER',
    planLevel,
    userStatus: 'ACTIVE',
    membershipStatus: 'ACTIVE',
  });
  fixtures.push(fixture);
  return fixture;
}

afterEach(async () => {
  for (const fixture of fixtures.splice(0).reverse()) {
    await fixture.cleanup();
  }
});

describe('AI Visibility feature gate', () => {
  it('denies STANDARD projects', async () => {
    const fixture = await seed('STANDARD');
    const response = await request(app)
      .get(`/api/projects/${fixture.project.id}/features/ai-visibility`)
      .set('Cookie', fixture.sessionCookie);
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FEATURE_NOT_AVAILABLE');
  });

  it('allows ADVANCED projects', async () => {
    const fixture = await seed('ADVANCED');
    const response = await request(app)
      .get(`/api/projects/${fixture.project.id}/features/ai-visibility`)
      .set('Cookie', fixture.sessionCookie);
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ enabled: true });
  });
});
