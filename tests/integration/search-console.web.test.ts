import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';

const projectIds: string[] = [];

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

async function project(label: string) {
  const suffix = `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const value = await prisma.project.create({
    data: {
      name: `P7-A GSC Web ${label}`,
      slug: `p7a-gsc-web-${suffix}`,
      primaryDomain: `p7a-gsc-web-${suffix}.example.com`,
      planLevel: 'STANDARD'
    }
  });
  projectIds.push(value.id);
  return value;
}

async function connectReady(projectId: string, domain: string) {
  const credential = await prisma.oAuthCredentialRecord.create({
    data: {
      projectId,
      provider: 'GOOGLE_SEARCH_CONSOLE',
      ciphertext: Buffer.from('ACCESS_TOKEN_SHOULD_NEVER_RENDER'),
      iv: Buffer.alloc(12, 1),
      authTag: Buffer.alloc(16, 2),
      keyVersion: 'test-v1'
    }
  });
  const connection = await prisma.searchConsoleConnection.create({
    data: {
      projectId,
      credentialRef: credential.id,
      status: 'CONNECTED',
      lastVerifiedAt: new Date('2026-08-18T00:00:00.000Z')
    }
  });
  const property = await prisma.searchConsoleProperty.create({
    data: {
      projectId,
      connectionId: connection.id,
      propertyUri: `sc-domain:${domain}`,
      propertyType: 'DOMAIN',
      permissionState: 'siteOwner',
      isActive: true,
      lastSyncAt: new Date('2026-08-17T04:00:00.000Z')
    }
  });

  const firstDate = new Date('2026-06-23T00:00:00.000Z');
  for (let index = 0; index < 56; index += 1) {
    const date = addDays(firstDate, index);
    await prisma.gscDailySnapshot.create({
      data: {
        projectId,
        propertyId: property.id,
        date,
        status: 'COMPLETED',
        syncVersion: 1,
        rowCount: 10,
        sourceFreshness: new Date(date.getTime() + 12 * 60 * 60 * 1000),
        sourceCompletenessState: 'TOP_ROWS_ONLY',
        completedAt: new Date(date.getTime() + 13 * 60 * 60 * 1000)
      }
    });
  }
  return { credential, connection, property };
}

describe('P7-A Search Console settings web UI', () => {
  afterAll(async () => {
    for (const projectId of projectIds) {
      await prisma.gscQueryPageFact.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.gscDailySnapshot.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.searchConsoleProperty.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.searchConsoleConnection.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.oAuthCredentialRecord.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    }
  });

  it('renders a read-only READY connection with freshness and 56-day coverage without credential material', async () => {
    const p = await project('ready');
    const { credential, property } = await connectReady(p.id, p.primaryDomain);

    const response = await request(createApp()).get(`/projects/${p.id}/search-console`).expect(200);

    expect(response.text).toContain('Google Search Console');
    expect(response.text).toContain('只读');
    expect(response.text).toContain('READY');
    expect(response.text).toContain(property.propertyUri);
    expect(response.text).toContain('数据覆盖');
    expect(response.text).toContain('56 / 56');
    expect(response.text).toContain('新鲜度');
    expect(response.text).toContain('TOP_ROWS_ONLY');
    expect(response.text).not.toContain('ACCESS_TOKEN_SHOULD_NEVER_RENDER');
    expect(response.text).not.toContain(credential.id);
    expect(response.text).not.toContain('ciphertext');
    expect(response.text).not.toContain('refresh_token');
  });

  it('renders NOT_CONNECTED without touching OAuth configuration', async () => {
    const p = await project('empty');
    const response = await request(createApp()).get(`/projects/${p.id}/search-console`).expect(200);
    expect(response.text).toContain('NOT_CONNECTED');
    expect(response.text).toContain('连接 Google Search Console');
    expect(response.text).toContain('只读');
  });
});