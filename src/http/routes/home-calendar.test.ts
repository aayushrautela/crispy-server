import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestApp, seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

async function makeDto(overrides: Record<string, unknown>) {
  const itemId = overrides.itemId as string ?? '00000000000000000000000000000694';
  const tmdbId = overrides.tmdbId as string ?? '694';
  const imageTags = overrides.imageTags as Record<string, unknown> | undefined;
  return {
    Id: itemId,
    Type: 'Series',
    Name: overrides.name as string ?? 'Test Show',
    OriginalTitle: null,
    Overview: null,
    Taglines: [],
    ProductionYear: overrides.productionYear as number ?? 2024,
    PremiereDate: null,
    CommunityRating: overrides.communityRating as number ?? 8.0,
    OfficialRating: null,
    Certification: null,
    Genres: [],
    RunTimeTicks: overrides.runTimeSeconds != null ? (overrides.runTimeSeconds as number) * 10_000_000 : null,
    Status: null,
    ProviderIds: { Tmdb: tmdbId, Imdb: null, Tvdb: null },
    ImageTags: {
      Primary: (imageTags?.primary as Record<string, unknown> | undefined) ?? { small: 'https://img.test/poster.jpg', medium: 'https://img.test/poster.jpg', large: 'https://img.test/poster.jpg' },
      Backdrop: (imageTags?.backdrop as Array<Record<string, unknown>> | undefined) ?? [{ small: 'https://img.test/backdrop.jpg', medium: 'https://img.test/backdrop.jpg', large: 'https://img.test/backdrop.jpg' }],
      Logo: (imageTags?.logo ?? null) as Record<string, unknown> | null,
      Thumb: (imageTags?.thumb ?? null) as Record<string, unknown> | null,
      Screenshot: [],
    },
    ParentImageTags: null,
    SeriesId: null,
    SeriesName: null,
    SeasonId: null,
    SeasonName: null,
    ParentIndexNumber: overrides.parentIndexNumber as number | null ?? null,
    IndexNumber: overrides.indexNumber as number | null ?? null,
    AbsoluteIndexNumber: null,
    EpisodeTitle: overrides.episodeTitle as string | null ?? null,
    AirDate: overrides.airDate as string | null ?? null,
    RemoteTrailers: [],
    PosterColor: null,
    BackdropColor: null,
    UserData: null,
  } as const;
}

test('calendar route returns canonical envelope fields', async (t) => {
  const { CalendarService } = await import('../../modules/calendar/calendar.service.js');
  const original = CalendarService.prototype.getCalendar;
  const itemKey = '00000000000000000000000000000500';

  t.after(() => {
    CalendarService.prototype.getCalendar = original;
  });

  CalendarService.prototype.getCalendar = async function (_userId, profileId) {
    const mediaItem = await makeDto({
      itemId: itemKey,
      tmdbId: '500',
      name: 'Example Show',
      productionYear: 2024,
      communityRating: 8.5,
      runTimeSeconds: 2640,
      parentIndexNumber: 1,
      indexNumber: 3,
      episodeTitle: 'Third Episode',
      airDate: '2024-01-03',
    });
    return {
      profileId,
      source: 'canonical_calendar',
      generatedAt: '2024-01-02T00:00:00.000Z',
      items: [mediaItem],
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
  assert.equal(data.items[0].Id, itemKey);
  assert.equal(data.items[0].Name, 'Example Show');
  assert.equal(data.items[0].Type, 'Series');
  assert.equal(data.items[0].ParentIndexNumber, 1);
  assert.equal(data.items[0].EpisodeTitle, 'Third Episode');
});

test('calendar this-week route returns narrowed canonical envelope fields', async (t) => {
  const { CalendarService } = await import('../../modules/calendar/calendar.service.js');
  const original = CalendarService.prototype.getThisWeek;
  const itemKey = '00000000000000000000000000000501';

  t.after(() => {
    CalendarService.prototype.getThisWeek = original;
  });

  CalendarService.prototype.getThisWeek = async function (_userId, profileId) {
    const mediaItem = await makeDto({
      itemId: itemKey,
      tmdbId: '501',
      name: 'Next Week Show',
      productionYear: 2024,
      communityRating: 8.3,
      runTimeSeconds: 2760,
      parentIndexNumber: 2,
      indexNumber: 1,
      episodeTitle: 'Season Premiere',
      airDate: '2024-01-05',
    });
    return {
      profileId,
      source: 'canonical_calendar',
      generatedAt: '2024-01-03T00:00:00.000Z',
      items: [mediaItem],
    } as never;
  };

  const { registerCalendarRoutes } = await import('./calendar.js');
  const app = await buildTestApp(registerCalendarRoutes);
  t.after(async () => { await app.close(); });

  const response = await app.inject({ method: 'GET', url: '/v1/profiles/profile-1/calendar/this-week', headers: { authorization: 'Bearer test' } });
  assert.equal(response.statusCode, 200);
  const data = response.json().data;
  assert.equal(data.items[0].Id, itemKey);
  assert.equal(data.items[0].Name, 'Next Week Show');
  assert.equal(data.items[0].Type, 'Series');
});
