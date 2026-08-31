import type {
  PrismaClient,
  SearchProviderLaneBinding,
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import type {
  CreateSearchProviderLaneBindingInput,
  OfficialSearchBindingProvider,
  OfficialSearchBindingRepositoryPort,
  SearchProviderLaneBindingIdentity,
} from './official-search-sync.types.js';

const SUPPORTED_PROVIDERS = new Set<OfficialSearchBindingProvider>([
  'GOOGLE_SEARCH_CONSOLE',
  'BING_WEBMASTER',
]);

function isPrismaUniqueConflict(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'P2002';
}

function normalizeIdentity(
  input: CreateSearchProviderLaneBindingInput,
): CreateSearchProviderLaneBindingInput {
  if (!SUPPORTED_PROVIDERS.has(input.provider)) {
    throw new Error('OFFICIAL_SEARCH_BINDING_PROVIDER_UNSUPPORTED');
  }

  const projectId = input.projectId.trim();
  const propertyRef = input.propertyRef.trim();
  const locale = input.locale.trim();
  if (
    projectId.length === 0
    || propertyRef.length === 0
    || propertyRef.length > 2048
    || locale.length === 0
    || locale.length > 64
  ) {
    throw new Error('OFFICIAL_SEARCH_BINDING_IDENTITY_INVALID');
  }

  return {
    ...input,
    projectId,
    propertyRef,
    locale,
  };
}

export class OfficialSearchSyncRepository
implements OfficialSearchBindingRepositoryPort {
  constructor(private readonly db: PrismaClient = prisma) {}

  listBindings(projectId: string): Promise<SearchProviderLaneBinding[]> {
    return this.db.searchProviderLaneBinding.findMany({
      where: { projectId },
      orderBy: [
        { provider: 'asc' },
        { marketCode: 'asc' },
        { locale: 'asc' },
        { propertyRef: 'asc' },
        { id: 'asc' },
      ],
    });
  }

  findBinding(
    projectId: string,
    bindingId: string,
  ): Promise<SearchProviderLaneBinding | null> {
    return this.db.searchProviderLaneBinding.findFirst({
      where: { id: bindingId, projectId },
    });
  }

  findBindingByIdentity(
    input: SearchProviderLaneBindingIdentity,
  ): Promise<SearchProviderLaneBinding | null> {
    const normalized = normalizeIdentity(input);
    return this.db.searchProviderLaneBinding.findFirst({
      where: {
        projectId: normalized.projectId,
        provider: normalized.provider,
        propertyRef: normalized.propertyRef,
        marketCode: normalized.marketCode,
        locale: normalized.locale,
      },
    });
  }

  async createBinding(
    input: CreateSearchProviderLaneBindingInput,
  ): Promise<SearchProviderLaneBinding> {
    const normalized = normalizeIdentity(input);
    try {
      return await this.db.searchProviderLaneBinding.create({
        data: normalized,
      });
    } catch (error) {
      if (!isPrismaUniqueConflict(error)) throw error;
      const existing = await this.findBindingByIdentity(normalized);
      if (!existing) throw error;
      return existing;
    }
  }

  async setBindingActive(
    projectId: string,
    bindingId: string,
    isActive: boolean,
  ): Promise<SearchProviderLaneBinding | null> {
    const result = await this.db.searchProviderLaneBinding.updateMany({
      where: { id: bindingId, projectId },
      data: { isActive },
    });
    if (result.count === 0) return null;
    return this.findBinding(projectId, bindingId);
  }
}

export const officialSearchSyncRepository = new OfficialSearchSyncRepository();
