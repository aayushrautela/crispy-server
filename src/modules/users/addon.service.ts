import { withTransaction, type DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import {
  AddonRepository,
  ADDON_TYPES,
  type AddonPayload,
  type AddonRecord,
  type AddonType,
} from './addon.repo.js';

export type { AddonPayload, AddonType };

export type Addon = {
  id: string;
  accountId: string;
  type: AddonType;
  manifestUrl: string;
  payload: AddonPayload;
  createdAt: string;
};

export type AddonListItem = {
  id: string;
  type: AddonType;
  manifestUrl: string;
  payload: AddonPayload;
  createdAt: string;
};

export type AddonCreateInput = {
  type?: unknown;
  manifestUrl: unknown;
  payload?: unknown;
};

type TransactionRunner = <T>(work: (client: DbClient) => Promise<T>) => Promise<T>;

export class AddonService {
  constructor(
    private readonly addonRepository = new AddonRepository(),
    private readonly runInTransaction: TransactionRunner = withTransaction,
  ) {}

  async listAddons(accountId: string): Promise<{ addons: AddonListItem[] }> {
    return this.runInTransaction(async (client) => {
      const rows = await this.addonRepository.listForAccount(client, accountId);
      return {
        addons: rows.map((row) => toAddonListItem(row)),
      };
    });
  }

  async addAddon(accountId: string, input: AddonCreateInput): Promise<Addon> {
    const addonType = normalizeAddonType(input.type);
    const normalizedUrl = normalizeManifestUrl(input.manifestUrl);
    const payload = normalizePayload(addonType, input.payload);
    const providerId = addonType === 'jsplugin' ? payload.providerId ?? null : null;

    return this.runInTransaction(async (client) => {
      const existing = await this.addonRepository.findByKey(
        client,
        accountId,
        addonType,
        normalizedUrl,
        providerId,
      );
      if (existing) {
        // Idempotent install: sync pushes may race across devices, and a
        // re-install of an already-tracked addon must not fail the push.
        return toAddon(existing);
      }

      try {
        const inserted = await this.addonRepository.insert(
          client,
          accountId,
          addonType,
          normalizedUrl,
          payload,
        );
        return toAddon(inserted);
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        const raced = await this.addonRepository.findByKey(
          client,
          accountId,
          addonType,
          normalizedUrl,
          providerId,
        );
        if (!raced) throw err;
        return toAddon(raced);
      }
    });
  }

  async removeAddon(accountId: string, addonId: string): Promise<{ deleted: boolean }> {
    return this.runInTransaction(async (client) => {
      const deleted = await this.addonRepository.deleteById(client, accountId, addonId);
      return { deleted };
    });
  }
}

function normalizeAddonType(value: unknown): AddonType {
  if (value === undefined || value === null || value === '') {
    return 'stremio';
  }
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) {
    return 'stremio';
  }
  if ((ADDON_TYPES as readonly string[]).includes(raw)) {
    return raw as AddonType;
  }
  throw new HttpError(400, `type must be one of: ${ADDON_TYPES.join(', ')}.`);
}

function normalizePayload(addonType: AddonType, value: unknown): AddonPayload {
  if (addonType === 'stremio') {
    if (value === undefined || value === null) {
      return {};
    }
    if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0) {
      return {};
    }
    throw new HttpError(400, 'payload is only supported for jsplugin addons.');
  }

  if (value === undefined || value === null) {
    throw new HttpError(400, 'payload with providerId is required for jsplugin addons.');
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'payload must be an object.');
  }

  const raw = value as Record<string, unknown>;
  const providerId = optionalString(raw.providerId);
  if (!providerId) {
    throw new HttpError(400, 'payload.providerId is required for jsplugin addons.');
  }

  const payload: AddonPayload = { providerId };
  const name = optionalString(raw.name);
  if (name) payload.name = name;
  const version = optionalString(raw.version);
  if (version) payload.version = version;
  return payload;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: unknown }).code === '23505';
}

function normalizeManifestUrl(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) {
    throw new HttpError(400, 'manifestUrl is required.');
  }

  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new HttpError(400, 'manifestUrl must use http or https protocol.');
    }
    return url.toString();
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, 'manifestUrl must be a valid URL.');
  }
}

function toAddon(record: AddonRecord): Addon {
  return {
    id: record.id,
    accountId: record.account_id,
    type: record.addon_type,
    manifestUrl: record.manifest_url,
    payload: record.payload,
    createdAt: record.created_at,
  };
}

function toAddonListItem(record: AddonRecord): AddonListItem {
  return {
    id: record.id,
    type: record.addon_type,
    manifestUrl: record.manifest_url,
    payload: record.payload,
    createdAt: record.created_at,
  };
}
