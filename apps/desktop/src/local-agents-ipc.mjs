/**
 * The chat's IPC for its agents (the sessions themselves: agents.mjs), as the chat's lib/local-agent-run.ts talks to
 * them:
 *
 *   desktop:local-agents:list        → [{ id, label, cli: { path, source } | null, signedIn, install, setupRequired }]
 *   desktop:local-agents:sign-in     { agent } → Terminal runs its own sign-in, which opens its own page
 *   desktop:local-agents:probe       { agent } → { ok, info }: a session opened and closed, only for its options
 *                                    (model, reasoning effort) and its commands (info.commands), so the menu and the
 *                                    composer's / show them before the first message
 *   desktop:local-agents:start       { agent, cwd, resume? } → { ok, key, info } | { ok: false, error, code? }
 *                                    resume: the agent's own id of a conversation it had (info.sessionId of an earlier
 *                                    start), taken up where it stopped: the session still open here (a reloaded
 *                                    page), else the agent's own resume; a new one when it cannot
 *   desktop:local-agents:prompt      { key, text, meta?, images? } → { ok, stopReason } | { ok: false, error }
 *                                    images: [{ data (base64), mimeType }], the pictures of the message's references,
 *                                    sent after the text to an agent that takes pictures (the text names their files
 *                                    either way)
 *   desktop:local-agents:steer       { key, text, images? } → { ok, outcome }   a message sent while a turn runs,
 *                                    into that turn (ok: it joined it); the page sends it as a turn of its own if not
 *   desktop:local-agents:adopt       { key, turnId | null, meta? }   what the agent does with nobody having written (a
 *                                    background task of its own came back) is the page's turn `turnId`: written in its
 *                                    log from the first of it (kept since the last turn), until null
 *   desktop:local-agents:cancel      { key }
 *   desktop:local-agents:set-option  { key, configId, value }
 *   desktop:local-agents:permission  { key, requestId, optionId | null }   the page answers a permission request
 *   desktop:local-agents:answer      { key, requestId, answers | null }    the page answers its question (null: skip)
 *   desktop:local-agents:close       { key }
 *   desktop:local-agents:running     → [{ key, agent, cwd, meta, done, events }]  a reloaded page puts the turn back
 *   desktop:local-agents:ack         { key, turnId }  the page has the turn: it is forgotten here
 *
 * One channel to the page, `desktop:local-agents:event`, carrying { key, kind, … }:
 *   'update' { update }, 'permission' { requestId, params }, 'question' { requestId, message, toolCallId, questions },
 *   'exit' { code, stderr }, 'done' { turnId, ok, stopReason | error }.
 *
 * A session belongs to the page that opened it: when the page goes, its sessions close, no orphan processes. A
 * reload in the middle of a turn loses nothing: the running turn (the page's meta and every event since) is kept
 * here until the reloaded page takes it, and the reloaded page takes the session up again by its id. One left idle
 * for IDLE_MS closes (its process goes); the conversation is resumed from the agent's own record on its next turn.
 *
 * Every turn is also written down as it happens, in the project's `.film/logs/<turn>.jsonl` (chat-store.mjs):
 * the prompt and the session it ran in (what the agent was started and opened with, `opened`), each message exactly
 * as the agent got it (`sent`: the app's words before the first one's too; pictures kept apart, by file), every event
 * above, each answer the page gave, how it ended. Once a turn ends, the requests the agent made to its model are read
 * from its own record (agent-records.mjs),
 * into `.film/logs/<turn>.model.jsonl`, as the app's own agent writes its own.
 */
import { prepareEditPrompt } from './edit-workflow.mjs';
import { CLIENT_AGENTS } from 'openfilm/client-scope';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { RECORDED_AGENTS, agentRecordCalls, compactCalls } from './agent-records.mjs';
import { AgentSession, isAgentId, isChatAgent, listAgents, openAgentSignIn } from './agents.mjs';
import { loggedBlocks, openLog, writeModelLog } from './chat-store.mjs';
import { loginShellVariables } from './environment.mjs';
import { codexEnvironment } from './codex-runtime.mjs';
import { VideoAgentSession } from './video-agent-session.mjs';
import { assertVideoRequest, assertVideoStorage, videoProjectRoot, VideoPolicyError } from './video-policy.mjs';

