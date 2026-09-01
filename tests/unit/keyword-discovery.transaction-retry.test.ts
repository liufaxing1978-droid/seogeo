import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { KeywordDiscoveryRepository } from '../../src/modules/keywords/keyword-discovery.repository.js';

describe('KeywordDiscoveryRepository transaction retry', () => {
  it('restarts the whole transaction after a unique-key race aborts PostgreSQL', async () => {
    let attempt = 0;
    const transaction = vi.fn(async (work: (tx: object) => Promise<string>) => {
      attempt += 1;
      if (attempt === 1) {
        throw new Prisma.PrismaClientKnownRequestError('unique-key race', {
          code: 'P2002',
          clientVersion: '6.19.3',
        });
      }
      return work({});
    });
    const repository = new KeywordDiscoveryRepository({ $transaction: transaction } as never);

    await expect(repository.withSerializableTransaction(async () => 'accepted')).resolves.toBe('accepted');
    expect(transaction).toHaveBeenCalledTimes(2);
  });
});
