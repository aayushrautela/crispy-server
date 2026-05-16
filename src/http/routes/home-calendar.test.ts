import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

function makeCalendarMediaItem(key: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const segs = key.split(':');
  const mediaType = segs[0] ?? 'movie';
  return {
    id: key,
    mediaKey: key,
    type: mediaType === 'show' ? 'Series' : 'Movie',
    name: 'Test Show',
    originalTitle: null,
    overview: null,
    tagline: null,
    productionYear: 2024,
    premiereDate: null,
    communityRating: 8.0,
    officialRating: null,
    certification: null,
    genres: [],
    runTimeSeconds: null,
    status: null,
    providerIds: { tmdb: String(segs[2] ?? '0'), imdb: null, tvdb: null },
    imageTags: {
      primary: { small: 'https://img.test/poster.jpg', medium: 'https://img.test/poster.jpg', large: 'https://img.test/poster.jpg' },
      backdrop: [{ small: 'https://img.test/backdrop.jpg', medium: 'https://img.test/backdrop.jpg', large: 'https://img.test/backdrop.jpg' }],
      logo: null,
      thumb: null,
      screenshot: [],
    },
    parentImageTags: null,
    seriesId: mediaType === 'show' ? String(segs[2] ?? '0') : null,
    seriesName: null,
    seasonId: null,
    seasonName: null,
    parentIndexNumber: null,
    indexNumber: null,
    absoluteIndexNumber: null,
    episodeTitle: null,
    airDate: null,
    trailerUrl: null,
    trailerThumbnailUrl: null,
    posterColor: null,
    backdropColor: null,
    userData: null,
    ...overrides,
  };
}

