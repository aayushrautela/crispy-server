import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../../test-helpers.js';

seedTestEnv();

type UpsertCoreParams = Record<string, unknown>;

function makeRepo() {
  const coreCalls: UpsertCoreParams[] = [];
  return {
    coreCalls,
    repo: {
      upsertTitleCore: async (_client: unknown, params: UpsertCoreParams) => { coreCalls.push(params); },
      upsertTranslations: async () => {},
      insertImagesIfEmpty: async () => {},
      replaceReviews: async () => {},
      replaceRelations: async () => {},
      upsertSummaryTitles: async () => {},
      missingImageKinds: async () => [],
      getTitle: async () => null,
      markTitleNotFound: async () => {},
    },
  };
}

function fakeClient() {
  return { query: async () => ({ rows: [] }) };
}

/** The single detail-ingest write, so assertions read off a known-present row. */
function onlyCoreCall(coreCalls: UpsertCoreParams[]): UpsertCoreParams {
  assert.equal(coreCalls.length, 1);
  const [call] = coreCalls;
  assert.ok(call, 'expected exactly one upsertTitleCore call');
  return call;
}

test('ingestTitle asks for release_dates on movies and stores the certification', async () => {
  const { TmdbIngestService } = await import('./tmdb-ingest.service.js');
  const { coreCalls, repo } = makeRepo();

  let requestedPath = '';
  let requestedParams: Record<string, unknown> = {};
  const client = {
    request: async (path: string, params: Record<string, unknown>) => {
      requestedPath = path;
      requestedParams = params;
      return {
        id: 550,
        title: 'Fight Club',
        original_title: 'Fight Club',
        release_date: '1999-10-15',
        adult: false,
        release_dates: {
          results: [
            { iso_3166_1: 'GB', release_dates: [{ certification: '18' }] },
            { iso_3166_1: 'US', release_dates: [{ certification: 'R' }] },
          ],
        },
      };
    },
  } as never;

  await new TmdbIngestService(client, repo as never).ingestTitle(fakeClient() as never, 'movie', 550);

  assert.equal(requestedPath, '/movie/550');
  assert.ok(String(requestedParams.append_to_response).includes('release_dates'));
  assert.ok(!String(requestedParams.append_to_response).includes('content_ratings'));
  assert.equal(onlyCoreCall(coreCalls).certification, 'R');
  assert.equal(onlyCoreCall(coreCalls).hydrationLevel, 'detail');
});

test('ingestTitle asks for content_ratings on tv and stores the certification', async () => {
  const { TmdbIngestService } = await import('./tmdb-ingest.service.js');
  const { coreCalls, repo } = makeRepo();

  let requestedParams: Record<string, unknown> = {};
  const client = {
    request: async (_path: string, params: Record<string, unknown>) => {
      requestedParams = params;
      return {
        id: 1396,
        name: 'Breaking Bad',
        original_name: 'Breaking Bad',
        first_air_date: '2008-01-20',
        adult: false,
        content_ratings: {
          results: [
            { iso_3166_1: 'DE', rating: '16' },
            { iso_3166_1: 'US', rating: 'TV-MA' },
          ],
        },
      };
    },
  } as never;

  await new TmdbIngestService(client, repo as never).ingestTitle(fakeClient() as never, 'tv', 1396);

  assert.ok(String(requestedParams.append_to_response).includes('content_ratings'));
  assert.ok(!String(requestedParams.append_to_response).includes('release_dates'));
  assert.equal(onlyCoreCall(coreCalls).certification, 'TV-MA');
});

test('ingestTitle stores a null certification when TMDB reports none', async () => {
  const { TmdbIngestService } = await import('./tmdb-ingest.service.js');
  const { coreCalls, repo } = makeRepo();

  const client = {
    request: async () => ({ id: 11, title: 'Untitled', adult: false }),
  } as never;

  await new TmdbIngestService(client, repo as never).ingestTitle(fakeClient() as never, 'movie', 11);

  assert.equal(onlyCoreCall(coreCalls).certification, null);
});

test('buildTmdbTitleDetailAppendToResponse keeps the shared sub-resource list', async () => {
  const { buildTmdbTitleDetailAppendToResponse } = await import('../metadata-language.js');

  const movie = buildTmdbTitleDetailAppendToResponse('movie').split(',');
  const tv = buildTmdbTitleDetailAppendToResponse('tv').split(',');

  for (const key of ['images', 'videos', 'credits', 'recommendations', 'similar', 'reviews', 'external_ids', 'translations']) {
    assert.ok(movie.includes(key), `movie list missing ${key}`);
    assert.ok(tv.includes(key), `tv list missing ${key}`);
  }
  assert.ok(movie.includes('release_dates'));
  assert.ok(tv.includes('content_ratings'));
});
