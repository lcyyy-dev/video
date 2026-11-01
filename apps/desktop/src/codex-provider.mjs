/** Credential-only bridge. Codex owns the Responses protocol, including streaming and tool calls. */
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

async function requestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function createCodexProvider({ baseUrl, apiKey, fetchImpl = fetch, narration }) {
  const token = randomBytes(32).toString('hex');
  const narrationCapability = randomBytes(32).toString('hex');
  const pending = new Set();
  const server = createServer(async (req, res) => {
    const supplied = Buffer.from(String(req.headers.authorization ?? ''));
    const isNarration = Boolean(narration && req.method === 'POST' && req.url === '/tts/generate');
    const expected = Buffer.from(`Bearer ${isNarration ? narrationCapability : token}`);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected) || req.headers.origin) {
      res.writeHead(403); res.end(); return;
    }
    const url = new URL(req.url, 'http://localhost');
    if (isNarration) {
      if (Number(req.headers['content-length'] ?? 0) !== 0 || req.headers['transfer-encoding']) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: '旁白接口不接受请求参数。' } })); return;
      }
      const controller = new AbortController(); pending.add(controller);
      res.on('close', () => { if (!res.writableEnded) controller.abort(); });
      try {
        const result = await narration(controller.signal);
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(result));
      } catch (error) {
        if (!res.headersSent) res.writeHead(422, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
      } finally { pending.delete(controller); }
      return;
    }
    if (!((req.method === 'POST' && url.pathname === '/v1/responses') || (req.method === 'GET' && url.pathname === '/v1/models'))) {
      res.writeHead(404); res.end(); return;
    }
    const controller = new AbortController(); pending.add(controller);
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    try {
      const body = req.method === 'POST' ? await requestBody(req) : undefined;
      const headers = { authorization: `Bearer ${apiKey}`, accept: req.headers.accept ?? 'text/event-stream' };
      for (const key of ['content-type', 'content-encoding', 'openai-beta', 'session_id', 'conversation_id']) {
        if (typeof req.headers[key] === 'string') headers[key] = req.headers[key];
      }
      const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}${url.pathname.slice(3)}${url.search}`, {
        method: req.method, headers, signal: controller.signal,
        ...(req.method === 'POST' ? { body } : {}),
      });
      res.writeHead(response.status, { 'content-type': response.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' });
      if (response.body) await pipeline(Readable.fromWeb(response.body), res);
      else res.end();
    } catch {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' });
      if (!res.destroyed) res.end(JSON.stringify({ error: { message: '模型连接中断，请重试。' } }));
    } finally { pending.delete(controller); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`, token, narrationCapability,
    async close() {
      for (const controller of pending) controller.abort();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}
