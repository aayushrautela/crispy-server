import { env } from '../../../config/env.js';
import { withDbClient } from '../../../lib/db.js';
import { CollectionRegistry } from '../collections/collection-registry.js';
import { TraktImportsRepository } from '../repos/trakt-imports.repo.js';
import type { ProviderRef, TraktImportRecord } from '../homescreen.types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const TRAKT_BASE_URL = 'https://api.trakt.tv';

type TraktListRef = { slug: string; listId: string };

function parseListRef(ref: TraktImportRecord): TraktListRef {
  if (ref.traktListId) {
    const [slug, listId] = ref.traktListId.split('/').filter(Boolean);
    if (slug && listId) {
      return { slug, listId };
    }
  }
  return { slug: ref.slug, listId: ref.slug };
}

function buildTraktHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'trakt-api-key': env.traktImportClientId,
    'trakt-api-version': '2',
    'User-Agent': 'CrispyServer/1.0',
  };
}

function extractTmdbId(item: Record<string, unknown>): number | null {
  const movie = isRecord(item.movie) ? item.movie : null;
  const show = isRecord(item.show) ? item.show : null;
  const media = movie ?? show;
  if (!media) {
    return null;
  }
  const ids = isRecord(media.ids) ? media.ids : null;
  if (ids && typeof ids.tmdb === 'number') {
    return ids.tmdb;
  }
  return null;
}

async function fetchTraktListItems(ref: TraktListRef): Promise<ProviderRef[]> {
  if (!env.traktImportClientId) {
    throw new Error('traktImportClientId is not configured.');
  }
  const url = `${TRAKT_BASE_URL}/users/${encodeURIComponent(ref.slug)}/lists/${encodeURIComponent(ref.listId)}/items?extended=ids`;
  const response = await fetch(url, {
    headers: buildTraktHeaders(),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    throw new Error(`Trakt list fetch failed: ${response.status} ${response.statusText}`);
  }
  const payload = (await response.json()) as unknown;
  const items = Array.isArray(payload) ? payload.filter(isRecord) : [];
  const refs: ProviderRef[] = [];
  const seen = new Set<number>();
  for (const item of items) {
    const tmdbId = extractTmdbId(item);
    if (tmdbId === null || seen.has(tmdbId)) {
      continue;
    }
    seen.add(tmdbId);
    refs.push({ provider: 'tmdb', providerId: String(tmdbId) });
  }
  return refs;
}

export class TraktListImporter {
  constructor(
    private readonly traktImportsRepository = new TraktImportsRepository(),
    private readonly collectionRegistry = new CollectionRegistry(),
  ) {}

  async syncImport(importId: string): Promise<{ collectionKey: string; items: number }> {
    const record = await withGetTraktImport(importId, this.traktImportsRepository);
    const listRef = parseListRef(record);
    const providerRefs = await fetchTraktListItems(listRef);
    const collectionKey = `trakt:${listRef.slug}:${listRef.listId}`;
    const title = record.title ?? `Trakt: ${listRef.slug}`;
    await this.collectionRegistry.upsert({
      key: collectionKey,
      title,
      subtitle: `Imported from Trakt list ${listRef.slug}`,
      providerRefs,
      source: 'trakt',
      sourceRef: record.traktListId ?? record.slug,
      updatedBy: 'trakt-sync',
    });
    await withDbClient((client) => this.traktImportsRepository.markSynced(client, record.id, new Date(), null));
    return { collectionKey, items: providerRefs.length };
  }

  async syncAll(): Promise<number> {
    const records = await withDbClient((client) => this.traktImportsRepository.list(client));
    const active = records.filter((record) => record.active);
    let synced = 0;
    for (const record of active) {
      try {
        await this.syncImport(record.id);
        synced += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        await withDbClient((client) => this.traktImportsRepository.markSynced(client, record.id, new Date(), message));
      }
    }
    return synced;
  }
}

async function withGetTraktImport(
  importId: string,
  repository: TraktImportsRepository,
): Promise<TraktImportRecord> {
  const record = await withDbClient((client) => repository.get(client, importId));
  if (!record) {
    throw new Error(`Trakt import ${importId} not found.`);
  }
  return record;
}
