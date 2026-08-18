import { Prisma } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type { ContentDocumentRecord, ContentFacts, ContentPageSource } from './content.types.js';

export interface ContentRepository {
  listLatestOwnedPageSources(projectId: string): Promise<ContentPageSource[]>;
  upsertContentDocument(facts: ContentFacts): Promise<ContentDocumentRecord>;
}

export const contentRepository: ContentRepository = {
  async listLatestOwnedPageSources(projectId) {
    const snapshots = await prisma.pageSnapshot.findMany({
      where: {
        page: {
          projectId,
          isActive: true
        }
      },
      include: {
        page: {
          select: {
            id: true,
            projectId: true,
            normalizedUrl: true
          }
        }
      },
      orderBy: [{ pageId: 'asc' }, { capturedAt: 'desc' }, { id: 'desc' }]
    });

    const latest = new Map<string, (typeof snapshots)[number]>();
    for (const snapshot of snapshots) {
      if (!latest.has(snapshot.pageId)) latest.set(snapshot.pageId, snapshot);
    }

    return [...latest.values()].map((snapshot) => ({
      projectId: snapshot.page.projectId,
      pageId: snapshot.page.id,
      normalizedUrl: snapshot.page.normalizedUrl,
      snapshotId: snapshot.id,
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

    return prisma.contentDocument.upsert({
      where: {
        projectId_pageId: {
          projectId: facts.projectId,
          pageId: facts.pageId
        }
      },
      create: {
        projectId: facts.projectId,
        pageId: facts.pageId,
        ...data
      },
      update: data
    });
  }
};
