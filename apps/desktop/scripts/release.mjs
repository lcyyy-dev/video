/**
 * Build the app people install: `pnpm --filter @openfilm/desktop release` (`--arch=x64` for Intel Macs, default this
 * Mac's; `--unsigned` for a local try; `--platform=win --arch=x64|arm64` for the Windows installer, built here too;
 * `--official` for the project's own build; `--preview` for "OpenFilm Preview", an app of its own to try a build in).
 *
 * Which build it is comes from the `openfilm` package's product files: a build of this source uses product.json,
 * empty in the repository (no update feed: the app never looks for updates); `--official` uses product.official.json
 * (the update feed under its `desktop.updates`).
 *
 *   1. the desktop window (shell/: editor and chat) is built; no standalone browser UI is shipped;
 *   2. a stage folder gets the app's own files and a plain npm install of what it needs at run time: the `openfilm`
 *      package as `npm pack` makes it (what npm would publish), the Codex ACP adapter
 *      and the updater. Windows includes a separately checksum-pinned native Codex distribution (codex-build.json),
 *      independent of the builder's OS and the user's global programs. Other optional npm binaries are omitted.
 *      The staged `openfilm` package gets the build's product.json;
 *   2b. the programs the app needs that are not node modules, for the platform and chip built for, in the app's
 *      resources (runtime/; src/main.mjs puts them to use): ffmpeg and ffprobe with their license (src/ffmpeg-runtime.mjs),
 *      and the headless browser Studio and `openfilm` draw pages in (Playwright's, the revision the staged
 *      playwright-core takes). People never download either: on a slow or blocked connection the first start used to
 *      fail there;
 *   3. electron-builder makes the .dmg (to download) and the .zip (for updates), signed with the Developer ID
 *      OPENFILM_SIGN_IDENTITY ("Name (TEAMID)") and notarized (APPLE_TEAM_ID, the `openfilm-notary` keychain profile or
 *      OPENFILM_NOTARY_PROFILE), with the update feed written in (none without one). Without OPENFILM_SIGN_IDENTITY
 *      and APPLE_TEAM_ID the build is unsigned, as with --unsigned.
 *
 *   4. the .dmg is signed and notarized too, so the download itself opens without a warning.
 *
 * Windows: an NSIS installer (OpenFilm-Setup-<version>-<arch>.exe, per user, no admin) and its feed (latest.yml). It is
 * built on this Mac: the program's icon and version are written into OpenFilm.exe with resedit (rcedit would need
 * wine). Not code-signed yet (no Windows certificate): SmartScreen asks once, "More info" → "Run anyway".
 *
 * Output: .release/<arch>/out (git-ignored). Nothing is uploaded: official builds are published by the project's
 * release pipeline.
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { lockedOverrides, versionsOffLock } from './locked-versions.mjs';
import { CODEX_BUILD, stageCodex } from './codex-bundle.mjs';
import { verifyWindowsApp } from './verify-windows.mjs';
import { buildFetch } from './download.mjs';
import { windowsHostTools } from './windows-host-tools.mjs';

const require = createRequire(import.meta.url);
const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/* the `openfilm` package (Studio, the CLI), where node finds it */
const protocol = dirname(require.resolve('openfilm/package.json'));
const asked = process.argv.find((a) => a.startsWith('--arch='))?.slice('--arch='.length);
const arch = asked === 'x64' || asked === 'arm64' ? asked : process.arch === 'arm64' ? 'arm64' : 'x64';
const win = process.argv.includes('--platform=win');
if (win && arch !== 'x64') throw new Error('Windows installers currently support x64 only (Codex, FFmpeg and Chromium).');
const work = join(desktop, '.release', win ? `win-${arch}` : arch);
const stage = join(work, 'app');
const out = join(work, 'out');
/* the Developer ID ("Name (TEAMID)") and its team, from the environment (the release pipeline's secrets) */
const IDENTITY = process.env.OPENFILM_SIGN_IDENTITY?.trim() || '';
const TEAM_ID = process.env.APPLE_TEAM_ID?.trim() || '';
const unsigned = process.argv.includes('--unsigned') || (!win && (!IDENTITY || !TEAM_ID));
if (unsigned && !win && !process.argv.includes('--unsigned')) {
  console.warn('OPENFILM_SIGN_IDENTITY and APPLE_TEAM_ID are not set: building an unsigned app (not notarized). Official builds are signed by the release pipeline.');
}

