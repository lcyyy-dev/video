/** Local Codex connection state. Credentials remain managed by Codex itself. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const AGENT_IDS = Object.freeze(['codex']);
const SIGN_IN_WAIT_MS = 5 * 60_000;
const SIGN_IN_POLL_MS = 3000;
const isOwn = (id) => id === 'codex';

/** Read only supported choices; old agent/model settings are never activated. */
export function readChoices(dataDir) {
  let raw = {};
  try { raw = JSON.parse(readFileSync(join(dataDir, 'agents.json'), 'utf8')); } catch { /* first run */ }
  if (!raw || typeof raw !== 'object') raw = {};
  return {
    paths: typeof raw.paths?.codex === 'string' && raw.paths.codex ? { codex: raw.paths.codex } : {},
    disconnected: Array.isArray(raw.disconnected) && raw.disconnected.includes('codex') ? ['codex'] : [],
  };
}

export function createRoster(deps) {
  const { dataDir } = deps;
  let choices = readChoices(dataDir);
  deps.usePaths?.(choices.paths);
  let local = null;
  const live = { waiting: {}, errors: {} };
  function list() {
    const found = local?.find((agent) => agent.id === 'codex');
    const status = !found ? 'checking' : !found.cli ? 'missing'
      : choices.disconnected.includes('codex') ? 'off'
      : deps.providerConfigured?.() ? 'ready'
      : found.signedIn === false ? (live.waiting.codex ? 'waiting' : 'sign-in') : 'ready';
    return [{ id: 'codex', name: 'Codex', shown: true, status,
      path: found?.cli?.path ?? null, chosen: found?.cli?.source === 'bundled' ? null : choices.paths.codex ?? null,
      ...(found?.cli?.source === 'bundled' ? { managed: true } : {}),
      install: found?.install ?? null, account: found?.account ?? null,
      ...(found?.problem ? { problem: found.problem } : {}),
      ...(live.errors.codex ? { error: live.errors.codex } : {}),
    }];
  }
  const changed = () => deps.onChange(list());
  const save = (next) => {
    choices = next;
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(join(dataDir, 'agents.json'), `${JSON.stringify(choices, null, 2)}\n`, { mode: 0o600 });
    changed();
  };
  async function refresh() {
    local = await deps.localAgents().catch(() => null) ?? local ?? [];
    changed();
    return list();
  }
  async function waitForSignIn(id) {
    live.waiting[id] = true;
    changed();
    const until = Date.now() + SIGN_IN_WAIT_MS;
    while (Date.now() < until && live.waiting[id]) {
      await new Promise((done) => setTimeout(done, SIGN_IN_POLL_MS));
      await refresh();
      if (local?.find((a) => a.id === id)?.signedIn !== false) break;
    }
    delete live.waiting[id];
    changed();
  }

  return {
    list,
    refresh,
    async connect(id) {
      if (!isOwn(id)) return { ok: false, error: `No agent ${id}` };
      delete live.errors[id];
      save({ ...choices, disconnected: [] });
      deps.closeSessions(id);
      try {
        const [now] = await refresh();
        if (now.status === 'sign-in') {
          const opened = await deps.openSignIn(id);
          if (!opened.ok) { live.errors[id] = opened.error ?? 'Terminal did not open.'; changed(); return { ok: false, error: live.errors[id] }; }
          void waitForSignIn(id);
        }
        return { ok: true };
      } catch (e) {
        live.errors[id] = e.message;
        changed();
        return { ok: false, error: e.message };
      }
    },
    disconnect(id) {
      if (!isOwn(id)) return;
      delete live.waiting[id];
      deps.closeSessions(id);
      save({ ...choices, disconnected: ['codex'] });
    },
    /**
     * Point at the program for one of the person's own agents: they choose it, it is tried (`--version`), and it is
     * used from then on. `words`: the dialog's title and button, in Studio's language. `{ ok: false }` without an
     * error when they cancelled.
     */
    async locate(id, words) {
      if (!isOwn(id) || !deps.pickProgram || !deps.checkProgram) return { ok: false, error: `No agent ${id}` };
      const path = await deps.pickProgram(id, words);
      if (!path) return { ok: false };
      const checked = await deps.checkProgram(id, path);
      if (!checked.ok) return { ok: false, error: checked.error ?? '', ...(checked.code ? { code: checked.code } : {}) };
      delete live.errors[id];
      deps.closeSessions(id);
      choices = { ...choices, paths: { ...choices.paths, [id]: path } };
      deps.usePaths?.(choices.paths);
      save(choices);
      await refresh();
      return { ok: true };
    },

    /** Back to finding the program where it is installed. */
    async useAutomatic(id) {
      if (!Object.hasOwn(choices.paths, id)) return { ok: true };
      const { [id]: _gone, ...paths } = choices.paths;
      deps.closeSessions(id);
      choices = { ...choices, paths };
      deps.usePaths?.(choices.paths);
      save(choices);
      await refresh();
      return { ok: true };
    },

    /** What was searched for one of the person's own agents, and why it is not found (see agents.mjs diagnoseAgent). */
    async diagnose(id) {
      if (!isOwn(id) || !deps.diagnose) return null;
      const report = await deps.diagnose(id);
      void refresh();
      return report;
    },

  };
}
