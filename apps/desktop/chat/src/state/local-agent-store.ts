/**
 * The chat's agent and its options, including the composer's read-only model display.
 *
 * Which agents there are, whether each is connected and whether the person switched it on for the chat, is the app's
 * roster (apps/desktop/src/agent-roster.mjs; Settings → Agents changes it): the menu lists the agents switched on,
 * and the chat uses the one picked while it is on and ready, else the first one that is.
 *
 * Kept here, on this computer: which agent was picked, the options picked for each (model, reasoning effort, speed:
 * ACP configOption ids) and the option list each last reported, so the menu shows "6 Astra · Medium" before the
 * first message (the list only comes with a session).
 */
import { create } from 'zustand';
import { CLIENT_AGENTS } from 'openfilm/client-scope';
import {
  desktopBridge,
  type LocalAgentId,
  type LocalAgentSessionInfo,
  type RosterAgent,
} from '@/lib/desktop-bridge';
import { forgetLocalAgentSessions, keepCommands, readCommands } from '@/lib/local-agent-run';

export type AgentPick = LocalAgentId;

type ConfigOptions = NonNullable<LocalAgentSessionInfo['configOptions']>;

const AGENT_IDS = CLIENT_AGENTS as readonly LocalAgentId[];
const isAgent = (v: unknown): v is LocalAgentId => AGENT_IDS.includes(v as LocalAgentId);

interface Persisted {
  picked: LocalAgentId;
  prefs: Partial<Record<LocalAgentId, Record<string, unknown>>>;
  options: Partial<Record<LocalAgentId, ConfigOptions>>;
}

interface LocalAgentStore extends Persisted {
  hydrated: boolean;
  /** The roster as the app last told it; null = not told yet (or not in the app). */
  roster: RosterAgent[] | null;
  /**
   * Asking an agent for its option list failed (its adapter would not start): the menu says so, with what it said
   * (`text`) and why, when known (`code`: 'outdated', a Codex older than the chat needs).
   */
  optionsError: Partial<Record<LocalAgentId, { text: string; code?: string }>>;
  hydrate(): void;
  refresh(): Promise<void>;
  pick(agent: LocalAgentId): void;
  setPref(agent: LocalAgentId, configId: string, value: unknown): void;
  /** The option list a session reported, kept for the menu. */
  noteOptions(agent: LocalAgentId, options: ConfigOptions | null): void;
  /** No option list yet: ask for one (a session opened and closed, nothing said, nothing spent). */
  /** Ask the agent for its options once; one that failed is asked again only on `retry` (the menu opened, Retry). */
  ensureOptions(agent: LocalAgentId, opts?: { retry?: boolean }): Promise<void>;
}

const probing = new Set<LocalAgentId>();
/** the agents asked for their options since the app started: the ones kept from before are shown until then, but an
    agent updated since (Claude Code with new models) has other options, so each is asked once a launch */
const askedThisLaunch = new Set<LocalAgentId>();

const KEY = 'openfilm.local-agents.v2';

function load(): Persisted {
  const empty: Persisted = { picked: 'codex', prefs: {}, options: {} };
  if (typeof window === 'undefined') return empty;
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? window.localStorage.getItem('openfilm.local-agents.v1') ?? 'null') as Partial<Persisted> | null;
    if (!raw) return empty;
    return {
      picked: isAgent(raw.picked) ? raw.picked : 'codex',
      prefs: raw.prefs && typeof raw.prefs === 'object' ? raw.prefs : {},
      options: raw.options && typeof raw.options === 'object' ? raw.options : {},
    };
  } catch {
    return empty;
  }
}

function save(s: Persisted): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ picked: s.picked, prefs: s.prefs, options: s.options }));
  } catch { /* private mode */ }
}

/** Codex reports the available models and controls through its session. */
export function agentOptions(state: Pick<LocalAgentStore, 'options' | 'roster'> & Partial<Pick<LocalAgentStore, 'prefs'>>, agent: LocalAgentId): ConfigOptions | undefined {
  return state.options[agent];
}
export function offeredOption(_agent: LocalAgentId, _roster: RosterAgent[] | null, _option: { id: string; category?: string; name?: string }): boolean { return true; }
export function offeredChoices<T extends { value: unknown }>(_agent: LocalAgentId, option: { id: string; category?: string; options?: T[] }, _chosen: unknown): T[] {
  return (option.options ?? []).filter((choice) => choice.value !== 'default');
}

/** The agents the menu lists: the ones switched on in Settings, in the roster's order. */
export function shownAgents(roster: RosterAgent[] | null): RosterAgent[] {
  return (roster ?? []).filter((a) => CLIENT_AGENTS.includes(a.id) && a.shown);
}

/** The agent the chat uses: the one picked while it is shown and ready, else the first shown one that is ready. */
export function currentAgent(state: Pick<LocalAgentStore, 'picked' | 'roster'>): LocalAgentId {
  const shown = shownAgents(state.roster);
  const picked = shown.find((a) => a.id === state.picked);
  if (picked?.status === 'ready' || !state.roster) return state.picked;
  return shown.find((a) => a.status === 'ready')?.id ?? picked?.id ?? shown[0]?.id ?? state.picked;
}

let listening = false;

