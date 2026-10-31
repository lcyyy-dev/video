# OpenFilm for desktop

An editing desktop client: Studio with one video-editing chat, footage import, timeline editing, text styles, video export and editable Jianying/CapCut drafts.

Templates are saved by the native process to each project's `.film/edit-template.json`. The selected template routes to its matching bundled workflow before reaching Codex. See [the workflow](../../docs/CLIENT_EDIT_WORKFLOW.zh-CN.md).

There is no standalone browser UI. Studio's UI sources, local HTTP API and headless Chromium are internal parts of the desktop editor and renderer.

## Run from source

```sh
npm start            # builds the window's page, then runs the app as "OpenFilm Dev"
npm test
npm run typecheck
```

Run from source, the app is its own "OpenFilm Dev": its own name, data folder, Studio home and port, so it never
shares anything with an installed OpenFilm. Its renamed copy of Electron lives in `.dev/` (git-ignored).

Windows installers include a pinned Codex executable and its complete native runtime. For video planning, configure a
Sub2API domain and user key as described in [the hosted Codex guide](../../docs/SUB2API_HOSTED_CODEX.zh-CN.md);
the video planner does not inherit the user's ChatGPT credentials. Windows uses an app-private Codex home and receives Codex updates through
app releases. Source runs and macOS builds still use a separately installed Codex. This client carries four fixed video workflows: `ad-editing`, `talk-editing`, `copy-rewrite` and `live-clips`. It does not include other agent
runtimes, a skill marketplace, remote project galleries, or cloud media-provider configuration. For narration,
use original video audio only; TTS is not connected and narration generation is deferred.

Exports are limited to video, Jianying/CapCut drafts, and project archives/folders. The underlying film format,
renderer and media utilities remain shared with the CLI. See [the scope record](../../docs/CLIENT_SIMPLIFICATION.zh-CN.md).

Desktop network proxy settings (HTTP/HTTPS/ALL/NO_PROXY, including lowercase variants) are preserved for Studio and Codex; explicit login-shell proxy settings take precedence.

On Linux, the launcher keeps the desktop session's display and audio variables. WSLg source runs default to the native Wayland backend; pass `--ozone-platform=x11` to the launcher to override it. Optional development libraries in
`.dev/linux-libs/usr/lib/x86_64-linux-gnu/` and ffmpeg in `.dev/runtime/ffmpeg/` are reused when present.

WSLg does not forward the Windows taskbar IME (for example, Microsoft Pinyin) to Linux GUI applications. In that
environment OpenFilm can receive Latin key presses and pasted Chinese text, but it cannot receive an IME composition.
This is a WSLg limitation, so changing the React editor or switching Electron between X11 and Wayland does not fix it.
Use a Windows-native OpenFilm build when Windows IME input is required, or install and run a Linux IME inside WSL
(Fcitx5/IBus) and configure it for the WSLg session.
To use an already running Chromium browser, set `OPENFILM_BROWSER_CDP_URL` to its local CDP address. Set
`OPENFILM_SKIP_BROWSER_DOWNLOAD=1` to report a missing browser instead of downloading one. These two settings can
also be stored as strings in `.dev/runtime/browser.json` (git-ignored); explicit environment values take precedence.
The external browser must enable the rendering features the film needs; its executable is not installed by OpenFilm.

## Builds

For the Windows x64 installer, run `pnpm release:win` from the repository root. See
[Windows 构建流程](../../docs/WINDOWS_INSTALLER.zh-CN.md) for prerequisites, output files, verification, CI and Codex version upgrades.

`npm run release` builds the app into `.release/` (git-ignored). Without `OPENFILM_SIGN_IDENTITY` and `APPLE_TEAM_ID`
it is unsigned. Like a run from source, it never looks for updates: the feed comes from the `openfilm` package's
`product.json`, empty in the repository. Official builds, signed, notarized and
published, are produced by the project's release pipeline; see TRADEMARK.md before distributing a build of your own.
