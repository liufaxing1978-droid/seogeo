import { prisma } from '../../db/prisma.js';
import type {
  CoveragePageFact,
  KeywordCoverageEmptyReason,
} from './keyword.types.js';

export interface ActiveKeywordCoverageFacts {
  usablePages: CoveragePageFact[];
  emptyReason?: KeywordCoverageEmptyReason;
}

export class KeywordCoverageRepository {
  async listActivePageFacts(projectId: string): Promise<ActiveKeywordCoverageFacts> {
    const pages = await prisma.page.findMany({
      where: { projectId, isActive: true },
      select: {
        id: true,
        url: true,
        path: true,
        snapshots: {
          orderBy: { capturedAt: 'desc' },
          take: 1,
          select: {
            title: true,
            h1: true,
            metaDescription: true,
            statusCode: true,
            indexable: true,
          },
        },
      },
      orderBy: { normalizedUrl: 'asc' },
    });

    if (pages.length === 0) {
      return {
        usablePages: [],
        emptyReason: 'NO_ACTIVE_PAGE_EVIDENCE',
      };
    }

    const usablePages = pages.flatMap<CoveragePageFact>((page) => {
      const snapshot = page.snapshots[0];
      const usable = snapshot
        && snapshot.statusCode !== null
        && snapshot.statusCode >= 200
        && snapshot.statusCode < 300
        && snapshot.indexable !== false;

      if (!usable || !snapshot) return [];

      return [{
        pageId: page.id,
        url: page.url,
        path: page.path,
        title: snapshot.title,
        h1: snapshot.h1,
        metaDescription: snapshot.metaDescription,
      }];
    });

    if (usablePages.length === 0) {
      return {
        usablePages: [],
        emptyReason: 'NO_USABLE_SNAPSHOT_EVIDENCE',
      };
    }

    return { usablePages };
  }
}
