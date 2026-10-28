/** Environment for a native Codex project session. It carries the user's normal PATH and locale while excluding
 * inherited Codex/OpenFilm session state; the app-server applies the project sandbox separately. */
export function projectEnvironment(source, { home }) {
  const allowed = new Set(['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'ComSpec', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP',
    'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)',
    'ProgramW6432', 'CommonProgramFiles', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS',
    'LANG', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy', 'LD_LIBRARY_PATH', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS']);
  const env = Object.fromEntries(Object.entries(source).filter(([key, value]) => (allowed.has(key) || key.startsWith('LC_')) && typeof value === 'string'));
  if (!env.PATH && env.Path) env.PATH = env.Path;
  const noProxy = [env.NO_PROXY ?? env.no_proxy, '127.0.0.1', 'localhost'].filter(Boolean).join(',');
  return { ...env, NO_PROXY: noProxy, no_proxy: noProxy, CODEX_HOME: home, HOME: home, USERPROFILE: home, MODEL_PROVIDER: 'openfilm' };
}
