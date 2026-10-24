import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:https';
import { createServer } from 'node:http';
import { createVideoModelGateway, plannerRequest, plannerResponse } from './video-model-gateway.mjs';

test('the inference request has no native, dynamic, MCP, browser or shell tools', () => {
  const body = plannerRequest({ input: [{ role: 'user', content: 'edit footage' }], tools: [{ name: 'exec_command' }, { type: 'web_search' }], tool_choice: 'required', parallel_tool_calls: true });
  assert.deepEqual(body.tools, []); assert.equal(body.tool_choice, 'none'); assert.equal(body.parallel_tool_calls, false);
  const deferred = plannerRequest({ input: [{ type: 'additional_tools', tools: [{ name: 'read_secret' }] }, { role: 'user', content: 'edit footage' }] });
  assert.equal(deferred.input.length, 1); assert.equal(deferred.input[0].role, 'user');
  for (const type of ['function_call', 'custom_tool_call', 'function_call_output', 'local_shell_call']) assert.throws(() => plannerRequest({ input: [{ type, name: 'read_secret' }] }));
});

const event = value => `data: ${JSON.stringify(value)}\n\n`;
test('no tool call reaches the Codex dispatcher, including tool calls hidden in SSE output', () => {
  const safe = event({ type: 'response.output_item.added', item: { type: 'message', role: 'assistant', content: [] } }) + event({ type: 'response.output_text.delta', delta: '{"status":"refuse"}' }) + event({ type: 'response.completed', response: { output: [{ type: 'message', role: 'assistant' }] } });
  assert.equal(plannerResponse(safe, 'text/event-stream'), safe);
  assert.equal(plannerResponse(safe, ''), safe, 'upstream proxies may omit the SSE content type');
  for (const type of ['function_call', 'custom_tool_call', 'computer_call', 'mcp_call', 'web_search_call', 'local_shell_call', 'code_interpreter_call']) {
    assert.throws(() => plannerResponse(event({ type: 'response.output_item.added', item: { type, name: 'exec_command' } }), 'text/event-stream'));
    assert.throws(() => plannerResponse(JSON.stringify({ output: [{ type }] })));
  }
  assert.throws(() => plannerResponse(event({ type: 'response.function_call_arguments.delta', delta: '{}' }), 'text/event-stream'));
  assert.throws(() => plannerResponse('data: {broken}\n\n', 'text/event-stream'));
});

test('private TLS trusts only its ephemeral authority and normalizes a headerless checked event stream', async () => {
  const gateway = await createVideoModelGateway({ forward: async () => ({ status: 200, headers: {}, body: event({ type: 'response.completed', response: { output: [{ type: 'message', role: 'assistant' }] } }) }) });
  const ask = ca => new Promise((resolve, reject) => {
    const req = request(`${gateway.baseUrl}/codex/responses`, { method: 'POST', ...(ca ? { ca } : {}) }, res => {
      res.resume(); res.once('end', () => resolve({ status: res.statusCode, contentType: res.headers['content-type'] }));
    });
    req.once('error', reject); req.end(JSON.stringify({ input: [{ role: 'user', content: 'trim video' }] }));
  });
  try {
    await assert.rejects(ask(), /certificate|issuer|self.signed/i);
    assert.deepEqual(await ask(gateway.certificate), { status: 200, contentType: 'text/event-stream' });
    assert.equal(gateway.state.responses, 1);
  } finally { await gateway.close(); }
});

test('private HTTP gateway denies unknown routes and browser origins and inspects both directions', async () => {
  const seen = [];
  let malicious = false;
  const gateway = await createVideoModelGateway({ secure: false, forward: async (path, request) => {
    seen.push({ path, body: request.body ? JSON.parse(request.body) : null });
    return { status: 200, headers: { 'content-type': 'text/event-stream' }, body: event({ type: 'response.output_item.done', item: { type: malicious ? 'function_call' : 'message', role: 'assistant' } }) };
  } });
  try {
    const endpoint = `${gateway.baseUrl}/codex/responses`;
    const ask = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: [{ role: 'user', content: 'trim video' }], tools: [{ name: 'shell' }] }) };
    assert.equal((await fetch(endpoint, { ...ask, headers: { ...ask.headers, origin: 'https://untrusted.example' } })).status, 403);
    assert.equal((await fetch(endpoint.replace(/\/[a-f0-9]{64}\//, '/wrong/'), ask)).status, 403);
    assert.equal((await fetch(`${gateway.baseUrl}/plugins/install`, { method: 'POST' })).status, 404);
    assert.equal(seen.length, 0);
    assert.equal((await fetch(endpoint, ask)).status, 200);
    assert.deepEqual(seen[0].body.tools, []); assert.equal(seen[0].body.tool_choice, 'none');
    malicious = true;
    const denied = await fetch(endpoint, ask); assert.equal(denied.status, 502);
    assert.doesNotMatch(await denied.text(), /function_call/);
    assert.equal(gateway.state.responses, 1); assert.equal(gateway.state.blocked, 1);
  } finally { await gateway.close(); }
});

test('hosted forwarding maps the private Codex route to Sub2API and replaces auth', async () => {
  const seen = [];
  const gateway = await createVideoModelGateway({ secure: false, upstreamBaseUrl: 'https://sub2api.example/v1', upstreamHeaders: { authorization: 'Bearer product-key' }, forward: async (path, request) => {
    seen.push({ path, authorization: request.upstreamHeaders?.authorization });
    return { status: 200, headers: { 'content-type': 'text/event-stream' }, body: event({ type: 'response.completed', response: { output: [{ type: 'message', role: 'assistant' }] } }) };
  } });
  try {
    const response = await fetch(`${gateway.baseUrl}/codex/responses`, { method: 'POST', body: JSON.stringify({ input: [{ role: 'user', content: 'edit' }] }) });
    assert.equal(response.status, 200);
    assert.equal(seen[0].path, '/backend-api/codex/responses');
  } finally { await gateway.close(); }
});

test('the real forwarder reaches a local HTTP Sub2API with the configured key', async () => {
  let seen;
  const upstream = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    seen = { path: req.url, auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks)) };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(event({ type: 'response.completed', response: { output: [{ type: 'message', role: 'assistant' }] } }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  let gateway;
  try {
    gateway = await createVideoModelGateway({ secure: false,
      upstreamBaseUrl: `http://127.0.0.1:${upstream.address().port}/v1`,
      upstreamHeaders: { authorization: 'Bearer product-key' },
      proxyEnv: { HTTP_PROXY: 'http://127.0.0.1:1' },
    });
    const response = await fetch(`${gateway.baseUrl}/codex/responses`, {
      method: 'POST', headers: { authorization: 'Bearer local-placeholder' },
      body: JSON.stringify({ input: [{ role: 'user', content: 'edit' }], tools: [{ name: 'shell' }] }),
    });
    assert.equal(response.status, 200);
    assert.equal(seen.path, '/v1/responses');
    assert.equal(seen.auth, 'Bearer product-key');
    assert.deepEqual(seen.body.tools, []);
    assert.equal(gateway.state.responses, 1);
  } finally {
    await gateway?.close();
    upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
  }
});
