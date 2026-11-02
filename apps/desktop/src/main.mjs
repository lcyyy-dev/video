/**
 * OpenFilm for desktop: one window of tabs, a project in each, Studio on the left and a chat on the right, one page
 * per tab (tabs.mjs). A project is picked in Studio's projects window (the tabs' `+`), and its tab opens; with no tab
 * open, the window's page is the projects (HOME).
 *
 * Studio is the open-source one (the `openfilm` package), run in a utility process (studio.mjs). It serves the
 * window's page: Studio's editor, built together with the chat beside it (shell/), on Studio's own origin, so the
 * editor works as it does in a browser and the chat is a column of the same page. What happens between them happens
 * in the page (shell/bridge.ts); this process does what only the app can: the window, the agents, files on the disk,
 * ffmpeg, updates (preload.cjs). The window opens straight into the last project.
 */
import { BaseWindow, Menu, WebContentsView, app, clipboard, dialog, ipcMain, nativeTheme, safeStorage, screen, shell } from 'electron';
import { appendFileSync, createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { FLAVOR, IDENTITY, PRODUCT_NAME } from './flavor.mjs';
import { folderDialogOptions, programDialogOptions } from './folder-dialog.mjs';
import { childEnvironment, loginShellEnvironment } from './environment.mjs';
import { startWindowStudio } from './studio.mjs';
import { CHAT_MIN, STUDIO_MIN, WINDOW_MIN, editorLayout, placeOnDisplays, readWindowState, writeWindowState } from './window-state.mjs';
import { applicationMenu } from './menu.mjs';
import { registerLocalAgentIpc } from './local-agents-ipc.mjs';
import { registerChatIpc } from './chat-ipc.mjs';
import { registerEditTemplateIpc } from './edit-template-ipc.mjs';
import { credentialStorage } from './credential-storage.mjs';
import { registerSkillsIpc } from './skills-ipc.mjs';
import { createRoster } from './agent-roster.mjs';
import { CLIENT_AGENTS, CLIENT_PROFILE } from 'openfilm/client-scope';
import { configureBundledCodex } from './codex-runtime.mjs';
import { checkAgentProgram, diagnoseAgent, listAgents, openAgentSignIn, setChosenPaths } from './agents.mjs';
import { agentUsage, forgetAgentUsage } from './agent-usage.mjs';
import { installOpenfilmCommand } from './openfilm-command.mjs';
import { startUpdates } from './updates.mjs';
import { ensureFfmpeg, ffmpegDir, ffmpegDownloadable, ffmpegIn, ffmpegOnPath } from './ffmpeg-runtime.mjs';
import { PATH_SEP } from './environment.mjs';
import { createTabs } from './tabs.mjs';
import { gatewayConfig, activateGateway, checkGatewayAuthorization, checkSub2ApiConfig, publicSub2ApiConfig, gatewayEndpoint, probeGatewayAuthorization } from './sub2api-config.mjs';
import { authorizationController } from './authorization-state.mjs';
import { precomputeUploadFrames } from './source-analysis.mjs';

process.env.OPENFILM_CLIENT_PROFILE = CLIENT_PROFILE;

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const mac = process.platform === 'darwin';
const windows = process.platform === 'win32';
/** Windows' window buttons over the top bar: the board's color, and the text's */
const overlayColours = (t) => ({ color: t === 'dark' ? '#111111' : '#f2f2f2', symbolColor: t === 'dark' ? '#dadada' : '#1f1f1f', height: 32 });

/* HTML-in-Canvas in Studio's viewer, as in the renderer (the `openfilm` package's src/host.mjs) */
app.commandLine.appendSwitch('enable-blink-features', 'CanvasDrawElement');
/* Chromium's Wayland text-input protocol is opt-in in Electron. Without it IBus/Fcitx can
   switch in other Linux apps but Chromium fields remain English-only. */
if (process.platform === 'linux' && process.env.WAYLAND_DISPLAY) {
  app.commandLine.appendSwitch('enable-wayland-ime');
  app.commandLine.appendSwitch('wayland-text-input-version', '3');
}

/* each flavour its own name, data folder and single-instance lock (flavor.mjs) */
app.setName(PRODUCT_NAME);
app.setPath('userData', IDENTITY.userData ?? join(app.getPath('appData'), PRODUCT_NAME));
const DATA = app.getPath('userData');
const LOGS = join(DATA, 'logs');
mkdirSync(LOGS, { recursive: true });
const log = (line) => { try { appendFileSync(join(LOGS, 'studio.log'), line); } catch { /* no log */ } };
const sub2apiStorage = () => ({...credentialStorage({safeStorage,dataDir:DATA}),onAuthorizationInvalidated:()=>authorization.invalidate()});

if (!app.requestSingleInstanceLock()) {
  if (!app.isPackaged) console.log(`${PRODUCT_NAME} is already running; requesting its existing window.`);
  app.quit();
} else {
  app.on('second-instance', () => focusWindow());
  app.whenReady().then(start).catch((error) => {
    console.error(error);
    app.exit(1);
  });
}

/** @type {BaseWindow | null} */
let win = null;
/** @type {ReturnType<typeof createTabs> | null} */
let tabs = null;
let appFfmpegDir = null;
/** the page of each tab that has one (a tab left behind long enough has none until it is shown again) */
/** @type {Map<string, WebContentsView>} */
const views = new Map();
/** the page in front */
const activeView = () => (tabs ? views.get(tabs.activeId() ?? HOME) ?? null : null);
/** something every page is told (the theme, an update, the agents…) */
const broadcast = (channel, value) => { for (const v of views.values()) if (!v.webContents.isDestroyed()) v.webContents.send(channel, value); };
/** the tab whose page this is, or null */
const tabOf = (contents) => { for (const [id, v] of views) if (v.webContents === contents) return id; return null; };
/** a tab behind for this long lets its page go (it comes back when shown), unless an agent works in it or it exports */
const IDLE_PAGE_MS = 5 * 60_000;
/** @type {Awaited<ReturnType<typeof startWindowStudio>> | null} */
let studio = null;
let state = readWindowState(DATA);
let theme = 'dark';
/** whether Studio has ffmpeg: true, false, { state: 'downloading', progress } or { state: 'failed', message } (null: not known yet) */
let ffmpegFound = null;
/** ffmpeg is being downloaded (ffmpeg-runtime.mjs): Studio's "not found" at its start is not the last word */
let ffmpegFetching = false;
const tellFfmpeg = (state) => { ffmpegFound = state; broadcast('desktop:ffmpeg', state); };
/** @type {ReturnType<typeof startUpdates> | null} */
let updates = null;
let quitting = false;
/** @type {ReturnType<typeof registerLocalAgentIpc> | null} */
let localAgents = null;
/** @type {ReturnType<typeof createRoster> | null} */
let roster = null;
let fullMenu = null;
const lockedMenu = () => Menu.buildFromTemplate([
  { label: '编辑', submenu: [{ role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
  { label: '退出', role: 'quit' },
]);
const authorization = authorizationController(() => checkGatewayAuthorization(DATA, sub2apiStorage()), next => {
  if (fullMenu) Menu.setApplicationMenu(next ? fullMenu : lockedMenu());
  broadcast('desktop:authorization', next);
  if (!next) localAgents?.closeAll();
});
const ipc = {
  handle(channel, handler) {
    ipcMain.handle(channel, (event, ...args) => {
      authorization.guard(channel);
      return handler(event, ...args);
    });
  },
};
let onlineAuthorizationCheck=null;
const authorizationStatus = async () => {
  const result=await authorization.status();
  if(result.authorized&&!onlineAuthorizationCheck){
    onlineAuthorizationCheck=probeGatewayAuthorization(DATA,sub2apiStorage()).finally(()=>{onlineAuthorizationCheck=null;});
  }
  return result;
};


/** the board Studio's panes sit on (its --dock-shell), so the window never flashes another color */
const BACKGROUND = { light: '#f2f2f2', dark: '#111111' };

function focusWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** Each page fills the window (only the one in front shows). */
function layout() {
  if (!win) return;
  const { width, height } = win.contentView.getBounds();
  for (const v of views.values()) v.setBounds({ x: 0, y: 0, width, height });
}

function saveState() {
  if (!win) return;
  const maximized = win.isMaximized() || win.isFullScreen();
  state = { ...state, maximized, bounds: maximized ? state.bounds : win.getNormalBounds(), ...(tabs ? { tabs: tabs.saved() } : {}) };
  try { writeWindowState(DATA, state); } catch { /* kept until next time */ }
}

/** Links out of the page open in the person's browser; the page never navigates away from Studio. */
function guard(contents, allowed) {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    if (allowed(url)) return;
    event.preventDefault();
    if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

/** IPC only from a tab's page, its own main frame. */
const fromPage = (event) => tabOf(event.sender) != null && event.senderFrame === event.sender.mainFrame;

/** A page for a tab: Studio's editor at its project (or its launcher), on Studio's origin. */
function makeView(tabId) {
  const v = new WebContentsView({
    webPreferences: {
      preload: here('./preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
      autoplayPolicy: 'no-user-gesture-required',
      devTools: !app.isPackaged,
    },
  });
  v.setBackgroundColor(BACKGROUND[theme]);
  views.set(tabId, v);
  win.contentView.addChildView(v);
  const { width, height } = win.contentView.getBounds();
  v.setBounds({ x: 0, y: 0, width, height });
  guard(v.webContents, (url) => Boolean(studio) && url.startsWith(`${studio.origin}/`));
  /* what went wrong with the page, for the log (logs/studio.log) */
  v.webContents.on('render-process-gone', (_event, details) => log(`page: renderer gone (${details.reason}, ${details.exitCode})\n`));
  v.webContents.on('did-fail-load', (_event, code, description, url, mainFrame) => { if (mainFrame) log(`page: ${description} (${code}) loading ${url.replace(/key=[^&]+/, 'key=…')}\n`); });
  v.webContents.on('unresponsive', () => log('page: not responding\n'));
  /* the page gone (a crash): it comes back where it was; the agents' turns go on in this process meanwhile */
  v.webContents.on('render-process-gone', (_event, details) => { if (details.reason !== 'clean-exit' && !quitting) setTimeout(() => { if (!v.webContents.isDestroyed()) v.webContents.reload(); }, 500); });
  return v;
}

/** The page shown when no tab is open: Studio's projects (`/` with tabs). */
const HOME = 'home';
/** Where a tab's page opens: its project (no tab: the projects). */
const pageAddress = (tab, path = null) => `${studio.origin}/open?key=${studio.key}&to=${encodeURIComponent(path ?? (tab ? `/projects/${encodeURIComponent(tab.projectId)}` : '/'))}`;

/** Every page told of the tabs as they are now; kept for next time. */
function tellTabs() {
  if (!tabs) return;
  broadcast('desktop:tabs', tabs.list());
  saveState();
}

/** Show a page: a tab's (made again when it has none), or HOME. Once a tab shows, HOME's page goes. */
function showPage(id) {
  if (!win || !studio) return;
  let v = views.get(id);
  if (!v) { v = makeView(id); void v.webContents.loadURL(pageAddress(id === HOME ? null : tabs?.get(id))); }
  for (const [other, page] of views) page.setVisible(other === id);
  v.webContents.focus();
  if (id !== HOME) dropView(HOME);
}

/** Bring a tab to the front. */
function showTab(id) {
  if (!tabs || !tabs.activate(id)) return;
  showPage(id);
  tellTabs();
}

/** A project's tab (in front if it is open already). */
function newTab(projectId) {
  if (!tabs || typeof projectId !== 'string' || !projectId) return;
  showTab(tabs.open({ projectId }).id);
}

/** Let a tab's page go: closed, or behind too long (the tab stays). */
function dropView(id) {
  const v = views.get(id);
  if (!v) return;
  views.delete(id);
  win?.contentView.removeChildView(v);
  if (!v.webContents.isDestroyed()) v.webContents.close();
}

/** Close a tab; one whose agent is still at work, only once the person says so. */
async function closeTab(id) {
  if (!tabs || !win) return;
  const tab = tabs.get(id);
  if (!tab) return;
  if (tab.working) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'warning', buttons: ['Close Tab', 'Cancel'], defaultId: 1, cancelId: 1,
      message: 'An agent is still working in this project.', detail: 'Closing the tab stops it.',
    });
    if (response !== 0) return;
  }
  dropView(id);
  const next = tabs.close(id);
  if (next) showTab(next.id);
  else { showPage(HOME); tellTabs(); }
}

/**
 * Studio's "open this project" (`openfilm open`, File › Open Project…), heard by every page at once: once only. Its
 * tab comes to the front, opened if it is not.
 */
let lastOpen = { to: '', at: 0 };
function openInTabs(to) {
  if (!tabs || typeof to !== 'string') return;
  if (to === lastOpen.to && Date.now() - lastOpen.at < 2000) return;
  lastOpen = { to, at: Date.now() };
  const projectId = /^\/projects\/([\w-]+)/.exec(to)?.[1] ?? null;
  if (projectId) newTab(projectId);
}

/** The tabs open when the window opens: those left last time, else the last project's; none: the projects. */
async function openTabs() {
  const projects = (await studioApi('/api/projects').catch(() => ({ projects: [] }))).projects.filter((p) => !p.missing);
  tabs = createTabs({ saved: state.tabs?.tabs?.length ? state.tabs : null });
  /* a tab of a project no longer there is left out */
  const known = new Set(projects.map((p) => p.id));
  for (const t of tabs.list()) if (!known.has(t.projectId)) tabs.close(t.id);
  if (!tabs.list().length && !state.tabs?.tabs?.length && projects[0]) tabs.open({ projectId: projects[0].id, title: projects[0].name });
  const front = tabs.activeId();
  if (front) showTab(front);
  else { showPage(HOME); tellTabs(); }
  /* Upload analysis is queued when media is imported. Do not rescan every project at startup: opening the
     window should restore tabs, not start ffmpeg work for unrelated projects. Existing cached indexes remain
     available to the agent and Studio, and a changed upload is analyzed on the next import. */
}

/** The projects the chat's agents work in, and wait for an answer in, by Studio's ids (from their folders), on each tab. */
let projectPaths = new Map();
const agentFolders = { working: /** @type {string[]} */ ([]), asking: /** @type {string[]} */ ([]) };
async function tellTabsWorking({ working = agentFolders.working, asking = agentFolders.asking } = {}) {
  Object.assign(agentFolders, { working, asking });
  if (!tabs) return;
  if ([...working, ...asking].some((f) => !projectPaths.has(f))) {
    projectPaths = new Map((await studioApi('/api/projects').catch(() => ({ projects: [] }))).projects.map((p) => [p.path, p.id]));
  }
  const ids = (folders) => folders.map((f) => projectPaths.get(f)).filter(Boolean);
  if (tabs.setAgents(ids(agentFolders.working), ids(agentFolders.asking))) tellTabs();
}

async function studioApi(path, method = 'GET', body = undefined) {
  const res = await fetch(`${studio.origin}${path}`, {
    method,
    headers: { 'x-studio-key': studio.key, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Studio answered ${res.status}`);
  return res.json();
}

/**
 * A folder picked by the person (null: cancelled): with no options, one to open as a project (any folder: one not yet
 * a project becomes one); with Studio's own words and starting folder, any other (see folder-dialog.mjs).
 */
async function pickFolder(options) {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, folderDialogOptions(options));
  return canceled || !filePaths[0] ? null : filePaths[0];
}

/** File › Open Project…: the folder picked, shown in the window (Studio switches its pages to it). */
async function openProjectFolder() {
  const folder = await pickFolder();
  if (!folder || !studio) return;
  try {
    await studioApi('/api/open', 'POST', { path: folder, fallback: 0 });
    focusWindow();
  } catch (error) {
    void dialog.showMessageBox(win, { type: 'warning', message: 'This folder can’t be opened as a project.', detail: error.message });
  }
}

/** The page's theme (Studio's), for the window behind it and the system's menus and dialogs. */
function setTheme(next) {
  theme = next === 'dark' ? 'dark' : 'light';
  nativeTheme.themeSource = theme;
  win?.setBackgroundColor(BACKGROUND[theme]);
  for (const v of views.values()) v.setBackgroundColor(BACKGROUND[theme]);
  if (windows) win?.setTitleBarOverlay?.(overlayColours(theme));
}

/** Tell Studio which folders the chat's agents are working in now. */
function tellWorking(/** @type {string[]} */ folders) {
  studio?.child.postMessage({ type: 'working', folders });
  void tellTabsWorking({ working: folders });
}

async function runStudio(env) {
  studio = await startWindowStudio({
    home: env.OPENFILM_HOME,
    port: IDENTITY.studioPort,
    /* Studio serves the window's page as its editor (shell/: its editor with the chat beside it) */
    env: { ...env, OPENFILM_EDITOR_DIR: here('../shell/dist/'),
      ...(process.env.OPENFILM_SKIP_BROWSER_DOWNLOAD === '1' ? { OPENFILM_SKIP_BROWSER_DOWNLOAD: '1' } : {}) },
    log,
    onOpen: (url) => {
      /* Studio would open a browser for an address of its own: the window already shows Studio */
      if (studio && url.startsWith(studio.origin)) focusWindow();
      else if (/^https?:/i.test(url)) void shell.openExternal(url);
    },
    onBrowser: (message) => {
      if (message.type === 'ffmpeg') { if (!ffmpegFetching) tellFfmpeg(message.found); }
      else broadcast('desktop:studio-browser', message);
    },
    onExit: (code) => {
      if (quitting) return;
      log(`Studio stopped (${code}); starting it again\n`);
      setTimeout(() => void runStudio(env).catch((error) => log(`Studio did not start again: ${error.message}\n`)), 1000);
    },
  });
  /* a Studio started again hears where the agents are working */
  tellWorking(localAgents?.working() ?? []);
  /* the first time, the tabs; a Studio started again: each page stays where it was */
  if (!tabs) { await openTabs(); return; }
  for (const [id, v] of views) {
    const at = v.webContents.getURL();
    await v.webContents.loadURL(pageAddress(tabs.get(id), at.startsWith('http') ? new URL(at).pathname : null));
  }
}

async function start() {
  const shellEnv = await loginShellEnvironment();
  const env = childEnvironment({
    shell: shellEnv,
    extra: {
      OPENFILM_HOME: IDENTITY.studioHome ?? process.env.OPENFILM_HOME ?? join(app.getPath('home'), '.openfilm'),
      ...((IDENTITY.library ?? process.env.OPENFILM_LIBRARY) ? { OPENFILM_LIBRARY: IDENTITY.library ?? process.env.OPENFILM_LIBRARY } : {}),
      /* the app names Studio's home, which would put exports inside it (Studio's rule for a home kept apart): the
         Desktop, where `openfilm` puts them, unless this is a flavour with a home of its own */
      ...(IDENTITY.studioHome || process.env.OPENFILM_EXPORTS ? {} : { OPENFILM_EXPORTS: app.getPath('desktop') }),
      /* another examples index (a file, to try one), passed through when run from source */
      ...(process.env.OPENFILM_EXAMPLES_INDEX ? { OPENFILM_EXAMPLES_INDEX: process.env.OPENFILM_EXAMPLES_INDEX } : {}),
    },
  });


  /* what the installer brings (scripts/release.mjs): ffmpeg and ffprobe, first on the PATH of Studio and of the
     agents' `openfilm` command, and the headless browser Studio and `openfilm` draw pages in. A build without them
     (from source): no ffmpeg on this computer, the app's own goes first on the PATH and is downloaded once the window
     is up (they find it the moment it lands); the browser, Studio downloads the first time (studio-process.mjs) */
  const runtime = app.isPackaged ? join(process.resourcesPath, 'runtime') : here('../.dev/runtime');
  if (app.isPackaged && process.platform === 'win32') configureBundledCodex({ runtimeDir: runtime, dataDir: DATA });
  const ownFfmpeg = runtime && ffmpegIn(join(runtime, 'ffmpeg')) ? join(runtime, 'ffmpeg') : null;
  const needFfmpeg = !ownFfmpeg && !ffmpegOnPath(env.PATH) && ffmpegDownloadable();
  const ffmpegHere = ownFfmpeg ?? (needFfmpeg ? ffmpegDir(DATA) : null);
  appFfmpegDir = ffmpegHere;
  if (ffmpegHere) env.PATH = [ffmpegHere, env.PATH].join(PATH_SEP);
  const browserCache = process.platform === 'win32' ? join(app.getPath('home'), 'AppData', 'Local', 'ms-playwright')
    : process.platform === 'darwin' ? join(app.getPath('home'), 'Library', 'Caches', 'ms-playwright') : join(app.getPath('home'), '.cache', 'ms-playwright');
  const browsers = { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH
    || (runtime && existsSync(join(runtime, 'ms-playwright')) ? join(runtime, 'ms-playwright') : browserCache) };
  if (process.env.OPENFILM_BROWSER_CDP_URL) browsers.OPENFILM_BROWSER_CDP_URL = process.env.OPENFILM_BROWSER_CDP_URL;
  Object.assign(env, browsers);

  const display = screen.getPrimaryDisplay().workArea;
  const width = Math.min(1480, display.width);
  const height = Math.min(920, display.height);
  const fallback = { x: display.x + Math.round((display.width - width) / 2), y: display.y + Math.round((display.height - height) / 2), width, height };
  const bounds = placeOnDisplays(state.bounds, screen.getAllDisplays(), fallback);

  win = new BaseWindow({
    ...bounds,
    minWidth: WINDOW_MIN.width,
    minHeight: WINDOW_MIN.height,
    show: false,
    title: PRODUCT_NAME,
    backgroundColor: BACKGROUND[theme],
    ...(mac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 10 } } : {}),
    /* Windows: no title bar either; its own buttons drawn over Studio's top bar, at its right, in its colors */
    ...(windows ? { titleBarStyle: 'hidden', titleBarOverlay: overlayColours(theme), autoHideMenuBar: true, icon: here('../build/icon.png') } : {}),
  });
  if (state.maximized) win.maximize();

  /* The window's resize event can precede its content layout (notably on Wayland).
     Size pages after the content view actually changes, including maximize and full screen. */
  win.contentView.on('bounds-changed', layout);
  win.on('resized', saveState);
  win.on('moved', saveState);
  win.on('enter-full-screen', () => broadcast('desktop:full-screen', true));
  win.on('leave-full-screen', () => broadcast('desktop:full-screen', false));
  win.on('close', saveState);
  win.on('closed', () => { win = null; views.clear(); app.quit(); });

  ipcMain.on('desktop:theme', (event, next) => { if (fromPage(event)) setTheme(next); });
  ipc.handle('desktop:hello', (event) => {
    if (!fromPage(event)) throw new Error('not the window\'s page');
    return { flavor: FLAVOR, version: app.getVersion(), ffmpeg: ffmpegFound, update: updates?.snapshot() ?? null, editorLayout: state.editorLayout, chatOpen: state.chatOpen, chatWidth: state.chatWidth, chatMin: CHAT_MIN, studioMin: STUDIO_MIN, fullScreen: Boolean(win?.isFullScreen()), sub2api: publicSub2ApiConfig(DATA, sub2apiStorage()) };
  });
  ipc.handle('desktop:clipboard-text', (event) => fromPage(event) ? clipboard.readText() : '');
  ipc.handle('desktop:sub2api:status', event => fromPage(event) ? authorizationStatus() : { authorized: false });
  ipc.handle('desktop:sub2api:get', event => fromPage(event) ? publicSub2ApiConfig(DATA, sub2apiStorage()) : null);
  ipc.handle('desktop:sub2api:set', async (event, input) => {
    if (!fromPage(event)) throw new Error('not the window\'s page');
    const result = await authorization.activate(() => activateGateway(DATA, { ...gatewayEndpoint(), activationCode: String(input?.activationCode ?? '') }, sub2apiStorage()));
    localAgents?.closeAll();
    void roster?.refresh();
    return result;
  });
  ipc.handle('desktop:sub2api:test', event => fromPage(event) ? checkSub2ApiConfig(DATA, fetch, sub2apiStorage()) : null);
  /* the chat's column as the person left it (the page sizes it; the window keeps it for next time) */
  ipcMain.on('desktop:editor-layout', (event, next) => {
    if (!fromPage(event)) return;
    state = { ...state, editorLayout: { ...state.editorLayout, ...editorLayout(next) } };
    saveState();
  });
  ipcMain.on('desktop:layout', (event, next) => {
    if (!fromPage(event) || !next || typeof next !== 'object') return;
    const width = Number(next.chatWidth);
    state = { ...state, chatOpen: next.chatOpen === true, ...(Number.isFinite(width) ? { chatWidth: Math.max(CHAT_MIN, Math.round(width)) } : {}) };
    saveState();
  });
  /* the chat's record of each project (in the project's .film/chat and .film/logs) and the app's own preferences */
  registerChatIpc(ipc, {
    trusted: fromPage,
    projects: async () => (await studioApi('/api/projects')).projects.filter((p) => !p.missing).map((p) => p.path),
    dataDir: DATA,
    reveal: (path) => shell.showItemInFolder(path),
    tell: (channel, value) => broadcast(channel, value),
    log,
  });
  /* the tabs, drawn by each page in Studio's top bar: asked for, and told of every change (tellTabs) */
  const tabHandle = (channel, fn) => ipc.handle(channel, (event, opts) => {
    if (!fromPage(event)) throw new Error('not the window\'s page');
    return fn(tabOf(event.sender), opts ?? {});
  });
  tabHandle('desktop:tabs:list', (self) => ({ self, tabs: tabs?.list() ?? [] }));
  tabHandle('desktop:tabs:new', (_self, { projectId }) => { newTab(projectId); return { ok: true }; });
  tabHandle('desktop:tabs:show', (_self, { id }) => { showTab(String(id)); return { ok: true }; });
  tabHandle('desktop:tabs:close', (self, { id }) => { void closeTab(typeof id === 'string' ? id : self); return { ok: true }; });
  tabHandle('desktop:tabs:move', (_self, { id, index }) => { if (tabs?.move(String(id), Number(index))) tellTabs(); return { ok: true }; });
  /* what a page shows now: its project's title, an export's progress; or its project gone */
  tabHandle('desktop:tabs:report', (self, { title, exporting, gone }) => {
    if (!tabs) return { ok: false };
    /* its project deleted (in this page or another): its tab closes */
    if (gone === true) { void closeTab(self); return { ok: true }; }
    tabs.report(self, { ...(typeof title === 'string' ? { title: title.slice(0, 200) } : {}), ...(exporting !== undefined ? { exporting: typeof exporting === 'number' ? exporting : null } : {}) });
    tellTabs();
    return { ok: true };
  });
  /* Studio's "open this project", heard by each page: settled once here */
  tabHandle('desktop:tabs:open', (_self, { to }) => { openInTabs(to); return { ok: true }; });
  /* a tab left behind long enough lets its page go; it comes back when shown */
  setInterval(() => { for (const id of tabs?.idle(IDLE_PAGE_MS) ?? []) dropView(id); }, 60_000).unref?.();

  /* the agents: Studio's home and library go with them, so the `openfilm` they run finds this window's Studio */
  /* the person's own skills: Skills/ beside this app's projects (~/Movies/OpenFilm/Skills), as its `openfilm` finds them */
  const mySkills = process.env.OPENFILM_SKILLS || (env.OPENFILM_LIBRARY ? join(dirname(env.OPENFILM_LIBRARY), 'Skills') : (await import('openfilm/skills')).mySkillsDir());
  localAgents = registerLocalAgentIpc(ipc, {
    trusted: fromPage,
    log,
    /* Studio refuses to delete a project an agent is working in */
    onWorking: tellWorking,
    /* a tab says when its agent waits for the person's answer */
    onAsking: (folders) => void tellTabsWorking({ asking: folders }),
    /* the `openfilm` command first (with the app's ffmpeg and browser in it); the app's ffmpeg last, for a computer
       that has none of its own: the person's own ffmpeg and browsers are what the agent's commands use */
    binDir: installOpenfilmCommand(DATA, { ffmpeg: ffmpegHere, env: browsers }),
    fallbackDir: ffmpegHere,
    env: { OPENFILM_HOME: env.OPENFILM_HOME, ...(env.OPENFILM_LIBRARY ? { OPENFILM_LIBRARY: env.OPENFILM_LIBRARY } : {}) },
    /* each session's skills: its maker's, OpenFilm's, and of the person's own those let in (agent-skills.mjs) */
    skills: { dataDir: DATA, mine: mySkills },
    videoSecurity: {
      dataDir: DATA,
      storage: sub2apiStorage(),
      protectedRoots: [app.getAppPath(), DATA, ...(app.isPackaged ? [dirname(process.execPath), process.resourcesPath] : []), join(app.getPath('home'), '.codex'), join(app.getPath('home'), '.ssh'), join(app.getPath('home'), '.aws'), ...(shellEnv.CODEX_HOME ? [shellEnv.CODEX_HOME] : [])],
      projects: async () => (await studioApi('/api/projects')).projects.filter(project => !project.missing).map(project => project.path),
      projectFor: async event => {
        const tab = tabs?.get(tabOf(event.sender));
        return (await studioApi('/api/projects')).projects.find(project => project.id === tab?.projectId && !project.missing)?.path;
      },

    },
  });
  registerEditTemplateIpc(ipc, {
    trusted: fromPage,
    hosted: () => gatewayConfig(DATA, sub2apiStorage()),
    projects: async () => (await studioApi('/api/projects')).projects.filter(project => !project.missing).map(project => project.path),
  });
  /* the composer's Skills button */
  registerSkillsIpc(ipc, {
    trusted: fromPage,
    projects: async () => (await studioApi('/api/projects')).projects.filter((project) => !project.missing).map((project) => project.path),
    mine: mySkills,
  });
  /* Settings → Agents (in Studio's page) and the chat's agent menu: one roster, both told of every change */
  roster = createRoster({
    dataDir: DATA,
    providerConfigured: () => publicSub2ApiConfig(DATA, sub2apiStorage()).configured,
    localAgents: () => listAgents(CLIENT_AGENTS),
    openSignIn: openAgentSignIn,
    /* sessions closed on connecting and disconnecting: the next look at its usage is for whichever account is used now */
    closeSessions: (id) => { forgetAgentUsage(id); localAgents?.closeAgent(id); },
    onChange: (list) => broadcast('desktop:agents', list),
    /* the program the person points at, for an agent not found where it is looked for */
    usePaths: setChosenPaths,
    pickProgram: async (_id, words) => {
      const { canceled, filePaths } = await dialog.showOpenDialog(win, programDialogOptions(words));
      return canceled || !filePaths[0] ? null : filePaths[0];
    },
    checkProgram: checkAgentProgram,
    diagnose: (id) => diagnoseAgent(id, { appVersion: app.getVersion() }),
  });
  const agentHandle = (channel, fn) => ipc.handle(channel, (event, opts) => {
    if (!fromPage(event)) throw new Error('not the window\'s page');
    return fn(opts ?? {});
  });
  agentHandle('desktop:agents:list', () => { void roster.refresh(); return roster.list(); });
  agentHandle('desktop:agents:connect', ({ id }) => roster.connect(String(id)));
  agentHandle('desktop:agents:disconnect', ({ id }) => { roster.disconnect(String(id)); return { ok: true }; });
  /* what is left of Claude Code's and Codex's plan, on OpenFilm's sign-in (agent-usage.mjs); null when it can't say */
  agentHandle('desktop:agents:usage', ({ id, fresh }) => agentUsage(String(id), { fresh: fresh === true }));
  agentHandle('desktop:agents:locate', ({ id, words }) => roster.locate(String(id), words));
  agentHandle('desktop:agents:automatic', ({ id }) => roster.useAutomatic(String(id)));
  agentHandle('desktop:agents:diagnose', ({ id }) => roster.diagnose(String(id)));
  /* a file on the disk brought into the chat goes into the project the page names, through Studio's own import (it
     shows in Studio's media at once, and the import is in the project's history); one without a path the page sends
     itself */
  ipc.handle('desktop:import-file', async (event, request) => {
    if (!fromPage(event) || !studio) return { ok: false, error: 'Studio is not running.' };
    const projectId = String(request?.projectId ?? '');
    if (!/^[\w-]+$/.test(projectId)) return { ok: false, error: 'No project is open.' };
    const name = basename(String(request?.name ?? '')).replace(/[\u0000-\u001f/\\]+/g, '').slice(0, 200) || 'file';
    const path = typeof request?.path === 'string' ? request.path : '';
    try { if (!path || !statSync(path).isFile()) return { ok: false, error: 'That is not a file.' }; } catch { return { ok: false, error: 'That file is not there any more.' }; }
    try {
      const res = await fetch(`${studio.origin}/api/projects/${encodeURIComponent(projectId)}/files?path=${encodeURIComponent(`assets/upload/${name}`)}`, {
        method: 'PUT', headers: { 'x-studio-key': studio.key }, body: Readable.toWeb(createReadStream(path)), duplex: 'half',
      });
      const answer = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: answer.error ?? `Studio answered ${res.status}` };
      /* Prepare upload-only metadata and frames in the background. Import stays responsive; video chat can reuse the
         finished cache instead of blocking its first request on ffmpeg. */
      void studioApi('/api/projects').then(({ projects }) => {
        const project = projects.find(item => item.id === projectId && !item.missing);
        return project ? precomputeUploadFrames({ root: project.path, ffmpegDir: ffmpegHere }) : null;
      }).catch(error => log(`upload analysis failed: ${error?.message ?? error}\n`));
      return { ok: true, path: answer.path };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  ipc.handle('desktop:reveal', (event, path) => { if (fromPage(event) && typeof path === 'string' && path) shell.showItemInFolder(path); });
  ipc.handle('desktop:pick-folder', (event, options) => (fromPage(event) ? pickFolder(options) : null));
  /* a picture of part of the window (the viewer, for a reference in the chat): what the person sees, as JPEG */
  ipc.handle('desktop:capture', async (event, rect) => {
    if (!fromPage(event) || !rect || typeof rect !== 'object') return null;
    const box = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
    if (!Object.values(box).every((n) => Number.isFinite(n)) || box.width < 2 || box.height < 2 || box.width > 8000 || box.height > 8000) return null;
    const image = await event.sender.capturePage(box).catch(() => null);
    return image && !image.isEmpty() ? image.toJPEG(88).toString('base64') : null;
  });

  /* updates (updates.mjs): Restart waits while an agent's turn runs or Studio exports, either would be lost */
  updates = startUpdates({
    dataDir: DATA,
    productName: PRODUCT_NAME,
    getWindow: () => win,
    onState: (next) => broadcast('desktop:update', next),
    prepareRestart: async () => {
      if (localAgents?.isBusy()) return { ok: false, error: 'agent-busy' };
      /* Studio's quit-when-idle answers 409 while it exports; otherwise the window's Studio stays (studio-process.mjs
         `stays`, 423), and is stopped in beforeInstall. No answer: no Studio, no export to lose. */
      const res = studio && await fetch(`${studio.origin}/api/quit`, {
        method: 'POST', headers: { 'x-studio-key': studio.key, 'content-type': 'application/json' },
        body: JSON.stringify({ whenIdle: true }), signal: AbortSignal.timeout(3000),
      }).catch(() => null);
      return res?.status === 409 ? { ok: false, error: 'exporting' } : { ok: true };
    },
    /* what before-quit would do, done first (`quitting`), so the quit Squirrel starts is not held up or cancelled */
    beforeInstall: async () => {
      quitting = true;
      localAgents?.closeAll();
      for (const v of views.values()) v.webContents.on('will-prevent-unload', (event) => event.preventDefault());
      await studio?.quit();
      updates?.close();
    },
  });
  ipc.handle('desktop:update-restart', (event) => (fromPage(event) ? updates?.restart() : { ok: false }));
  /* Settings → About: the state now, and a check that answers with the state it ends in (no dialog) */
  ipc.handle('desktop:update-state', (event) => (fromPage(event) ? updates?.snapshot() ?? null : null));
  ipc.handle('desktop:update-check', (event) => (fromPage(event) ? updates?.check() ?? null : null));

  fullMenu = applicationMenu({
    productName: PRODUCT_NAME,
    packaged: app.isPackaged,
    toggleChat: () => activeView()?.webContents.send('desktop:toggle-chat'),
    openProject: () => void openProjectFolder(),
    reload: () => activeView()?.webContents.reload(),
    devTools: () => activeView()?.webContents.toggleDevTools(),
    tabs: {
      /* the projects window, in the page in front, to pick the project a new tab shows */
      open: () => activeView()?.webContents.send('desktop:tabs:pick') ?? views.get(HOME)?.webContents.focus(),
      close: () => { if (tabs?.activeId()) void closeTab(tabs.activeId()); },
      reopen: () => { const tab = tabs?.reopen(); if (tab) showTab(tab.id); },
      step: (by) => {
        const list = tabs?.list() ?? [];
        const i = list.findIndex((t) => t.active);
        if (list.length > 1) showTab(list[(i + by + list.length) % list.length].id);
      },
      pick: (n) => { const list = tabs?.list() ?? []; const tab = n === 9 ? list.at(-1) : list[n - 1]; if (tab) showTab(tab.id); },
    },
    updates: updates.packaged ? {
      check: () => updates.manualCheck(),
      beta: updates.channel() === 'beta',
      setBeta: (on) => updates.setChannel(on ? 'beta' : 'stable'),
    } : null,
  });
  Menu.setApplicationMenu(authorization.get() ? fullMenu : lockedMenu());

  win.show();
  if (needFfmpeg) {
    ffmpegFetching = true;
    let shownAt = 0;
    tellFfmpeg({ state: 'downloading', progress: 0 });
    void ensureFfmpeg(DATA, {
      onProgress: (progress) => { if (Date.now() - shownAt > 500) { shownAt = Date.now(); tellFfmpeg({ state: 'downloading', progress }); } },
    }).then(() => tellFfmpeg(true), (error) => { log(`ffmpeg did not download: ${error.message}\n`); tellFfmpeg({ state: 'failed', message: error.message }); })
      .finally(() => { ffmpegFetching = false; });
  }
  try {
    await runStudio(env);
  } catch (error) {
    log(`Studio did not start: ${error.stack ?? error}\n`);
    const v = makeView('failed');
    void v.webContents.loadFile(here('./failed.html'), { query: { message: String(error.message ?? error) } });
  }
}

/* a terminal's Ctrl-C, or the launcher passing one on: quit the way the menu does, so Studio writes its history */
process.on('SIGINT', () => app.quit());
process.on('SIGTERM', () => app.quit());
app.on('activate', () => focusWindow());
app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event) => {
  localAgents?.closeAll();
  if (quitting || !studio) return;
  event.preventDefault();
  quitting = true;
  void studio.quit().finally(() => app.quit());
});
