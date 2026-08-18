import { prisma } from '../../db/prisma.js';
import { geoApiRepository } from './geo.api.repository.js';

export const geoWebRepository = {
  async getOverview(projectId: string) {
    const [summary, opportunities, latestCompletedCrawl] = await Promise.all([
      geoApiRepository.getSummary(projectId),
      geoApiRepository.listOpportunities(projectId),
      prisma.crawlRun.findFirst({
        where: { projectId, status: 'COMPLETED' },
        orderBy: [{ finishedAt: 'desc' }, { createdAt: 'desc' }],
        select: { id: true, finishedAt: true }
      })
    ]);

    const components = new Map(
      (summary?.components ?? []).map((component: any) => [component.componentCode, component])
    );

    return {
      summary,
      opportunities: opportunities.slice(0, 10),
      latestCompletedCrawl,
      dimensions: {
        citability: components.get('CITABILITY') ?? null,
        entity: components.get('ENTITY') ?? null,
        aiCrawler: components.get('AI_CRAWLER') ?? null,
        brand: components.get('BRAND') ?? null,
        contentGeo: components.get('CONTENT_GEO') ?? null
      }
    };
  }
};
