import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildGoogleAuthorizationUrl,
  type GoogleSearchConsoleTransport,
  type GoogleTokenPayload
} from '../../src/modules/search-console/google-search-console.client.js';
import {
  SearchConsoleService,
  type SearchConsoleServiceRepository
} from '../../src/modules/search-console/search-console.service.js';
import type {
  OAuthCredentialVault,
  OAuthCredentialProviderName
} from '../../src/modules/search-console/oauth-credential-vault.js';

type Nonce = {
  id: string;
  projectId: string;
  actorId: string;
  provider: 'GOOGLE_SEARCH_CONSOLE';
  stateHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
};

type Connection = {
  id: string;
  projectId: string;
  credentialRef: string;
  googleAccountRef: string | null;
  status: 'CONNECTED' | 'TOKEN_REVOKED' | 'PERMISSION_DENIED' | 'DISCONNECTED';
  connectedAt: Date;
  revokedAt: Date | null;
  lastVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type Property = {
  id: string;
  projectId: string;
  connectionId: string;
  propertyUri: string;
  propertyType: string;
  permissionState: string;
  isActive: boolean;
  lastSyncAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

class MemoryRepository implements SearchConsoleServiceRepository {
  readonly projects = new Set<string>();
  readonly nonces = new Map<string, Nonce>();
  readonly connections = new Map<string, Connection>();
  readonly properties = new Map<string, Property>();
  private sequence = 0;

  async projectExists(projectId: string) { return this.projects.has(projectId); }
  async createOAuthStateNonce(input: Omit<Nonce, 'id' | 'consumedAt' | 'createdAt'>) {
    const row: Nonce = {
      id: `nonce-${++this.sequence}`,
      ...input,
      consumedAt: null,
      createdAt: new Date('2026-08-20T00:00:00.000Z')
    };
    this.nonces.set(input.stateHash, row);
    return row;
  }
  async consumeOAuthStateNonce(stateHash: string, consumedAt: Date) {
    const row = this.nonces.get(stateHash);
    if (!row || row.consumedAt || row.expiresAt <= consumedAt) return null;
    row.consumedAt = consumedAt;
    return row;
  }
  async findActiveConnection(projectId: string) {
    return [...this.connections.values()].find((row) => row.projectId === projectId && row.status === 'CONNECTED') ?? null;
  }
  async createConnection(input: { projectId: string; credentialRef: string; googleAccountRef?: string | null; status?: Connection['status'] }) {
    const now = new Date('2026-08-20T00:00:00.000Z');
    const row: Connection = {
      id: `connection-${++this.sequence}`,
      projectId: input.projectId,
      credentialRef: input.credentialRef,
      googleAccountRef: input.googleAccountRef ?? null,
      status: input.status ?? 'CONNECTED',
      connectedAt: now,
      revokedAt: null,
      lastVerifiedAt: null,
      createdAt: now,
      updatedAt: now
    };
    this.connections.set(row.id, row);
    return row;
  }
  async disconnectConnection(connectionId: string, disconnectedAt: Date) {
    const row = this.connections.get(connectionId);
    if (!row) throw new Error('connection not found');
    row.status = 'DISCONNECTED';
    row.revokedAt = disconnectedAt;
    row.updatedAt = disconnectedAt;
    for (const property of this.properties.values()) {
      if (property.connectionId === connectionId) property.isActive = false;
    }
    return row;
  }
  async listProperties(projectId: string, connectionId: string) {
    return [...this.properties.values()].filter((row) => row.projectId === projectId && row.connectionId === connectionId);
  }
  async bindProperty(input: { projectId: string; connectionId: string; propertyUri: string; propertyType: string; permissionState: string }) {
    for (const property of this.properties.values()) {
      if (property.projectId === input.projectId) property.isActive = false;
    }
    const now = new Date('2026-08-20T00:00:00.000Z');
    const existing = [...this.properties.values()].find((row) => row.connectionId === input.connectionId && row.propertyUri === input.propertyUri);
    if (existing) {
      existing.isActive = true;
      existing.permissionState = input.permissionState;
      existing.propertyType = input.propertyType;
      return existing;
    }
    const row: Property = {
      id: `property-${++this.sequence}`,
      projectId: input.projectId,
      connectionId: input.connectionId,
      propertyUri: input.propertyUri,
      propertyType: input.propertyType,
      permissionState: input.permissionState,
      isActive: true,
      lastSyncAt: null,
      createdAt: now,
      updatedAt: now
    };
    this.properties.set(row.id, row);
    return row;
  }
}

class MemoryVault implements OAuthCredentialVault {
  readonly values = new Map<string, unknown>();
  private sequence = 0;
  async put(_projectId: string, _provider: OAuthCredentialProviderName, payload: unknown) {
    const ref = `credential-${++this.sequence}`;
    this.values.set(ref, structuredClone(payload));
    return ref;
  }
  async get(ref: string) {
    if (!this.values.has(ref)) throw new Error('credential not found');
    return structuredClone(this.values.get(ref));
  }
  async replace(ref: string, payload: unknown) {
    if (!this.values.has(ref)) throw new Error('credential not found');
    this.values.set(ref, structuredClone(payload));
  }
  async revoke(ref: string) { this.values.delete(ref); }
}

class FakeTransport implements GoogleSearchConsoleTransport {
  exchangeCalls = 0;
  refreshCalls = 0;
  lastListToken: string | null = null;
  exchangePayload: GoogleTokenPayload = {
    access_token: 'access-one',
    refresh_token: 'refresh-one',
    expires_in: 3600,
    token_type: 'Bearer'
  };
  refreshPayload: GoogleTokenPayload = {
    access_token: 'access-refreshed',
    expires_in: 3600,
    token_type: 'Bearer'
  };
  sites = [
    { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner' },
    { siteUrl: 'https://example.com/', permissionLevel: 'siteFullUser' },
    { siteUrl: 'sc-domain:unverified.example', permissionLevel: 'siteUnverifiedUser' }
  ];

  async exchangeCode() { this.exchangeCalls += 1; return this.exchangePayload; }
  async refreshToken() { this.refreshCalls += 1; return this.refreshPayload; }
  async listSites(accessToken: string) { this.lastListToken = accessToken; return this.sites; }
  async querySearchAnalytics() { return { rows: [] }; }
}

const config = {
  clientId: 'google-client-id',
  clientSecret: 'google-client-secret',
  redirectUri: 'https://seo.example.com/api/search-console/oauth/callback'
};

function makeService(now = new Date('2026-08-20T00:00:00.000Z')) {
  const repository = new MemoryRepository();
  const vault = new MemoryVault();
  const transport = new FakeTransport();
  const clock = { current: now };
  const service = new SearchConsoleService({
    repository,
    vault,
    transport,
    oauthConfig: config,
    now: () => clock.current
  });
  return { service, repository, vault, transport, clock };
}

describe('P7-A read-only Search Console OAuth', () => {
  it('builds an authorization URL with the exact read-only scope and offline consent', () => {
    const url = buildGoogleAuthorizationUrl(config, 'state-value');
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/webmasters.readonly');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('state-value');
  });

  it('stores only a state hash with project/actor scope and never the raw state', async () => {
    const { service, repository } = makeService();
    repository.projects.add('project-1');

    const result = await service.beginGoogleOAuth('project-1', 'actor-1');
    const url = new URL(result.authorizationUrl);
    const rawState = url.searchParams.get('state')!;
    const expectedHash = createHash('sha256').update(rawState).digest('hex');
    const nonce = repository.nonces.get(expectedHash);

    expect(rawState.length).toBeGreaterThanOrEqual(32);
    expect(nonce).toMatchObject({ projectId: 'project-1', actorId: 'actor-1', stateHash: expectedHash });
    expect(JSON.stringify([...repository.nonces.values()])).not.toContain(rawState);
  });

  it('rejects unknown, expired and replayed state before token exchange', async () => {
    const { service, repository, transport, clock } = makeService();
    repository.projects.add('project-1');

    await expect(service.completeGoogleOAuth('code-x', 'not-a-real-state')).rejects.toMatchObject({ code: 'OAUTH_STATE_INVALID' });
    expect(transport.exchangeCalls).toBe(0);

    const expired = await service.beginGoogleOAuth('project-1', 'actor-1');
    const expiredState = new URL(expired.authorizationUrl).searchParams.get('state')!;
    clock.current = new Date('2026-08-20T00:11:00.000Z');
    await expect(service.completeGoogleOAuth('code-x', expiredState)).rejects.toMatchObject({ code: 'OAUTH_STATE_INVALID' });
    expect(transport.exchangeCalls).toBe(0);

    clock.current = new Date('2026-08-20T01:00:00.000Z');
    const valid = await service.beginGoogleOAuth('project-1', 'actor-1');
    const state = new URL(valid.authorizationUrl).searchParams.get('state')!;
    await service.completeGoogleOAuth('code-ok', state);
    expect(transport.exchangeCalls).toBe(1);
    await expect(service.completeGoogleOAuth('code-replay', state)).rejects.toMatchObject({ code: 'OAUTH_STATE_INVALID' });
    expect(transport.exchangeCalls).toBe(1);
  });

  it('requires a refresh token for a schedulable first connection', async () => {
    const { service, repository, transport } = makeService();
    repository.projects.add('project-1');
    transport.exchangePayload = { access_token: 'access-only', expires_in: 3600, token_type: 'Bearer' };
    const begin = await service.beginGoogleOAuth('project-1', 'actor-1');
    const state = new URL(begin.authorizationUrl).searchParams.get('state')!;

    await expect(service.completeGoogleOAuth('code', state)).rejects.toMatchObject({ code: 'OAUTH_REFRESH_TOKEN_REQUIRED' });
    expect(repository.connections.size).toBe(0);
  });

  it('filters unreadable properties and binds only an exact authorized property', async () => {
    const { service, repository } = makeService();
    repository.projects.add('project-1');
    const begin = await service.beginGoogleOAuth('project-1', 'actor-1');
    const state = new URL(begin.authorizationUrl).searchParams.get('state')!;
    await service.completeGoogleOAuth('code', state);

    const properties = await service.listReadableProperties('project-1');
    expect(properties.map((row) => row.siteUrl)).toEqual(['sc-domain:example.com', 'https://example.com/']);

    const bound = await service.bindProperty('project-1', 'sc-domain:example.com');
    expect(bound).toMatchObject({ propertyUri: 'sc-domain:example.com', propertyType: 'DOMAIN', isActive: true });
    await expect(service.bindProperty('project-1', 'sc-domain:not-authorized.example')).rejects.toMatchObject({ code: 'SEARCH_CONSOLE_PROPERTY_NOT_AVAILABLE' });
  });

  it('refreshes an expired access token and preserves the stored refresh token', async () => {
    const { service, repository, vault, transport, clock } = makeService();
    repository.projects.add('project-1');
    const begin = await service.beginGoogleOAuth('project-1', 'actor-1');
    const state = new URL(begin.authorizationUrl).searchParams.get('state')!;
    await service.completeGoogleOAuth('code', state);
    const connection = await repository.findActiveConnection('project-1');
    const stored = await vault.get(connection!.credentialRef) as Record<string, unknown>;
    vault.values.set(connection!.credentialRef, { ...stored, expires_at: '2026-08-20T00:30:00.000Z' });
    clock.current = new Date('2026-08-20T01:00:00.000Z');

    await service.listReadableProperties('project-1');

    expect(transport.refreshCalls).toBe(1);
    expect(transport.lastListToken).toBe('access-refreshed');
    expect(await vault.get(connection!.credentialRef)).toMatchObject({
      access_token: 'access-refreshed',
      refresh_token: 'refresh-one'
    });
  });
});
