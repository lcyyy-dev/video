/** Read the current Codex session's model calls for local diagnostics. */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The agents whose records (or logs) are read. */
export const RECORDED_AGENTS = Object.freeze(['codex']);

/** a record longer than this is not read: one turn's requests are not worth reading hundreds of megabytes */
const RECORD_MAX = 256 * 1024 * 1024;

const lines = (file) => {
  try {
    if (statSync(file).size > RECORD_MAX) return [];
    return readFileSync(file, 'utf8').split('\n').flatMap((line) => { try { return line ? [JSON.parse(line)] : []; } catch { return []; } });
  } catch { return []; }
};
const ms = (iso) => { const t = Date.parse(String(iso ?? '')); return Number.isFinite(t) ? t : null; };
const str = (v) => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v));
/** a picture as the turn log shows it: its type and its data (base64) */
const picture = (mimeType, data) => ({ type: 'image', mimeType: String(mimeType || 'image/png'), data: String(data ?? '') });

/** The rollout of a Codex session, or null: in its sessions (newest days first), or archived. */
export function findCodexRecord({ sessionId, env = {} }) {
  if (!/^[\w-]{8,80}$/.test(String(sessionId ?? ''))) return null;
  const home = env.CODEX_HOME || join(homedir(), '.codex');
  const suffix = `-${sessionId}.jsonl`;
  const sorted = (dir) => { try { return readdirSync(dir).sort().reverse(); } catch { return []; } };
  const sessions = join(home, 'sessions');
  for (const y of sorted(sessions)) {
    for (const m of sorted(join(sessions, y))) {
      for (const d of sorted(join(sessions, y, m))) {
        const hit = sorted(join(sessions, y, m, d)).find((n) => n.endsWith(suffix));
        if (hit) return join(sessions, y, m, d, hit);
      }
    }
  }
  const archived = sorted(join(home, 'archived_sessions')).find((n) => n.endsWith(suffix));
  return archived ? join(home, 'archived_sessions', archived) : null;
}

/** OpenAI's usage as the turn log counts it (its input counts the cached part too). */
const codexUsage = (u = {}) => {
  const cached = Number(u.cached_input_tokens) || 0;
  return {
    input: Math.max(0, (Number(u.input_tokens) || 0) - cached),
    cacheRead: cached,
    cacheWrite: Number(u.cache_write_input_tokens) || 0,
    output: Number(u.output_tokens) || 0,
    reasoning: Number(u.reasoning_output_tokens) || 0,
  };
};

/** A message's content parts (input_text, output_text, input_image), as the turn log has them. */
function codexParts(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return (Array.isArray(content) ? content : []).map((p) => {
    if (typeof p?.text === 'string') return { type: 'text', text: p.text };
    if (p?.type === 'input_image') {
      const m = /^data:([^;,]+);base64,(.*)$/s.exec(String(p.image_url ?? ''));
      return m ? picture(m[1], m[2]) : { type: 'text', text: `[image ${str(p.image_url).slice(0, 200)}]` };
    }
    return { type: 'other', value: p };
  });
}

