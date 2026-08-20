import { createHash, randomBytes } from 'node:crypto';
import type {
  OAuthStateNonce,
  SearchConsoleConnection,
  SearchConsoleProperty
} from '@prisma/client';
import type {
  OAuthCredentialVault
} from './oauth-credential-vault.js';
import {
  buildGoogleAuthorizationUrl,
  type GoogleOAuthConfig,
  type GoogleSearchConsoleTransport,
  type GoogleSiteEntry,
  type GoogleTokenPayload
} from './google-search-console.client.js';
import type {
  CreateOAuthStateNonceInput,
  SearchConsoleRepository
} from './search-console.repository.js';
import type {
  CreateSearchConsoleConnectionInput
} from './search-console.types.js';

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const ACCESS_TOKEN_REFRESH_SKEW_MS = 60 * 1000;
const READABLE_PERMISSION_LEVELS = new Set(['siteOwner', 'siteFullUser', 'siteRestrictedUser']);

export class SearchConsoleServiceError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number
  ) {
    super(message);
    this.name = 'SearchConsoleServiceError';
  }
}

type SafeConnection = Pick<
  SearchConsoleConnection,
  'id' | 'projectId' | 'credentialRef' | 'googleAccountRef' | 'status' | 'connectedAt' | 'revokedAt' | 'lastVerifiedAt' | 'createdAt' | 'updatedAt'
>;

type SafeProperty = Pick<
  SearchConsoleProperty,
  'id' | 'projectId' | 'connectionId' | 'propertyUri' | 'propertyType' | 'permissionState' | 'isActive' | 'lastSyncAt' | 'createdAt' | 'updatedAt'
>;

export interface SearchConsoleServiceRepository {
  projectExists(projectId: string): Promise<boolean>;
  createOAuthStateNonce(input: CreateOAuthStateNonceInput): Promise<OAuthStateNonce>;
  consumeOAuthStateNonce(stateHash: string, consumedAt?: Date): Promise<OAuthStateNonce | null>;
  findActiveConnection(projectId: string): Promise<SafeConnection | null>;
  createConnection(input: CreateSearchConsoleConnectionInput): Promise<SafeConnection>;
  disconnectConnection(connectionId: string, disconnectedAt: Date): Promise<SafeConnection>;
  listProperties(projectId: string, connectionId: string): Promise<SafeProperty[]>;
  bindProperty(input: {
    projectId: string;
    connectionId: string;
    propertyUri: string;
    propertyType: string;
    permissionState: string;
  }): Promise<SafeProperty>;
}

type StoredGoogleCredential = {
  access_token: string;
  refresh_token: string;
  token_type?: string;
  scope?: string;
  expires_at?: string;
};

export type SearchConsoleServiceDependencies = {
  repository: SearchConsoleServiceRepository;
  vault: OAuthCredentialVault;
  transport: GoogleSearchConsoleTransport;
  oauthConfig: GoogleOAuthConfig;
  now?: () => Date;
};

