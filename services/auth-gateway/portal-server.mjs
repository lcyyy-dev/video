import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFileSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
const root = resolve(process.env.PORTAL_DIST ?? '/portal');
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon' };
createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/v1/') || req.url.startsWith('/-/')) {
      const headers = { 'x-forwarded-proto': 'https', host: process.env.KEYGEN_API_HOST ?? 'api.keygen.localhost' };
      for (const name of ['authorization', 'content-type', 'accept', 'keygen-version', 'keygen-environment']) if (typeof req.headers[name] === 'string') headers[name] = req.headers[name];
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 2 * 1024 * 1024) { res.writeHead(413); return res.end(); } chunks.push(chunk); }
      const base = process.env.KEYGEN_URL.replace(/\/v1\/?$/, '');
      // Node fetch does not reliably honor a custom Host header; Rails uses it for account routes.
      const target = new URL(`${base}${req.url}`);
      const response = await new Promise((resolveResponse, reject) => {
        const upstream = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, { method: req.method, headers, signal: AbortSignal.timeout(30000) }, resolveResponse);
        upstream.on('error', reject);
        res.on('close', () => { if (!res.writableEnded) upstream.destroy(); });
        upstream.end(!['GET', 'HEAD'].includes(req.method) ? Buffer.concat(chunks) : undefined);
      });
      res.writeHead(response.statusCode, { 'content-type': response.headers['content-type'] ?? 'application/json', 'cache-control': 'no-store' });
      await pipeline(response, res);
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = resolve(root, `.${pathname}`);
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403); return res.end(); }
    try { if (!statSync(file).isFile()) file = resolve(root, 'index.html'); } catch { file = resolve(root, 'index.html'); }
    const content = req.method === 'HEAD' ? undefined : readFileSync(file);
    res.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream', 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff' });
    res.end(content);
  } catch { if (!res.headersSent) res.writeHead(502); res.end(); }
}).listen(Number(process.env.PORTAL_PORT ?? 8791), process.env.PORTAL_BIND ?? '127.0.0.1');
