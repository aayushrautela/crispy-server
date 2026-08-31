import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';
import type { MetadataCardService } from './metadata-card.service.js';
import type { MetadataCardView } from './metadata-card.types.js';

seedTestEnv();

const MOVIE_ITEM_ID = 'f137a2dd21bbc1b99aa5c0f6bf02a805';
const EPISODE_ITEM_ID = 'f137a2dd21bbc1b99aa5c0f6bf02a807';
const SERIES_ITEM_ID = 'f137a2dd21bbc1b99aa5c0f6bf02a806';
const SEASON_ITEM_ID = 'f137a2dd21bbc1b99aa5c0f6bf02a808';

test('MetadataCardBatchService hydrates valid item ids and reports invalid ids', async () => {
  const { MetadataCardBatchService } = await import('./metadata-card-batch.service.js');
  let receivedLanguage: string | null = null;
  let receivedMediaTypes: string[] = [];
  const metadataCardService = {
    async buildCardViews(_client, identities, language) {
      receivedLanguage = language ?? null;
      receivedMediaTypes = identities.map((identity) => identity.mediaType);
      return identities.map((identity, index): MetadataCardView => ({
        mediaType: identity.mediaType === 'season' ? 'show' : identity.mediaType,
        kind: identity.mediaType === 'episode' ? 'episode' : 'title',
        itemId: index === 0 ? MOVIE_ITEM_ID : EPISODE_ITEM_ID,
        parentMediaType: identity.mediaType === 'episode' ? 'show' : null,
        seriesItemId: identity.mediaType === 'episode' ? SERIES_ITEM_ID : null,
        seasonItemId: identity.mediaType === 'episode' ? SEASON_ITEM_ID : null,
        tmdbId: identity.tmdbId,
        showTmdbId: identity.showTmdbId,
        seasonNumber: identity.seasonNumber,
        episodeNumber: identity.episodeNumber,
        absoluteEpisodeNumber: identity.absoluteEpisodeNumber ?? null,
        title: identity.mediaType === 'episode' ? 'Episode Title' : 'Movie',
        subtitle: identity.mediaType === 'episode' ? 'S01 E02' : null,
        summary: null,
        overview: null,
        tagline: null,
        artwork: { artwork: { small: 'https://img.test/backdrop.jpg', medium: 'https://img.test/backdrop.jpg', large: 'https://img.test/backdrop.jpg' }, still: { small: null, medium: null, large: null } },
        images: { artwork: { small: 'https://img.test/backdrop.jpg', medium: 'https://img.test/backdrop.jpg', large: 'https://img.test/backdrop.jpg' }, still: { small: null, medium: null, large: null }, logo: { small: null, medium: null, large: null } },
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
        externalIds: { tmdb: null, imdb: null, tvdb: null },
      }));
    },
  } satisfies Pick<MetadataCardService, 'buildCardViews'>;
  const contentIdentityService = {
    resolveMediaIdentity: async (_client: unknown, contentId: string) => ({
      contentId,
      mediaType: contentId.endsWith('807') ? 'episode' : 'movie',
      mediaKey: contentId.endsWith('807') ? 'episode:tmdb:456:1:2' : 'movie:tmdb:222',
      tmdbId: contentId.endsWith('807') ? null : 222,
      showTmdbId: contentId.endsWith('807') ? 456 : null,
      seasonNumber: contentId.endsWith('807') ? 1 : null,
      episodeNumber: contentId.endsWith('807') ? 2 : null,
    }),
  };
  const service = new MetadataCardBatchService(
    metadataCardService as MetadataCardService,
    async (work) => work({} as never),
    contentIdentityService as never,
  );

  const result = await service.hydrate({
    itemIds: [MOVIE_ITEM_ID, EPISODE_ITEM_ID, 'bad-key'],
    language: 'es-ES',
  });

  assert.deepEqual(receivedMediaTypes, ['movie', 'episode']);
  assert.equal(receivedLanguage, 'es-ES');
  assert.equal(result.items.length, 2);
  assert.equal(result.items[1]?.mediaItem.itemId, EPISODE_ITEM_ID);
  assert.equal(result.items[1]?.mediaItem.parent?.seriesItemId, SERIES_ITEM_ID);
  assert.equal(result.items[1]?.mediaItem.parent?.seasonItemId, SEASON_ITEM_ID);
  assert.equal(result.items[1]?.mediaItem.parent?.seasonNumber, 1);
  assert.equal(result.items[1]?.mediaItem.parent?.episodeNumber, 2);
  assert.equal(result.items[1]?.mediaItem.title, 'Episode Title');
  assert.deepEqual(result.missing, [{ itemId: 'bad-key', reason: 'invalid_item_id' }]);
});
