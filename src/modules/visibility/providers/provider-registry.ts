import type {
  VisibilityChannel,
  VisibilityProvider
} from '@prisma/client';
import {
  VisibilityProviderError,
  type VisibilityProviderAdapter
} from './provider.js';

function registryKey(provider: VisibilityProvider, channel: VisibilityChannel) {
  return `${provider}:${channel}`;
}

export class VisibilityProviderRegistry {
  private readonly adapters = new Map<string, VisibilityProviderAdapter>();

  constructor(adapters: readonly VisibilityProviderAdapter[]) {
    for (const adapter of adapters) {
      const key = registryKey(adapter.provider, adapter.channel);
      if (this.adapters.has(key)) {
        throw new VisibilityProviderError(
          'VISIBILITY_PROVIDER_DUPLICATE_ADAPTER',
          `Duplicate visibility adapter for ${adapter.provider}/${adapter.channel}`
        );
      }
      this.adapters.set(key, adapter);
    }
  }

  get(
    provider: VisibilityProvider,
    model: string,
    channel: VisibilityChannel
  ): VisibilityProviderAdapter {
    const adapter = this.adapters.get(registryKey(provider, channel));
    if (!adapter) {
      throw new VisibilityProviderError(
        'VISIBILITY_PROVIDER_UNAVAILABLE',
        `Visibility provider adapter is unavailable for ${provider}/${channel}/${model}`
      );
    }
    return adapter;
  }

  list(): readonly VisibilityProviderAdapter[] {
    return [...this.adapters.values()];
  }
}
