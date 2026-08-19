import { prisma } from '../../db/prisma.js';

export class VisibilityRepository {
  async claimPendingObservation(observationId: string): Promise<boolean> {
    const result = await prisma.platformObservation.updateMany({
      where: {
        id: observationId,
        status: 'PENDING'
      },
      data: {
        status: 'RUNNING'
      }
    });
    return result.count === 1;
  }
}

export const visibilityRepository = new VisibilityRepository();
