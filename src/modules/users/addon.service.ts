import { withTransaction, type DbClient } from '../../lib/db.js';
import { HttpError } from '../../lib/errors.js';
import { AddonRepository, type AddonRecord } from './addon.repo.js';

export type Addon = {
  id: string;
  accountId: string;
  manifestUrl: string;
  createdAt: string;
};

export type AddonListItem = {
  id: string;
  manifestUrl: string;
  createdAt: string;
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

  async addAddon(accountId: string, manifestUrl: string): Promise<Addon> {
    const normalizedUrl = normalizeManifestUrl(manifestUrl);

    return this.runInTransaction(async (client) => {
      const existing = await this.addonRepository.findByManifestUrl(client, accountId, normalizedUrl);
      if (existing) {
        throw new HttpError(409, 'Addon already installed.', undefined, 'addon_already_installed');
      }

      const inserted = await this.addonRepository.insert(client, accountId, normalizedUrl);
      return toAddon(inserted);
    });
  }

  async removeAddon(accountId: string, addonId: string): Promise<{ deleted: boolean }> {
    return this.runInTransaction(async (client) => {
      const deleted = await this.addonRepository.deleteById(client, accountId, addonId);
      return { deleted };
    });
  }
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
    manifestUrl: record.manifest_url,
    createdAt: record.created_at,
  };
}

function toAddonListItem(record: AddonRecord): AddonListItem {
  return {
    id: record.id,
    manifestUrl: record.manifest_url,
    createdAt: record.created_at,
  };
}
