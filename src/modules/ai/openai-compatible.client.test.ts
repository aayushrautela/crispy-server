import test from 'node:test';
import assert from 'node:assert/strict';

test('generateJson sends correct request and parses response', async (t) => {
  const { OpenAiCompatibleClient } = await import('./openai-compatible.client.js');

  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  let capturedBody: Record<string, unknown> = {};

  globalThis.fetch = (async (input, init) => {
    capturedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String(input);
    capturedBody = JSON.parse((init?.body as string) ?? '{}');
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"result": "ok"}' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  t.after(() => { globalThis.fetch = originalFetch; });

  const client = new OpenAiCompatibleClient();
  const result = await client.generateJson({
    provider: { id: 'openai', label: 'OpenAI', endpointUrl: 'https://api.openai.com/v1/chat/completions', httpReferer: '', title: '' },
    apiKey: 'test-key',
    model: 'gpt-4o',
    userPrompt: 'Hello',
  });

  assert.deepEqual(result, { result: 'ok' });
  assert.equal(capturedUrl, 'https://api.openai.com/v1/chat/completions');
  assert.equal(capturedBody.model, 'gpt-4o');
  assert.equal((capturedBody.messages as unknown[]).length, 1);
});

test('generateJson throws 502 on provider error', async (t) => {
  const { OpenAiCompatibleClient } = await import('./openai-compatible.client.js');

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(JSON.stringify({ error: { message: 'Rate limited' } }), { status: 429 });
  }) as typeof fetch;

  t.after(() => { globalThis.fetch = originalFetch; });

  const client = new OpenAiCompatibleClient();
  await assert.rejects(
    () => client.generateJson({
      provider: { id: 'openai', label: 'OpenAI', endpointUrl: 'https://api.openai.com/v1/chat/completions', httpReferer: '', title: '' },
      apiKey: 'test-key',
      model: 'gpt-4o',
      userPrompt: 'Hello',
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Rate limited/);
      return true;
    },
  );
});

test('generateJson includes system prompt when provided', async (t) => {
  const { OpenAiCompatibleClient } = await import('./openai-compatible.client.js');

  const originalFetch = globalThis.fetch;
  let capturedBody: unknown = null;

  globalThis.fetch = (async (_input, init) => {
    capturedBody = JSON.parse(init?.body as string ?? '{}');
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"ok": true}' } }],
    }), { status: 200 });
  }) as typeof fetch;

  t.after(() => { globalThis.fetch = originalFetch; });

  const client = new OpenAiCompatibleClient();
  await client.generateJson({
    provider: { id: 'openai', label: 'OpenAI', endpointUrl: 'https://api.openai.com/v1/chat/completions', httpReferer: '', title: '' },
    apiKey: 'test-key',
    model: 'gpt-4o',
    systemPrompt: 'Be helpful',
    userPrompt: 'Hello',
  });

  assert.equal((capturedBody as any).messages.length, 2);
  assert.equal((capturedBody as any).messages[0].role, 'system');
  assert.equal((capturedBody as any).messages[0].content, 'Be helpful');
});
