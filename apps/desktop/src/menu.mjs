/** The menu bar. Studio's own shortcuts live in its page; these are the window's, its tabs' among them. */
import { Menu } from 'electron';

const mac = process.platform === 'darwin';

/**
 * `updates`: the packaged app's (updates.mjs), for "Check for Updates…" (the app menu on macOS, Help on Windows) and
 * "Beta Updates" (builds before they go to everyone); null from source, which has none.
 * `tabs`: a new tab (its launcher), the one in front closed, the one closed last opened again, the next or previous,
 * the nth (9: the last).
 * @param {{ productName: string, packaged: boolean, toggleChat: () => void, openProject: () => void, reload: () => void,
 *           devTools: () => void,
 *           tabs: { open: () => void, close: () => void, reopen: () => void, step: (by: number) => void, pick: (n: number) => void },
 *           updates?: { check: () => Promise<void>, beta: boolean, setBeta: (on: boolean) => void } | null }} actions
 */
export function applicationMenu({ productName, packaged, toggleChat, openProject, reload, devTools, tabs, updates = null }) {
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const updateItems = updates ? [
    {
      label: '检查更新…',
      /* off while its dialog is up, so a second click does not queue another */
      click: async (item) => {
        item.enabled = false;
        try { await updates.check(); } finally { item.enabled = true; }
      },
    },
    { label: '接收测试版更新', type: 'checkbox', checked: updates.beta, click: (item) => updates.setBeta(item.checked) },
  ] : [];
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const template = [
    ...(mac ? [{
      label: productName,
      submenu: [
        { label: `关于 ${productName}`, role: 'about' },
        ...updateItems,
        { type: 'separator' },
        { label: '服务', role: 'services' },
        { type: 'separator' },
        { label: `隐藏 ${productName}`, role: 'hide' },
        { label: '隐藏其他应用', role: 'hideOthers' },
        { label: '显示全部', role: 'unhide' },
        { type: 'separator' },
        { label: `退出 ${productName}`, role: 'quit' },
      ],
    }] : []),
    {
      label: '文件',
      submenu: [
        { label: '新建标签页', accelerator: 'CmdOrCtrl+T', click: () => tabs.open() },
        { label: '打开项目…', accelerator: 'CmdOrCtrl+O', click: openProject },
        { type: 'separator' },
        { label: '关闭标签页', accelerator: 'CmdOrCtrl+W', click: () => tabs.close() },
        { label: '重新打开已关闭的标签页', accelerator: 'CmdOrCtrl+Shift+T', click: () => tabs.reopen() },
      ],
    },
    { label: '编辑', submenu: [
      { label: '撤销', role: 'undo' },
      { label: '重做', role: 'redo' },
      { type: 'separator' },
      { label: '剪切', role: 'cut' },
      { label: '复制', role: 'copy' },
      { label: '粘贴', role: 'paste' },
      { label: '粘贴并匹配样式', role: 'pasteAndMatchStyle' },
      { label: '删除', role: 'delete' },
      { type: 'separator' },
      { label: '全选', role: 'selectAll' },
    ] },
    {
      label: '视图',
      submenu: [
        { label: '显示或隐藏对话', type: 'normal', accelerator: 'CmdOrCtrl+Shift+L', click: toggleChat },
        { type: 'separator' },
        { label: '实际大小', role: 'resetZoom' },
        { label: '放大', role: 'zoomIn' },
        { label: '缩小', role: 'zoomOut' },
        { type: 'separator' },
        { label: '切换全屏', role: 'togglefullscreen' },
        ...(packaged ? [] : [
          { type: 'separator' },
          { label: '重新加载', accelerator: 'CmdOrCtrl+Shift+R', click: reload },
          { label: '开发者工具', accelerator: 'Alt+CmdOrCtrl+I', click: () => devTools() },
        ]),
      ],
    },
    {
      label: '窗口',
      submenu: [
        { label: '最小化', role: 'minimize' },
        { label: '缩放窗口', role: 'zoom' },
        { type: 'separator' },
        { label: '下一个标签页', accelerator: 'Control+Tab', click: () => tabs.step(1) },
        { label: '上一个标签页', accelerator: 'Control+Shift+Tab', click: () => tabs.step(-1) },
        /* ⌘1–⌘9, as in a browser: each a tab, 9 the last */
        ...Array.from({ length: 9 }, (_, i) => ({ label: `标签页 ${i + 1}`, accelerator: `CmdOrCtrl+${i + 1}`, visible: false, acceleratorWorksWhenHidden: true, click: () => tabs.pick(i + 1) })),
        ...(mac ? [{ type: 'separator' }, { label: '全部置于前台', role: 'front' }] : []),
      ],
    },
    ...(!mac && updateItems.length ? [{ label: '帮助', role: 'help', submenu: updateItems }] : []),
  ];
  return Menu.buildFromTemplate(template);
}
