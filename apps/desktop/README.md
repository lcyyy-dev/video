# OpenFilm for desktop

Studio, with a chat beside it for Claude Code, Codex and the other agents, as an Electron app.

## Run from source

```sh
npm start            # builds the window's page, then runs the app as "OpenFilm Dev"
npm test
npm run typecheck
```

Run from source, the app is its own "OpenFilm Dev": its own name, data folder, Studio home and port, so it never
shares anything with an installed OpenFilm. Its renamed copy of Electron lives in `.dev/` (git-ignored).

Codex, Claude Code, the other agents, your own key, and Studio with your own media keys all work.

On Linux, the launcher keeps the desktop session's display and audio variables. Optional development libraries in
`.dev/linux-libs/usr/lib/x86_64-linux-gnu/` and ffmpeg in `.dev/runtime/ffmpeg/` are reused when present.
To use an already running Chromium browser, set `OPENFILM_BROWSER_CDP_URL` to its local CDP address. Set
`OPENFILM_SKIP_BROWSER_DOWNLOAD=1` to report a missing browser instead of downloading one. These two settings can
also be stored as strings in `.dev/runtime/browser.json` (git-ignored); explicit environment values take precedence.
The external browser must enable the rendering features the film needs; its executable is not installed by OpenFilm.

## Builds

`npm run release` builds the app into `.release/` (git-ignored). Without `OPENFILM_SIGN_IDENTITY` and `APPLE_TEAM_ID`
it is unsigned. Like a run from source, it never looks for updates: the feed comes from the `openfilm` package's
`product.json`, empty in the repository. Official builds, signed, notarized and
published, are produced by the project's release pipeline; see TRADEMARK.md before distributing a build of your own.
