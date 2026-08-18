import type { AiProviderName, AiProviderRequest, AiProviderResponse } from './ai.types.js';

export type AiProviderErrorCode =
  | 'INVALID_REQUEST'
  | 'AUTH'
  | 'BALANCE'
  | 'RATE_LIMIT'
  | 'UPSTREAM'
  | 'OVERLOADED'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'INVALID_RESPONSE'
  | 'EMPTY_RESPONSE';

export class AiProviderError extends Error {
  readonly name = 'AiProviderError';

  constructor(
    message: string,
    public readonly code: AiProviderErrorCode,
    public readonly provider: AiProviderName,
    public readonly retryable: boolean,
    public readonly httpStatus: number | null = null
  ) {
    super(message);
  }
}

export interface AiProvider {
  readonly name: AiProviderName;
  complete(request: AiProviderRequest): Promise<AiProviderResponse>;
}
