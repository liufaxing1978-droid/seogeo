export type AiProviderName = 'DEEPSEEK';
export type AiGatewayMode = 'FAST' | 'REASONING';
export type AiGatewayFormat = 'TEXT' | 'JSON';
export type AiMessageRole = 'system' | 'user' | 'assistant';

export interface AiMessage {
  role: AiMessageRole;
  content: string;
}

export interface AiProviderRequest {
  messages: AiMessage[];
  model: string;
  mode: AiGatewayMode;
  responseFormat: AiGatewayFormat;
  maxOutputTokens: number;
  projectUserId?: string;
}

export interface AiProviderUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  reasoningTokens: number | null;
}

export interface AiProviderResponse {
  provider: AiProviderName;
  model: string;
  responseId: string | null;
  content: string;
  finishReason: string | null;
  latencyMs: number;
  usage: AiProviderUsage;
}

export interface AiGatewayRequest {
  messages: AiMessage[];
  mode: AiGatewayMode;
  responseFormat: AiGatewayFormat;
  maxOutputTokens?: number;
  projectUserId?: string;
}
