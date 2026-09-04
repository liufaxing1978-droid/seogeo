import { prisma } from '../../db/prisma.js';

export interface WebPagination {
  limit: number;
  offset: number;
}

export class CrawlerWebRepository {
  async getProjectCrawlerHealthAndSubmissions(projectId: string) {
    const [latestHealth, submissions] = await Promise.all([
      prisma.crawlerHealthSnapshot.findFirst({
        where: { projectId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          crawlRunId: true,
          status: true,
          calculationVersion: true,
          createdAt: true
        }
      }),
      prisma.indexNowSubmissionBatch.findMany({
        where: { projectId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 20,
        select: {
          id: true,
          status: true,
          attemptCount: true,
          responseStatusCode: true,
          errorCode: true,
          createdAt: true,
          urls: {
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: { url: true, status: true, errorCode: true }
          }
        }
      })
    ]);
    return { latestHealth, submissions };
  }

  async listProjectPages(projectId: string, pagination: WebPagination) {
    const where = { projectId, isActive: true };
    const [pages, total] = await Promise.all([
      prisma.page.findMany({
        where,
        orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
        skip: pagination.offset,
        take: pagination.limit,
        include: {
          snapshots: {
            orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }],
            take: 1,
            select: {
              statusCode: true,
              title: true,
              indexable: true,
              capturedAt: true,
              rendered: true,
              httpResult: { select: { fetchError: true } }
            }
          }
        }
      }),
      prisma.page.count({ where })
    ]);

    return {
      data: pages.map((page) => {
        const latest = page.snapshots[0] ?? null;
        return {
          id: page.id,
          url: page.normalizedUrl,
          path: page.path,
          firstSeenAt: page.firstSeenAt,
          lastSeenAt: page.lastSeenAt,
          statusCode: latest?.statusCode ?? null,
          title: latest?.title ?? null,
          indexable: latest?.indexable ?? null,
          rendered: latest?.rendered ?? false,
          fetchError: latest?.httpResult?.fetchError ?? null,
          latestCapturedAt: latest?.capturedAt ?? null
        };
      }),
      total
    };
  }

  async getPageDetail(pageId: string) {
    return prisma.page.findUnique({
      where: { id: pageId },
      include: {
        project: {
          select: { id: true, name: true, primaryDomain: true }
        },
        snapshots: {
          orderBy: [{ capturedAt: 'desc' }, { id: 'desc' }],
          take: 100,
          include: {
            crawlRun: {
              select: { id: true, runType: true, status: true, createdAt: true }
            },
            httpResult: {
              select: {
                requestUrl: true,
                finalUrl: true,
                statusCode: true,
                responseBytes: true,
                latencyMs: true,
                fetchError: true
              }
            },
            renderResult: {
              select: {
                attempted: true,
                succeeded: true,
                reason: true,
                renderTimeMs: true,
                browserVersion: true
              }
            }
          }
        }
      }
    });
  }
}

export const crawlerWebRepository = new CrawlerWebRepository();
