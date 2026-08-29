import type { MarketCode, SearchProviderLaneBinding } from '@prisma/client';

export type OfficialSearchBindingProvider =
  | 'GOOGLE_SEARCH_CONSOLE'
  | 'BING_WEBMASTER';

export type CreateSearchProviderLaneBindingInput = {
  projectId: string;
  provider: OfficialSearchBindingProvider;
  propertyRef: string;
  marketCode: MarketCode;
  locale: string;
};

export type SearchProviderLaneBindingIdentity = CreateSearchProviderLaneBindingInput;

export type OfficialSearchBindingRepositoryPort = {
  listBindings(projectId: string): Promise<SearchProviderLaneBinding[]>;
  findBinding(projectId: string, bindingId: string): Promise<SearchProviderLaneBinding | null>;
  findBindingByIdentity(
    input: SearchProviderLaneBindingIdentity,
  ): Promise<SearchProviderLaneBinding | null>;
  createBinding(
    input: CreateSearchProviderLaneBindingInput,
  ): Promise<SearchProviderLaneBinding>;
  setBindingActive(
    projectId: string,
    bindingId: string,
    isActive: boolean,
  ): Promise<SearchProviderLaneBinding | null>;
};