export const useLocalAgents = create<LocalAgentStore>((set, get) => ({
  picked: 'codex',
  prefs: {},
  options: {},
  hydrated: false,
  roster: null,
  optionsError: {},
  hydrate() {
    if (get().hydrated) return;
    set({ ...load(), hydrated: true });
    const api = desktopBridge()?.agents;
    if (api && !listening) {
      listening = true;
      api.onChange((roster) => {
        /* an agent that stopped being ready: what its sessions held goes (it may be another account next time) */
        for (const before of get().roster ?? []) {
          const now = roster.find((a) => a.id === before.id);
          if (before.status === 'ready' && now?.status !== 'ready') forgetLocalAgentSessions(before.id);
          /* other models (the own key's): its sessions were closed for the next ones to use them */
        }
        set({ roster });
      });
    }
    void get().refresh();
  },
  async refresh() {
    const roster = await desktopBridge()?.agents?.list().catch(() => null);
    if (roster) set({ roster });
  },
  pick(picked) {
    if (!isAgent(picked)) return;
    set({ picked });
    save(get());
  },
  setPref(agent, configId, value) {
    const prefs = { ...get().prefs, [agent]: { ...(get().prefs[agent] ?? {}), [configId]: value } };
    set({ prefs });
    save(get());
  },
  noteOptions(agent, options) {
    if (!options) return;
    set({ options: { ...get().options, [agent]: options } });
    save(get());
  },
  async ensureOptions(agent, { retry = false } = {}) {
    /* the own key's are known from Settings (agentOptions); a failed probe is not tried again on every render, each
       try being a whole session of the agent's */
    if (probing.has(agent)) return;
    const kept = Boolean(get().options[agent]);
    if (kept && askedThisLaunch.has(agent)) return;
    if (get().optionsError[agent] && !retry) return;
    const api = desktopBridge()?.localAgents;
    if (!api) return;
    probing.add(agent);
    askedThisLaunch.add(agent);
    set({ optionsError: { ...get().optionsError, [agent]: undefined } });
    try {
      const r = await api.probe(agent).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e), code: undefined }));
      if (r.ok && r.info.commands?.length) keepCommands(agent, readCommands({ availableCommands: r.info.commands }));
      if (r.ok && r.info.configOptions?.length) get().noteOptions(agent, r.info.configOptions);
      /* the ones kept from before stay when this launch's ask fails */
      else if (!kept) set({ optionsError: { ...get().optionsError, [agent]: r.ok ? { text: 'no options' } : { text: r.error, ...(r.code ? { code: r.code } : {}) } } });
    } finally {
      probing.delete(agent);
    }
  },
}));

/**
 * The frontend cannot grant execution privileges. Native video sessions force a tool-free planner and an actual
 * read-only sandbox; this value also replaces an old full-access choice persisted by previous client versions.
 */
const AGENT_FORCED_PREFS: Partial<Record<LocalAgentId, Record<string, unknown>>> = {
  codex: { mode: 'read-only' },
};

/** picks the menu no longer offers: plan mode (Claude Code's `plan`, Codex's collaboration mode) */
const DROPPED_PREFS = new Set(['plan', 'collaboration_mode']);

/**
 * The options in effect for an agent: the person's picks, then the ones the app sets. What the person never picked
 * here is the agent's own, as their config has it: the same model and effort as in their terminal. The own key's model
 * picked by its name at the service (before each model was set up on its own) is its id now.
 */
export function effectivePrefs(prefs: Persisted['prefs'], agent: LocalAgentId, roster?: RosterAgent[] | null, options?: ConfigOptions): Record<string, unknown> {
  /* "default" was a row the menu no longer offers: the agent's current value stands instead. A historical plan
     mode is not reused, and native video policy owns all execution permissions. A pick the agent no longer offers
     is not kept either: the agent's own stands instead */
  const offers = (id: string, value: unknown) => {
    const option = options?.find((o) => o.id === id);
    return !option?.options?.length || option.options.some((o) => o.value === value);
  };
  const own = Object.entries(prefs[agent] ?? {});
  const kept = Object.fromEntries(own
    .filter(([id, value]) => value !== 'default' && value !== null && !DROPPED_PREFS.has(id) && offers(id, value)));
  return { ...kept, ...(AGENT_FORCED_PREFS[agent] ?? {}) };
}

/** An option's current value (the person's pick first, else the value the session reports). */
export function optionValue(options: ConfigOptions | undefined, prefs: Record<string, unknown> | undefined, id: string): unknown {
  if (prefs && id in prefs) return prefs[id];
  return options?.find((o) => o.id === id)?.currentValue;
}

/** Option value → display name. */
export function optionLabel(options: ConfigOptions | undefined, id: string, value: unknown): string | null {
  const option = options?.find((o) => o.id === id);
  const hit = option?.options?.find((o) => o.value === value);
  return hit?.name ?? (typeof value === 'string' ? value : null);
}

/**
 * The agent's current model and effort as a short phrase (for the composer button and the turn footer).
 *
 * Claude Code names its default model "Default (recommended)" and its default effort "Default"; shown as is, that
 * truncates to "Default (recommended) Defa…" and says nothing. For the default, the model name from its
 * description is used ("Opus (1M context)" → "Opus"), without the parenthesis; a default effort is left out.
 */
export function agentModelSummary(
  options: ConfigOptions | undefined,
  prefs: Record<string, unknown> | undefined,
): { model: string | null; effort: string | null } {
  const byCategory = (category: string) => options?.find((o) => o.category === category || o.id === category);
  const modelOpt = byCategory('model');
  const effortOpt = byCategory('thought_level');
  let model: string | null = null;
  if (modelOpt) {
    const value = optionValue(options, prefs, modelOpt.id);
    const choice = modelOpt.options?.find((o) => o.value === value);
    const raw = value === 'default' && choice?.description ? choice.description : optionLabel(options, modelOpt.id, value);
    model = raw ? (raw.split('·')[0]!.replace(/\s*\([^)]*\)/g, '').trim() || raw) : null;
  }
  const effortValue = effortOpt ? optionValue(options, prefs, effortOpt.id) : undefined;
  const effort = effortOpt && effortValue !== 'default' ? optionLabel(options, effortOpt.id, effortValue) : null;
  return { model, effort };
}
