import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type OAuthCredentialProviderName = 'GOOGLE_SEARCH_CONSOLE';

export type StoredOAuthCredentialRecord = {
  id: string;
  projectId: string;
  provider: OAuthCredentialProviderName;
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: string;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface OAuthCredentialStore {
  createCredentialRecord(
    input: Omit<StoredOAuthCredentialRecord, 'id' | 'createdAt' | 'updatedAt' | 'revokedAt'>
  ): Promise<StoredOAuthCredentialRecord>;
  getCredentialRecord(id: string): Promise<StoredOAuthCredentialRecord | null>;
  replaceCredentialCiphertext(
    id: string,
    encrypted: Pick<StoredOAuthCredentialRecord, 'ciphertext' | 'iv' | 'authTag' | 'keyVersion'>
  ): Promise<StoredOAuthCredentialRecord>;
  revokeCredentialRecord(id: string, revokedAt: Date): Promise<StoredOAuthCredentialRecord>;
}

export interface OAuthCredentialVault {
  put(projectId: string, provider: OAuthCredentialProviderName, payload: unknown): Promise<string>;
  get(credentialRef: string): Promise<unknown>;
  replace(credentialRef: string, payload: unknown): Promise<void>;
  revoke(credentialRef: string): Promise<void>;
}

export type OAuthCredentialVaultOptions = {
  key: Buffer;
  keyVersion: string;
  store: OAuthCredentialStore;
};

type EncryptedCredential = Pick<StoredOAuthCredentialRecord, 'ciphertext' | 'iv' | 'authTag' | 'keyVersion'>;

function assertKey(key: Buffer): Buffer {
  if (key.length !== 32) {
    throw new Error('OAuth credential encryption key must be exactly 32 bytes');
  }
  return key;
}

export function parseOAuthCredentialKey(value: string | undefined): Buffer {
  if (!value || !value.trim()) {
    throw new Error('OAuth credential encryption key must decode to exactly 32 bytes');
  }

  const trimmed = value.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');

  if (key.length !== 32) {
    throw new Error('OAuth credential encryption key must decode to exactly 32 bytes');
  }
  return key;
}

function encryptPayload(payload: unknown, key: Buffer, keyVersion: string): EncryptedCredential {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv, authTag, keyVersion };
}

function decryptPayload(record: StoredOAuthCredentialRecord, key: Buffer): unknown {
  const decipher = createDecipheriv('aes-256-gcm', key, record.iv, { authTagLength: 16 });
  decipher.setAuthTag(record.authTag);
  const plaintext = Buffer.concat([decipher.update(record.ciphertext), decipher.final()]);
  try {
    return JSON.parse(plaintext.toString('utf8')) as unknown;
  } catch {
    throw new Error('Stored OAuth credential payload is invalid');
  }
}

export function createOAuthCredentialVault(options: OAuthCredentialVaultOptions): OAuthCredentialVault {
  const key = assertKey(Buffer.from(options.key));
  const keyVersion = options.keyVersion.trim();
  if (!keyVersion) throw new Error('OAuth credential key version is required');

  async function requireActive(credentialRef: string): Promise<StoredOAuthCredentialRecord> {
    const record = await options.store.getCredentialRecord(credentialRef);
    if (!record) throw new Error('OAuth credential not found');
    if (record.revokedAt) throw new Error('OAuth credential is revoked');
    if (record.keyVersion !== keyVersion) {
      throw new Error(`OAuth credential key version ${record.keyVersion} is not available`);
    }
    return record;
  }

  return {
    async put(projectId, provider, payload) {
      const encrypted = encryptPayload(payload, key, keyVersion);
      const record = await options.store.createCredentialRecord({ projectId, provider, ...encrypted });
      return record.id;
    },

    async get(credentialRef) {
      return decryptPayload(await requireActive(credentialRef), key);
    },

    async replace(credentialRef, payload) {
      await requireActive(credentialRef);
      await options.store.replaceCredentialCiphertext(
        credentialRef,
        encryptPayload(payload, key, keyVersion)
      );
    },

    async revoke(credentialRef) {
      const record = await options.store.getCredentialRecord(credentialRef);
      if (!record) throw new Error('OAuth credential not found');
      if (record.revokedAt) return;
      await options.store.revokeCredentialRecord(credentialRef, new Date());
    }
  };
}
