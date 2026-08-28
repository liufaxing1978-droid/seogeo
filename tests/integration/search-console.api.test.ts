import { createHash } from 'node:crypto';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';
import {
  createOAuthCredentialVault
} from '../../src/modules/search-console/oauth-credential-vault.js';
import type {
  GoogleSearchConsoleTransport,
  GoogleTokenPayload
} from '../../src/modules/search-console/google-search-console.client.js';
import { SearchConsoleRepository } from '../../src/modules/search-console/search-console.repository.js';
import { SearchConsoleService } from '../../src/modules/search-console/search-console.service.js';

const projectIds: string[] = [];

class FixtureGoogleTransport implements GoogleSearchConsoleTransport {
  exchangeCalls = 0;
  listCalls = 0;
  async exchangeCode(): Promise<GoogleTokenPayload> {
    this.exchangeCalls += 1;
    return {
      access_token: 'integration-access-secret',
      refresh_token: 'integration-refresh-secret',
      expires_in: 3600,
      token_type: 'Bearer'
    };
  }
  async refreshToken(): Promise<GoogleTokenPayload> {
    return { access_token: 'refreshed-access', expires_in: 3600, token_type: 'Bearer' };
  }
  async listSites() {
    this.listCalls += 1;
    return [
      { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' },
      { siteUrl: 'https://example.com/', permissionLevel: 'siteRestrictedUser' },
      { siteUrl: 'sc-domain:no-access.example', permissionLevel: 'siteUnverifiedUser' }
    ];
  }
  async querySearchAnalytics() { return { rows: [] }; }
}

async function createProject(
  label: string,
  planLevel: 'STANDARD' | 'ADVANCED' | 'ENTERPRISE' = 'ADVANCED'
) {
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: `P7-A ${label}`,
      slug: `p7a-oauth-${suffix}`,
      primaryDomain: `p7a-oauth-${suffix}.example.com`,
      planLevel
    }
  });
  projectIds.push(project.id);
  return project;
}

function createFixtureApp() {
  const repository = new SearchConsoleRepository();
  const transport = new FixtureGoogleTransport();
  const vault = createOAuthCredentialVault({
    key: Buffer.alloc(32, 21),
    keyVersion: 'v1',
    store: repository
  });
  const service = new SearchConsoleService({
    repository,
    vault,
    transport,
    oauthConfig: {
      clientId: 'integration-google-client',
      clientSecret: 'integration-google-secret',
      redirectUri: 'https://seo.example.com/api/search-console/oauth/callback'
    }
  });
  return { app: createApp({ searchConsoleService: service }), transport };
}

