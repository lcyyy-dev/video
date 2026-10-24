/** A private inference boundary: neither requests nor responses can contain executable tools. */
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer, request, Agent } from 'node:https';
import { getCACertificates } from 'node:tls';
import { randomBytes } from 'node:crypto';
import { brotliDecompressSync, gunzipSync, inflateSync, zstdDecompressSync } from 'node:zlib';
import { VIDEO_MODEL_INSTRUCTIONS, VideoPolicyError } from './video-policy.mjs';
import { createVideoLocalTls } from './video-local-tls.mjs';

const MAX_BODY = 24 * 1024 * 1024;
const OUT_ITEMS = new Set(['message', 'reasoning', 'compaction']);
const READ_PATHS = new Set(['/backend-api/wham/accounts/check', '/backend-api/wham/settings/user', '/backend-api/codex/models']);

export function plannerRequest(body, schema) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.input)) throw new VideoPolicyError('视频规划请求无效。');
  // Newer Codex versions put deferred tool definitions in the input as well as in `tools`.
  const input = body.input.filter(item => item?.type !== 'additional_tools');
  for (const item of input) {
    if (item && item.type && !['message', 'reasoning', 'compaction'].includes(item.type)) throw new VideoPolicyError('视频规划器不能使用工具历史。');
    if (item && !['user', 'assistant', 'developer', 'system', undefined].includes(item.role)) throw new VideoPolicyError();
  }
  return { ...body, input, ...(schema ? { text: { ...(body.text ?? {}), format: { type: 'json_schema', name: 'openfilm_video', strict: true, schema } } } : {}), instructions: `${VIDEO_MODEL_INSTRUCTIONS}\n\n${typeof body.instructions === 'string' ? body.instructions : ''}`,
    tools: [], tool_choice: 'none', parallel_tool_calls: false };
}

function checkItem(item) {
  if (!item || !OUT_ITEMS.has(item.type)) throw new VideoPolicyError('视频规划器返回了禁止的工具调用。');
  if (item.type === 'message' && !['assistant', undefined].includes(item.role)) throw new VideoPolicyError();
}

/** Buffer and check the entire response before Codex can dispatch any native tool. */
export function plannerResponse(body, contentType = '') {
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
  if (Buffer.byteLength(text) > MAX_BODY) throw new VideoPolicyError('视频规划响应过大。');
  const events = (contentType.includes('event-stream') || /^\s*(?:data:|event:|:)/.test(text))
    ? text.split(/\r?\n\r?\n/).flatMap(frame => {
      const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      return data && data !== '[DONE]' ? [JSON.parse(data)] : [];
    }) : [JSON.parse(text)];
  if (!events.length) throw new VideoPolicyError('视频规划器未返回结果。');
  for (const event of events) {
    if (typeof event.type === 'string' && /(?:tool|function_call|computer_call|web_search|code_interpreter|file_search|apply_patch|shell)/i.test(event.type)) throw new VideoPolicyError('已拦截规划器的工具调用。');
    if (event.item) checkItem(event.item);
    const output = event.response?.output ?? event.output;
    if (output) {
      if (!Array.isArray(output)) throw new VideoPolicyError();
      output.forEach(checkItem);
    }
  }
  return text;
}

const decode = (body, encoding) => {
  const options = { maxOutputLength: MAX_BODY };
  if (!encoding || encoding === 'identity') return body;
  if (encoding === 'gzip') return gunzipSync(body, options);
  if (encoding === 'deflate') return inflateSync(body, options);
  if (encoding === 'br') return brotliDecompressSync(body, options);
  if (encoding === 'zstd') return zstdDecompressSync(body, options);
  throw new VideoPolicyError('不支持的模型传输编码。');
};

/** Only a fixed official upstream is reachable; no model/user URLs or redirects. */
export async function officialForward(path, options) {
  if (!/^\/backend-api\/(?:codex\/(?:responses|models)|wham\/(?:accounts\/check|settings\/user))(?:\?|$)/.test(path)) throw new VideoPolicyError();
  for (let attempt = 0; ; attempt++) {
    options.signal?.throwIfAborted();
    try { return await forwardOnce(path, options); }
    catch (error) {
      if (attempt >= 2 || options.signal?.aborted || !['ECONNRESET', 'ETIMEDOUT', 'EPIPE'].includes(error.code)) throw error;
    }
  }
}

