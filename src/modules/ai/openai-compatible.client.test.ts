import test from 'node:test';
import assert from 'node:assert/strict';

function seedTestEnv(): void {
  process.env.NODE_ENV ??= 'test';
  process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/crispy_test';
  process.env.REDIS_URL ||= 'redis://127.0.0.1:6379';
  process.env.SUPABASE_URL ||= 'https://example.supabase.co';
  process.env.AUTH_JWT_AUDIENCE ||= 'authenticated';
  process.env.TMDB_API_KEY ||= 'tmdb-key';
  process.env.SERVICE_CLIENTS_JSON ||= '[{"serviceId":"test-service","apiKey":"test-key","scopes":["profiles:read"]}]';
}

test('generateJson parses fenced JSON responses', async () => {
  seedTestEnv();
  process.env.AI_ENDPOINT_URL = 'https://example.com/v1/chat/completions';
  const { OpenAiCompatibleClient } = await import('./openai-compatible.client.js');

  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = (async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: '```json\n{"items":["The Matrix"]}\n```',
          },
        },
      ],
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
      },
    });
  }) as typeof fetch;

  try {
    const client = new OpenAiCompatibleClient();
    const payload = await client.generateJson({
      apiKey: 'test-key',
      model: 'test-model',
      systemPrompt: 'Return JSON only.',
      userPrompt: 'Suggest one title.',
    });

    assert.equal(requestedUrl, 'https://example.com/v1/chat/completions');
    assert.deepEqual(payload, {
      items: ['The Matrix'],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
