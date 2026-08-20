import type {
  GscDailySnapshot,
  OAuthStateNonce,
  SearchConsoleConnection,
  SearchConsoleProperty
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type {
  CompleteGscDailySnapshotInput,
  CreateGscDailySnapshotInput,
  CreateSearchConsoleConnectionInput,
  CreateSearchConsolePropertyInput,
  GscDailyFactInput
} from './search-console.types.js';
import type {
  OAuthCredentialStore,
  StoredOAuthCredentialRecord
} from './oauth-credential-vault.js';

function asPrismaBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy;
}

function asStoredCredential(record: {
  id: string;
  projectId: string;
  provider: 'GOOGLE_SEARCH_CONSOLE';
  ciphertext: Uint8Array;
  iv: Uint8Array;
  authTag: Uint8Array;
  keyVersion: string;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): StoredOAuthCredentialRecord {
  return {
    ...record,
    ciphertext: Buffer.from(record.ciphertext),
    iv: Buffer.from(record.iv),
    authTag: Buffer.from(record.authTag)
  };
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function assertMutableSnapshot(snapshot: Pick<GscDailySnapshot, 'status'>): void {
  if (snapshot.status === 'COMPLETED') {
    throw new Error('COMPLETED GSC daily snapshot is immutable');
  }
  if (snapshot.status === 'FAILED') {
    throw new Error('FAILED GSC daily snapshot cannot be mutated');
  }
}

export type CreateOAuthStateNonceInput = {
  projectId: string;
  actorId: string;
  provider: 'GOOGLE_SEARCH_CONSOLE';
  stateHash: string;
  expiresAt: Date;
};

export class SearchConsoleRepository implements OAuthCredentialStore {
  async createOAuthStateNonce(input: CreateOAuthStateNonceInput): Promise<OAuthStateNonce> {
    return prisma.oAuthStateNonce.create({ data: input });
  }

  async findOAuthStateNonceByHash(stateHash: string): Promise<OAuthStateNonce | null> {
    return prisma.oAuthStateNonce.findUnique({ where: { stateHash } });
  }

  async consumeOAuthStateNonce(stateHash: string, consumedAt = new Date()): Promise<OAuthStateNonce | null> {
    return prisma.$transaction(async (tx) => {
      const nonce = await tx.oAuthStateNonce.findUnique({ where: { stateHash } });
      if (!nonce || nonce.consumedAt || nonce.expiresAt <= consumedAt) return null;
      const claimed = await tx.oAuthStateNonce.updateMany({
        where: { id: nonce.id, consumedAt: null, expiresAt: { gt: consumedAt } },
        data: { consumedAt }
      });
      if (claimed.count !== 1) return null;
      return tx.oAuthStateNonce.findUnique({ where: { id: nonce.id } });
    });
  }

  async createCredentialRecord(
    input: Omit<StoredOAuthCredentialRecord, 'id' | 'createdAt' | 'updatedAt' | 'revokedAt'>
  ): Promise<StoredOAuthCredentialRecord> {
    const record = await prisma.oAuthCredentialRecord.create({
      data: {
        projectId: input.projectId,
        provider: input.provider,
        ciphertext: asPrismaBytes(input.ciphertext),
        iv: asPrismaBytes(input.iv),
        authTag: asPrismaBytes(input.authTag),
        keyVersion: input.keyVersion
      }
    });
    return asStoredCredential(record);
  }

  async getCredentialRecord(id: string): Promise<StoredOAuthCredentialRecord | null> {
    const record = await prisma.oAuthCredentialRecord.findUnique({ where: { id } });
    return record ? asStoredCredential(record) : null;
  }

  async replaceCredentialCiphertext(
    id: string,
    encrypted: Pick<StoredOAuthCredentialRecord, 'ciphertext' | 'iv' | 'authTag' | 'keyVersion'>
  ): Promise<StoredOAuthCredentialRecord> {
    const record = await prisma.oAuthCredentialRecord.update({
      where: { id },
      data: {
        ciphertext: asPrismaBytes(encrypted.ciphertext),
        iv: asPrismaBytes(encrypted.iv),
        authTag: asPrismaBytes(encrypted.authTag),
        keyVersion: encrypted.keyVersion
      }
    });
    return asStoredCredential(record);
  }

  async revokeCredentialRecord(id: string, revokedAt: Date): Promise<StoredOAuthCredentialRecord> {
    const record = await prisma.oAuthCredentialRecord.update({
      where: { id },
      data: { revokedAt }
    });
    return asStoredCredential(record);
  }

  async createConnection(input: CreateSearchConsoleConnectionInput): Promise<SearchConsoleConnection> {
    return prisma.searchConsoleConnection.create({
      data: {
        projectId: input.projectId,
        credentialRef: input.credentialRef,
        googleAccountRef: input.googleAccountRef ?? null,
        status: input.status ?? 'CONNECTED'
      }
    });
  }

  async createProperty(input: CreateSearchConsolePropertyInput): Promise<SearchConsoleProperty> {
    return prisma.searchConsoleProperty.create({
      data: {
        projectId: input.projectId,
        connectionId: input.connectionId,
        propertyUri: input.propertyUri,
        propertyType: input.propertyType,
        permissionState: input.permissionState,
        isActive: input.isActive ?? false
      }
    });
  }

  async createDailySnapshot(input: CreateGscDailySnapshotInput): Promise<GscDailySnapshot> {
    return prisma.gscDailySnapshot.create({
      data: {
        projectId: input.projectId,
        propertyId: input.propertyId,
        date: input.date,
        syncVersion: input.syncVersion,
        status: input.status ?? 'PENDING',
        inputHash: input.inputHash ?? null,
        startedAt: input.startedAt ?? (input.status === 'RUNNING' ? new Date() : null)
      }
    });
  }

  async replaceDailyFacts(snapshotId: string, facts: readonly GscDailyFactInput[]): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const snapshot = await tx.gscDailySnapshot.findUnique({ where: { id: snapshotId } });
      if (!snapshot) throw new Error('GSC daily snapshot not found');
      assertMutableSnapshot(snapshot);

      for (const fact of facts) {
        if (fact.projectId !== snapshot.projectId) {
          throw new Error('GSC fact project does not match snapshot project');
        }
        if (dateKey(fact.date) !== dateKey(snapshot.date)) {
          throw new Error('GSC fact date does not match snapshot date');
        }
      }

      await tx.gscQueryPageFact.deleteMany({ where: { snapshotId } });
      if (facts.length > 0) {
        await tx.gscQueryPageFact.createMany({
          data: facts.map((fact) => ({ ...fact, snapshotId }))
        });
      }
    });
  }

  async completeDailySnapshot(
    snapshotId: string,
    input: CompleteGscDailySnapshotInput
  ): Promise<GscDailySnapshot> {
    return prisma.$transaction(async (tx) => {
      const snapshot = await tx.gscDailySnapshot.findUnique({ where: { id: snapshotId } });
      if (!snapshot) throw new Error('GSC daily snapshot not found');
      assertMutableSnapshot(snapshot);
      const actualRowCount = await tx.gscQueryPageFact.count({ where: { snapshotId } });
      if (actualRowCount !== input.rowCount) {
        throw new Error(`GSC daily row count mismatch: expected ${input.rowCount}, found ${actualRowCount}`);
      }
      return tx.gscDailySnapshot.update({
        where: { id: snapshotId },
        data: {
          status: 'COMPLETED',
          rowCount: input.rowCount,
          sourceCompletenessState: input.sourceCompletenessState,
          sourceFreshness: input.sourceFreshness ?? null,
          inputHash: input.inputHash ?? snapshot.inputHash,
          errorCode: null,
          completedAt: input.completedAt ?? new Date()
        }
      });
    });
  }

  async failDailySnapshot(snapshotId: string, errorCode: string): Promise<GscDailySnapshot> {
    return prisma.$transaction(async (tx) => {
      const snapshot = await tx.gscDailySnapshot.findUnique({ where: { id: snapshotId } });
      if (!snapshot) throw new Error('GSC daily snapshot not found');
      assertMutableSnapshot(snapshot);
      return tx.gscDailySnapshot.update({
        where: { id: snapshotId },
        data: { status: 'FAILED', errorCode, completedAt: null }
      });
    });
  }

  async findAuthoritativeDailySnapshot(
    projectId: string,
    propertyId: string,
    date: Date
  ): Promise<GscDailySnapshot | null> {
    return prisma.gscDailySnapshot.findFirst({
      where: { projectId, propertyId, date, status: 'COMPLETED' },
      orderBy: [{ syncVersion: 'desc' }, { completedAt: 'desc' }, { createdAt: 'desc' }]
    });
  }
}

export const searchConsoleRepository = new SearchConsoleRepository();
