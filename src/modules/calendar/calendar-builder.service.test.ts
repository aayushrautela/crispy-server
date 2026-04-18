import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

test('CalendarBuilderService emits no_scheduled when canonical next episode is absent', async () => {
  const { CalendarBuilderService } = await import('./calendar-builder.service.js');

  const service = new CalendarBuilderService(
    {
      listEpisodicFollow: async () => [{
        seriesMediaKey: 'show:tmdb:100',
        seriesMediaType: 'show',
        provider: 'tmdb',
        providerId: '100',
        reason: 'watch_activity',
        lastInteractedAt: '2026-04-07T12:00:00.000Z',
        nextEpisodeAirDate: null,
        nextEpisodeMediaKey: null,
        nextEpisodeSeasonNumber: null,
        nextEpisodeEpisodeNumber: null,
        nextEpisodeAbsoluteEpisodeNumber: null,
        nextEpisodeTitle: null,
        metadataRefreshedAt: null,
        payload: {},
      }],
      listWatchedEpisodeKeysForShow: async () => [],
    } as never,
    {
      buildCardView: async (_client: unknown, identity: { mediaKey: string }) => {
        if (identity.mediaKey === 'show:tmdb:100') {
          return {
            mediaType: 'show',
            kind: 'title',
            mediaKey: 'show:tmdb:100',
            provider: 'tmdb',
            providerId: '100',
            parentMediaType: null,
            parentProvider: null,
            parentProviderId: null,
            tmdbId: null,
            showTmdbId: null,
            seasonNumber: null,
            episodeNumber: null,
            absoluteEpisodeNumber: null,
            title: 'Example Show',
            subtitle: null,
            summary: null,
            overview: null,
            artwork: {
              posterUrl: 'https://img.test/show-poster.jpg',
              backdropUrl: 'https://img.test/show-backdrop.jpg',
              stillUrl: null,
            },
            images: {
              posterUrl: 'https://img.test/show-poster.jpg',
              backdropUrl: 'https://img.test/show-backdrop.jpg',
              stillUrl: null,
              logoUrl: null,
            },
            releaseDate: '2024-01-01',
            releaseYear: 2024,
            runtimeMinutes: 45,
            rating: 8.1,
            status: null,
          };
        }
        throw new Error(`Unexpected media key ${identity.mediaKey}`);
      },
    } as never,
  );

  const result = await service.build({} as never, 'profile-1', 10);

  assert.equal(result.length, 1);
  assert.equal(result[0]?.bucket, 'no_scheduled');
  assert.equal(result[0]?.media.mediaKey, 'show:tmdb:100');
  assert.equal(result[0]?.airDate, null);
});

test('CalendarBuilderService builds item from persisted canonical next episode', async () => {
  const { CalendarBuilderService } = await import('./calendar-builder.service.js');

  const service = new CalendarBuilderService(
    {
      listEpisodicFollow: async () => [{
        seriesMediaKey: 'show:tmdb:100',
        seriesMediaType: 'show',
        provider: 'tmdb',
        providerId: '100',
        reason: 'watch_activity',
        lastInteractedAt: '2026-04-07T12:00:00.000Z',
        nextEpisodeAirDate: '2099-01-01',
        nextEpisodeMediaKey: 'episode:tmdb:100:1:2',
        nextEpisodeSeasonNumber: 1,
        nextEpisodeEpisodeNumber: 2,
        nextEpisodeAbsoluteEpisodeNumber: null,
        nextEpisodeTitle: 'Episode 2',
        metadataRefreshedAt: null,
        payload: {},
      }],
      listWatchedEpisodeKeysForShow: async () => ['episode:tmdb:100:1:1'],
    } as never,
    {
      buildCardView: async (_client: unknown, identity: { mediaKey: string }) => {
        if (identity.mediaKey === 'show:tmdb:100') {
          return {
            mediaType: 'show',
            kind: 'title',
            mediaKey: 'show:tmdb:100',
            provider: 'tmdb',
            providerId: '100',
            parentMediaType: null,
            parentProvider: null,
            parentProviderId: null,
            tmdbId: null,
            showTmdbId: null,
            seasonNumber: null,
            episodeNumber: null,
            absoluteEpisodeNumber: null,
            title: 'Example Show',
            subtitle: null,
            summary: null,
            overview: null,
            artwork: {
              posterUrl: 'https://img.test/show-poster.jpg',
              backdropUrl: 'https://img.test/show-backdrop.jpg',
              stillUrl: null,
            },
            images: {
              posterUrl: 'https://img.test/show-poster.jpg',
              backdropUrl: 'https://img.test/show-backdrop.jpg',
              stillUrl: null,
              logoUrl: null,
            },
            releaseDate: '2024-01-01',
            releaseYear: 2024,
            runtimeMinutes: 45,
            rating: 8.1,
            status: null,
          };
        }
        if (identity.mediaKey === 'episode:tmdb:100:1:2') {
          return {
            mediaType: 'episode',
            kind: 'episode',
            mediaKey: 'episode:tmdb:100:1:2',
            provider: 'tmdb',
            providerId: '100:s1:e2',
            parentMediaType: 'show',
            parentProvider: 'tmdb',
            parentProviderId: '100',
            tmdbId: null,
            showTmdbId: null,
            seasonNumber: 1,
            episodeNumber: 2,
            absoluteEpisodeNumber: null,
            title: 'Episode 2',
            subtitle: null,
            summary: null,
            overview: null,
            artwork: {
              posterUrl: 'https://img.test/episode-poster.jpg',
              backdropUrl: null,
              stillUrl: 'https://img.test/episode-still.jpg',
            },
            images: {
              posterUrl: 'https://img.test/episode-poster.jpg',
              backdropUrl: null,
              stillUrl: 'https://img.test/episode-still.jpg',
              logoUrl: null,
            },
            releaseDate: '2099-01-01',
            releaseYear: 2099,
            runtimeMinutes: 47,
            rating: 8.5,
            status: null,
          };
        }
        throw new Error(`Unexpected media key ${identity.mediaKey}`);
      },
    } as never,
  );

  const result = await service.build({} as never, 'profile-1', 10);

  assert.equal(result.length, 1);
  assert.equal(result[0]?.bucket, 'upcoming');
  assert.equal(result[0]?.media.mediaKey, 'episode:tmdb:100:1:2');
  assert.equal(result[0]?.airDate, '2099-01-01');
  assert.equal(result[0]?.watched, false);
});
