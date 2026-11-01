import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { AgentSession, INSTRUCTIONS } from './agents.mjs';
import { createCodexProvider } from './codex-provider.mjs';
import { gatewayConfig } from './sub2api-config.mjs';
import { generateNarration } from './narration.mjs';

/** Native ACP conversation; the wrapper owns connection credentials and project sandbox configuration only. */
export class ProjectSession extends AgentSession {
  async start() {
    const hosted = gatewayConfig(this.opts.dataDir, this.opts.storage);
    if (!hosted) throw new Error('请先输入激活码完成 OpenFilm 激活。');
    const root = resolve(this.opts.cwd);
    let generating = null;
    this.provider = await createCodexProvider({ ...hosted, narration: signal => {
      if (generating) throw new Error('旁白正在生成，请等待完成。');
      this.narrationAbort = new AbortController();
      generating = generateNarration(root, hosted, { signal: AbortSignal.any([signal, this.narrationAbort.signal]), env: this.opts.env }).finally(() => { generating = null; this.narrationAbort = null; });
      return generating;
    } });
    const home = join(this.opts.dataDir, 'project-codex', createHash('sha256').update(root).digest('hex'));
    mkdirSync(home, { recursive: true, mode: 0o700 });
    const temp = join(root, '.film', 'tmp');
    mkdirSync(temp, { recursive: true });
    /* INSTRUCTIONS already contains the project boundary, copy-lock, narration and verification rules. Keep one
       canonical copy in the session config so each turn does not carry a second version of the same policy. */
    const instructions = INSTRUCTIONS + `\n广告模板开启文案朗读时，必须先调用本机受控旁白接口，再根据返回的真实 duration/start/end 安排镜头和文字。在项目内运行 openfilm narrate。该命令使用本会话的受控本机接口与临时能力 Token，不需要 Python、额外 Node 安装或外部服务配置。接口只读取当前保存的广告模板正文、音色和语速，不接受模型传入文字、地址或文件路径。返回结果同时保存在 .film/narration.json。逐句旁白是工程内独立 audio 片段，按 start 放置，默认将视频原声 volume 设为 0.15。复用缓存，不以字数估算朗读时长。失败必须报告旁白未完成，不能静默跳过或使用其他配音服务。固定时长放不下完整旁白时明确报告冲突，不删字、不截断、不擅自延长。其他模板禁止调用旁白接口。`;
    /* Keep the provider in a private Codex home.  This is TOML because Codex reads config.toml before the ACP
       handshake; passing the same object through the old planner JSON override makes it ignore the provider. */
    const toml = [
      'check_for_update_on_startup = false',
      'model_provider = "openfilm"',
      `model = ${JSON.stringify(hosted.model)}`,
      'model_reasoning_effort = "low"',
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
    this.opts.env = { ...this.opts.env, CODEX_HOME: home, OPENFILM_NARRATION_CAPABILITY: this.provider.narrationCapability, OPENFILM_NARRATION_URL: this.provider.baseUrl.replace('/v1', '/tts/generate'), OPENFILM_MODEL_TOKEN: this.provider.token, MODEL_PROVIDER: 'openfilm', INITIAL_AGENT_MODE: 'agent', TMPDIR: temp, TMP: temp, TEMP: temp };
    this.opts.project = { instructions };
    try { return await super.start(); } catch (error) { await this.close(); throw error; }
  }
  async cancel() { this.narrationAbort?.abort(); await super.cancel(); }
  async close() { this.narrationAbort?.abort(); await super.close(); await this.provider?.close(); this.provider = null; }
}