/* this build's product: its update feed (see the header) */
const official = process.argv.includes('--official');
/* --preview: "OpenFilm Preview", to try a build in apart from an installed OpenFilm: its own name and bundle, data
   folder, Studio home, port and projects (src/flavor.mjs `preview`, from the package's `openfilmFlavor`); no updates */
const preview = process.argv.includes('--preview');
if (preview && official) throw new Error('--preview is never the official build');
const NAME = preview ? 'GainingCut Preview' : 'GainingCut';
const productFile = join(protocol, official ? 'product.official.json' : 'product.json');
const product = JSON.parse(readFileSync(productFile, 'utf8'));
const updates = typeof product.desktop?.updates === 'string' ? product.desktop.updates.trim().replace(/\/+$/, '') : '';
/** Where the packaged app looks for updates (the release's files are uploaded there), or null: it never looks. */
export const FEED = updates ? `${updates}/${win ? 'win' : 'mac'}/${arch}` : null;
const NOTARY_PROFILE = process.env.OPENFILM_NOTARY_PROFILE || 'openfilm-notary';

const commandOptions = (cmd) => ({ shell: process.platform === 'win32' && /^(?:npm|pnpm)$/.test(cmd) });
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...commandOptions(cmd), ...opts });
const pkg = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'));

/* 1. the desktop window; the shared package contains only the engine and local APIs. */
const vite = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
run(process.execPath, [vite, 'build', '--config', 'shell/vite.config.ts', '--logLevel', 'warn'], { cwd: desktop });
/* 2. the stage */
rmSync(work, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(join(desktop, 'src'), join(stage, 'src'), { recursive: true, filter: (from) => !from.endsWith('.test.mjs') });
cpSync(join(desktop, 'shell/dist'), join(stage, 'shell/dist'), { recursive: true });
const pack = (dir) => execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', work, '--silent'], { ...commandOptions('npm'), cwd: dir, encoding: 'utf8' }).trim().split('\n').pop();
/* npm takes the versions pnpm's lockfile has (locked-versions.mjs): what the tests ran with, not the latest */
const lockedTree = JSON.parse(execFileSync('pnpm', ['list', '--prod', '--depth', 'Infinity', '--json'], { ...commandOptions('pnpm'), cwd: desktop, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }))[0];
const dependencies = Object.fromEntries(Object.keys(pkg.dependencies).filter((name) => name !== 'openfilm').map((name) => {
  const version = lockedTree.dependencies?.[name]?.version;
  if (!/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version ?? '')) throw new Error(`No locked runtime version for ${name}. Run pnpm install --frozen-lockfile first.`);
  return [name, version];
}));
dependencies.openfilm = `file:../${pack(protocol)}`;
writeFileSync(join(stage, 'package.json'), `${JSON.stringify({
  name: 'openfilm-desktop',
  productName: NAME,
  ...(preview ? { openfilmFlavor: 'preview' } : {}),
  version: pkg.version,
  description: pkg.description,
  author: 'GainingCut',
  license: 'UNLICENSED',
  private: true,
  packageManager: `npm@${execFileSync('npm', ['--version'], { ...commandOptions('npm'), encoding: 'utf8' }).trim()}`,
  type: 'module',
  main: 'src/main.mjs',
  dependencies,
  overrides: lockedOverrides(lockedTree),
}, null, 2)}\n`);
run('npm', ['install', '--omit=dev', '--omit=optional', '--no-audit', '--no-fund', '--no-package-lock', '--loglevel=error'], { cwd: stage });
const offLock = versionsOffLock(lockedTree, join(stage, 'node_modules'));
if (offLock.length) {
  throw new Error(`The installer's packages are not the lockfile's:\n${offLock.map((p) => `  ${p.name} ${p.version} (locked: ${p.locked.join(', ')})`).join('\n')}`);
}
/* the build's product file */
cpSync(productFile, join(stage, 'node_modules/openfilm/product.json'));

