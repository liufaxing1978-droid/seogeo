import { describe, expect, it } from 'vitest';
import {
  createOAuthCredentialVault,
  parseOAuthCredentialKey,
  type OAuthCredentialStore,
  type StoredOAuthCredentialRecord
} from '../../src/modules/search-console/oauth-credential-vault.js';

class MemoryCredentialStore implements OAuthCredentialStore {
  readonly rows = new Map<string, StoredOAuthCredentialRecord>();
  private sequence = 0;

  async createCredentialRecord(input: Omit<StoredOAuthCredentialRecord, 'id' | 'createdAt' | 'updatedAt' | 'revokedAt'>) {
    const now = new Date();
    const row: StoredOAuthCredentialRecord = {
      id: `credential-${++this.sequence}`,
      ...input,
      revokedAt: null,
      createdAt: now,
      updatedAt: now
    };
    this.rows.set(row.id, row);
    return row;
  }

  async getCredentialRecord(id: string) {
    return this.rows.get(id) ?? null;
  }

  async replaceCredentialCiphertext(
    id: string,
    encrypted: Pick<StoredOAuthCredentialRecord, 'ciphertext' | 'iv' | 'authTag' | 'keyVersion'>
  ) {
    const row = this.rows.get(id);
    if (!row) throw new Error('credential not found');
    const next = { ...row, ...encrypted, updatedAt: new Date() };
    this.rows.set(id, next);
    return next;
  }

  async revokeCredentialRecord(id: string, revokedAt: Date) {
    const row = this.rows.get(id);
    if (!row) throw new Error('credential not found');
    const next = { ...row, revokedAt, updatedAt: revokedAt };
    this.rows.set(id, next);
    return next;
  }
}

describe('P7-A Search Console OAuth credential vault', () => {
  it('round-trips credential JSON without storing plaintext', async () => {
    const store = new MemoryCredentialStore();
    const vault = createOAuthCredentialVault({
      key: Buffer.alloc(32, 7),
      keyVersion: 'v1',
      store
    });

    const ref = await vault.put('00000000-0000-0000-0000-000000000001', 'GOOGLE_SEARCH_CONSOLE', {
      access_token: 'secret-access-token',
      refresh_token: 'secret-refresh-token',
      expires_in: 3600
    });

    const stored = store.rows.get(ref);
    expect(stored).toBeDefined();
    expect(stored?.ciphertext.toString('utf8')).not.toContain('secret-access-token');
    expect(stored?.ciphertext.toString('utf8')).not.toContain('secret-refresh-token');
    expect(stored?.iv).toHaveLength(12);
    expect(stored?.authTag).toHaveLength(16);
    expect(await vault.get(ref)).toEqual({
      access_token: 'secret-access-token',
      refresh_token: 'secret-refresh-token',
      expires_in: 3600
    });
  });

  it('replaces encrypted material without changing the opaque reference', async () => {
    const store = new MemoryCredentialStore();
    const vault = createOAuthCredentialVault({ key: Buffer.alloc(32, 9), keyVersion: 'v1', store });
    const ref = await vault.put('00000000-0000-0000-0000-000000000002', 'GOOGLE_SEARCH_CONSOLE', {
      access_token: 'old-token'
    });

    await vault.replace(ref, { access_token: 'new-token', refresh_token: 'refresh-token' });

    expect(await vault.get(ref)).toEqual({ access_token: 'new-token', refresh_token: 'refresh-token' });
    expect(store.rows.get(ref)?.ciphertext.toString('utf8')).not.toContain('new-token');
  });

  it('refuses reads and replacements after revocation', async () => {
    const store = new MemoryCredentialStore();
    const vault = createOAuthCredentialVault({ key: Buffer.alloc(32, 11), keyVersion: 'v1', store });
    const ref = await vault.put('00000000-0000-0000-0000-000000000003', 'GOOGLE_SEARCH_CONSOLE', {
      access_token: 'revoked-token'
    });

    await vault.revoke(ref);

    await expect(vault.get(ref)).rejects.toThrow(/revoked/i);
    await expect(vault.replace(ref, { access_token: 'should-not-write' })).rejects.toThrow(/revoked/i);
  });

  it('fails closed when the encryption key is missing or invalid', () => {
    expect(() => parseOAuthCredentialKey(undefined)).toThrow(/32 bytes/i);
    expect(() => parseOAuthCredentialKey('short')).toThrow(/32 bytes/i);
    expect(parseOAuthCredentialKey(Buffer.alloc(32, 3).toString('base64'))).toHaveLength(32);
    expect(parseOAuthCredentialKey(Buffer.alloc(32, 4).toString('hex'))).toHaveLength(32);
  });
});
