import test from 'node:test';
import assert from 'node:assert/strict';

function seedTestEnv(): void {
  process.env.NODE_ENV ??= 'test';
  process.env.DATABASE_URL ||= 'postgres://postgres:postgres@127.0.0.1:5432/crispy_test';
  process.env.REDIS_URL ||= 'redis://127.0.0.1:6379';
  process.env.SUPABASE_JWKS_URL ||= 'https://example.supabase.co/auth/v1/.well-known/jwks.json';
  process.env.SUPABASE_JWT_ISSUER ||= 'https://example.supabase.co/auth/v1';
  process.env.SUPABASE_JWT_AUDIENCE ||= 'authenticated';
  process.env.TMDB_API_KEY ||= 'tmdb-key';
}

test('generateJson parses fenced JSON responses', async () => {
  seedTestEnv();
  const { OpenRouterClient } = await import('./openrouter.client.js');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
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
    const client = new OpenRouterClient();
    const payload = await client.generateJson({
      apiKey: 'openrouter-key',
      model: 'test-model',
      systemPrompt: 'Return JSON only.',
      userPrompt: 'Suggest one title.',
    });

    assert.deepEqual(payload, {
      items: ['The Matrix'],
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