/* 2b. ffmpeg and the headless browser, for the platform and chip built for */
const runtime = join(work, 'runtime');
if (win) stageCodex(runtime, { arch, cacheDir: join(desktop, '.release/cache') });
const { ffmpegDownloadable, fetchFfmpeg } = await import(pathToFileURL(join(desktop, 'src/ffmpeg-runtime.mjs')).href);
const platform = win ? 'win32' : 'darwin';
if (ffmpegDownloadable(platform, arch)) await fetchFfmpeg(join(runtime, 'ffmpeg'), { platform, arch, license: true, fetch: buildFetch, stallMs: 650_000 });
else console.warn(`No ffmpeg build for ${platform}-${arch}: this app downloads none either; people install their own.`);
const browserCache = join(desktop, '.release/cache', `browsers-${platform}-${arch}`);
run(process.execPath, [join(stage, 'node_modules/playwright-core/cli.js'), 'install', 'chromium-headless-shell'], {
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browserCache, PLAYWRIGHT_HOST_PLATFORM_OVERRIDE: win ? 'win64' : arch === 'arm64' ? 'mac15-arm64' : 'mac15' },
});
cpSync(browserCache, join(runtime, 'ms-playwright'), { recursive: true });

/* 3. the app */
const builder = require('electron-builder');
if (win) Object.assign(process.env, await windowsHostTools(join(desktop, '.release/cache')));
const electronVersion = require('electron/package.json').version;
const env = unsigned || win ? { CSC_IDENTITY_AUTO_DISCOVERY: 'false' } : { APPLE_KEYCHAIN_PROFILE: NOTARY_PROFILE, APPLE_TEAM_ID: TEAM_ID };
Object.assign(process.env, env);
await builder.build({
  projectDir: stage,
  publish: 'never',
  ...(win ? { win: ['nsis'] } : { mac: ['dmg', 'zip'] }),
  [arch]: true,
  config: {
    afterPack: win ? async (context) => {
      await windowsResources(context);
      console.log('Windows runtime:', verifyWindowsApp(context.appOutDir, { executable: `${NAME}.exe` }));
    } : undefined,
    /* unsigned on a Mac: signed ad hoc, whole, before the .dmg and .zip are made. Electron's fuses are written into
       its framework after the linker signed it, and an Apple chip kills a program whose pages no longer match its
       signature ("Code Signature Invalid") the moment it starts */
    afterSign: !win && unsigned ? (context) => adHocSign(context) : undefined,
    win: {
      icon: join(desktop, 'build/icon.ico'),
      /* resedit writes the icon and version (afterPack); rcedit would need wine on this Mac */
      signAndEditExecutable: false,
      artifactName: `${NAME.replace(' ', '-')}-Setup-\${arch}.\${ext}`,
    },
    nsis: {
      /* the installer asks where to put the app (the person's own folder by default), so it need not live on C: */
      oneClick: false,
      allowToChangeInstallationDirectory: true,
      perMachine: false,
      installerIcon: join(desktop, 'build/icon.ico'),
      uninstallerIcon: join(desktop, 'build/icon.ico'),
      shortcutName: NAME,
      deleteAppDataOnUninstall: false,
      artifactName: `${NAME.replace(' ', '-')}-Setup-\${arch}.\${ext}`,
    },
    appId: preview ? 'dev.openfilm.desktop.preview' : 'dev.openfilm.desktop',
    productName: NAME,
    copyright: 'Copyright © 2026 GainingCut',
    electronVersion,
    asar: true,
    /* run by Electron as Node from outside the archive: the CLI the agents run, the agents' adapters */
    asarUnpack: ['node_modules/openfilm/**', 'node_modules/@agentclientprotocol/**', 'node_modules/playwright-core/**'],
    files: ['src/**/*', 'shell/dist/**/*', 'package.json', 'node_modules/**/*'],
    /* ffmpeg and the headless browser (2b), as files of their own beside the archive: they run as programs */
    extraResources: [{ from: runtime, to: 'runtime' }],
    directories: { output: out, buildResources: join(desktop, 'build') },
    electronFuses: {
      runAsNode: true,
      enableCookieEncryption: true,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
    },
    /* one feed folder for both channels: the app reads latest(-mac).yml, or beta(-mac).yml when Beta Updates is on
       (src/update-channel.mjs); publishing puts this build's feed under either name */
    publish: FEED ? [{ provider: 'generic', url: FEED, channel: 'latest' }] : null,
    mac: {
      category: 'public.app-category.video',
      icon: join(desktop, 'build/icon.icns'),
      minimumSystemVersion: '13.0',
      /* the .zip the updater downloads; the .dmg has its own name (dmg.artifactName) */
      artifactName: `${NAME.replace(' ', '-')}-\${version}-\${arch}-mac.\${ext}`,
      hardenedRuntime: true,
      gatekeeperAssess: false,
      entitlements: join(desktop, 'build/entitlements.mac.plist'),
      entitlementsInherit: join(desktop, 'build/entitlements.mac.plist'),
      ...(unsigned ? { identity: null } : { identity: IDENTITY, notarize: true }),
    },
    /* the downloads keep one name from version to version: the website links the latest release's by it */
    dmg: { title: NAME, artifactName: `${NAME.replace(' ', '-')}-\${arch}.\${ext}` },
  },
});