test('calendar route returns canonical envelope fields', async (t) => {
  const { CalendarService } = await import('../../modules/calendar/calendar.service.js');
  const original = CalendarService.prototype.getCalendar;
  const itemKey = 'show:tmdb:500';

  t.after(() => {
    CalendarService.prototype.getCalendar = original;
  });

  CalendarService.prototype.getCalendar = async function (_userId, profileId) {
    const { mediaItemToMediaItemDto, metadataCardToMediaItem } = await import('../../modules/metadata/media-item.mapper.js');
    const makeDto = (overrides: Record<string, unknown>) => {
      const legacy = {
        mediaKey: overrides.mediaKey as string,
        mediaType: 'show',
        title: overrides.name as string ?? 'Test Show',
        originalTitle: null,
        subtitle: null,
        overview: null,
        images: {
          poster: { small: 'https://img.test/show-poster.jpg', medium: 'https://img.test/show-poster.jpg', large: 'https://img.test/show-poster.jpg' },
          backdrop: { small: null, medium: null, large: null },
          logo: { small: null, medium: null, large: null },
          still: { small: null, medium: null, large: null },
        },
        releaseDate: null,
        releaseYear: overrides.productionYear as number ?? 2024,
        rating: overrides.communityRating as number ?? 8.0,
        genres: [],
        runtimeMinutes: overrides.runTimeSeconds != null ? (overrides.runTimeSeconds as number) / 60 : null,
        status: null,
        maturityRating: null,
        certification: null,
        trailerUrl: null,
        trailerThumbnailUrl: null,
        posterColor: null,
        backdropColor: null,
        externalIds: { tmdb: Number(String(overrides.mediaKey).split(':')[2] ?? '0'), imdb: null, tvdb: null },
        parent: null,
        showTmdbId: Number(String(overrides.mediaKey).split(':')[2] ?? '0'),
        seasonNumber: overrides.parentIndexNumber as number | null ?? null,
        episodeNumber: overrides.indexNumber as number | null ?? null,
        absoluteEpisodeNumber: null,
        episodeTitle: overrides.episodeTitle as string | null ?? null,
        airDate: overrides.airDate as string | null ?? null,
        badges: [],
      } as any;
      return mediaItemToMediaItemDto(legacy);
    };
    const mediaItem = makeDto({
      mediaKey: 'show:tmdb:500',
      name: 'Example Show',
      productionYear: 2024,
      communityRating: 8.5,
      runTimeSeconds: 2640,
      parentIndexNumber: 1,
      indexNumber: 3,
      episodeTitle: 'Third Episode',
      airDate: '2024-01-03',
    });
    const relatedShow = makeCalendarMediaItem('show:tmdb:500', {
      name: 'Example Show',
      productionYear: 2024,
      communityRating: 8.5,
      runTimeSeconds: null,
      imageTags: {
        primary: { small: 'https://img.test/show-poster.jpg', medium: 'https://img.test/show-poster.jpg', large: 'https://img.test/show-poster.jpg' },
        backdrop: [],
        logo: null,
        thumb: null,
        screenshot: [],
      },
    });
    return {
      profileId,
      source: 'canonical_calendar',
      generatedAt: '2024-01-02T00:00:00.000Z',
      items: [
        {
          bucket: 'this_week',
          kind: 'calendar_item',
          mediaItem,
          context: {
            bucket: 'this_week',
            airDate: '2024-01-03',
            watched: false,
            relatedShow,
          },
          presentation: { preferredSize: 'wide', sectionId: null, sectionTitle: null },
          airDate: '2024-01-03',
          watched: false,
        },
      ],
    } as never;
  };

  const { registerCalendarRoutes } = await import('./calendar.js');
  const app = await buildTestApp(registerCalendarRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({ method: 'GET', url: '/v1/profiles/profile-1/calendar', headers: { authorization: 'Bearer test' } });
  assert.equal(response.statusCode, 200);
  const data = response.json().data;
  assert.equal(data.profileId, 'profile-1');
  assert.equal(data.source, 'canonical_calendar');
  assert.equal(data.items.length, 1);
  assert.equal(data.items[0].kind, 'calendar_item');
  assert.equal(data.items[0].mediaItem.mediaKey, itemKey);
  assert.equal(data.items[0].mediaItem.name, 'Example Show');
  assert.equal(data.items[0].mediaItem.type, 'Series');
  assert.equal(data.items[0].mediaItem.parentIndexNumber, 1);
  assert.equal(data.items[0].mediaItem.episodeTitle, 'Third Episode');
  assert.equal(data.items[0].context.relatedShow.mediaKey, itemKey);
  assert.equal(data.items[0].context.relatedShow.type, 'Series');
  assert.equal('relatedShow' in data.items[0].context, true);
});

test('calendar this-week route returns narrowed canonical envelope fields', async (t) => {
  const { CalendarService } = await import('../../modules/calendar/calendar.service.js');
  const original = CalendarService.prototype.getThisWeek;
  const itemKey = 'show:tmdb:501';

  t.after(() => {
    CalendarService.prototype.getThisWeek = original;
  });

  CalendarService.prototype.getThisWeek = async function (_userId, profileId) {
    const mediaItem = makeCalendarMediaItem('show:tmdb:501', {
      name: 'Next Week Show',
      productionYear: 2024,
      communityRating: 8.3,
      runTimeSeconds: 2760,
      parentIndexNumber: 2,
      indexNumber: 1,
      episodeTitle: 'Season Premiere',
      airDate: '2024-01-05',
    });
    const relatedShow = makeCalendarMediaItem('show:tmdb:501', {
      name: 'Next Week Show',
      productionYear: 2024,
      communityRating: 8.3,
      runTimeSeconds: null,
      imageTags: {
        primary: { small: 'https://img.test/next-show-poster.jpg', medium: 'https://img.test/next-show-poster.jpg', large: 'https://img.test/next-show-poster.jpg' },
        backdrop: [],
        logo: null,
        thumb: null,
        screenshot: [],
      },
    });
    return {
      profileId,
      source: 'canonical_calendar',
      kind: 'this-week',
      generatedAt: '2024-01-03T00:00:00.000Z',
      items: [
        {
          bucket: 'this_week',
          kind: 'calendar_item',
          mediaItem,
          context: {
            bucket: 'this_week',
            airDate: '2024-01-05',
            watched: false,
            relatedShow,
          },
          presentation: { preferredSize: 'wide', sectionId: null, sectionTitle: null },
          airDate: '2024-01-05',
          watched: false,
        },
      ],
    } as never;
  };

  const { registerCalendarRoutes } = await import('./calendar.js');
  const app = await buildTestApp(registerCalendarRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({ method: 'GET', url: '/v1/profiles/profile-1/calendar/this-week', headers: { authorization: 'Bearer test' } });
  assert.equal(response.statusCode, 200);
  const data = response.json().data;
  assert.equal(data.kind, 'this-week');
  assert.equal(data.items[0].mediaItem.mediaKey, itemKey);
  assert.equal(data.items[0].mediaItem.name, 'Next Week Show');
  assert.equal(data.items[0].mediaItem.type, 'Series');
  assert.equal(data.items[0].context.relatedShow.mediaKey, itemKey);
  assert.equal('relatedShow' in data.items[0].context, true);
});
