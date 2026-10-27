import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCodexProvider } from './codex-provider.mjs';

test('provider preserves tool declarations, tool results and streamed Responses events', async () => {
  const request = JSON.stringify({ input: [{ type: 'function_call_output', call_id: 'one', output: 'done' }], tools: [{ type: 'function', name: 'shell' }], stream: true });
  const first = 'data: {"type":"response.output_item.added","item":{"type":"function_call","name":"shell"}}\n\n';
  const last = 'data: {"type":"response.completed"}\n\n';
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const provider = await createCodexProvider({ baseUrl: 'http://127.0.0.1:8188/v1', apiKey: 'host-secret', fetchImpl: async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:8188/v1/responses');
    assert.equal(options.headers.authorization, 'Bearer host-secret');
    assert.equal(Buffer.from(options.body).toString(), request);
    return new Response(new ReadableStream({ async start(controller) {
      controller.enqueue(new TextEncoder().encode(first));
      await gate;
      controller.enqueue(new TextEncoder().encode(last)); controller.close();
    } }), { headers: { 'content-type': 'text/event-stream' } });
  } });
  try {
    const response = await fetch(`${provider.baseUrl}/responses`, { method: 'POST', headers: { authorization: `Bearer ${provider.token}`, 'content-type': 'application/json' }, body: request });
    const reader = response.body.getReader();
    assert.equal(new TextDecoder().decode((await reader.read()).value), first);
    release();
    assert.equal(new TextDecoder().decode((await reader.read()).value), last);
    assert.equal((await reader.read()).done, true);
    assert.equal((await fetch(`${provider.baseUrl}/responses`, { method: 'POST' })).status, 403);
    assert.equal((await fetch(`${provider.baseUrl}/arbitrary`, { headers: { authorization: `Bearer ${provider.token}` } })).status, 404);
  } finally { release(); await provider.close(); }
});