function stateHash(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

function propertyType(siteUrl: string): 'DOMAIN' | 'URL_PREFIX' {
  return siteUrl.startsWith('sc-domain:') ? 'DOMAIN' : 'URL_PREFIX';
}

function toStoredCredential(
  payload: GoogleTokenPayload,
  now: Date,
  existingRefreshToken?: string
): StoredGoogleCredential {
  const refreshToken = payload.refresh_token ?? existingRefreshToken;
  if (!refreshToken) {
    throw new SearchConsoleServiceError(
      'Google did not return a refresh token required for scheduled synchronization',
      'OAUTH_REFRESH_TOKEN_REQUIRED',
      400
    );
  }
  return {
    access_token: payload.access_token,
    refresh_token: refreshToken,
    ...(payload.token_type ? { token_type: payload.token_type } : {}),
    ...(payload.scope ? { scope: payload.scope } : {}),
    ...(payload.expires_in
      ? { expires_at: new Date(now.getTime() + payload.expires_in * 1000).toISOString() }
      : {})
  };
}

function parseStoredCredential(value: unknown): StoredGoogleCredential {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SearchConsoleServiceError('Stored Google credential is invalid', 'OAUTH_CREDENTIAL_INVALID', 500);
  }
  const record = value as Record<string, unknown>;
  if (typeof record.access_token !== 'string' || !record.access_token) {
    throw new SearchConsoleServiceError('Stored Google access token is invalid', 'OAUTH_CREDENTIAL_INVALID', 500);
  }
  if (typeof record.refresh_token !== 'string' || !record.refresh_token) {
    throw new SearchConsoleServiceError('Stored Google refresh token is invalid', 'OAUTH_CREDENTIAL_INVALID', 500);
  }
  return {
    access_token: record.access_token,
    refresh_token: record.refresh_token,
    ...(typeof record.token_type === 'string' ? { token_type: record.token_type } : {}),
    ...(typeof record.scope === 'string' ? { scope: record.scope } : {}),
    ...(typeof record.expires_at === 'string' ? { expires_at: record.expires_at } : {})
  };
}

function safeConnection(connection: SafeConnection) {
  return {
    id: connection.id,
    projectId: connection.projectId,
    googleAccountRef: connection.googleAccountRef,
    status: connection.status,
    connectedAt: connection.connectedAt,
    revokedAt: connection.revokedAt,
    lastVerifiedAt: connection.lastVerifiedAt,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt
  };
}

export class SearchConsoleService {
  private readonly now: () => Date;

  constructor(private readonly dependencies: SearchConsoleServiceDependencies) {
    this.now = dependencies.now ?? (() => new Date());
  }

  private async requireProject(projectId: string): Promise<void> {
    if (!await this.dependencies.repository.projectExists(projectId)) {
      throw new SearchConsoleServiceError('Project not found', 'PROJECT_NOT_FOUND', 404);
    }
  }

  async beginGoogleOAuth(projectId: string, actorId: string) {
    await this.requireProject(projectId);
    const state = randomBytes(32).toString('base64url');
    const now = this.now();
    await this.dependencies.repository.createOAuthStateNonce({
      projectId,
      actorId,
      provider: 'GOOGLE_SEARCH_CONSOLE',
      stateHash: stateHash(state),
      expiresAt: new Date(now.getTime() + OAUTH_STATE_TTL_MS)
    });
    return {
      authorizationUrl: buildGoogleAuthorizationUrl(this.dependencies.oauthConfig, state).toString(),
      expiresAt: new Date(now.getTime() + OAUTH_STATE_TTL_MS)
    };
  }

  async completeGoogleOAuth(code: string, state: string) {
    const now = this.now();
    const nonce = await this.dependencies.repository.consumeOAuthStateNonce(stateHash(state), now);
    if (!nonce) {
      throw new SearchConsoleServiceError('OAuth state is invalid, expired, or already used', 'OAUTH_STATE_INVALID', 400);
    }

    const token = await this.dependencies.transport.exchangeCode({
      code,
      redirectUri: this.dependencies.oauthConfig.redirectUri
    });
    const storedToken = toStoredCredential(token, now);
    const credentialRef = await this.dependencies.vault.put(
      nonce.projectId,
      'GOOGLE_SEARCH_CONSOLE',
      storedToken
    );

    try {
      const previous = await this.dependencies.repository.findActiveConnection(nonce.projectId);
      if (previous) {
        await this.dependencies.repository.disconnectConnection(previous.id, now);
        await this.dependencies.vault.revoke(previous.credentialRef);
      }
      const connection = await this.dependencies.repository.createConnection({
        projectId: nonce.projectId,
        credentialRef,
        googleAccountRef: null,
        status: 'CONNECTED'
      });
      return { ...safeConnection(connection), actorId: nonce.actorId };
    } catch (error) {
      await this.dependencies.vault.revoke(credentialRef).catch(() => undefined);
      throw error;
    }
  }