/* what Codex puts in as the person's words by itself: its environment, the project's AGENTS.md and the like */
const CODEX_CONTEXT = [
  [/^\s*<environment_context>/, 'environment_context'],
  [/^\s*# AGENTS\.md instructions/, 'AGENTS.md'],
  [/^\s*<user_instructions>/, 'user_instructions'],
  [/^\s*<turn_aborted>/, 'turn_aborted'],
];

/** An output of a request (what the model said or asked for), as a part of its answer; null for anything else. */
function codexOutput(item) {
  switch (item?.type) {
    case 'message': return item.role === 'assistant' ? codexParts(item.content) : null;
    case 'reasoning': {
      const said = [...(item.summary ?? []), ...(item.content ?? [])].map((s) => s?.text).filter((t) => typeof t === 'string');
      return [{ type: 'thinking', thinking: said.length ? said.join('\n\n') : item.encrypted_content ? '[encrypted]' : '' }];
    }
    case 'function_call': {
      let args = item.arguments;
      try { args = JSON.parse(item.arguments); } catch { /* as written */ }
      return [{ type: 'toolCall', id: String(item.call_id ?? item.id ?? ''), name: String(item.name ?? ''), arguments: args ?? {} }];
    }
    case 'custom_tool_call': return [{ type: 'toolCall', id: String(item.call_id ?? item.id ?? ''), name: String(item.name ?? ''), arguments: item.input ?? '' }];
    case 'local_shell_call': return [{ type: 'toolCall', id: String(item.call_id ?? item.id ?? ''), name: 'local_shell', arguments: item.action ?? {} }];
    case 'web_search_call': return [{ type: 'toolCall', id: String(item.id ?? ''), name: 'web_search', arguments: item.action ?? {} }];
    case 'image_generation_call': return [{ type: 'toolCall', id: String(item.id ?? ''), name: 'image_generation', arguments: { prompt: item.revised_prompt ?? '' } }];
    default: return null;
  }
}

/** An input of a request (a message to the model, a tool's output), as a message; null for anything else. */
function codexInput(item, tools) {
  if (item?.type === 'message' && item.role !== 'assistant') {
    const content = codexParts(item.content);
    if (item.role === 'user') {
      const text = content.map((p) => p.text ?? '').join('');
      const known = CODEX_CONTEXT.find(([re]) => re.test(text));
      if (known) return { role: 'context', as: 'user', label: known[1], content };
      return { role: 'user', content };
    }
    return { role: 'context', as: String(item.role), label: String(item.role), content };
  }
  if (/_call_output$/.test(String(item?.type))) {
    const out = item.output;
    const content = typeof out === 'string' ? [{ type: 'text', text: out }]
      : Array.isArray(out) ? codexParts(out)
        : typeof out?.content === 'string' ? [{ type: 'text', text: out.content }] : [{ type: 'text', text: str(out) }];
    return { role: 'toolResult', toolCallId: String(item.call_id ?? ''), toolName: tools.get(item.call_id) ?? 'tool', content, isError: out?.success === false };
  }
  return null;
}

/**
 * The requests in one Codex rollout that ended between `from` and `to` (ms), each whole: the base instructions as
 * its system prompt, everything before it as its messages, what it said and asked for as its answer, its usage, and
 * the turn's settings (model, effort, permissions). No tools: Codex does not keep them.
 */
export function codexCallsOf(entries, { from = 0, to = Infinity } = {}) {
  let systemPrompt = null;
  let settings = null;
  const history = [];
  const tools = new Map();
  let out = [];
  let sentAt = null;
  const calls = [];
  const usageRecords = entries.some((e) => e?.type === 'token_usage_record');
  const close = (at, usage) => {
    if (!out.length && !usage) return;
    const answer = { role: 'assistant', content: out, usage: codexUsage(usage ?? {}),
      ...(settings?.model ? { responseModel: settings.model } : {}), ...(settings?.effort ? { thinkingLevel: settings.effort } : {}) };
    for (const part of out) if (part.type === 'toolCall') tools.set(part.id, part.name);
    const started = sentAt ?? at ?? 0;
    if ((at ?? started) >= from && (at ?? started) <= to) {
      calls.push({ startedAt: started, ms: Math.max(0, (at ?? started) - started), messages: history.map((m) => ({ ...m })), systemPrompt, tools: null, toolsUnknown: true, answer, ...(settings ? { settings } : {}) });
    }
    if (out.length) history.push({ role: 'assistant', content: out });
    out = [];
    sentAt = null;
  };
  for (const e of entries) {
    const p = e?.payload ?? {};
    const at = ms(e?.timestamp);
    if (e?.type === 'session_meta') {
      const base = p.base_instructions ?? p.instructions;
      systemPrompt = typeof base === 'string' ? base : typeof base?.text === 'string' ? base.text : systemPrompt;
    } else if (e?.type === 'turn_context') {
      settings = p;
    } else if (e?.type === 'compacted') {
      close(at, null);
      history.length = 0;
      const kept = Array.isArray(p.replacement_history) ? p.replacement_history.map((i) => codexInput(i, tools) ?? (codexOutput(i) ? { role: 'assistant', content: codexOutput(i) } : null)).filter(Boolean) : [];
      history.push(...(kept.length ? kept : [{ role: 'context', as: 'user', label: 'compaction summary', content: [{ type: 'text', text: str(p.message) }] }]));
    } else if (e?.type === 'response_item') {
      const said = codexOutput(p);
      if (said) { sentAt ??= at; out.push(...said); continue; }
      const input = codexInput(p, tools);
      if (!input) continue;
      /* an input while an answer is open: that answer ended without its usage being kept */
      if (out.length) close(at, null);
      history.push(input);
      sentAt = at;
    } else if (e?.type === 'token_usage_record' || (!usageRecords && e?.type === 'event_msg' && p.type === 'token_count' && p.info?.last_token_usage)) {
      close(at, e.type === 'token_usage_record' ? p.usage : p.info.last_token_usage);
    }
  }
  close(null, null);
  return calls;
}

export const codexCalls = (file, { from = 0, to = Infinity } = {}) => codexCallsOf(lines(file), { from, to });

export function agentRecordCalls({ agent, sessionId, from, to, env = {} }) {
  if (agent !== 'codex') return null;
  const file = findCodexRecord({ sessionId, env });
  return file ? { file, calls: codexCalls(file, { from, to }).map((call) => ({ ...call, source: { agent, file } })) } : null;
}

export function compactCalls(calls) {
  let keys = [];
  const last = { systemPrompt: 'null', tools: 'null', settings: 'null', source: 'null', thread: 'null' };
  return calls.map((call) => {
    const all = call.messages.map((m) => JSON.stringify(m));
    let prefix = 0;
    while (prefix < keys.length && prefix < all.length && keys[prefix] === all[prefix]) prefix += 1;
    keys = all;
    const line = { startedAt: call.startedAt, ms: call.ms, prefix, messages: call.messages.slice(prefix), answer: call.answer ?? null };
    for (const field of /** @type {const} */ (['systemPrompt', 'tools', 'settings', 'source', 'thread'])) {
      const key = JSON.stringify(call[field] ?? null);
      if (key !== last[field]) { line[field] = call[field] ?? null; last[field] = key; }
    }
    if (call.toolsUnknown) line.toolsUnknown = true;
    if (call.lacks?.length) line.lacks = call.lacks;
    return line;
  });
}
