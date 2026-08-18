import type { AiProviderName, AiProviderRequest, AiProviderResponse } from './ai.types.js';

export interface AiProvider {
  readonly name: AiProviderName;
  complete(request: AiProviderRequest): Promise<AiProviderResponse>;
}
