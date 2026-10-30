import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AgentSession, INSTRUCTIONS } from './agents.mjs';
import { createCodexProvider } from './codex-provider.mjs';
import { readSub2ApiConfig } from './sub2api-config.mjs';

/** Native ACP conversation; the wrapper owns connection credentials and project sandbox configuration only. */
export class ProjectSession extends AgentSession {
  async start() {
    const hosted = readSub2ApiConfig(process.env, this.opts.dataDir, this.opts.storage);
    if (!hosted) throw new Error('请先在连接设置中配置模型服务。');
    this.provider = await createCodexProvider(hosted);
    const root = resolve(this.opts.cwd);
    const home = join(this.opts.dataDir, 'project-codex', createHash('sha256').update(root).digest('hex'));
    mkdirSync(home, { recursive: true, mode: 0o700 });
    const temp = join(root, '.film', 'tmp');
    mkdirSync(temp, { recursive: true });
    /* INSTRUCTIONS already contains the project boundary, copy-lock, narration and verification rules. Keep one
       canonical copy in the session config so each turn does not carry a second version of the same policy. */
    const instructions = INSTRUCTIONS;
    /* Keep the provider in a private Codex home.  This is TOML because Codex reads config.toml before the ACP
       handshake; passing the same object through the old planner JSON override makes it ignore the provider. */
    const toml = [
      'check_for_update_on_startup = false',
      'model_provider = "openfilm"',
      `model = ${JSON.stringify(hosted.model)}`,
      'model_reasoning_effort = "medium"',
      'approval_policy = "never"',
      'sandbox_mode = "workspace-write"',
      `developer_instructions = ${JSON.stringify(instructions)}`,
      '[model_providers.openfilm]',
      'name = "OpenFilm"',
      `base_url = ${JSON.stringify(this.provider.baseUrl)}`,
      'wire_api = "responses"',
      'env_key = "OPENFILM_MODEL_TOKEN"',
      'requires_openai_auth = false',
    ].join('\n') + '\n';
    // No product API key is written into a project or exposed to execution tools.
    writeFileSync(join(home, 'config.toml'), toml, { mode: 0o600 });
    this.opts.env = { ...this.opts.env, CODEX_HOME: home, OPENFILM_MODEL_TOKEN: this.provider.token, MODEL_PROVIDER: 'openfilm', INITIAL_AGENT_MODE: 'agent', TMPDIR: temp, TMP: temp, TEMP: temp };
    this.opts.project = { instructions };
    try { return await super.start(); } catch (error) { await this.close(); throw error; }
  }
  async close() { await super.close(); await this.provider?.close(); this.provider = null; }
}
