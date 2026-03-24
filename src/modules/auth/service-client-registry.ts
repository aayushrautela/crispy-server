import { timingSafeEqual } from 'node:crypto';
import type { AuthScope } from './auth.types.js';
import { isAuthScope } from './auth.types.js';

export type ServiceClientStatus = 'active' | 'disabled';

export type ServiceClientConfig = {
  serviceId: string;
  apiKey: string;
  scopes: AuthScope[];
  description: string | null;
  status: ServiceClientStatus;
};

export class ServiceClientRegistry {
  private readonly clientsByServiceId: Map<string, ServiceClientConfig>;

  constructor(clients: ServiceClientConfig[]) {
    this.clientsByServiceId = new Map(clients.map((client) => [client.serviceId, client]));
  }

  lookup(serviceId: string): ServiceClientConfig | null {
    const normalized = normalizeRequiredString(serviceId);
    if (!normalized) {
      return null;
    }

    return this.clientsByServiceId.get(normalized) ?? null;
  }

  authenticate(serviceId: string, apiKey: string): ServiceClientConfig | null {
    const client = this.lookup(serviceId);
    const normalizedApiKey = normalizeRequiredString(apiKey);
    if (!client || client.status !== 'active' || !normalizedApiKey) {
      return null;
    }

    return safeEqual(normalizedApiKey, client.apiKey) ? client : null;
  }
}

export function parseServiceClientRegistryConfig(raw: string): ServiceClientConfig[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid SERVICE_CLIENTS_JSON: expected valid JSON.');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Invalid SERVICE_CLIENTS_JSON: expected an array of service clients.');
  }

  const clients: ServiceClientConfig[] = [];
  const seen = new Set<string>();

  for (const entry of parsed) {
    if (!isRecord(entry)) {
      throw new Error('Invalid SERVICE_CLIENTS_JSON: each client must be an object.');
    }

    const serviceId = normalizeRequiredString(entry.serviceId);
    if (!serviceId) {
      throw new Error('Invalid SERVICE_CLIENTS_JSON: serviceId is required.');
    }

    if (seen.has(serviceId)) {
      throw new Error(`Invalid SERVICE_CLIENTS_JSON: duplicate serviceId '${serviceId}'.`);
    }

    const apiKey = normalizeRequiredString(entry.apiKey);
    if (!apiKey) {
      throw new Error(`Invalid SERVICE_CLIENTS_JSON: apiKey is required for '${serviceId}'.`);
    }

    const rawScopes = Array.isArray(entry.scopes)
      ? entry.scopes
      : Array.isArray(entry.allowedScopes)
        ? entry.allowedScopes
        : null;
    if (!rawScopes?.length) {
      throw new Error(`Invalid SERVICE_CLIENTS_JSON: scopes are required for '${serviceId}'.`);
    }

    const invalidScope = rawScopes.find((scope) => !isAuthScope(scope));
    if (invalidScope !== undefined) {
      throw new Error(`Invalid SERVICE_CLIENTS_JSON: unsupported scope '${String(invalidScope)}' for '${serviceId}'.`);
    }

    const status = normalizeStatus(entry.status);
    if (!status) {
      throw new Error(`Invalid SERVICE_CLIENTS_JSON: unsupported status for '${serviceId}'.`);
    }

    clients.push({
      serviceId,
      apiKey,
      scopes: Array.from(new Set(rawScopes)) as AuthScope[],
      description: normalizeOptionalString(entry.description),
      status,
    });
    seen.add(serviceId);
  }

  return clients;
}

function normalizeStatus(value: unknown): ServiceClientStatus | null {
  if (value === undefined || value === null || value === '') {
    return 'active';
  }

  return value === 'active' || value === 'disabled' ? value : null;
}

function normalizeRequiredString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
