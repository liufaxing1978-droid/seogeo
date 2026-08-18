import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { EvaluatedContentRule } from './content-rules.js';
import type { ContentDocumentRecord, ContentFacts, ContentPageSource } from './content.types.js';

export interface ContentRepository {
  listLatestOwnedPageSources(projectId: string): Promise<ContentPageSource[]>;
  upsertContentDocument(facts: ContentFacts): Promise<ContentDocumentRecord>;
  replaceEvaluation(projectId: string, contentDocumentId: string, rows: EvaluatedContentRule[]): Promise<void>;
}

function stringArray(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

export const contentRepository: ContentRepository = {
  async listLatestOwnedPageSources(projectId) {
    const snapshots = await prisma.pageSnapshot.findMany({
      where: { page: { projectId, isActive: true } },
      include: { page: { select: { id: true, projectId: true, normalizedUrl: true } } },
      orderBy: [{ pageId: 'asc' }, { capturedAt: 'desc' }, { id: 'desc' }]
    });

    const latest = new Map<string, (typeof snapshots)[number]>();
    for (const snapshot of snapshots) if (!latest.has(snapshot.pageId)) latest.set(snapshot.pageId, snapshot);

    return [...latest.values()].map((snapshot) => ({
      projectId: snapshot.page.projectId,
      pageId: snapshot.page.id,
      normalizedUrl: snapshot.page.normalizedUrl,
      snapshotId: snapshot.id,
      statusCode: snapshot.statusCode,
      contentType: snapshot.contentType,
      canonicalUrl: snapshot.canonicalUrl,
      title: snapshot.title,
      metaDescription: snapshot.metaDescription,
      h1: snapshot.h1,
      language: snapshot.language,
      wordCount: snapshot.wordCount,
      h1Count: snapshot.h1Count,
      h2Count: snapshot.h2Count,
      h3Count: snapshot.h3Count,
      imagesCount: snapshot.imagesCount,
      internalLinksCount: snapshot.internalLinksCount,
      externalLinksCount: snapshot.externalLinksCount,
      schemaTypes: [],
      contentHash: snapshot.contentHash,
      capturedAt: snapshot.capturedAt
    }));
  },

  async upsertContentDocument(facts) {
    const data = {
      latestPageSnapshotId: facts.latestPageSnapshotId,
      canonicalUrl: facts.canonicalUrl,
      title: facts.title,
      metaDescription: facts.metaDescription,
      h1: facts.h1,
      language: facts.language,
      wordCount: facts.wordCount,
      paragraphCount: facts.paragraphCount,
      headingCount: facts.headingCount,
      listCount: facts.listCount,
      tableCount: facts.tableCount,
      imageCount: facts.imageCount,
      internalLinkCount: facts.internalLinkCount,
      externalLinkCount: facts.externalLinkCount,
      schemaTypes: facts.schemaTypes as Prisma.InputJsonValue,
      contentHash: facts.contentHash,
      extractedAt: facts.extractedAt
    };

    const stored = await prisma.contentDocument.upsert({
      where: { projectId_pageId: { projectId: facts.projectId, pageId: facts.pageId } },
      create: { projectId: facts.projectId, pageId: facts.pageId, ...data },
      update: data
    });

    return { ...stored, schemaTypes: stringArray(stored.schemaTypes) };
  },

  async replaceEvaluation(projectId, contentDocumentId, rows) {
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      for (const row of rows) {
        await tx.contentSignal.upsert({
          where: {
            contentDocumentId_ruleKey_ruleVersion: {
              contentDocumentId,
              ruleKey: row.ruleKey,
              ruleVersion: row.ruleVersion
            }
          },
          create: {
            projectId,
            contentDocumentId,
            ruleKey: row.ruleKey,
            ruleVersion: row.ruleVersion,
            status: row.status,
            priority: row.priority,
            numericValue: row.numericValue,
            textValue: row.textValue,
            sourceReferences: row.sourceReferences as Prisma.InputJsonValue
          },
          update: {
            status: row.status,
            priority: row.priority,
            numericValue: row.numericValue,
            textValue: row.textValue,
            sourceReferences: row.sourceReferences as Prisma.InputJsonValue
          }
        });

        const existing = await tx.contentOpportunity.findUnique({
          where: {
            contentDocumentId_opportunityKey_opportunityVersion: {
              contentDocumentId,
              opportunityKey: row.opportunityKey,
              opportunityVersion: row.ruleVersion
            }
          }
        });

        if (row.status === 'FAIL') {
          await tx.contentOpportunity.upsert({
            where: {
              contentDocumentId_opportunityKey_opportunityVersion: {
                contentDocumentId,
                opportunityKey: row.opportunityKey,
                opportunityVersion: row.ruleVersion
              }
            },
            create: {
              projectId,
              contentDocumentId,
              opportunityKey: row.opportunityKey,
              opportunityVersion: row.ruleVersion,
              category: row.category,
              priority: row.priority,
              status: 'OPEN',
              summary: row.summary,
              sourceReferences: row.sourceReferences as Prisma.InputJsonValue,
              firstDetectedAt: now,
              lastDetectedAt: now
            },
            update: {
              category: row.category,
              priority: row.priority,
              status: existing?.status === 'VERIFIED_FIXED' ? 'OPEN' : existing?.status ?? 'OPEN',
              summary: row.summary,
              sourceReferences: row.sourceReferences as Prisma.InputJsonValue,
              lastDetectedAt: now,
              verifiedFixedAt: null
            }
          });
        } else if (row.status === 'PASS' && existing && existing.status !== 'IGNORED') {
          await tx.contentOpportunity.update({
            where: { id: existing.id },
            data: { status: 'VERIFIED_FIXED', verifiedFixedAt: now }
          });
        }
      }
    });
  }
};
