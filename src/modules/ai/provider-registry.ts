import type { AiProviderName } from './ai.types.js';
import type { AiProvider } from './provider.js';

export class AiProviderRegistry {
  private readonly providers = new Map<AiProviderName, AiProvider>();

  constructor(providers: AiProvider[]) {
    for (const provider of providers) {
      if (this.providers.has(provider.name)) {
        throw new Error(`Duplicate AI provider registration: ${provider.name}`);
      }
      this.providers.set(provider.name, provider);
    }
  }

  get(name: AiProviderName): AiProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(`AI provider is not registered: ${name}`);
    }
    return provider;
  }
}