const TURN_LOG_MAX = 5000;
/** what the agent sends between turns, kept for a turn of its own the page may open for it */
const BETWEEN_TURNS_MAX = 500;
/** a session nobody has spoken in for this long closes; how often that is looked at */
const IDLE_MS = 20 * 60_000;
const IDLE_CHECK_MS = 60_000;
/** how long after its turn a session whose skills changed closes: the page has settled the turn by then */
const STALE_CLOSE_MS = 3000;
/** the pictures one message may carry, and how big each (base64 of a JPEG at most 1280 px wide) */
const PROMPT_IMAGES_MAX = 8;
const PROMPT_IMAGE_MAX_CHARS = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** how long after a turn the agent's own record is read: its last lines may still be on their way to the file */
const RECORD_SETTLE_MS = 800;

/**
 * The agent's requests to its model from `from` to `to` (ms), read from its own record (or `agentLog`, the log it was
 * started with) into the turn's model log. Never throws: a record that cannot be read leaves the turn without one.
 */
export async function keepAgentRecord({ agent, sessionId, cwd, turnId, from, to, agentLog = null, log = () => {}, settleMs = RECORD_SETTLE_MS }) {
  if (!RECORDED_AGENTS.includes(agent) || !sessionId || !turnId) return;
  try {
    await new Promise((done) => setTimeout(done, settleMs));
    const env = codexEnvironment(await loginShellVariables({ staleOk: true }));
    const found = agentRecordCalls({ agent, sessionId, cwd, from, to, env, log: agentLog });
    if (found?.calls.length) writeModelLog(cwd, turnId, compactCalls(found.calls));
  } catch (e) {
    log(`agent record ${turnId}: ${e instanceof Error ? e.message : String(e)}\n`);
  }
}

/** The page's pictures as ACP image blocks; anything not one is left out. */
function imageBlocks(images) {
  if (!Array.isArray(images)) return [];
  return images
    .filter((image) => typeof image?.data === 'string' && image.data.length > 0 && image.data.length <= PROMPT_IMAGE_MAX_CHARS && IMAGE_TYPES.has(image.mimeType))
    .slice(0, PROMPT_IMAGES_MAX)
    .map((image) => ({ type: 'image', data: image.data, mimeType: image.mimeType }));
}

/**
 * @param {import('electron').IpcMain} ipcMain
 * `onWorking` hears the folders agents are working in (a turn running there) each time they change; `onAsking` the
 * folders where an agent waits for the person's answer.
 * `skills`: where the app keeps its record of skills (`dataDir`) and the person's own skills (`mine`): each session has its maker's skills and MCP servers, OpenFilm's skills, and of the person's own those let
 * in (agent-skills.mjs).
 * @param {{ trusted: (event: any) => boolean, binDir?: string | null, fallbackDir?: string | null, env?: Record<string, string>,
 *           onWorking?: (folders: string[]) => void, onAsking?: (folders: string[]) => void,
 *           skills?: { dataDir: string, mine: string } | null }} opts
 */