function forwardOnce(path, { method, headers, body, signal, proxyEnv = process.env }) {
  return new Promise((done, fail) => {
    const agent = new Agent({ proxyEnv, ca: [...getCACertificates('default'), ...getCACertificates('system')] });
    const req = request(new URL(path, 'https://chatgpt.com'), { method, headers, agent, signal, timeout: 180_000 }, res => {
      const chunks = []; let length = 0;
      res.on('data', chunk => { length += chunk.length; if (length > MAX_BODY) req.destroy(new VideoPolicyError()); else chunks.push(chunk); });
      res.on('error', error => { error.responseBytes = length; error.responseType = String(res.headers['content-type'] ?? ''); fail(error); });
      res.on('end', () => {
        try { done({ status: res.statusCode, headers: res.headers, body: decode(Buffer.concat(chunks), res.headers['content-encoding']) }); }
        catch (error) { fail(error); }
        finally { agent.destroy(); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('model timeout')));
    req.on('error', error => { agent.destroy(); fail(error); });
    if (body != null) req.setHeader('content-length', Buffer.byteLength(body));
    req.end(body);
  });
}

export async function createVideoModelGateway({ forward = officialForward, proxyEnv, secure = true } = {}) {
  const capability = randomBytes(32).toString('hex');
  const state = { requests: 0, responses: 0, blocked: 0, unauthorized: 0, tlsErrors: {}, deniedRoutes: {}, failures: [], inputTypes: [] };
  let schema;
  const pending = new Set();
  const tls = secure ? createVideoLocalTls() : null;
  const handler = async (req, res) => {
    const abort = new AbortController(); pending.add(abort);
    res.on('close', () => { if (!res.writableEnded) abort.abort(); });
    const reply = (status, body) => { if (!res.destroyed) { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); } };
    try {
      if (req.headers.origin || !/^127\.0\.0\.1:\d+$/.test(req.headers.host ?? '') || !req.url?.startsWith(`/${capability}/`)) { state.unauthorized++; return reply(403, { error: { message: 'Forbidden' } }); }
      const url = new URL(req.url.slice(capability.length + 1), 'http://localhost');
      const path = url.pathname;
      const inference = req.method === 'POST' && path === '/backend-api/codex/responses';
      if (!inference && !(req.method === 'GET' && READ_PATHS.has(path))) {
        state.deniedRoutes[path] = (state.deniedRoutes[path] ?? 0) + 1;
        // Plugin discovery and telemetry are deliberately never forwarded.
        return reply(404, { error: { message: 'Unavailable in video mode' } });
      }
      const headers = {};
      for (const key of ['authorization', 'chatgpt-account-id', 'openai-beta', 'originator', 'version', 'user-agent', 'session_id', 'conversation_id']) {
        if (typeof req.headers[key] === 'string') headers[key] = req.headers[key];
      }
      headers['accept-encoding'] = 'identity';
      let body;
      if (inference) {
        const chunks = []; let length = 0;
        for await (const chunk of req) { length += chunk.length; if (length > MAX_BODY) throw new VideoPolicyError(); chunks.push(chunk); }
        const raw = decode(Buffer.concat(chunks), req.headers['content-encoding']);
        const parsed = JSON.parse(raw.toString('utf8'));
        state.inputTypes = Array.isArray(parsed.input) ? [...new Set(parsed.input.map(item => /^[a-z_]{1,40}$/.test(item?.type ?? item?.role ?? '') ? item.type ?? item.role : 'unknown'))] : [];
        body = JSON.stringify(plannerRequest(parsed, schema));
        headers['content-type'] = 'application/json'; headers.accept = 'text/event-stream';
        state.requests++;
      }
      const answer = await forward(`${path}${url.search}`, { method: req.method, headers, body, signal: abort.signal, proxyEnv });
      state.lastTransport = { status: answer.status, contentType: String(answer.headers['content-type'] ?? ''), bytes: Buffer.byteLength(answer.body), format: /^\s*(?:data:|event:|:)/.test(String(answer.body)) ? 'sse' : /^\s*[\[{]/.test(String(answer.body)) ? 'json' : 'other' };
      if (answer.status < 200 || answer.status >= 300) return reply(answer.status === 401 ? 401 : 502, { error: { message: answer.status === 401 ? 'Sign in to Codex again.' : 'Video planner is temporarily unavailable.' } });
      const contentType = inference && state.lastTransport.format === 'sse' ? 'text/event-stream' : String(answer.headers['content-type'] ?? 'application/json');
      const checked = inference ? plannerResponse(answer.body, contentType) : answer.body;
      if (inference) state.responses++;
      res.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' }); res.end(checked);
    } catch (error) {
      state.blocked++;
      state.failures = [...state.failures.slice(-4), { name: String(error.name), code: typeof error.code === 'string' ? error.code : null, responseBytes: error.responseBytes, responseType: error.responseType, reason: error instanceof VideoPolicyError ? error.message : 'Transport or data rejected' }];
      reply(502, { error: { message: 'Video-only policy rejected this request or response.' } });
    } finally { pending.delete(abort); }
  };
  const server = secure ? createHttpsServer(tls, handler) : createHttpServer(handler);
  server.on('tlsClientError', error => { const code = String(error.code ?? 'unknown'); state.tlsErrors[code] = (state.tlsErrors[code] ?? 0) + 1; });
  // A WebSocket path would bypass the request/response inspection; never accept upgrades.
  server.on('upgrade', (_req, socket) => socket.destroy());
  server.requestTimeout = 200_000;
  server.headersTimeout = 10_000;
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
  const origin = `${secure ? 'https' : 'http'}://127.0.0.1:${server.address().port}/${capability}`;
  return {
    baseUrl: `${origin}/backend-api`, certificate: tls?.ca ?? null, state,
    setSchema(value) { schema = value; },
    async close() { for (const abort of pending) abort.abort(); server.closeAllConnections(); await new Promise(done => server.close(done)); },
  };
}
