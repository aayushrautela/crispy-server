import test from 'node:test';
import assert from 'node:assert/strict';
import { seedTestEnv } from '../../test-helpers.js';

seedTestEnv();

const { RecommendationGenerationJobsRepository } = await import('./recommendation-generation-jobs.repo.js');

test('create aligns recommendation_generation_jobs insert placeholders', async () => {
  const repository = new RecommendationGenerationJobsRepository();
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const client = {
    query: async (text: string, values: unknown[] = []) => {
      queries.push({ text, values });
      return {
        rows: [{
          id: 'job-1',
          profile_id: values[0],
          account_id: values[1],
          source_key: values[2],
          algorithm_version: values[3],
          history_generation: values[4],
          idempotency_key: values[5],
          worker_job_id: null,
          status: values[7],
          request_payload: JSON.parse(String(values[6] ?? '{}')),
          last_status_payload: {},
          failure_json: {},
          submit_attempts: 0,
          poll_attempts: 0,
          poll_error_count: 0,
          accepted_at: null,
          started_at: null,
          completed_at: null,
          cancelled_at: null,
          last_submitted_at: null,
          last_polled_at: null,
          next_poll_at: null,
          created_at: '2024-01-01T00:00:00.000Z',
          updated_at: '2024-01-01T00:00:00.000Z',
        }],
      };
    },
  } as never;

  await repository.create(client, {
    profileId: '11111111-1111-1111-1111-111111111111',
    accountId: '22222222-2222-2222-2222-222222222222',
    sourceKey: 'default',
    algorithmVersion: 'v3.2.1',
    historyGeneration: 7,
    idempotencyKey: 'recommendation:profile:default:v3.2.1:7',
    requestPayload: { test: true },
  });

  const insert = queries.find((entry) => entry.text.includes('INSERT INTO recommendation_generation_jobs'));
  assert.ok(insert, 'expected recommendation_generation_jobs insert query');
  assert.match(insert.text, /\$6, \$7::jsonb, \$8\)/);
  assert.equal(insert.values.length, 8);
});
