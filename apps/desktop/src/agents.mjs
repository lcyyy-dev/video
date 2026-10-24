/** Local Codex, driven through its ACP adapter. Studio stays in the same desktop window. */
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, homedir, release, tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import * as acp from '@agentclientprotocol/sdk';
import { PATH_SEP, childEnvironment, lastPathSource, loginShellEnvironment, loginShellVariables } from './environment.mjs';
import { AGENT_PROGRAMS, HOME_BIN_CANDIDATES, chosenProgram, codexVersion, consoleProgram, detectAgentInstallation, laterVersion, searchReport } from './agent-installation.mjs';
import { mergeConfig, sessionSkills } from './agent-skills.mjs';
import { nodeBinary } from './node-runtime.mjs';
import { CLIENT_PROFILE } from 'openfilm/client-scope';
import { bundledCodex, codexArguments, codexEnvironment } from './codex-runtime.mjs';
import { plannerEnvironment } from './video-planner-runtime.mjs';
import { videoCodexLaunchEnv } from './video-codex-launch.mjs';

const require = createRequire(import.meta.url);

/**
 * Each agent: through an adapter the app carries (`adapter`, told where the person's program is by `env`), or the
 * person's program itself with `args`. Signed in? `auth` asks the program (its words say); without it, a session is
 * opened and closed (acpSignedIn). `login` is its own sign-in, run in Terminal (none: the program itself, which asks
 * for one on its first run). `authenticate`: the ACP auth method that takes up the program's own sign-in.
 * `approve`: it asks permission for what the app lets every agent do (see the chat's AGENT_FORCED_PREFS), so the app
 * answers yes itself. The others are told the app's INSTRUCTIONS in the first message of a session (`systemPrompt`:
 * how Claude Code and Codex are told them instead).
 */
export const AGENTS = Object.freeze({
  codex: {
    label: 'Codex', adapter: '@agentclientprotocol/codex-acp',
    env: (path) => codexLaunchEnv(path), auth: codexArguments(['login', 'status']), login: codexArguments(['login']), systemPrompt: true,
  },
});

export const isAgentId = (id) => typeof id === 'string' && Object.hasOwn(AGENTS, id);

export const isChatAgent = isAgentId;

/** How the person points at things in Studio, and how the agent points back: told to every agent, the app's own too. */
export const STUDIO_REFERENCES = `When the person mentions something in Studio, they may name a clip, a page or a moment (as seconds); find it in
film.html and the project's files.

In your replies you can point at things in Studio for the person: [[clip:ID]] (a clip, by its id in film.html),
[[t:SECONDS]] (a moment), [[range:START-END]] (a stretch, in seconds), [[track:N]] (a track, 0 is the first) and
[[file:PATH]] (a file of the project). They show as links that open it in Studio.`;

/** What the agent is told about where it is, on top of its own instructions. */
export const INSTRUCTIONS = `You are working inside OpenFilm, a desktop app for editing footage-based promotional ads. Beside this chat the person sees OpenFilm Studio,
the video editor, showing the project in your working directory; it updates live as you save files.

The project is an OpenFilm film: pages with window.film, cut together by film.html. Before you change anything, run
\`openfilm\` with no arguments and read the manual it prints; follow it. Use the \`openfilm\` command on your PATH (this
app's own, on the Studio beside you), not \`npx openfilm\`, whatever a skill says. Studio is already open on this
project: you never need \`openfilm open\` and never open Studio in a browser. Run \`openfilm look\` after each change
to see what you made. Render the MP4 only when the person asks for it; they can also export from Studio. Reply in the
language the person writes in.

The desktop process attaches the selected template and its required skill to every request. Follow that fixed route;
do not choose a different skill from the wording of the request. This client focuses on supplied footage and copy. Read \`openfilm skill ad-editing\` before making an ad. Preserve
manual timeline edits and locked selections. Cloud media generation is outside this client's current scope: reuse
supplied recordings or explicitly requested local simulated narration, label simulation clearly, and never claim it
is a production TTS voice. Do not offer other film workflows, install skills, or configure paid media services.

${STUDIO_REFERENCES}`;


/**
 * The person's own `developer_instructions` in Codex's config.toml (top level), or null: the app's instructions go to
 * Codex in the same place, which would otherwise take the place of theirs, so theirs come first. Read for the basic
 * and literal strings TOML has, on one line or several; anything else (a profile's, a key it cannot read) is left.
 */