  private async activeConnection(projectId: string): Promise<SafeConnection> {
    await this.requireProject(projectId);
    const connection = await this.dependencies.repository.findActiveConnection(projectId);
    if (!connection) {
      throw new SearchConsoleServiceError('Search Console is not connected', 'SEARCH_CONSOLE_NOT_CONNECTED', 409);
    }
    return connection;
  }

  private async accessToken(projectId: string): Promise<{ connection: SafeConnection; accessToken: string }> {
    const connection = await this.activeConnection(projectId);
    let credential = parseStoredCredential(await this.dependencies.vault.get(connection.credentialRef));
    const now = this.now();
    const expiresAt = credential.expires_at ? Date.parse(credential.expires_at) : Number.POSITIVE_INFINITY;
    if (Number.isFinite(expiresAt) && expiresAt <= now.getTime() + ACCESS_TOKEN_REFRESH_SKEW_MS) {
      const refreshed = await this.dependencies.transport.refreshToken(credential.refresh_token);
      credential = toStoredCredential(refreshed, now, credential.refresh_token);
      await this.dependencies.vault.replace(connection.credentialRef, credential);
    }
    return { connection, accessToken: credential.access_token };
  }

  async getAccessTokenForSync(projectId: string): Promise<string> {
    return (await this.accessToken(projectId)).accessToken;
  }

  async listReadableProperties(projectId: string): Promise<GoogleSiteEntry[]> {
    const { accessToken } = await this.accessToken(projectId);
    const sites = await this.dependencies.transport.listSites(accessToken);
    return sites.filter((site) => READABLE_PERMISSION_LEVELS.has(site.permissionLevel));
  }

  async bindProperty(projectId: string, propertyUri: string): Promise<SafeProperty> {
    const { connection, accessToken } = await this.accessToken(projectId);
    const sites = await this.dependencies.transport.listSites(accessToken);
    const selected = sites.find(
      (site) => site.siteUrl === propertyUri && READABLE_PERMISSION_LEVELS.has(site.permissionLevel)
    );
    if (!selected) {
      throw new SearchConsoleServiceError(
        'Search Console property is not available to the connected account',
        'SEARCH_CONSOLE_PROPERTY_NOT_AVAILABLE',
        400
      );
    }
    return this.dependencies.repository.bindProperty({
      projectId,
      connectionId: connection.id,
      propertyUri: selected.siteUrl,
      propertyType: propertyType(selected.siteUrl),
      permissionState: selected.permissionLevel
    });
  }

  async getStatus(projectId: string) {
    await this.requireProject(projectId);
    const connection = await this.dependencies.repository.findActiveConnection(projectId);
    if (!connection) return { status: 'NOT_CONNECTED' as const, property: null };
    const properties = await this.dependencies.repository.listProperties(projectId, connection.id);
    const property = properties.find((item) => item.isActive) ?? null;
    return {
      ...safeConnection(connection),
      property: property
        ? {
            id: property.id,
            propertyUri: property.propertyUri,
            propertyType: property.propertyType,
            permissionState: property.permissionState,
            isActive: property.isActive,
            lastSyncAt: property.lastSyncAt
          }
        : null
    };
  }

  async disconnect(projectId: string): Promise<void> {
    await this.requireProject(projectId);
    const connection = await this.dependencies.repository.findActiveConnection(projectId);
    if (!connection) return;
    const now = this.now();
    await this.dependencies.repository.disconnectConnection(connection.id, now);
    await this.dependencies.vault.revoke(connection.credentialRef);
  }
}

export type SearchConsoleRepositoryForService = Pick<
  SearchConsoleRepository,
  | 'projectExists'
  | 'createOAuthStateNonce'
  | 'consumeOAuthStateNonce'
  | 'findActiveConnection'
  | 'createConnection'
  | 'disconnectConnection'
  | 'listProperties'
  | 'bindProperty'
>;
