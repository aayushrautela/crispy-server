import { appConfig, listPublicAiProviders, normalizeAiProviderId } from '../../config/app-config.js';
import type { AiClientSettings } from './ai.types.js';

export function getAiProviderIdFromSettings(settings: Record<string, unknown>): string {
  const aiSettings = isRecord(settings.ai) ? settings.ai : null;
  const providerId = typeof aiSettings?.providerId === 'string' ? aiSettings.providerId : '';
  return normalizeAiProviderId(providerId);
}

export function buildAiClientSettings(settings: Record<string, unknown>, hasAiApiKey: boolean): AiClientSettings {
  return {
    hasAiApiKey,
    providerId: getAiProviderIdFromSettings(settings),
    defaultProviderId: appConfig.ai.defaultProviderId,
    providers: listPublicAiProviders(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