describe('P7-A Search Console REST API', () => {
  afterAll(async () => {
    for (const projectId of projectIds) {
      await prisma.gscQueryPageFact.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.gscDailySnapshot.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.searchConsoleProperty.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.searchConsoleConnection.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.oAuthStateNonce.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.oAuthCredentialRecord.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    }
  });

  it('accepts Google callback metadata while consuming the authorization code and state', async () => {
    const completeGoogleOAuth = async (code: string, state: string) => ({
      projectId: 'f0cc3a7c-86ee-4f2a-b3d6-1e8649d37a1b',
      code,
      state,
      status: 'CONNECTED'
    });
    const app = createApp({
      searchConsoleService: { completeGoogleOAuth } as unknown as SearchConsoleService
    });

    await request(app)
      .get('/api/search-console/oauth/callback')
      .query({
        code: 'google-authorisation-code',
        state: 'google-oauth-state-value',
        scope: 'https://www.googleapis.com/auth/webmasters.readonly',
        iss: 'https://accounts.google.com'
      })
      .expect(200)
      .expect(({ body }) => expect(body.data).toMatchObject({
        code: 'google-authorisation-code',
        state: 'google-oauth-state-value',
        status: 'CONNECTED'
      }));
  });

  it('gates project routes before touching the injected Search Console service', async () => {
    const missingProject = '00000000-0000-0000-0000-000000000098';
    let serviceCalls = 0;
    const service = {
      getStatus: async () => {
        serviceCalls += 1;
        return { status: 'NOT_CONNECTED', property: null };
      }
    } as unknown as SearchConsoleService;
    const app = createApp({ searchConsoleService: service });

    await request(app)
      .get(`/api/projects/${missingProject}/search-console/status`)
      .expect(404)
      .expect(({ body }) => expect(body.error.code).toBe('PROJECT_NOT_FOUND'));

    expect(serviceCalls).toBe(0);
  });

  it('allows STANDARD projects to use the read-only Search Console surface', async () => {
    const project = await createProject('standard feature gate', 'STANDARD');
    const { app } = createFixtureApp();

    await request(app)
      .get(`/api/projects/${project.id}/search-console/status`)
      .expect(200)
      .expect(({ body }) => expect(body.data.status).toBe('NOT_CONNECTED'));
  });

  it('connects with hashed single-use state and never returns or stores plaintext tokens', async () => {
    const project = await createProject('oauth callback');
    const { app, transport } = createFixtureApp();

    const started = await request(app)
      .post(`/api/projects/${project.id}/search-console/oauth/start`)
      .send({})
      .expect(201);
    const authorizationUrl = new URL(started.body.data.authorizationUrl);
    expect(authorizationUrl.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/webmasters.readonly');
    const state = authorizationUrl.searchParams.get('state')!;
    const stateHash = createHash('sha256').update(state).digest('hex');
    expect(await prisma.oAuthStateNonce.findUnique({ where: { stateHash } })).toMatchObject({ projectId: project.id, consumedAt: null });
    expect(JSON.stringify(await prisma.oAuthStateNonce.findMany({ where: { projectId: project.id } }))).not.toContain(state);

    const callback = await request(app)
      .get('/api/search-console/oauth/callback')
      .query({ code: 'fixture-code', state })
      .expect(200);
    expect(callback.body.data).toMatchObject({ projectId: project.id, status: 'CONNECTED' });
    expect(JSON.stringify(callback.body)).not.toContain('integration-access-secret');
    expect(JSON.stringify(callback.body)).not.toContain('integration-refresh-secret');
    expect(transport.exchangeCalls).toBe(1);

    const credential = await prisma.oAuthCredentialRecord.findFirstOrThrow({ where: { projectId: project.id } });
    expect(Buffer.from(credential.ciphertext).toString('utf8')).not.toContain('integration-access-secret');
    expect(Buffer.from(credential.ciphertext).toString('utf8')).not.toContain('integration-refresh-secret');

    await request(app)
      .get('/api/search-console/oauth/callback')
      .query({ code: 'fixture-replay', state })
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe('OAUTH_STATE_INVALID'));
    expect(transport.exchangeCalls).toBe(1);
  });

  it('lists only readable properties and binds an exact authorized property', async () => {
    const project = await createProject('property binding');
    const { app } = createFixtureApp();
    const started = await request(app)
      .post(`/api/projects/${project.id}/search-console/oauth/start`)
      .send({})
      .expect(201);
    const state = new URL(started.body.data.authorizationUrl).searchParams.get('state')!;
    await request(app).get('/api/search-console/oauth/callback').query({ code: 'fixture-code', state }).expect(200);

    const listed = await request(app)
      .get(`/api/projects/${project.id}/search-console/properties`)
      .expect(200);
    expect(listed.body.data.map((row: { siteUrl: string }) => row.siteUrl)).toEqual([
      'sc-domain:example.com',
      'https://example.com/'
    ]);

    const bound = await request(app)
      .post(`/api/projects/${project.id}/search-console/property`)
      .send({ propertyUri: 'sc-domain:example.com' })
      .expect(200);
    expect(bound.body.data).toMatchObject({ propertyUri: 'sc-domain:example.com', isActive: true });

    await request(app)
      .post(`/api/projects/${project.id}/search-console/property`)
      .send({ propertyUri: 'sc-domain:no-access.example' })
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe('SEARCH_CONSOLE_PROPERTY_NOT_AVAILABLE'));
  });

  it('fails missing projects before creating OAuth state and exposes safe connection status/disconnect', async () => {
    const { app } = createFixtureApp();
    const missingProject = '00000000-0000-0000-0000-000000000099';
    await request(app)
      .post(`/api/projects/${missingProject}/search-console/oauth/start`)
      .send({})
      .expect(404)
      .expect(({ body }) => expect(body.error.code).toBe('PROJECT_NOT_FOUND'));
    expect(await prisma.oAuthStateNonce.count({ where: { projectId: missingProject } })).toBe(0);

    const project = await createProject('status disconnect');
    const started = await request(app)
      .post(`/api/projects/${project.id}/search-console/oauth/start`)
      .send({})
      .expect(201);
    const state = new URL(started.body.data.authorizationUrl).searchParams.get('state')!;
    await request(app).get('/api/search-console/oauth/callback').query({ code: 'fixture-code', state }).expect(200);

    const status = await request(app)
      .get(`/api/projects/${project.id}/search-console/status`)
      .expect(200);
    expect(status.body.data).toMatchObject({ status: 'CONNECTED', property: null });
    expect(JSON.stringify(status.body)).not.toContain('credentialRef');

    await request(app)
      .delete(`/api/projects/${project.id}/search-console/connection`)
      .expect(204);
    const disconnected = await prisma.searchConsoleConnection.findFirstOrThrow({ where: { projectId: project.id } });
    expect(disconnected.status).toBe('DISCONNECTED');
    const credential = await prisma.oAuthCredentialRecord.findUniqueOrThrow({ where: { id: disconnected.credentialRef } });
    expect(credential.revokedAt).not.toBeNull();
  });
});
