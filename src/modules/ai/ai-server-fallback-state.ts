import { appConfig } from '../../config/app-config.js';

type CooldownBucket = 'transient' | 'rate_limit';

type ModelState = {
  blockedUntil: number;
  transientFailures: number;
  rateLimitFailures: number;
  lastFailureAt: number;
};

type ProviderState = {
  blockedUntil: number;
};

const modelStates = new Map<string, ModelState>();
const providerStates = new Map<string, ProviderState>();

export function isServerProviderBlocked(providerId: string, now = Date.now()): boolean {
  const state = providerStates.get(providerId);
  return Boolean(state && state.blockedUntil > now);
}

export function isServerModelBlocked(providerId: string, model: string, now = Date.now()): boolean {
  const state = modelStates.get(toModelKey(providerId, model));
  return Boolean(state && state.blockedUntil > now);
}

export function getHealthyServerModels(models: string[], providerId: string, now = Date.now()): string[] {
  return models.filter((model) => !isServerModelBlocked(providerId, model, now));
}

export function recordServerModelTransientFailure(providerId: string, model: string, now = Date.now()): void {
  const key = toModelKey(providerId, model);
  const current = modelStates.get(key);
  const failureCount = (current?.transientFailures ?? 0) + 1;
  const cooldownSeconds = selectCooldown(appConfig.ai.serverFallback.transientCooldownSeconds, failureCount);

  modelStates.set(key, {
    blockedUntil: now + (cooldownSeconds * 1000),
    transientFailures: failureCount,
    rateLimitFailures: current?.rateLimitFailures ?? 0,
    lastFailureAt: now,
  });
}

export function recordServerModelRateLimit(
  providerId: string,
  model: string,
  retryAfterSeconds?: number,
  now = Date.now(),
): void {
  const key = toModelKey(providerId, model);
  const current = modelStates.get(key);
  const failureCount = (current?.rateLimitFailures ?? 0) + 1;
  const cooldownSeconds = retryAfterSeconds && retryAfterSeconds > 0
    ? retryAfterSeconds
    : selectCooldown(appConfig.ai.serverFallback.rateLimitCooldownSeconds, failureCount);

  modelStates.set(key, {
    blockedUntil: now + (cooldownSeconds * 1000),
    transientFailures: current?.transientFailures ?? 0,
    rateLimitFailures: failureCount,
    lastFailureAt: now,
  });
}

export function clearServerModelFailure(providerId: string, model: string): void {
  modelStates.delete(toModelKey(providerId, model));
}

export function blockServerProvider(providerId: string, now = Date.now()): void {
  providerStates.set(providerId, {
    blockedUntil: now + (appConfig.ai.serverFallback.providerBlockSeconds * 1000),
  });
}

export function clearServerProviderBlock(providerId: string): void {
  providerStates.delete(providerId);
}

export function resetServerFallbackState(): void {
  modelStates.clear();
  providerStates.clear();
}

function toModelKey(providerId: string, model: string): string {
  return `${providerId}:${model}`;
}

function selectCooldown(cooldowns: number[], failures: number): number {
  const index = Math.min(Math.max(failures - 1, 0), cooldowns.length - 1);
  return cooldowns[index] ?? cooldowns[cooldowns.length - 1] ?? 60;
}
