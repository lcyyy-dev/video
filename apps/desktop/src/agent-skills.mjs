/** Session-local Codex skills and MCP isolation. Never modifies the user's global configuration. */
import { CLIENT_SKILLS } from 'openfilm/client-scope';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const skillsLib = () => import(pathToFileURL(require.resolve('openfilm/skills')).href);
const KEEP_MS = 2 * 24 * 60 * 60_000;
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
async function skillFolders(dir, { except = [] } = {}) {
  const { readSkill } = await skillsLib();
  let names = [];
  try { names = readdirSync(dir); } catch { return []; }
  return names.filter((n) => !n.startsWith('.') && !except.includes(n)).flatMap((n) => {
    const folder = join(dir, n);
    if (!isDir(folder)) return [];
    const skill = readSkill(folder, 'mine');
    return skill ? [{ name: skill.name, dirName: n, description: skill.description, folder, file: skill.file, ...(isOurs(skill) ? { ours: true } : {}) }] : [];
  });
}

/**
 * OpenFilm's own skill for agents in a terminal (the repository's skills/openfilm: "run `npx openfilm`, read the
 * manual"), installed in an agent: in the app it is never wanted, as the app tells the agent the same, and its `npx`
 * would contradict it. Never shown, never let in.
 */
export const isOurs = (skill) => skill.name === 'openfilm' && /\bOpenFilm\b/.test(skill.description ?? '');
/** the folder and each above it, to the root */
const upFrom = (cwd) => { const out = []; for (let up = resolve(cwd); ; up = dirname(up)) { out.push(up); if (up === dirname(up)) break; } return out; };
const subdirs = (dir) => { try { return readdirSync(dir); } catch { return []; } };

/**
 * The skills the person installed in an agent themselves (not its maker's), for the project in `cwd`: `[{ name,
 * dirName, description, folder, file }]`, each once by name. `env`: the person's shell (CLAUDE_CONFIG_DIR, CODEX_HOME…).
 */
export async function ownSkills(agent, { cwd = '', env = {}, home = homedir() } = {}) {
  if (agent !== 'codex') return [];
  const codexHome = env.CODEX_HOME || join(home, '.codex');
  const parents = (cwd ? upFrom(cwd) : []).filter((dir) => dir !== home);
  const dirs = [join(codexHome, 'skills'), join(home, '.agents', 'skills'), ...parents.flatMap((dir) => [join(dir, '.agents/skills'), join(dir, '.codex/skills')])];
  const cache = join(codexHome, 'plugins', 'cache');
  for (const market of subdirs(cache).filter((name) => !/^openai/i.test(name))) {
    for (const plugin of subdirs(join(cache, market))) for (const version of subdirs(join(cache, market, plugin))) dirs.push(join(cache, market, plugin, version, 'skills'));
  }
  const seen = new Map();
  for (const dir of dirs) for (const skill of await skillFolders(dir, { except: [] })) if (!seen.has(skill.name)) seen.set(skill.name, skill);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function serverDetail(config) {
  if (typeof config?.url === 'string' || typeof config?.httpUrl === 'string') { try { return new URL(config.url ?? config.httpUrl).host; } catch { return String(config.url ?? config.httpUrl).slice(0, 60); } }
  const command = Array.isArray(config?.command) ? config.command[0] : config?.command;
  return typeof command === 'string' ? basename(command) : '';
}

/** Codex's config.toml: each `[mcp_servers.<name>]` and its command and url (its other keys and its tables left). */
export function codexServers(toml) {
  const out = [];
  let current = null;
  for (const line of String(toml ?? '').split(/\r?\n/)) {
    const head = /^\s*\[\s*mcp_servers\.("(?:[^"\\]|\\.)*"|[\w-]+)\s*\]\s*$/.exec(line);
    if (head) { current = { name: head[1].startsWith('"') ? JSON.parse(head[1]) : head[1], config: {} }; out.push(current); continue; }
    if (/^\s*\[/.test(line)) { current = null; continue; }
    const kv = current && /^\s*(command|url)\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*')/.exec(line);
    if (kv) current.config[kv[1]] = kv[2].startsWith('"') ? JSON.parse(kv[2]) : kv[2].slice(1, -1);
  }
  return out;
}

/* a server Codex's own apps (Codex, ChatGPT) put in its configuration, or that runs from its own folders: its maker's */
const OPENAI_SERVER = /(?:^|\/)(?:Codex|ChatGPT)[^/]*\.app(?:\/|$)|\/\.codex\/|codex-runtimes/i;

export function ownMcpServers(agent, { env = {}, home = homedir() } = {}) {
  if (agent !== 'codex') return [];
  let toml = '';
  try { toml = readFileSync(join(env.CODEX_HOME || join(home, '.codex'), 'config.toml'), 'utf8'); } catch { /* none */ }
  return codexServers(toml).filter((server) => !OPENAI_SERVER.test(`${server.config.command ?? ''} ${server.config.url ?? ''}`))
    .map((server) => ({ name: server.name, detail: serverDetail(server.config) }));
}

function linkFolder(base, skills) {
  mkdirSync(base, { recursive: true });
  for (const name of subdirs(base)) {
    try { if (Date.now() - statSync(join(base, name)).mtimeMs > KEEP_MS) rmSync(join(base, name), { recursive: true, force: true }); } catch { /* in use */ }
  }
  const dir = join(base, `${Date.now().toString(36)}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
  const link = process.platform === 'win32' ? 'junction' : 'dir';
  mkdirSync(join(dir, 'skills'), { recursive: true });
  mkdirSync(join(dir, '.agents'));
  for (const skill of skills) {
    if (!/^[\w.-]+$/.test(skill.name)) continue;
    try { symlinkSync(skill.folder, join(dir, 'skills', skill.name), link); } catch { /* one that cannot be linked is left out */ }
  }
  symlinkSync(join(dir, 'skills'), join(dir, '.agents', 'skills'), link);
  return dir;
}

export async function sessionSkills(agent, { cwd, env = {}, dataDir, mine, home = homedir() }) {
  if (agent !== 'codex') throw new Error('Only Codex is available in this client.');
  const { listSkills, mySkillsDir } = await skillsLib();
  const openfilm = listSkills({ project: cwd, mine: mine ?? mySkillsDir() }).filter((skill) => CLIENT_SKILLS.includes(skill.name));
  const hidden = await ownSkills(agent, { cwd, env, home });
  const mcpHidden = ownMcpServers(agent, { env, home }).map((server) => server.name);
  const dir = linkFolder(join(dataDir, 'agent-skills'), openfilm);
  return {
    codexConfig: { skills: { config: hidden.map((skill) => ({ path: skill.file, enabled: false })) }, ...Object.fromEntries(mcpHidden.map((name) => [`mcp_servers.${name}.enabled`, false])) },
    additionalDirectories: [dir],
    log: { openfilm: openfilm.map((skill) => skill.name), folder: dir, allowed: [], mcpAllowed: [], filtered: true, mcpFiltered: true,
      hidden: hidden.map((skill) => skill.name), mcpHidden },
  };
}

export function mergeConfig(a, b) {
  if (!a || typeof a !== 'object' || Array.isArray(a)) return b;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b ?? a;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = k in out ? mergeConfig(out[k], v) : v;
  return out;
}
