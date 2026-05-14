import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';
import type { MetadataCardService } from './metadata-card.service.js';
import type { MetadataCardView } from './metadata-card.types.js';

seedTestEnv();

test('MetadataCardBatchService hydrates valid media keys and reports invalid keys', async () => {
  const { MetadataCardBatchService } = await import('./metadata-card-batch.service.js');
  let receivedLanguage: string | null = null;
  let receivedMediaKeys: string[] = [];
  const metadataCardService = {
    async buildCardViews(_client, identities, language) {
      receivedLanguage = language ?? null;
      receivedMediaKeys = identities.map((identity) => identity.mediaKey);
      return identities.map((identity): MetadataCardView => ({
        mediaType: identity.mediaType === 'season' ? 'show' : identity.mediaType,
        kind: identity.mediaType === 'episode' ? 'episode' : 'title',
        mediaKey: identity.mediaKey,
        parentMediaType: identity.mediaType === 'episode' ? 'show' : null,
        tmdbId: identity.tmdbId,
        showTmdbId: identity.showTmdbId,
        seasonNumber: identity.seasonNumber,
        episodeNumber: identity.episodeNumber,
        absoluteEpisodeNumber: identity.absoluteEpisodeNumber ?? null,
        title: identity.mediaType === 'episode' ? 'Episode Title' : 'Movie',
        subtitle: identity.mediaType === 'episode' ? 'S01 E02' : null,
        summary: null,
        overview: null,
        artwork: { poster: { small: 'https://img.test/poster.jpg', medium: 'https://img.test/poster.jpg', large: 'https://img.test/poster.jpg' }, backdrop: { small: 'https://img.test/backdrop.jpg', medium: 'https://img.test/backdrop.jpg', large: 'https://img.test/backdrop.jpg' }, still: { small: null, medium: null, large: null } },
        images: { poster: { small: 'https://img.test/poster.jpg', medium: 'https://img.test/poster.jpg', large: 'https://img.test/poster.jpg' }, backdrop: { small: 'https://img.test/backdrop.jpg', medium: 'https://img.test/backdrop.jpg', large: 'https://img.test/backdrop.jpg' }, still: { small: null, medium: null, large: null }, logo: { small: null, medium: null, large: null } },
        releaseDate: null,
        releaseYear: 2024,
        runtimeMinutes: 45,
        rating: 7.5,
        status: null,
        maturityRating: null,
        trailerUrl: null,
        trailerThumbnailUrl: null,
        posterColor: null,
        backdropColor: null,
        genres: [],
      }));
    },
  } satisfies Pick<MetadataCardService, 'buildCardViews'>;
  const service = new MetadataCardBatchService(
    metadataCardService as MetadataCardService,
    async (work) => work({} as never),
  );

  const result = await service.hydrate({
    mediaKeys: ['movie:tmdb:222', 'episode:tmdb:456:1:2', 'bad-key'],
    language: 'es-ES',
  });

  assert.deepEqual(receivedMediaKeys, ['movie:tmdb:222', 'episode:tmdb:456:1:2']);
  assert.equal(receivedLanguage, 'es-ES');
  assert.equal(result.items.length, 2);
  assert.equal(result.items[1]?.mediaItem.mediaKey, 'episode:tmdb:456:1:2');
  assert.equal(result.items[1]?.mediaItem.seasonNumber, 1);
  assert.equal(result.items[1]?.mediaItem.episodeNumber, 2);
  assert.equal(result.items[1]?.mediaItem.episodeTitle, 'Episode Title');
  assert.deepEqual(result.missing, [{ mediaKey: 'bad-key', reason: 'invalid_media_key' }]);
});

test('parseMediaKey preserves episode identity in media key', async () => {
  const { parseMediaKey } = await import('../identity/media-key.js');
  const identity = parseMediaKey('episode:tmdb:456:1:2');

  assert.equal(identity.showTmdbId, 456);
  assert.equal(identity.seasonNumber, 1);
  assert.equal(identity.episodeNumber, 2);
});
