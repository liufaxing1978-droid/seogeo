import type { AiGatewayConfig } from './ai.config.js';
import type { AiGatewayRequest, AiProviderResponse } from './ai.types.js';
import { AiProviderRegistry } from './provider-registry.js';

export class AiGateway {
  constructor(
    private readonly providers: AiProviderRegistry,
    private readonly config: AiGatewayConfig
  ) {}

  async complete(request: AiGatewayRequest): Promise<AiProviderResponse> {
    const model = request.mode === 'REASONING' ? this.config.reasoningModel : this.config.fastModel;
    const maxOutputTokens = request.maxOutputTokens ?? this.config.maxOutputTokens;

    if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > this.config.maxOutputTokens) {
      throw new Error(`AI max output tokens must be between 1 and ${this.config.maxOutputTokens}`);
    }

    const inputChars = request.messages.reduce((sum, message) => sum + message.content.length, 0);
    if (inputChars > this.config.maxInputChars) {
      throw new Error(`AI input exceeds configured character limit: ${this.config.maxInputChars}`);
    }

    return this.providers.get('DEEPSEEK').complete({
      messages: request.messages,
      model,
      mode: request.mode,
      responseFormat: request.responseFormat,
      maxOutputTokens,
      ...(request.projectUserId ? { projectUserId: request.projectUserId } : {})
    });
  }
}
