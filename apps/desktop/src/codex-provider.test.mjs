import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCodexProvider } from './codex-provider.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

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

test('native narration is capability-authenticated and never forwards caller text or proxy parameters', async () => {
  let calls = 0;
  const provider = await createCodexProvider({ baseUrl: 'https://gateway.test/v1', apiKey: 'private', fetchImpl: () => { throw new Error('unexpected model forwarding'); }, narration: async signal => {
    assert.ok(signal instanceof AbortSignal); calls++;
    return { sentences: [{ src: 'assets/narration/example.mp3', duration: 1 }] };
  } });
  const url = provider.baseUrl.replace('/v1', '/tts/generate');
  try {
    assert.equal((await fetch(url, { method: 'POST' })).status, 403);
    assert.equal((await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${provider.token}` } })).status, 403, 'model bridge credential cannot invoke narration');
    assert.equal((await fetch(`${provider.baseUrl}/responses`, { method: 'POST', headers: { authorization: `Bearer ${provider.narrationCapability}` }, body: '{}' })).status, 403, 'narration capability cannot call the model proxy');
    assert.equal((await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${provider.narrationCapability}`, origin: 'https://evil.test' } })).status, 403);
    assert.equal((await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${provider.narrationCapability}` }, body: '{"text":"override","url":"http://localhost"}' })).status, 400);
    const response = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${provider.narrationCapability}` } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).sentences[0].duration, 1);
    assert.equal(calls, 1);
  } finally { await provider.close(); }
});

test('bundled narrate command reaches native bridge without additional Python or Node installation', async () => {
  const provider = await createCodexProvider({ baseUrl: 'https://gateway.test/v1', narration: async () => ({ model: 'seed-tts-2.0', duration: 1.1, sentences: [] }) });
  try {
    const { stdout } = await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../../../packages/openfilm/bin/openfilm.mjs', import.meta.url)), 'narrate'], {
      env: { ...process.env, OPENFILM_NO_UPDATE_CHECK: '1', OPENFILM_NARRATION_URL: provider.baseUrl.replace('/v1', '/tts/generate'), OPENFILM_NARRATION_CAPABILITY: provider.narrationCapability }, timeout: 10000,
    });
    assert.equal(JSON.parse(stdout).model, 'seed-tts-2.0');
  } finally { await provider.close(); }
});


test('narrate duration crosses the capability bridge as a validated numeric target', async () => {
  let target;
  const provider = await createCodexProvider({ baseUrl: 'https://gateway.test/v1', narration: async (signal, options) => { target = options.targetSeconds; return { duration: 20 }; } });
  try {
    const env = { ...process.env, OPENFILM_NO_UPDATE_CHECK: '1', OPENFILM_NARRATION_URL: provider.baseUrl.replace('/v1', '/tts/generate'), OPENFILM_NARRATION_CAPABILITY: provider.narrationCapability };
    await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../../../packages/openfilm/bin/openfilm.mjs', import.meta.url)), 'narrate', '--duration', '20'], { env, timeout: 10000 });
    assert.equal(target, 20);
    const invalid = await fetch(env.OPENFILM_NARRATION_URL, { method: 'POST', headers: { authorization: `Bearer ${provider.narrationCapability}`, 'x-openfilm-target-seconds': 'NaN' } });
    assert.equal(invalid.status, 400);
  } finally { await provider.close(); }
});
