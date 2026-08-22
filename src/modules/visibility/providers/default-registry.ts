import { AnthropicVisibilityProvider } from './anthropic.provider.js';
import { BaiduQianfanVisibilityProvider } from './baidu-qianfan.provider.js';
import { DeepSeekVisibilityProvider } from './deepseek.provider.js';
import { GeminiVisibilityProvider } from './gemini.provider.js';
import { MicrosoftVisibilityProvider } from './microsoft.provider.js';
import { OpenAIVisibilityProvider } from './openai.provider.js';
import { PerplexityVisibilityProvider } from './perplexity.provider.js';
import { QwenVisibilityProvider } from './qwen.provider.js';
import { TencentHunyuanVisibilityProvider } from './tencent-hunyuan.provider.js';
import { VisibilityProviderRegistry } from './provider-registry.js';

export interface DefaultVisibilityProviderRegistryOptions {
  openAiApiKey?: string;
  geminiApiKey?: string;
  perplexityApiKey?: string;
  anthropicApiKey?: string;
  microsoftWorkIqAccessToken?: string;
  baiduQianfanApiKey?: string;
  dashscopeApiKey?: string;
  tencentTokenHubApiKey?: string;
}

export function createDefaultVisibilityProviderRegistry(
  options: DefaultVisibilityProviderRegistryOptions = {}
) {
  return new VisibilityProviderRegistry([
    new OpenAIVisibilityProvider({ apiKey: options.openAiApiKey }),
    new GeminiVisibilityProvider({ apiKey: options.geminiApiKey }),
    new PerplexityVisibilityProvider({ apiKey: options.perplexityApiKey }),
    new AnthropicVisibilityProvider({ apiKey: options.anthropicApiKey }),
    new DeepSeekVisibilityProvider(),
    new MicrosoftVisibilityProvider({ accessToken: options.microsoftWorkIqAccessToken }),
    new BaiduQianfanVisibilityProvider({ apiKey: options.baiduQianfanApiKey }),
    new QwenVisibilityProvider({ apiKey: options.dashscopeApiKey }),
    new TencentHunyuanVisibilityProvider({ apiKey: options.tencentTokenHubApiKey })
  ]);
}

export const defaultVisibilityProviderRegistry = createDefaultVisibilityProviderRegistry();
