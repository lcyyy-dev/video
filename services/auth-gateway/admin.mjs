import { openProfileStore } from './profiles.mjs';
import { openLogStore } from './log-store.mjs';
import { keyReference } from './logs.mjs';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function createAdmin(config) {
  const sessions = new Map();
  const sessionFile = config.sessionFile ?? `${config.mappingFile}.sessions.json`;
  const attempts = new Map();
  const fetchImpl = config.fetchImpl ?? fetch;
  const readMappings = () => JSON.parse(readFileSync(config.mappingFile, 'utf8'));
  const saveMappings = value => {
    const temp = `${config.mappingFile}.tmp`;
    writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
    renameSync(temp, config.mappingFile);
  };
  const persistSessions = () => {
    const temp = `${sessionFile}.tmp`;
    writeFileSync(temp, JSON.stringify(Object.fromEntries(sessions)), { mode: 0o600 });
    renameSync(temp, sessionFile);
  };
  try {
    const saved = JSON.parse(readFileSync(sessionFile, 'utf8'));
    for (const [id, session] of Object.entries(saved)) {
      if (/^[a-f0-9]{64}$/.test(id) && session && Number.isFinite(session.exp) && session.exp > Date.now() && /^[a-f0-9]{48}$/.test(session.csrf)) {
        sessions.set(id, { csrf: session.csrf, exp: session.exp });
      }
    }
  } catch { /* first start, or an expired/missing session store */ }
  async function keygen(path, method = 'GET', body, authorization = `Bearer ${config.keygenToken}`) {
    const response = await fetchImpl(`${config.keygenUrl.replace(/\/$/, '')}${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { authorization, 'content-type': 'application/vnd.api+json', accept: 'application/vnd.api+json', 'x-forwarded-proto': 'https' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const result = response.status === 204 ? {} : await response.json();
    if (!response.ok) throw Object.assign(new Error(`授权服务操作失败（${response.status}）`), { status: response.status < 500 ? 400 : 502 });
    return result;
  }
  async function list(path) {
    const data = [];
    for (let page = 1; page <= 100; page++) {
      const result = await keygen(`${path}?page[size]=100&page[number]=${page}`);
      data.push(...result.data);
      if (result.data.length < 100) return data;
    }
    throw new Error('记录过多，请使用官方 Portal 管理');
  }
  return createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'");
    const json = (status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && ['/', '/licenses', '/logs', '/diagnostics', '/admin.js'].includes(url.pathname)) {
        res.setHeader('content-type', url.pathname === '/admin.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
        return res.end(readFileSync(new URL(url.pathname === '/admin.js' ? './admin-ui.js' : './admin.html', import.meta.url)));
      }
      if (!url.pathname.startsWith('/admin/')) return json(404, { error: '接口不存在' });
      const expectedOrigin = `http://${req.headers.host}`;
      if (req.method !== 'GET' && req.headers.origin !== expectedOrigin) return json(403, { error: '请求来源无效' });
      let body = {};
      if (req.method !== 'GET') {
        let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 65536) throw Object.assign(new Error('请求过大'), { status: 413 }); }
        try { body = JSON.parse(raw || '{}'); } catch { return json(400, { error: '请求格式错误' }); }
      }
      if (url.pathname === '/admin/login' && req.method === 'POST') {
        const ip = req.socket.remoteAddress;
        const now = Date.now(); const previous = attempts.get(ip);
        const entry = previous && previous.until > now ? previous : { count: 0, until: now + 60000 };
        if (++entry.count > 10) return json(429, { error: '尝试过多，请稍后再试' });
        attempts.set(ip, entry);
        const basic = `Basic ${Buffer.from(`${body.email}:${body.password}`).toString('base64')}`;
        const token = await keygen('/tokens', 'POST', { data: { type: 'tokens', attributes: { name: 'OpenFilm admin', expiry: new Date(now + 8 * 3600000).toISOString() } } }, basic);
        const access = token.data?.attributes?.token;
        const profile = await keygen('/me', 'GET', null, `Bearer ${access}`);
        if (profile.data?.attributes?.role !== 'admin') return json(403, { error: '需要管理员账号' });
        for (const [id, session] of sessions) if (session.exp < now) sessions.delete(id);
        const id = randomBytes(32).toString('hex'); const csrf = randomBytes(24).toString('hex');
        sessions.set(id, { csrf, exp: now + 8 * 3600000 });
        persistSessions();
        res.setHeader('set-cookie', `openfilm_admin=${id}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=28800`);
        return json(200, { csrf });
      }
      const id = /(?:^|;\s*)openfilm_admin=([a-f0-9]+)/.exec(req.headers.cookie ?? '')?.[1];
      const session = sessions.get(id);
      if (!session || session.exp < Date.now()) return json(401, { error: '请登录管理员账号' });
      if (req.method !== 'GET' && req.headers['x-csrf-token'] !== session.csrf) return json(403, { error: '请求校验失败' });
      if (url.pathname === '/admin/session' && req.method === 'GET') return json(200, { csrf: session.csrf });
      if (url.pathname === '/admin/logout' && req.method === 'POST') { sessions.delete(id); persistSessions(); return json(200, { ok: true }); }
      if (url.pathname === '/admin/logs' && req.method === 'GET') {
        if(!config.logStore)return json(503,{error:'日志数据库未配置'});
        const result=await config.logStore.queryEvents(url.searchParams);let mappings={};try{mappings=readMappings();}catch{/* Log access remains available when mapping storage is broken. */}
        return json(200,{...result,configured:true,events:result.events.map(event=>({...event,userName:mappings[event.licenseId]?.name??''}))});
      }
      if (url.pathname === '/admin/diagnostics' && req.method === 'GET') {
        if(!config.logStore)return json(503,{error:'日志数据库未配置'});
        const result=await config.logStore.queryEvents(new URLSearchParams({source:'monitor',limit:'100',from:new Date(Date.now()-3600000).toISOString()}));
        const latest=result.events.find(event=>event.event==='link.summary');
        return json(200,{configured:true,storage:await config.logStore.status(),latest:latest??null,probes:result.events.filter(event=>event.event==='link.probe'&&event.probeId===latest?.probeId)});
      }
      if (url.pathname === '/admin/state' && req.method === 'GET') {
        const [licenses, policies] = await Promise.all([list('/licenses'), list('/policies')]);
        const mappings = readMappings();
        return json(200, {
          licenses: await Promise.all(licenses.map(async item => ({ ...(config.profileStore ? await config.profileStore.ensure(item.id) : {}), id: item.id, key: item.attributes.key, name: mappings[item.id]?.name ?? '', suspended: item.attributes.suspended, expiry: item.attributes.expiry, mapped: Boolean(mappings[item.id]?.apiKey), keyRef:keyReference(mappings[item.id]?.apiKey), policyId: item.relationships?.policy?.data?.id }))),
          policies: policies.map(item => ({ id: item.id, name: item.attributes.name, maxMachines: item.attributes.maxMachines })),
        });
      }
      if (url.pathname === '/admin/issue' && req.method === 'POST') {
        if (!body.policyId || typeof body.apiKey !== 'string' || !body.apiKey.trim()) return json(400, { error: '请选择策略并填写用户 sub2api Key' });
        const attributes = {};
        if (body.expiry) { const expiry = new Date(body.expiry); if (!Number.isFinite(expiry.getTime())) return json(400, { error: '到期时间无效' }); attributes.expiry = expiry.toISOString(); }
        const license = await keygen('/licenses', 'POST', { data: { type: 'licenses', attributes, relationships: { policy: { data: { type: 'policies', id: body.policyId } } } } });
        try { await config.profileStore?.ensure(license.data.id); const mappings = readMappings(); mappings[license.data.id] = { apiKey: body.apiKey.trim(), name: String(body.name ?? '').slice(0, 100) }; saveMappings(mappings); }
        catch (error) { await keygen(`/licenses/${license.data.id}/actions/suspend`, 'POST'); throw error; }
        return json(200, { activationCode: license.data.attributes.key, ...(config.profileStore ? await config.profileStore.ensure(license.data.id) : {}) });
      }
      const match = /^\/admin\/licenses\/([a-zA-Z0-9-]+)(?:\/(devices|mapping|suspend|reinstate))?$/.exec(url.pathname);
      if (!match) return json(404, { error: '接口不存在' });
      const licenseId = match[1], action = match[2];
      await keygen(`/licenses/${licenseId}`);
      if (action === 'devices' && req.method === 'GET') {
        const devices = await list(`/licenses/${licenseId}/machines`);
        return json(200, { devices: devices.map(item => ({ id: item.id, fingerprint: item.attributes.fingerprint, created: item.attributes.created })) });
      }
      if (action === 'devices' && req.method === 'DELETE') {
        const devices = await list(`/licenses/${licenseId}/machines`);
        if (!devices.some(item => item.id === body.deviceId)) return json(400, { error: '设备不属于该授权' });
        await keygen(`/machines/${body.deviceId}`, 'DELETE');
        return json(200, { ok: true });
      }
      if (action === 'mapping' && req.method === 'POST') {
        const mappings = readMappings(); const old = mappings[licenseId] ?? {};
        if (!old.apiKey && !body.apiKey) return json(400, { error: '请输入用户 sub2api Key' });
        mappings[licenseId] = { apiKey: body.apiKey?.trim() || old.apiKey, name: String(body.name ?? old.name ?? '').slice(0, 100) };
        saveMappings(mappings); return json(200, { ok: true });
      }
      if (action === 'mapping' && req.method === 'DELETE') {
        const mappings = readMappings(); delete mappings[licenseId]; saveMappings(mappings); return json(200, { ok: true });
      }
      if (['suspend', 'reinstate'].includes(action) && req.method === 'POST') {
        await keygen(`/licenses/${licenseId}/actions/${action}`, 'POST'); return json(200, { ok: true });
      }
      return json(404, { error: '接口不存在' });
    } catch (error) {
      const logQuery=req.url?.startsWith('/admin/logs')||req.url?.startsWith('/admin/diagnostics');
      json(error.status??(logQuery?503:502),{error:error.status?error.message:logQuery?'日志数据库连接或查询失败，请检查 PostgreSQL':'管理操作失败，请检查服务日志及配置'});
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const logStore=await openLogStore(process.env.LOG_DATABASE_READ_URL||process.env.LOG_DATABASE_URL);
  const profileStore=await openProfileStore(process.env.PROFILE_DATABASE_URL||process.env.LOG_DATABASE_URL);
  const server=createAdmin({ profileStore, logStore, mappingFile: process.env.MAPPING_FILE ?? '/data/mappings.json', keygenUrl: process.env.KEYGEN_URL, keygenToken: process.env.KEYGEN_TOKEN });
  server.listen(Number(process.env.ADMIN_PORT??8790),process.env.ADMIN_BIND??'127.0.0.1');
  const stop=()=>{server.closeIdleConnections();server.close(async()=>{await profileStore.close();await logStore.close();process.exit(0);});setTimeout(()=>server.closeAllConnections(),5000).unref();};
  process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
