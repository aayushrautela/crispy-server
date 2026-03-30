import { createGunzip } from 'zlib';
import { createInterface } from 'readline';
import { Readable } from 'stream';
import { logger } from '../../../config/logger.js';
import type { DbClient } from '../../../lib/db.js';
import { ImdbRatingsRepository, type ImdbRating } from './imdb-ratings.repo.js';

const IMDB_RATINGS_URL = 'https://datasets.imdbws.com/title.ratings.tsv.gz';
const MIN_VOTES = 20;
const BATCH_SIZE = 10000;
const UPDATE_INTERVAL_HOURS = 24;

export class ImdbRatingsService {
  private updateTimer: ReturnType<typeof setInterval> | null = null;
  private loaded = false;

  constructor(private readonly repo = new ImdbRatingsRepository()) {}

  async getRating(client: DbClient, imdbId: string): Promise<ImdbRating | null> {
    if (!imdbId) return null;
    return this.repo.findByImdbId(client, imdbId);
  }

  async getRatingString(client: DbClient, imdbId: string): Promise<string | null> {
    const result = await this.getRating(client, imdbId);
    return result ? String(result.rating) : null;
  }

  async downloadAndCache(client: DbClient): Promise<boolean> {
    try {
      logger.info('Downloading IMDb ratings dataset...');
      const response = await fetch(IMDB_RATINGS_URL, {
        headers: { 'User-Agent': 'CrispyServer/1.0' },
        signal: AbortSignal.timeout(120_000),
      });

      if (!response.ok || !response.body) {
        logger.error({ status: response.status }, 'Failed to download IMDb ratings');
        return false;
      }

      const gunzipStream = createGunzip();
      const bodyStream = Readable.from(response.body as unknown as AsyncIterable<Uint8Array>);
      const rl = createInterface({
        input: bodyStream.pipe(gunzipStream),
        crlfDelay: Infinity,
      });

      let batch: Array<{ imdbId: string; rating: number; votes: number }> = [];
      let isFirstLine = true;
      let totalLoaded = 0;

      for await (const line of rl) {
        if (isFirstLine) {
          isFirstLine = false;
          continue;
        }

        const parts = line.split('\t');
        if (parts.length < 3) continue;

        const imdbId = parts[0]!.trim();
        const rating = parseFloat(parts[1]!);
        const votes = parseInt(parts[2]!, 10);

        if (!imdbId.startsWith('tt') || isNaN(rating) || isNaN(votes) || votes < MIN_VOTES) {
          continue;
        }

        batch.push({ imdbId, rating, votes });

        if (batch.length >= BATCH_SIZE) {
          await this.repo.upsertMany(client, batch);
          totalLoaded += batch.length;
          batch = [];
        }
      }

      if (batch.length > 0) {
        await this.repo.upsertMany(client, batch);
        totalLoaded += batch.length;
      }

      this.loaded = true;
      logger.info({ totalLoaded }, 'IMDb ratings loaded successfully');
      return true;
    } catch (error) {
      logger.error({ err: error }, 'Failed to download IMDb ratings');
      return false;
    }
  }

  async initialize(client: DbClient): Promise<void> {
    const count = await this.repo.count(client);
    if (count > 0) {
      this.loaded = true;
      logger.info({ count }, 'IMDb ratings already cached');
      return;
    }

    await this.downloadAndCache(client);
  }

  startPeriodicUpdate(getClient: () => Promise<DbClient>): void {
    if (this.updateTimer) return;

    const intervalMs = UPDATE_INTERVAL_HOURS * 60 * 60 * 1000;
    this.updateTimer = setInterval(async () => {
      try {
        const client = await getClient();
        try {
          await this.downloadAndCache(client);
        } finally {
          client.release();
        }
      } catch (error) {
        logger.error({ err: error }, 'Scheduled IMDb ratings update failed');
      }
    }, intervalMs);

    logger.info({ intervalHours: UPDATE_INTERVAL_HOURS }, 'Scheduled periodic IMDb ratings updates');
  }

  stopPeriodicUpdate(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }

  isLoaded(): boolean {
    return this.loaded;
  }
}

export const imdbRatingsService = new ImdbRatingsService();