if (!unsigned && !win && FEED) {
  const app = join(out, arch === 'arm64' ? 'mac-arm64' : 'mac', `${NAME}.app`);
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  run('/usr/bin/xcrun', ['stapler', 'validate', app]);
  /* 4. the download */
  const dmg = join(out, `${NAME.replace(' ', '-')}-${arch}.dmg`);
  run('/usr/bin/codesign', ['--sign', `Developer ID Application: ${IDENTITY}`, '--timestamp', dmg]);
  run('/usr/bin/xcrun', ['notarytool', 'submit', dmg, '--keychain-profile', NOTARY_PROFILE, '--wait']);
  run('/usr/bin/xcrun', ['stapler', 'staple', dmg]);
  run('/usr/sbin/spctl', ['-a', '-t', 'open', '--context', 'context:primary-signature', '-v', dmg]);
  /* signing and stapling changed the .dmg: the feed lists it as it is now (the updater itself takes the .zip) */
  const bytes = readFileSync(dmg);
  const sha512 = createHash('sha512').update(bytes).digest('base64');
  const feed = join(out, 'latest-mac.yml');
  const name = basename(dmg);
  writeFileSync(feed, readFileSync(feed, 'utf8').replace(new RegExp(`(- url: ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n\\s+sha512: )\\S+(\\n\\s+size: )\\d+`), `$1${sha512}$2${bytes.length}`));
  if (!readFileSync(feed, 'utf8').includes(sha512)) throw new Error('the feed does not list the signed .dmg');
}
console.log(`\n${readdirSync(out).filter((f) => /\.(dmg|zip|exe|yml)$/.test(f)).map((f) => join(out, f)).join('\n')}`);
console.log(`feed: ${FEED ?? 'none (a build of this source: it never looks for updates)'}`);
if (win) {
  const artifacts = readdirSync(out).filter((file) => file.endsWith('.exe'));
  if (!artifacts.length) throw new Error('No Windows installer was generated.');
  const report = { version: pkg.version, platform: 'win32', arch, electronVersion,
    codex: CODEX_BUILD, updates: FEED, artifacts: artifacts.map((file) => ({ file,
      sha256: createHash('sha256').update(readFileSync(join(out, file))).digest('hex') })) };
  writeFileSync(join(out, 'build-manifest.json'), `${JSON.stringify(report, null, 2)}\n`);
}
if (FEED && !existsSync(join(out, win ? 'latest.yml' : 'latest-mac.yml'))) process.exitCode = 1;

/** An unsigned Mac app signed ad hoc (no identity), all of it, so it starts. @param {{ appOutDir: string }} context */
function adHocSign(context) {
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', join(context.appOutDir, `${NAME}.app`)], { stdio: 'inherit' });
}

/** OpenFilm.exe's icon and version, as rcedit would write them. */
async function windowsResources(context) {
  const ResEdit = await import('resedit');
  const PE = await import('pe-library');
  const file = join(context.appOutDir, `${NAME}.exe`);
  const exe = PE.NtExecutable.from(readFileSync(file), { ignoreCert: true });
  const res = PE.NtExecutableResource.from(exe);
  const icon = ResEdit.Data.IconFile.from(readFileSync(join(desktop, 'build/icon.ico')));
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(res.entries, 1, 1033, icon.icons.map((item) => item.data));
  const info = ResEdit.Resource.VersionInfo.fromEntries(res.entries)[0] ?? ResEdit.Resource.VersionInfo.createEmpty();
  const [major, minor, patch] = pkg.version.split('.').map(Number);
  info.setFileVersion(major, minor, patch, 0, 1033);
  info.setProductVersion(major, minor, patch, 0, 1033);
  info.setStringValues({ lang: 1033, codepage: 1200 }, {
    ProductName: NAME, FileDescription: NAME, CompanyName: 'GainingCut', OriginalFilename: `${NAME}.exe`,
    InternalName: NAME, LegalCopyright: 'Copyright © 2026 GainingCut', FileVersion: pkg.version, ProductVersion: pkg.version,
  });
  info.outputToResourceEntries(res.entries);
  res.outputResource(exe);
  writeFileSync(file, Buffer.from(exe.generate()));
}
