import test from 'node:test';
import assert from 'node:assert/strict';
import { TasteProfileRepository } from './taste-profile.repo.js';

const UUID = '0f0a2a34-9f4e-4d3b-8a7c-2f1e0d9b8a77';

function fakeClient(rows: Record<string, unknown>[] = []) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  return {
    client: {
      query: async (text: string, values: unknown[]) => {
        calls.push({ text, values });
        return { rows };
      },
    } as never,
    calls,
  };
}

const NOW = '2026-09-17T12:00:00.000Z';

function returningRow(): Record<string, unknown> {
  return {
    profile_id: UUID,
    source_key: 'default',
    content_type_pref: {},
    watching_pace: null,
    ai_summary: null,
    source: 'recommendation_worker',
    vectors,
    version: 3,
    created_at: NOW,
    updated_at: NOW,
    persona_long_term: null,
    persona_short_term: null,
    persona_updated_at: null,
    persona_watch_fingerprint: null,
    avoidances: [],
  };
}

const vectors = {
  schemaVersion: 5 as const,
  genres: [],
  people: [],
  decades: [],
  languages: [],
  contentMix: { short: { movie: 0, show: 0 }, long: { movie: 0, show: 0 } },
};

function baseInput() {
  return {
    profileId: UUID,
    sourceKey: 'default',
    contentTypePref: {},
    watchingPace: null,
    aiSummary: null,
    source: 'recommendation_worker',
    vectors,
  };
}

test('upsert without persona fields keeps prior persona via CASE guards', async () => {
  const { client, calls } = fakeClient([returningRow()]);
  const record = (await new TasteProfileRepository().upsert(client, baseInput()))!;
  assert.equal(record.personaLongTerm, null);
  assert.deepEqual(record.avoidances, []);
  const values = calls[0]!.values;
  assert.equal(calls[0]!.text.includes('persona_long_term = CASE WHEN $13'), true);
  assert.deepEqual(values.slice(12, 17), [false, false, false, false, false]);
  assert.deepEqual(values.slice(7, 12), [null, null, null, null, '[]']);
});

test('upsert with persona fields flips CASE guards and binds values', async () => {
  const row = { ...returningRow(), persona_long_term: 'Loves slow sci-fi', persona_updated_at: new Date('2026-09-01T10:00:00.000Z'), persona_watch_fingerprint: '12:2026-09-01T10:00:00.000Z', avoidances: ['found footage'] };
  const { client, calls } = fakeClient([row]);
  const record = await new TasteProfileRepository().upsert(client, {
    ...baseInput(),
    personaLongTerm: 'Loves slow sci-fi',
    personaShortTerm: null,
    personaUpdatedAt: '2026-09-01T10:00:00.000Z',
    personaWatchFingerprint: '12:2026-09-01T10:00:00.000Z',
    avoidances: ['found footage'],
  });
  assert.equal(record.personaLongTerm, 'Loves slow sci-fi');
  assert.deepEqual(record.avoidances, ['found footage']);
  assert.equal(record.personaUpdatedAt, '2026-09-01T10:00:00.000Z');

  const values = calls[0]!.values;
  assert.deepEqual(values.slice(7, 12), ['Loves slow sci-fi', null, '2026-09-01T10:00:00.000Z', '12:2026-09-01T10:00:00.000Z', '["found footage"]']);
  assert.deepEqual(values.slice(12, 17), [true, true, true, true, true]);
});

test('reads filter to schemaVersion 5 rows', async () => {
  const { client, calls } = fakeClient();
  await new TasteProfileRepository().findByProfileAndSourceKey(client, UUID, 'default');
  assert.equal(calls[0]!.text.includes(`vectors->>'schemaVersion' = '5'`), true);
});