export function registerLocalAgentIpc(ipcMain, { trusted, binDir = null, fallbackDir = null, env = {}, log = () => {}, onWorking = () => {}, onAsking = () => {}, skills = null, videoSecurity = null }) {
  /** @type {Map<string, { session: AgentSession, sender: import('electron').WebContents, pending: Map<string, (answer: any) => void>, agent: string, cwd: string, turn: any }>} */
  const sessions = new Map();
  let activePrompts = 0;
  /** the folders a turn is running in now: what a project cannot be deleted from under */
  const working = () => [...new Set([...sessions.values()].filter((entry) => entry.running > 0).map((entry) => entry.cwd))];
  /** the folders where an agent waits for the person's answer (a permission, a question): told on each change */
  const tellAsking = () => onAsking([...new Set([...sessions.values()].filter((entry) => entry.pending.size > 0).map((entry) => entry.cwd))]);
  const handle = (channel, fn) => ipcMain.handle(channel, (event, opts) => {
    if (!trusted(event)) throw new Error('not the chat');
    if (opts?.key && sessions.has(opts.key) && sessions.get(opts.key).sender !== event.sender) return { ok: false, error: 'This session belongs to another project page.' };
    return fn(event, opts);
  });
  const authorize = async (event, cwd) => {
    if (!videoSecurity?.projects || !videoSecurity?.projectFor) throw new VideoPolicyError('视频权限边界未初始化，已停止执行。');
    const bound = await videoSecurity.projectFor(event);
    const root = videoProjectRoot(cwd, { projects: await videoSecurity.projects(), protectedRoots: videoSecurity.protectedRoots ?? [] });
    if (root !== videoProjectRoot(bound, { projects: [bound], protectedRoots: videoSecurity.protectedRoots ?? [] })) throw new VideoPolicyError('只能剪辑当前标签页的影片。');
    assertVideoStorage(root);
    return root;
  };

  const send = (entry, key, payload) => {
    /* anything it says counts as use: a session working on its own is not idle */
    entry.lastUsed = Date.now();
    if (entry.turn && !entry.turn.done) { const { kind, ...fields } = payload; entry.turn.file.write(kind, fields); }
    else if (entry.adopted) { const { kind, ...fields } = payload; entry.adopted.write(kind, fields); }
    else {
      entry.between = [...(entry.between ?? []), payload].slice(-BETWEEN_TURNS_MAX);
    }
    const log = entry.turn?.log;
    if (log && !entry.turn.done) {
      log.push(payload);
      /* a very long turn: keep the questions and permission requests, let the oldest updates go */
      if (log.length > TURN_LOG_MAX) {
        const i = log.findIndex((e) => e.kind === 'update');
        if (i >= 0) log.splice(i, 1);
      }
    }
    if (!entry.sender.isDestroyed()) entry.sender.send('desktop:local-agents:event', { key, ...payload });
  };
  const close = (key) => {
    const entry = sessions.get(key);
    if (!entry) return;
    for (const answer of entry.pending.values()) answer(null);
    void Promise.resolve(entry.session.close()).catch(() => log('video session cleanup failed\n'));
    sessions.delete(key);
    if (entry.running > 0) onWorking(working());
  };

  handle('desktop:local-agents:list', () => listAgents(CLIENT_AGENTS));

  handle('desktop:local-agents:sign-in', (_event, opts) => {
    const agent = opts?.agent;
    if (!isAgentId(agent)) return { ok: false, error: `Unknown agent: ${String(agent)}` };
    return openAgentSignIn(agent);
  });

  /* disconnected in the app: its sessions here close; its own sign-in is not the app's to end */
  handle('desktop:local-agents:disconnect', (_event, opts) => {
    const agent = opts?.agent;
    if (!isAgentId(agent)) return { ok: false };
    for (const [key, entry] of [...sessions]) if (entry.agent === agent) close(key);
    return { ok: true };
  });

  handle('desktop:local-agents:probe', async (_event, opts) => {
    const agent = opts?.agent;
    if (!isChatAgent(agent) || !CLIENT_AGENTS.includes(agent)) return { ok: false, error: `Unknown agent: ${String(agent)}` };
    let session;
    try {
      session = new VideoAgentSession({ agent, cwd: null, dataDir: videoSecurity?.dataDir ?? skills?.dataDir, fallbackDir });
      const info = await session.start();
      return { ok: true, info: { ...info, commands: [] } };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      /* the model menu says only that it could not start: what went wrong is kept here (logs/studio.log) */
      log(`probe ${agent}: ${error.replace(/\s+/g, ' ').slice(0, 500)}\n`);
      return { ok: false, error, ...(e?.code ? { code: String(e.code) } : {}) };
    } finally {
      await session?.close();
    }
  });

  handle('desktop:local-agents:start', async (event, opts) => {
    const agent = opts?.agent;
    let cwd = opts?.cwd;
    const resume = typeof opts?.resume === 'string' && opts.resume ? opts.resume : null;
    if (!isChatAgent(agent) || !CLIENT_AGENTS.includes(agent)) return { ok: false, error: `Unknown agent: ${String(agent)}` };
    if (typeof cwd !== 'string' || !cwd) return { ok: false, error: 'Missing project folder.' };
    try { cwd = await authorize(event, cwd); } catch (error) { return { ok: false, error: error.message, code: 'video-policy' }; }
    /* the conversation still open here (the page was reloaded): taken up as it is, no second process */
    const open = resume ? [...sessions].find(([, e]) => e.agent === agent && e.cwd === cwd && e.info?.sessionId === resume && e.sender === event.sender) : null;
    if (open) {
      open[1].lastUsed = Date.now();
      return { ok: true, key: open[0], info: { ...open[1].info, resumed: true, authMethods: [], mcp: false } };
    }
    const key = randomUUID();
    const pending = new Map();
    const entry = { sender: event.sender, pending, session: null, agent, cwd, turn: null, lastUsed: Date.now() };
    try {
      entry.session = new VideoAgentSession({
        agent,
        cwd,
        resume,
        binDir,
        fallbackDir,
        env,
        skills,
        dataDir: videoSecurity.dataDir,
        authorize: () => authorize(event, cwd),
        exportFilm: videoSecurity.exportFilm ? options => videoSecurity.exportFilm(cwd, options) : null,

        onUpdate: (update) => send(entry, key, { kind: 'update', update }),
        onPermission: (params) => new Promise((resolve) => {
          const requestId = randomUUID();
          pending.set(requestId, (optionId) => { pending.delete(requestId); tellAsking(); resolve(optionId); });
          send(entry, key, { kind: 'permission', requestId, params });
          tellAsking();
        }),
        onQuestion: (ask) => new Promise((resolve) => {
          const requestId = randomUUID();
          pending.set(requestId, (answers) => { pending.delete(requestId); tellAsking(); resolve(answers); });
          send(entry, key, { kind: 'question', requestId, ...ask });
          tellAsking();
        }),
        onExit: (info) => { send(entry, key, { kind: 'exit', ...info }); sessions.delete(key); if (entry.running > 0) onWorking(working()); },
        onSend: (sent) => {
          const file = entry.turn && !entry.turn.done ? entry.turn.file : entry.adopted;
          file?.write('sent', { ...sent, prompt: loggedBlocks(cwd, sent.prompt) });
        },
      });
      sessions.set(key, entry);
      event.sender.once('destroyed', () => close(key));
      const info = await entry.session.start();
      entry.info = info;
      return { ok: true, key, info: { ...info, authMethods: [], mcp: false } };
    } catch (e) {
      close(key);
      return { ok: false, error: e instanceof Error ? e.message : String(e), ...(e?.code ? { code: String(e.code) } : {}) };
    }
  });

  handle('desktop:local-agents:prompt', async (event, opts) => {
    const key = opts?.key;
    const entry = sessions.get(key);
    if (!entry || entry.sender !== event.sender) return { ok: false, error: 'This session has ended.' };
    if (entry.accepting || entry.running > 0) return { ok: false, error: '请等待当前视频任务完成。' };
    entry.accepting = true;
    let prepared;
    try { await authorize(event, entry.cwd); assertVideoRequest(opts?.text); prepared = prepareEditPrompt(entry.cwd, opts.text); }
    catch (error) { entry.accepting = false; return { ok: false, error: error.message }; }
    entry.accepting = false;
    const meta = opts?.meta && typeof opts.meta === 'object' ? opts.meta : null;
    const file = meta ? openLog(entry.cwd, meta.turnId, (e) => log(`turn log ${meta.turnId}: ${e.message}\n`)) : null;
    const turn = meta ? { meta, log: [], done: null, file } : null;
    const { text, workflow } = prepared;
    /* an agent that takes no pictures is given none: the text names each one's file, which it can open itself */
    const images = entry.info?.promptCapabilities?.image ? imageBlocks(opts?.images) : [];
    entry.between = [];
    if (turn) {
      entry.turn = turn;
      file.write('prompt', { agent: entry.agent, cwd: entry.cwd, session: entry.info ?? null, opened: entry.session.opened ?? null, meta, text, workflow, images: images.length });
    }
    const from = Date.now();
    activePrompts++;
    entry.running = (entry.running ?? 0) + 1;
    onWorking(working());
    let result;
    try {
      result = { ok: true, stopReason: await entry.session.prompt([{ type: 'text', text }, ...images], { turnId: meta?.turnId, userText: opts.text, workflow }) };
    } catch (e) {
      /* `balance`: the service the app's own agent runs on has no balance left (agents.mjs), and where to top it up */
      result = { ok: false, error: e instanceof Error ? e.message : String(e), ...(e?.balance ? { balance: e.balance } : {}) };
    } finally {
      activePrompts--;
      entry.running -= 1;
      onWorking(working());
    }
    entry.lastUsed = Date.now();
    if (turn) {
      /* a turn that failed: what the agent's process last wrote to stderr says why */
      turn.file.write('done', result.ok ? result : { ...result, stderr: String(entry.session?.stderr ?? '').slice(-8000) });
      turn.file.end();
      turn.done = result;
      entry.turnEnded = Date.now();
      /* its skills changed while it worked: closed now its turn is over (refreshSkills) */
      if (entry.stale) setTimeout(() => { if (sessions.get(key) === entry && !(entry.running > 0)) close(key); }, STALE_CLOSE_MS);
      if (!entry.info?.videoPolicy) void keepAgentRecord({ agent: entry.agent, sessionId: entry.info?.sessionId, cwd: entry.cwd, turnId: meta.turnId, from, to: entry.turnEnded, agentLog: entry.session.opened?.log, log });
      /* the page that asked may be gone (reloaded): say it on the channel too */
      if (!entry.sender.isDestroyed()) entry.sender.send('desktop:local-agents:event', { key, kind: 'done', turnId: meta.turnId, ...result });
    }
    return result;
  });

  /* the turns a (reloaded) page should put back: still running, or finished and not yet taken */
  handle('desktop:local-agents:running', event => [...sessions].filter(([, entry]) => entry.sender === event.sender)
    .filter(([, entry]) => entry.turn)
    .map(([key, entry]) => ({ key, agent: entry.agent, cwd: entry.cwd, meta: entry.turn.meta, done: entry.turn.done, events: entry.turn.log })));

  handle('desktop:local-agents:ack', (_event, opts) => {
    const entry = sessions.get(opts?.key);
    if (entry?.turn && entry.turn.done && entry.turn.meta?.turnId === opts?.turnId) entry.turn = null;
    return { ok: true };
  });

  /* what the page answered goes in the turn's log beside what was asked */
  const noted = (opts, kind, fields) => {
    const turn = sessions.get(opts?.key)?.turn;
    if (turn && !turn.done) turn.file.write(kind, fields);
  };

  handle('desktop:local-agents:steer', async (event, opts) => {
    const entry = sessions.get(opts?.key);
    if (!entry || entry.sender !== event.sender || !(entry.running > 0)) return { ok: false, outcome: 'noRunningTurn' };
    const images = entry.info?.promptCapabilities?.image ? imageBlocks(opts?.images) : [];
    let prepared;
    try { await authorize(event, entry.cwd); assertVideoRequest(opts?.text); prepared = prepareEditPrompt(entry.cwd, opts.text); }
    catch (error) { return { ok: false, outcome: 'workflowError', error: error.message }; }
    const { text, workflow } = prepared;
    noted(opts, 'steer', { text, workflow, images: images.length, prompt: loggedBlocks(entry.cwd, [{ type: 'text', text }, ...images]) });
    const outcome = await entry.session.steer([{ type: 'text', text }, ...images]);
    noted(opts, 'steer-answer', { outcome });
    return { ok: outcome === 'injected', outcome };
  });

  handle('desktop:local-agents:adopt', (_event, opts) => {
    const entry = sessions.get(opts?.key);
    if (!entry) return { ok: false };
    if (entry.info?.videoPolicy) return { ok: false, error: '视频会话不执行后台自主任务。' };
    if (entry.adopted) {
      entry.adopted.write('done', { ok: true, unprompted: true });
      entry.adopted.end();
      if (!entry.info?.videoPolicy) void keepAgentRecord({ agent: entry.agent, sessionId: entry.info?.sessionId, cwd: entry.cwd, turnId: entry.adopted.turnId, from: entry.adopted.from, to: Date.now(), agentLog: entry.session?.opened?.log, log });
    }
    entry.adopted = null;
    if (typeof opts?.turnId === 'string') {
      entry.adopted = Object.assign(openLog(entry.cwd, opts.turnId, (e) => log(`turn log ${opts.turnId}: ${e.message}\n`)), { turnId: opts.turnId, from: entry.turnEnded ?? Date.now() });
      /* `meta`: the page's turn, so a log found without a saved turn can be made a turn again (chat-store unsavedTurns) */
      const meta = opts?.meta && typeof opts.meta === 'object' ? opts.meta : null;
      entry.adopted.write('prompt', { agent: entry.agent, cwd: entry.cwd, session: entry.info ?? null, opened: entry.session?.opened ?? null, meta, unprompted: true, text: '' });
      for (const { kind, ...fields } of entry.between ?? []) entry.adopted.write(kind, fields);
    }
    entry.between = [];
    return { ok: true };
  });

  handle('desktop:local-agents:cancel', async (_event, opts) => {
    noted(opts, 'cancel', {});
    await sessions.get(opts?.key)?.session.cancel();
    return { ok: true };
  });

  handle('desktop:local-agents:set-option', async (event, opts) => {
    noted(opts, 'set-option', { configId: opts?.configId, value: opts?.value });
    const entry = sessions.get(opts?.key);
    if (!entry || entry.sender !== event.sender) return { ok: false, error: 'This session has ended.' };
    try {
      return { ok: true, result: await entry.session.setConfigOption(String(opts.configId), opts.value) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  handle('desktop:local-agents:permission', (_event, opts) => {
    noted(opts, 'permission-answer', { requestId: opts?.requestId, optionId: opts?.optionId ?? null });
    const answer = sessions.get(opts?.key)?.pending.get(opts?.requestId);
    answer?.(typeof opts?.optionId === 'string' ? opts.optionId : null);
    return { ok: Boolean(answer) };
  });

  handle('desktop:local-agents:answer', (_event, opts) => {
    noted(opts, 'question-answer', { requestId: opts?.requestId, answers: opts?.answers ?? null });
    const answer = sessions.get(opts?.key)?.pending.get(opts?.requestId);
    answer?.(opts?.answers && typeof opts.answers === 'object' ? opts.answers : null);
    return { ok: Boolean(answer) };
  });

  handle('desktop:local-agents:close', (_event, opts) => {
    close(opts?.key);
    return { ok: true };
  });

  /* idle sessions close: a conversation not spoken in for a while costs no process; its next turn resumes it */
  const idle = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of [...sessions]) {
      if (!(entry.running > 0) && !entry.turn && entry.pending.size === 0 && now - (entry.lastUsed ?? 0) > IDLE_MS) close(key);
    }
  }, IDLE_CHECK_MS);
  idle.unref?.();

  return {
    isBusy: () => activePrompts > 0,
    working,
    closeAll: () => [...sessions.keys()].forEach(close),
    /** an agent disconnected in Settings: its sessions close */
    closeAgent: (agent) => { for (const [key, entry] of [...sessions]) if (entry.agent === agent) close(key); },
    /**
     * The skills or MCP servers let in changed for an agent: its sessions close (one at work once its turn ends), and the next message
     * takes each conversation up again with them.
     */
    refreshSkills: (agent) => {
      for (const [key, entry] of [...sessions]) {
        if (entry.agent !== agent) continue;
        if (entry.running > 0) entry.stale = true; else close(key);
      }
    },
  };
}
