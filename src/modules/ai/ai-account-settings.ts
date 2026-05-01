import { BYOK_OPENROUTER_PROVIDER_ID, listPublicAiProviders } from '../../config/app-config.js';
import type { AiClientSettings } from './ai.types.js';

export function getAiProviderIdFromSettings(_settings: Record<string, unknown>): string {
  return BYOK_OPENROUTER_PROVIDER_ID;
}

export function buildAiClientSettings(_settings: Record<string, unknown>, hasAiApiKey: boolean): AiClientSettings {
  return {
    hasAiApiKey,
    // Deprecated compatibility fields. BYOK is always OpenRouter and clients should not persist provider selection.
    providerId: BYOK_OPENROUTER_PROVIDER_ID,
    defaultProviderId: BYOK_OPENROUTER_PROVIDER_ID,
    providers: listPublicAiProviders(),
  };
}
