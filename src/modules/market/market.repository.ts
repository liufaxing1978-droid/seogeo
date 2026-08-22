import { prisma } from '../../db/prisma.js';
import type { MarketCode, MarketWriteInput } from './market.types.js';

export interface MarketRepository {
  findProjectIdentity(projectId: string): Promise<{
    id: string;
    targetCountry: string;
    defaultLanguage: string;
  } | null>;
  listExplicitMarkets(projectId: string): Promise<MarketWriteInput[]>;
  replaceExplicitMarkets(projectId: string, markets: MarketWriteInput[]): Promise<void>;
}

export class PrismaMarketRepository implements MarketRepository {
  async findProjectIdentity(projectId: string) {
    return prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        targetCountry: true,
        defaultLanguage: true
      }
    });
  }

  async listExplicitMarkets(projectId: string): Promise<MarketWriteInput[]> {
    const rows = await prisma.projectMarket.findMany({
      where: { projectId },
      select: {
        marketCode: true,
        locale: true,
        enabled: true
      }
    });

    return rows.map((row) => ({
      marketCode: row.marketCode as MarketCode,
      locale: row.locale,
      enabled: row.enabled
    }));
  }

  async replaceExplicitMarkets(projectId: string, markets: MarketWriteInput[]): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.project.findUniqueOrThrow({
        where: { id: projectId },
        select: { id: true }
      });
      await tx.projectMarket.deleteMany({ where: { projectId } });
      if (markets.length > 0) {
        await tx.projectMarket.createMany({
          data: markets.map((market) => ({
            projectId,
            marketCode: market.marketCode,
            locale: market.locale,
            enabled: market.enabled
          }))
        });
      }
    });
  }
}

export const marketRepository: MarketRepository = new PrismaMarketRepository();
