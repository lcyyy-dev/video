/** Authentication belongs to the host. A planner never inherits user config, hooks or shell secrets. */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VideoPolicyError } from './video-policy.mjs';
import { getCACertificates } from 'node:tls';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const authBytes = file => {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 128_000) throw new VideoPolicyError('登录凭据存储无效，请在设置中重新登录。');
  const bytes = readFileSync(file);
  const auth = JSON.parse(bytes.toString('utf8'));
  if (!auth.tokens?.access_token || auth.OPENAI_API_KEY) throw new VideoPolicyError('请在设置中使用 ChatGPT 账号登录，视频隔离模式不继承外部 API 密钥。');
  return bytes;
};

export function plannerEnvironment(source, { home }) {
  const allowed = new Set(['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'ComSpec', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP',
    'LANG', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy', 'LD_LIBRARY_PATH', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS']);
  const env = Object.fromEntries(Object.entries(source).filter(([key, value]) => (allowed.has(key) || key.startsWith('LC_')) && typeof value === 'string'));
  const noProxy = [env.NO_PROXY ?? env.no_proxy, '127.0.0.1', 'localhost'].filter(Boolean).join(',');
  return { ...env, NO_PROXY: noProxy, no_proxy: noProxy, CODEX_HOME: home, HOME: home, USERPROFILE: home, INITIAL_AGENT_MODE: 'read-only', MODEL_PROVIDER: 'openai', NO_BROWSER: '1' };
}

/** One private config and inference gateway per session; never use a project as Codex's cwd. */
export function createPlannerRuntime({ dataDir, authHome, baseUrl, certificate, model } = {}) {
  if (!dataDir || !authHome || !/^https:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{64}\/backend-api$/.test(baseUrl ?? '') || !certificate?.startsWith('-----BEGIN CERTIFICATE-----')) throw new VideoPolicyError('视频隔离环境初始化失败。');
  const base = join(dataDir, 'video-planners');
  mkdirSync(base, { recursive: true, mode: 0o700 });
  if (lstatSync(base).isSymbolicLink()) throw new VideoPolicyError('视频隔离环境不能是链接。');
  const folder = join(base, randomUUID());
  const home = join(folder, 'codex'), cwd = join(folder, 'workspace');
  mkdirSync(home, { recursive: true, mode: 0o700 }); mkdirSync(cwd, { mode: 0o700 });
  const source = join(authHome, 'auth.json');
  let original;
  try { original = authBytes(source); }
  catch (error) { rmSync(folder, { recursive: true, force: true }); throw error.code === 'ENOENT' ? new VideoPolicyError('请在设置中重新登录 Codex，视频模式使用应用独立凭据。') : error; }
  writeFileSync(join(home, 'auth.json'), original, { mode: 0o600 });
  const caFile = join(home, 'planner-ca.pem');
  writeFileSync(caFile, [certificate, ...getCACertificates('default'), ...getCACertificates('system')].join('\n'), { mode: 0o600 });
  const config = [
    'chatgpt_base_url = "https://chatgpt.com/backend-api"', 'model_provider = "openfilm-video"',
    ...(typeof model === 'string' && /^[\w.-]+$/.test(model) ? [`model = ${JSON.stringify(model)}`] : []),
    'cli_auth_credentials_store = "file"', 'approval_policy = "never"', 'sandbox_mode = "read-only"',
    'check_for_update_on_startup = false', 'web_search = "disabled"', 'project_doc_max_bytes = 0',
    'notify = []', 'allow_login_shell = false',
    '[features]', 'shell_tool = false', 'unified_exec = false', 'shell_snapshot = false',
    'apps = false', 'plugins = false', 'remote_plugin = false', 'multi_agent = false',
    'browser_use = false', 'browser_use_external = false', 'computer_use = false',
    'hooks = false', 'codex_hooks = false', 'skill_search = false', 'workspace_dependencies = false',
    'enable_request_compression = false', 'responses_websockets = false', 'responses_websockets_v2 = false',
    'code_mode = false', 'code_mode_host = false', 'view_image = false', 'skip_host_skill_discovery = true',
    '[model_providers.openfilm-video]', 'name = "OpenFilm Video Planner"', `base_url = ${JSON.stringify(`${baseUrl}/codex`)}`,
    'wire_api = "responses"', 'requires_openai_auth = true', 'supports_websockets = false', 'request_max_retries = 0', 'stream_max_retries = 0',
    '[tools]', 'view_image = false',
    '[shell_environment_policy]', 'inherit = "none"',
  ].join('\n') + '\n';
  writeFileSync(join(home, 'config.toml'), config, { mode: 0o600 });
  let closed = false;
  return {
    home, cwd, caFile,
    close() {
      if (closed) return; closed = true;
      // Propagate only an authentication refresh, and only if the original login has not changed meanwhile.
      try {
        const refreshed = authBytes(join(home, 'auth.json'));
        if (hash(refreshed) !== hash(original) && hash(authBytes(source)) === hash(original)) {
          const temp = join(authHome, `.video-auth-${randomUUID()}.tmp`);
          writeFileSync(temp, refreshed, { mode: 0o600 }); renameSync(temp, source);
        }
      } catch { /* A later explicit login wins; never expose authentication errors or credentials to the model. */ }
      if (existsSync(folder)) rmSync(folder, { recursive: true, force: true });
    },
  };
}
