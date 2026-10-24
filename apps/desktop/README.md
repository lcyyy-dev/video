# OpenFilm for desktop

An advertising-editing desktop client: Studio with local Codex chat, footage import, timeline editing, text styles, video export and editable Jianying/CapCut drafts.

Templates are saved by the native process to each project's `.film/edit-template.json`. The advertising template is fixed to `ad-editing`; prompt and steering requests always load it before reaching Codex. Unimplemented template types are disabled. See [the workflow](../../docs/CLIENT_EDIT_WORKFLOW.zh-CN.md).

There is no standalone browser UI. Studio's UI sources, local HTTP API and headless Chromium are internal parts of the desktop editor and renderer.

## Run from source

```sh
npm start            # builds the window's page, then runs the app as "OpenFilm Dev"
npm test
npm run typecheck
```

Run from source, the app is its own "OpenFilm Dev": its own name, data folder, Studio home and port, so it never
shares anything with an installed OpenFilm. Its renamed copy of Electron lives in `.dev/` (git-ignored).

Windows installers include a pinned Codex executable and its complete native runtime. Sign in in Settings → Codex;
no separate Codex installation is needed. Windows uses an app-private Codex home and receives Codex updates through
app releases. Source runs and macOS builds still use a separately installed Codex. This client carries only the `ad-editing` workflow. It does not include other agent
runtimes, a skill marketplace, remote project galleries, or cloud media-provider configuration. For narration,
use supplied recordings or explicitly requested local simulated audio; cloud TTS is deferred.

Exports are limited to video, Jianying/CapCut drafts, and project archives/folders. The underlying film format,
renderer and media utilities remain shared with the CLI. See [the scope record](../../docs/CLIENT_SIMPLIFICATION.zh-CN.md).

Desktop network proxy settings (HTTP/HTTPS/ALL/NO_PROXY, including lowercase variants) are preserved for Studio and Codex; explicit login-shell proxy settings take precedence.

On Linux, the launcher keeps the desktop session's display and audio variables. WSLg source runs default to the native Wayland backend; pass `--ozone-platform=x11` to the launcher to override it. Optional development libraries in
`.dev/linux-libs/usr/lib/x86_64-linux-gnu/` and ffmpeg in `.dev/runtime/ffmpeg/` are reused when present.
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