export function codexDeveloperInstructions(toml) {
  const top = String(toml ?? '').split(/^\s*\[/m)[0];
  const m = /^[ \t]*developer_instructions[ \t]*=[ \t]*("""|'''|"|')/m.exec(top);
  if (!m) return null;
  const quote = m[1];
  const rest = top.slice(m.index + m[0].length);
  /* a basic string on one line ends at its first quote not escaped; the others at their closing quotes */
  const end = quote === '"' ? (/^(?:[^"\\\n]|\\.)*"/.exec(rest)?.[0].length ?? 0) - 1 : rest.indexOf(quote);
  if (end < 0) return null;
  let text = rest.slice(0, end);
  if (quote.length === 3) text = text.replace(/^\r?\n/, '');
  if (quote.startsWith('"')) {
    text = text.replace(/\\(?:u([0-9a-fA-F]{4})|(.))/g, (_, hex, c) => (hex ? String.fromCharCode(parseInt(hex, 16))
      : ({ n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\' })[c] ?? c));
  }
  return text.trim() || null;
}

/** Codex's config.toml: in CODEX_HOME when the person's shell sets it, else ~/.codex. */
function codexConfigText(shell) {
  try { return readFileSync(join(shell.CODEX_HOME || join(homedir(), '.codex'), 'config.toml'), 'utf8'); } catch { return ''; }
}

/** The programs the person chose for their agents (Settings → Agents → Locate, agent-roster.mjs), by agent. */
let chosenPaths = {};
export function setChosenPaths(paths) {
  chosenPaths = Object.fromEntries(Object.entries(paths ?? {}).filter(([id, path]) => isAgentId(id) && typeof path === 'string' && path));
}

const windows = process.platform === 'win32';

/**
 * How the Codex adapter is told where Codex is. On Windows it starts it through cmd.exe, whose own messages (a program
 * not found, access refused) are in the console's code page, which the adapter reads as UTF-8: on a Chinese Windows
 * the reason came out as `������`. There Codex is started through a script that turns the console to UTF-8 first, made
 * on disk (the app's own files are in an archive cmd.exe cannot run from); Codex's own messages are UTF-8 already.
 */
export const CODEX_UTF8_CMD = '@echo off\r\nchcp 65001 >nul\r\n"%OPENFILM_CODEX%" -c check_for_update_on_startup=false %*\r\n';
export function codexLaunchEnv(/** @type {string} */ path, { win = windows, dir = join(tmpdir(), 'openfilm-codex') } = {}) {
  if (!win) return { CODEX_PATH: path };
  try {
    const script = join(dir, 'codex-utf8.cmd');
    if (!existsSync(script) || readFileSync(script, 'utf8') !== CODEX_UTF8_CMD) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(script, CODEX_UTF8_CMD);
    }
    return { CODEX_PATH: script, OPENFILM_CODEX: path };
  } catch {
    /* no room for the script: Codex as before, its reasons maybe unreadable */
    return { CODEX_PATH: path };
  }
}
/** what the slower search found last (Windows): npm's global folder, Codex inside a Microsoft Store app */
let slowFound = { npmPrefix: null, storeCodex: null };
let slowCache = null;
const SLOW_FOR_MS = 10 * 60_000;
/* an OpenAI app from the Microsoft Store (ChatGPT, Codex) that carries Codex: where its codex.exe is */
const STORE_CODEX = "Get-AppxPackage -Name 'OpenAI.*' | ForEach-Object { Get-ChildItem -LiteralPath $_.InstallLocation -Recurse -Depth 5 -Filter codex.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName }";

/**
 * Windows only, and only when an agent is not found the quick way: where npm puts global commands (a prefix of the
 * person's own that is not on their PATH), and Codex inside an OpenAI app from the Microsoft Store. Asked again after
 * ten minutes, or at once with `fresh`.
 */
function windowsSlowSearch({ fresh = false } = {}) {
  if (!windows) return Promise.resolve(slowFound);
  if (slowCache && !fresh && Date.now() - slowCache.at < SLOW_FOR_MS) return slowCache.value;
  const value = (async () => {
    const env = childEnvironment({ shell: await loginShellEnvironment() });
    const [npm, store] = await Promise.all([
      run(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm prefix -g'], 15_000, { env }),
      run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', STORE_CODEX], 20_000, { env }),
    ]);
    const prefix = npm.ok ? npm.stdout.trim().split(/\r?\n/).pop()?.trim() : null;
    /* the Codex app's own window program is a codex.exe too (`app\Codex.exe`, the filter ignores case): only a console
       program is the CLI */
    const exe = store.ok ? store.stdout.split(/\r?\n/).map((l) => l.trim()).find((l) => /codex\.exe$/i.test(l) && isAbsolute(l) && consoleProgram(l)) : null;
    slowFound = { npmPrefix: prefix && isAbsolute(prefix) ? prefix : null, storeCodex: exe && isAbsolute(exe) ? exe : null };
    return slowFound;
  })().catch(() => slowFound);
  slowCache = { at: Date.now(), value };
  return value;
}

/** Where this agent was looked for, beyond the PATH. */
const searchDirs = () => [...HOME_BIN_CANDIDATES(), ...(slowFound.npmPrefix ? [slowFound.npmPrefix] : [])];

/**
 * The person's program for this agent: the one they chose; else on their login shell's PATH (on Windows, the PATH the
 * registry has now), in the folders installers use, or inside the maker's app. `source`: chosen · path · app.
 */
export function resolveAgentCli(id, { pathDirs = [] } = {}) {
  if (!isAgentId(id)) return null;
  if (id === 'codex' && bundledCodex()) return bundledCodex();
  const found = detectAgentInstallation(id, {
    env: { PATH: pathDirs.join(PATH_SEP) },
    pathDirs: searchDirs(),
    chosen: chosenPaths[id] ?? null,
    others: id === 'codex' && slowFound.storeCodex ? [slowFound.storeCodex] : [],
  });
  return found.cli ? { path: found.cli, source: found.source } : null;
}

function run(cmd, args, timeoutMs = 10_000, { cwd, env, options } = {}) {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout: timeoutMs, encoding: 'utf8', windowsHide: true, ...options, ...(cwd ? { cwd } : {}), ...(env ? { env } : {}) }, (error, stdout, stderr) => {
        resolve({ ok: !error, out: `${stdout ?? ''}\n${stderr ?? ''}`, stdout: stdout ?? '' });
      });
    } catch (e) {
      /* a program Windows cannot start that way (EINVAL) */
      resolve({ ok: false, out: e instanceof Error ? e.message : String(e), stdout: '' });
    }
  });
}

/* one word of a cmd.exe command line: quoted when it has to be */
const winArg = (a) => (/^[\w.:\\/=+@-]+$/.test(a) ? a : `"${String(a).replace(/"/g, '""')}"`);

/** The app's own Node running a script, through as-node.mjs: what the script starts does not run Electron as Node. */
const AS_NODE = fileURLToPath(new URL('./as-node.mjs', import.meta.url));

/**
 * How to start a program found for an agent: itself, a script with the app's own Node (an npm install on Windows), or
 * a `.cmd` shim whose target could not be told, through cmd.exe. `options` go to spawn.
 */
function starting(cliPath, args) {
  if (/\.(?:c|m)?js$/i.test(cliPath)) return { cmd: nodeBinary(), args: [AS_NODE, cliPath, ...args], env: { ELECTRON_RUN_AS_NODE: '1' }, options: {} };
  if (windows && /\.(?:cmd|bat)$/i.test(cliPath)) {
    return { cmd: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${[cliPath, ...args].map(winArg).join(' ')}"`], env: {}, options: { windowsVerbatimArguments: true } };
  }
  return { cmd: cliPath, args, env: {}, options: {} };
}

/**
 * A program the person chose for an agent, tried: it has to start and answer `--version`. `{ ok, version }`, or why
 * not: `code` 'not-a-program' (nothing there this computer can start) or 'did-not-start' (with what it said).
 */
export async function checkAgentProgram(id, path) {
  const spec = AGENTS[id];
  if (!spec) return { ok: false, error: `No agent ${id}`, code: 'not-a-program' };
  const cli = chosenProgram(path, { names: AGENT_PROGRAMS[id]?.names ?? [id] });
  if (!cli) return { ok: false, error: 'That is not a program this computer can start.', code: 'not-a-program' };
  const how = starting(cli, ['--version']);
  const r = await run(how.cmd, how.args, 20_000, { env: childEnvironment({ shell: await loginShellVariables(), extra: how.env }), options: how.options });
  if (!r.ok) return { ok: false, error: r.out.trim().slice(0, 400), code: 'did-not-start' };
  return { ok: true, path: cli, version: r.stdout.trim().split(/\r?\n/)[0] ?? '' };
}

/** Where in WSL (Linux on Windows) one of these programs is, or null: there the app cannot use it. */
async function inWsl(names) {
  const wsl = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'wsl.exe');
  if (!existsSync(wsl)) return null;
  const r = await run(wsl, ['-e', 'bash', '-lic', names.map((n) => `command -v ${n}`).join(' || ')], 15_000);
  return r.stdout.replace(/\0/g, '').split(/\r?\n/).map((l) => l.trim()).find((l) => /^\/\S+$/.test(l)) ?? null;
}

/**
 * Why an agent is or is not found, for the person to read or send with an issue: the PATH and where it came from, the
 * program chosen, every folder searched, each file there with the agent's name and what it runs; on Windows, npm's
 * global folder and whether it is in WSL instead. `hint`, when it is not found: chosen-missing (the program chosen is
 * gone) · wsl (only in WSL) · unusable (files with its name, none that starts) · none.
 */
export async function diagnoseAgent(id, { appVersion = '' } = {}) {
  const spec = AGENTS[id];
  if (!spec) return null;
  const shell = await loginShellEnvironment({ maxAgeMs: 0 });
  const slow = bundledCodex() ? slowFound : await windowsSlowSearch({ fresh: true });
  const pathDirs = shell.PATH.split(PATH_SEP);
  const found = resolveAgentCli(id, { pathDirs });
  const names = AGENT_PROGRAMS[id]?.names ?? [id];
  const report = searchReport(id, { env: { PATH: shell.PATH }, pathDirs: searchDirs() });
  const wsl = windows && !found ? await inWsl(names) : null;
  const chosen = chosenPaths[id] ?? null;
  const hint = found ? null : chosen ? 'chosen-missing' : wsl ? 'wsl' : report.files.length ? 'unusable' : 'none';
  const lines = [
    `OpenFilm ${appVersion}`.trim(),
    `Agent: ${spec.label} (${names.join(', ')})`,
    `System: ${process.platform} ${release()} ${arch()}`,
    `PATH from: ${lastPathSource() ?? 'unknown'}`,
    `Chosen: ${chosen ?? '(none)'}`,
    `Found: ${found ? `${found.path} (${found.source})` : '(not found)'}`,
    ...(windows ? [
      `npm global folder: ${slow.npmPrefix ?? '(unknown)'}`,
      ...(id === 'codex' ? [`Codex in a Store app: ${slow.storeCodex ?? '(none)'}`] : []),
      `In WSL: ${found ? '(not checked)' : wsl ?? '(no)'}`,
    ] : []),
    '',
    `Files named ${names.join(', ')}:`,
    ...(report.files.length ? report.files.map((f) => `  ${f.file}${f.runs && f.runs !== f.file ? ` -> ${f.runs}` : ''}${f.usable ? '' : ' (cannot be started)'}`) : ['  (none)']),
    '',
    `Folders searched (${report.searched.length}):`,
    ...report.searched.map((d) => `  ${d}`),
  ];
  return { found: found?.path ?? null, program: names[0], hint, text: lines.join('\n') };
}

/**
 * Signed in? Asked of the program itself: true / false, or null when it cannot say (an older version). One that has
 * no command for it is asked by opening a session (acpSignedIn).
 */
export async function agentSignedIn(id, cliPath) {
  return (await agentStatus(id, cliPath)).signedIn;
}

/**
 * Signed in, and as whom, asked of the program: `account` is what it says of its sign-in (Claude Code: email,
 * organization, plan; Codex: how, ChatGPT or an API key), never a key or a token.
 * @returns {Promise<{ signedIn: boolean | null, account: AgentAccount | null, problem?: string }>}
 */
export async function agentStatus(id, cliPath) {
  const spec = AGENTS[id];
  if (!spec || !cliPath) return { signedIn: null, account: null };
  if (!spec.auth) return { signedIn: await acpSignedIn(id), account: null };
  const how = starting(cliPath, spec.auth);
  const r = await run(how.cmd, how.args, 10_000, { env: childEnvironment({ shell: agentShell(id, await loginShellVariables()), extra: how.env }), options: how.options });
  return readAgentStatus(id, r.stdout, r.out);
}

/**
 * @typedef {{ method: 'claude.ai' | 'console' | 'api-key' | 'chatgpt' | 'other', email?: string, org?: string, plan?: string }} AgentAccount
 * What a sign-in status says: Claude Code's JSON, Codex's words. @param {string} id @param {string} stdout @param {string} out
 * `problem`: why it could not say, when that is something the person can fix (its settings it cannot read).
 * @returns {{ signedIn: boolean | null, account: AgentAccount | null, problem?: string }}
 */
export function readAgentStatus(id, stdout, out) {
  const broken = /error loading config(?:uration)?\b[:\s]*(.*)/i.exec(out);
  if (broken) return { signedIn: null, account: null, problem: broken[0].trim().slice(0, 500) };
  if (/\bnot logged in\b/i.test(out)) return { signedIn: false, account: null };
  if (/\blogged in\b/i.test(out)) {
    const method = /chatgpt/i.test(out) ? 'chatgpt' : /api key/i.test(out) ? 'api-key' : 'other';
    return { signedIn: true, account: { method } };
  }
  return { signedIn: null, account: null };
}

/** what a session opened only to ask found, for a while: the roster asks again every few seconds */
const asked = new Map();
const ASKED_FOR_MS = 15_000;
let probeDir = null;

/**
 * Signed in, for an agent with no command that says: a session opened (in an empty folder of the app's) and closed.
 * One it refuses for its sign-in (ACP's auth_required) is signed out; one that opens, signed in; anything else, null.
 */
export function acpSignedIn(id) {
  const kept = asked.get(id);
  if (kept && Date.now() - kept.at < ASKED_FOR_MS) return kept.answer;
  const answer = (async () => {
    probeDir ??= mkdtempSync(join(tmpdir(), 'openfilm-agent-'));
    const session = new AgentSession({ agent: id, cwd: probeDir });
    try {
      await Promise.race([session.start(), new Promise((_, fail) => setTimeout(() => fail(new Error('timed out')), 30_000))]);
      return true;
    } catch (e) {
      return e?.code === 'sign-in' ? false : null;
    } finally {
      session.close();
    }
  })();
  asked.set(id, { at: Date.now(), answer });
  return answer;
}

/**
 * A message refused for the agent's sign-in (Kimi opens a session signed out, and says so only when it is spoken to):
 * signed out from now on, until its sign-in is opened.
 */
function noteSignedOut(id) {
  asked.set(id, { at: Infinity, answer: Promise.resolve(false) });
}

const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

/** The AppleScript that has Terminal run one command in a new window. */
export function signInScript(cliPath, args) {
  const command = [cliPath, ...args].map(shq).join(' ');
  return `tell application "Terminal"\nactivate\ndo script "${command.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"\nend tell`;
}

/**
 * A PowerShell script that names its window and runs one program (`& 'program' 'arg'…`, each in single quotes, as
 * PowerShell quotes): Windows sign-in. With a BOM, so Windows PowerShell reads a path with Chinese in it as UTF-8.
 */
export function powerShellScript(title, cmd, args) {
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
  return `\ufeff$Host.UI.RawUI.WindowTitle = ${q(title)}\r\n& ${[cmd, ...args].map(q).join(' ')}\r\n`;
}

/** The person's shell variables as this agent is given them (`fromShell`; all of them, for most). */
export function agentShell(id, shell) {
  return id === 'codex' ? codexEnvironment(shell) : shell;
}

/**
 * Sign in: Terminal runs the program's own sign-in, which opens the maker's own page. The app touches nothing. One
 * signed in the way its adapter offers (`acpSignIn`, that way's id) runs the adapter with that way's arguments, as ACP
 * has a client do it.
 */
export async function openAgentSignIn(id) {
  const spec = AGENTS[id];
  const pathDirs = (await loginShellEnvironment()).PATH.split(PATH_SEP);
  const cli = spec ? resolveAgentCli(id, { pathDirs }) : null;
  if (!spec || !cli) return { ok: false, error: `${spec?.label ?? id} is not installed on this computer.` };
  asked.delete(id);
  let how = null;
  if (process.platform === 'win32') {
    /* a PowerShell window of its own running a script, as ChatCut does: no command line for cmd.exe to unquote (a path
       with a space in it), and left open so its sign-in can be read and answered (it runs a shim itself) */
    how ??= /\.(?:cmd|bat)$/i.test(cli.path) ? { cmd: cli.path, args: spec.login, env: {} } : starting(cli.path, spec.login);
    try {
      const dir = join(tmpdir(), 'openfilm-sign-in');
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${id}.ps1`);
      writeFileSync(file, powerShellScript(`${spec.label} sign-in`, how.cmd, how.args), 'utf8');
      const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const child = spawn(powershell, ['-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', file], {
        detached: true, stdio: 'ignore', windowsHide: false, env: childEnvironment({ shell: agentShell(id, await loginShellVariables()), extra: how.env }),
      });
      await new Promise((done, fail) => { child.once('spawn', done); child.once('error', fail); });
      child.unref();
      return { ok: true };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  }
  const script = how
    ? signInScript('/usr/bin/env', [...Object.entries(how.env).map(([k, v]) => `${k}=${v}`), how.cmd, ...how.args])
    : signInScript(cli.path, spec.login);
  const r = await run('/usr/bin/osascript', ['-e', script], 15_000);
  return r.ok ? { ok: true } : { ok: false, error: r.out.trim() || 'Terminal did not open.' };
}

/**
 * The agents as they are on this machine, for the chat's picker. `setupRequired: 'code-tab'`: the Claude app is
 * here but has not downloaded Claude Code yet (opening its Code tab does).
 */
export async function listAgents(ids = Object.keys(AGENTS)) {
  /* looked at as the person comes back from installing one: a PATH from a few seconds ago at most */
  const pathDirs = (await loginShellEnvironment({ maxAgeMs: 10_000 })).PATH.split(PATH_SEP);
  /* the slower search (Windows): always, as it finds Codex inside a Store app, which may be later than one on the PATH
     (resolveAgentCli takes the later); waited for, a few seconds at most, when one is not found the quick way. What it
     finds later is there on the next look */
  if (windows && !bundledCodex()) {
    const slow = windowsSlowSearch();
    if (ids.some((id) => !resolveAgentCli(id, { pathDirs }))) {
      await Promise.race([slow, new Promise((done) => setTimeout(done, 3000).unref?.())]);
    }
  }
  return Promise.all(Object.entries(AGENTS).filter(([id]) => ids.includes(id)).map(async ([id, spec]) => {
    const cli = resolveAgentCli(id, { pathDirs });
    const { install } = detectAgentInstallation(id);
    return {
      id,
      label: spec.label,
      cli: cli ? { path: cli.path, source: cli.source } : null,
      chosen: cli?.source === 'bundled' ? null : chosenPaths[id] ?? null,
      ...(cli ? await agentStatus(id, cli.path) : { signedIn: null, account: null }),
      install: cli?.source === 'bundled' ? null : install,
      setupRequired: null,
    };
  }));
}

/** The adapter's command line (its package's `bin`), run with Electron's own Node. */
function adapterScript(pkg) {
  const manifest = require.resolve(`${pkg}/package.json`);
  const json = JSON.parse(readFileSync(manifest, 'utf8'));
  const bin = typeof json.bin === 'string' ? json.bin : Object.values(json.bin ?? {})[0];
  return join(dirname(manifest), bin ?? json.main ?? 'index.js');
}

function nodeRuntime() {
  return process.versions.electron
    ? { command: nodeBinary(), env: { ELECTRON_RUN_AS_NODE: '1' } }
    : { command: process.execPath, env: {} };
}

/* ── the agents' own questions to the person (ACP form elicitation) ──
 *
 * Claude Code's AskUserQuestion and Codex's request_user_input both arrive as a form: one field per question (a
 * choice is a `oneOf` of `{ const, title, description }`), maybe beside a field for an answer in the person's own
 * words — Claude's marked `_meta._askUserQuestionCustomAnswer.questionId`, Codex's `_meta.codex.role === 'user_note'`.
 * Read into a list of questions for the chat; the answers are put back in the fields they came from. A form that is
 * not one of these (numbers, booleans, nesting) is declined: the agent takes it as skipped and carries on. */

/** A form, as questions; null when it is not one this chat can show. */
export function formQuestions(params) {
  if (params?.mode !== undefined && params.mode !== 'form') return null;
  const properties = params?.requestedSchema?.properties;
  if (!properties || typeof properties !== 'object') return null;
  const entries = Object.entries(properties);
  const customOf = new Map();
  for (const [id, prop] of entries) {
    const target = prop?._meta?._askUserQuestionCustomAnswer?.questionId
      ?? (prop?._meta?.codex?.role === 'user_note' ? prop._meta.codex.questionId : undefined);
    if (typeof target === 'string' && properties[target]) customOf.set(target, id);
  }
  const custom = new Set(customOf.values());
  const fields = entries.filter(([id]) => !custom.has(id));
  if (fields.length === 0) return null;
  const questions = [];
  for (const [id, prop] of fields) {
    const multi = prop?.type === 'array';
    const choices = multi ? (prop.items?.anyOf ?? prop.items?.oneOf) : (prop?.oneOf ?? prop?.anyOf);
    const options = Array.isArray(choices)
      ? choices.filter((c) => typeof c?.const === 'string').map((c) => ({ label: c.const, ...(c.description ? { description: String(c.description) } : {}) }))
      : Array.isArray(prop?.enum) ? prop.enum.filter((v) => typeof v === 'string').map((label) => ({ label })) : [];
    if (prop?.type !== 'string' && !multi) return null;
    if (multi && options.length === 0) return null;
    /* Codex: the title is the question, the description its heading. Claude: with one question it is in `message`,
       with several in the description; the title is the heading. */
    const codex = Boolean(prop?._meta?.codex);
    const title = typeof prop?.title === 'string' && prop.title ? prop.title : null;
    const description = typeof prop?.description === 'string' && prop.description ? prop.description : null;
    const question = codex
      ? title ?? description ?? params.message ?? id
      : description ?? (fields.length === 1 && params.message ? params.message : title ?? params.message ?? id);
    const header = codex ? description : title;
    questions.push({ id, question: String(question), header: header && header !== question ? header : null, options, customId: customOf.get(id) ?? null, multi });
  }
  return questions;
}

/** The chat's answers, as the form's content. `answers[id]` is `{ label }` (a choice) or `{ text }` (own words). */
export function formContent(questions, answers) {
  const content = {};
  for (const q of questions) {
    const a = answers?.[q.id];
    if (!a) continue;
    if (typeof a.label === 'string' && q.options.some((o) => o.label === a.label)) {
      content[q.id] = q.multi ? [a.label] : a.label;
    } else if (typeof a.text === 'string' && a.text.trim()) {
      const text = a.text.trim();
      if (q.customId) content[q.customId] = text;
      else if (q.options.length === 0) content[q.id] = text;
    }
  }
  return content;
}

/** What the app tells each agent, as it shakes hands, that the chat can do. */
export const CLIENT_CAPABILITIES = {
  fs: { readTextFile: false, writeTextFile: false }, terminal: false, elicitation: { form: {} },
  /* Codex manages sign-in in the person's terminal. */
  auth: { terminal: true },
  /* the agent's own warnings (Codex: "Falling back from WebSockets…") come as notices, not as words in its reply */
  session: { notices: {} },
  /* Claude Code's "recommended value" extension: its model and effort lists come without a "Default" row, the
     current value named for what it is */
  _meta: { jetbrains: { air: { version: 1, capabilities: ['recommendedValue'] } } },
};

const CLIENT_INFO = { name: 'openfilm-desktop', title: 'OpenFilm', version: '0.1.0' };

/** ACP's auth_required: the agent wants its own sign-in first. */
const AUTH_REQUIRED = -32000;

/** The oldest Codex the chat was tried with: an older one may have an app server the adapter can't talk to. */
export const CODEX_TESTED = '0.132.0';

/**
 * A Codex that did not start, older than the ones tried: its reason, and that updating it is the likely fix (an old
 * one's app server goes away as the session opens, "connection got disposed", and says nothing more).
 * @param {string} agent @param {string | undefined} path @param {any} e @param {(file: string) => string | null} [versionOf]
 */
export function codexTooOld(agent, path, e, versionOf = codexVersion) {
  if (agent !== 'codex' || !path || e?.code === 'sign-in' || e?.code === 'not-installed') return e;
  const version = versionOf(path);
  if (!version || !laterVersion(CODEX_TESTED, version)) return e;
  const why = e instanceof Error ? e.message : String(e);
  return Object.assign(new Error(`Codex ${version} is older than OpenFilm needs (${CODEX_TESTED} or later): update Codex, then try again. ${why}`.trim()), { code: 'outdated' });
}

/**
 * A session refused for the agent's sign-in, said so (`code: 'sign-in'`); any other error with its reason: an error
 * the agent sends as "Internal error" carries the reason in its `data` (Codex's settings it cannot read, for one).
 */
export function signInError(label, e) {
  if (e?.code === AUTH_REQUIRED) return Object.assign(new Error(`${label} is not signed in. Sign in under Settings → Agents.`), { code: 'sign-in' });
  const data = e?.data;
  const why = typeof data === 'string' ? data : [data?.message, data?.details].find((v) => typeof v === 'string') ?? '';
  return why.trim() ? Object.assign(new Error(why.trim()), { code: e.code }) : e;
}

/** The answer that lets it go ahead (for good, where it offers that), or null when none does. */
export function allowOption(params) {
  const options = params?.options ?? [];
  return (options.find((o) => o.kind === 'allow_always') ?? options.find((o) => o.kind === 'allow_once'))?.optionId ?? null;
}

/** The older session lists (`models`, `modes`) as the config options the chat's menu reads. */
export function legacyOptions(session) {
  const out = [];
  if (session.models?.availableModels?.length) {
    out.push({ id: 'model', name: 'Model', category: 'model', type: 'select', currentValue: session.models.currentModelId,
      options: session.models.availableModels.map((m) => ({ value: m.modelId, name: m.name, ...(m.description ? { description: m.description } : {}) })) });
  }
  if (session.modes?.availableModes?.length) {
    out.push({ id: 'mode', name: 'Mode', category: 'mode', type: 'select', currentValue: session.modes.currentModeId,
      options: session.modes.availableModes.map((m) => ({ value: m.id, name: m.name, ...(m.description ? { description: m.description } : {}) })) });
  }
  return out;
}

/**
 * One conversation: one ACP session on one adapter process.
 *
 * `onUpdate(update)` hears each session/update as it comes; `onPermission(params)` answers an optionId, or null to
 * refuse (with no handler everything is refused: permission is never given for the person).
 */
export class AgentSession {
  /**
   * @param {{ agent: string, cwd: string, resume?: string | null, binDir?: string | null, fallbackDir?: string | null,
   *           env?: Record<string, string>,
   *           skills?: { dataDir: string, mine?: string, allowed?: string[], mcpAllowed?: string[] } | null,
   *           onUpdate?: (update: any) => void, onPermission?: (params: any) => Promise<string | null>,
   *           onQuestion?: (ask: { message: string, toolCallId: string | null, questions: any[] }) => Promise<Record<string, { label?: string, text?: string }> | null>,
   *           onExit?: (info: { code: number | null, stderr: string }) => void,
   *           onSend?: (sent: { prompt: any[], _meta?: any }) => void,
   *           planner?: { instructions: string } }} opts
   * `onSend` hears each message as it goes to the agent, whole (the app's words before the first one's, for an agent
   * told them there); `opened`, once started, says what it was started and opened with.
   * `skills`: the session has its maker's skills and MCP servers, OpenFilm's skills, and of the person's own only those
   * let in (`allowed`, `mcpAllowed`), each agent told by its own switch (agent-skills.mjs); `opened.skills` says how.
   */
  constructor(opts) {
    if (!isChatAgent(opts.agent)) throw new Error(`Unknown agent: ${String(opts.agent)}`);
    this.opts = opts;
    this.spec = AGENTS[opts.agent];
    this.sessionId = null;
    this.info = null;
    this.stderr = '';
    /** while an old session is loaded its history is replayed: the chat already has it */
    this.replaying = false;
  }

  /**
   * Start the adapter, shake hands, open (or resume) the session. The agent gets all the person's login shell sets
   * (their keys, gateways, tokens; Claude Code only its PATH and the like, agentShell), as in their terminal, and the app's
   * `openfilm` first on its PATH; the app's ffmpeg (`fallbackDir`) last, for a computer that has none of its own.
   */
  async start() {
    try {
      return await this.open();
    } catch (e) {
      throw codexTooOld(this.opts.agent, this.cli?.path, e);
    }
  }

  async open() {
    const hostShell = agentShell(this.opts.agent, await loginShellVariables({ staleOk: true }));
    const shell = this.opts.planner ? plannerEnvironment(hostShell, { home: this.opts.env.CODEX_HOME }) : hostShell;
    const cli = resolveAgentCli(this.opts.agent, { pathDirs: hostShell.PATH.split(PATH_SEP) });
    if (!cli) throw Object.assign(new Error(`${this.spec.label} is not installed on this computer.`), { code: 'not-installed' });
    this.cli = cli;
    const node = nodeRuntime();
    const path = [this.opts.binDir, shell.PATH, this.opts.fallbackDir].filter(Boolean).join(PATH_SEP);
    const instructions = this.opts.planner?.instructions ?? INSTRUCTIONS;
    /* its skills and MCP servers: its maker's, OpenFilm's skills, and the person's own only those let in (agent-skills.mjs) */
    const skills = !this.opts.planner && this.opts.skills
      ? await sessionSkills(this.opts.agent, { cwd: this.opts.cwd, env: shell, ...this.opts.skills }).catch(() => null) : null;
    const launch = this.opts.planner ? videoCodexLaunchEnv(cli.path, { directory: this.opts.env.CODEX_HOME, nodeCommand: node.command, nodeArgs: node.env.ELECTRON_RUN_AS_NODE ? [AS_NODE] : [] }) : this.spec.env(cli.path);
    const extra = { ...this.opts.env, ...node.env, ...launch, ...skills?.env, OPENFILM_CLIENT_PROFILE: CLIENT_PROFILE };
    const env = childEnvironment({ shell: { ...shell, PATH: path }, extra });
    if (this.spec.adapter === AGENTS.codex.adapter) {
      const theirs = this.opts.planner ? null : codexDeveloperInstructions(codexConfigText(shell));
      env.CODEX_CONFIG = JSON.stringify({ ...mergeConfig({ developer_instructions: theirs ? `${theirs}\n\n${instructions}` : instructions }, skills?.codexConfig ?? {}), check_for_update_on_startup: false });
    }
    /* the others have no place for it: the session's first message carries it */
    this.instructions = null;

    const script = adapterScript(this.spec.adapter);
    this.child = spawn(node.command, [...(node.env.ELECTRON_RUN_AS_NODE ? [AS_NODE] : []), script], { cwd: this.opts.cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.child.stderr.on('data', (d) => { this.stderr = (this.stderr + String(d)).slice(-16_000); });
    this.child.once('exit', (code) => this.opts.onExit?.({ code, stderr: this.stderr }));
    this.child.once('error', () => {});

    const stream = acp.ndJsonStream(Writable.toWeb(this.child.stdin), Readable.toWeb(this.child.stdout));
    this.conn = acp.client({ name: 'openfilm-desktop' })
      .onRequest(acp.methods.client.session.requestPermission, async (ctx) => {
        const optionId = (this.spec.approve ? allowOption(ctx.params) : null)
          ?? (this.opts.onPermission ? await this.opts.onPermission(ctx.params) : null);
        return optionId ? { outcome: { outcome: 'selected', optionId } } : { outcome: { outcome: 'cancelled' } };
      })
      .onRequest(acp.methods.client.elicitation.create, async (ctx) => {
        const questions = formQuestions(ctx.params);
        if (!questions || !this.opts.onQuestion) return { action: 'decline' };
        const answers = await this.opts.onQuestion({ message: ctx.params.message ?? '', toolCallId: ctx.params.toolCallId ?? null, questions });
        return answers ? { action: 'accept', content: formContent(questions, answers) } : { action: 'decline' };
      })
      .onNotification(acp.methods.client.session.update, (ctx) => {
        if (!this.replaying) this.opts.onUpdate?.(ctx.params.update);
      })
      .connect(stream);

    const init = await this.conn.agent.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: CLIENT_CAPABILITIES,
      clientInfo: CLIENT_INFO,
    }).catch((e) => { throw signInError(this.spec.label, e); });

    const params = {
      cwd: this.opts.cwd,
      mcpServers: [],
      ...(skills?.additionalDirectories ? { additionalDirectories: skills.additionalDirectories } : {}),
    };
    /* the program's own sign-in, taken up (Cursor asks for this before any session) */
    if (this.spec.authenticate && (init.authMethods ?? []).some((m) => m.id === this.spec.authenticate)) {
      await this.conn.agent.request(acp.methods.agent.authenticate, { methodId: this.spec.authenticate }).catch((e) => { throw signInError(this.spec.label, e); });
    }

    let session = null;
    const resume = this.opts.resume;
    const caps = init.agentCapabilities ?? {};
    if (resume && caps.sessionCapabilities?.resume) {
      session = await this.conn.agent.request(acp.methods.agent.session.resume, { ...params, sessionId: resume }).then((r) => ({ ...r, sessionId: resume }), () => null);
    } else if (resume && caps.loadSession) {
      this.replaying = true;
      session = await this.conn.agent.request(acp.methods.agent.session.load, { ...params, sessionId: resume }).then((r) => ({ ...r, sessionId: resume }), () => null);
      this.replaying = false;
    }
    const resumed = Boolean(session);
    session ??= await this.conn.agent.request(acp.methods.agent.session.new, params).catch((e) => { throw signInError(this.spec.label, e); });
    this.sessionId = session.sessionId;
    /* an agent on the older model and mode lists (Gemini CLI): the same choices, as config options */
    this.legacy = !session.configOptions && Boolean(session.models || session.modes);
    if (resumed) this.instructions = null;
    this.info = {
      sessionId: session.sessionId,
      resumed,
      agentInfo: init.agentInfo ?? null,
      models: session.models ?? null,
      modes: session.modes ?? null,
      configOptions: session.configOptions ?? (this.legacy ? legacyOptions(session) : null),
      /* what a prompt may carry besides text (pictures, for one): the agent says so as it shakes hands */
      promptCapabilities: caps.promptCapabilities ?? null,
      /* a message sent while it works joins the turn it is in (steer), as in its own chat */
      steering: init._meta?.steering?.supported === true,
    };
    this.noteModel(this.info.configOptions);
    /* what the agent was started and opened with, for the turn log: every word the app adds to its own, and the
       variables the app set (a key's value never: it reads "(hidden)") */
    this.opened = {
      program: cli.path,
      /* the command line the agent's process was started with: its own program, or the app's Node running its adapter (or Pi) */
      command: [node.command, ...(node.env.ELECTRON_RUN_AS_NODE ? [AS_NODE] : []), script],
      adapter: this.spec.adapter ?? null,
      env: Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, /KEY|TOKEN|SECRET|PASSWORD/i.test(k) ? '(hidden)' : v])),
      ...(env.CODEX_CONFIG ? { codexConfig: JSON.parse(env.CODEX_CONFIG) } : {}),
      path: { first: this.opts.binDir ?? null, last: this.opts.fallbackDir ?? null },
      fromShell: this.spec.fromShell ? Object.keys(shell).sort() : 'all',
      initialize: { request: { protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: CLIENT_CAPABILITIES, clientInfo: CLIENT_INFO }, response: init },
      session: { method: !resumed ? 'session/new' : caps.sessionCapabilities?.resume ? 'session/resume' : 'session/load', params: { ...params, ...(resumed ? { sessionId: resume } : {}) } },
      firstMessage: this.instructions,
      log: null,
      skills: skills?.log ?? null,
    };
    return this.info;
  }

  /**
   * Send a message; resolves with the stopReason when the turn ends. Everything on the way comes from onUpdate.
   * `turnId`: the app's own agent writes each request to its model in that turn's log (chat-store.mjs).
   */
  async prompt(blocks, { turnId } = {}) {
    if (!this.sessionId) throw new Error('The session has not started.');
    const meta = {};
    const told = this.instructions ? [{ type: 'text', text: this.instructions }] : [];
    this.instructions = null;
    /* the message exactly as the agent gets it, for the turn log */
    this.opts.onSend?.({ prompt: [...told, ...blocks], ...meta });
    const r = await this.conn.agent.request(acp.methods.agent.session.prompt, { sessionId: this.sessionId, prompt: [...told, ...blocks], ...meta })
      .catch((e) => {
        if (!isAgentId(this.opts.agent)) throw e;
        const said = signInError(this.spec.label, e);
        if (said.code === 'sign-in') noteSignedOut(this.opts.agent);
        throw said;
      });
    return r.stopReason;
  }

  /**
   * A message sent while a turn runs, into that turn (ACP's steering extension, `_session/steering`): the agent reads
   * it at its next step, as when the person types while it works in its own chat. → 'injected' when it joined the
   * turn; anything else ('startedNewTurn', 'promptRequired', 'failed') when it did not.
   */
  async steer(blocks) {
    if (!this.sessionId || !this.info?.steering) return 'failed';
    const r = await this.conn.agent.request('_session/steering', { sessionId: this.sessionId, prompt: blocks }).catch(() => null);
    return typeof r?.outcome === 'string' ? r.outcome : 'failed';
  }

  /** Stop this turn (it ends with stopReason 'cancelled'). */
  async cancel() {
    if (this.sessionId) await this.conn.agent.notify(acp.methods.agent.session.cancel, { sessionId: this.sessionId }).catch(() => {});
  }

  /** An option the adapter reports in configOptions: the model, the reasoning effort, the mode. */
  async setConfigOption(configId, value) {
    if (this.legacy && configId === 'mode') return this.setMode(value);
    if (this.legacy && configId === 'model') return this.conn.agent.request('session/set_model', { sessionId: this.sessionId, modelId: value });
    const r = await this.conn.agent.request(acp.methods.agent.session.setConfigOption, { sessionId: this.sessionId, configId, value });
    this.noteModel(r?.configOptions);
    return r;
  }

  /** The model the session is on (its `model` option's value): the app's own agent names the service a failure was on by it. */
  noteModel(configOptions) {
    const model = (configOptions ?? []).find((o) => o?.id === 'model');
    if (model) this.modelNow = model.currentValue;
  }

  async setMode(modeId) {
    return this.conn.agent.request(acp.methods.agent.session.setMode, { sessionId: this.sessionId, modeId });
  }

  async close() {
    try { this.conn?.close(); } catch { /* gone already */ }
    if (this.child && this.child.exitCode === null) {
      const child = this.child;
      await new Promise(resolve => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 2000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
        child.kill('SIGTERM');
      });
    }
  }
}
