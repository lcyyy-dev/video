import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeConfig, ownMcpServers, ownSkills, sessionSkills } from './agent-skills.mjs';

function world() {
  const root = mkdtempSync(join(tmpdir(), 'of-codex-skills-'));
  const home = join(root, 'home');
  const project = join(home, 'film');
  const mine = join(root, 'mine');
  mkdirSync(project, { recursive: true });
  mkdirSync(mine);
  const skill = (path, name) => {
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name}\n---\nBody.\n`);
  };
  skill(join(home, '.codex/skills/.system/imagegen'), 'imagegen');
  skill(join(home, '.codex/skills/personal'), 'personal');
  skill(join(home, '.codex/plugins/cache/openai-curated/test/1/skills/native'), 'native');
  skill(join(mine, 'unrelated'), 'unrelated');
  const config = join(home, '.codex/config.toml');
  writeFileSync(config, '[mcp_servers.node_repl]\ncommand = "/Applications/ChatGPT.app/node_repl"\n[mcp_servers.personal]\nurl = "https://example.test/mcp"\n');
  return { root, home, project, mine, config, dataDir: join(root, 'data') };
}

test('Codex receives the packaged video workflows; personal configuration stays unchanged', async () => {
  const w = world();
  const before = readFileSync(w.config, 'utf8');
  assert.deepEqual((await ownSkills('codex', { home: w.home, cwd: w.project })).map((skill) => skill.name), ['personal']);
  assert.deepEqual(ownMcpServers('codex', { home: w.home }).map((server) => server.name), ['personal']);
  const result = await sessionSkills('codex', { cwd: w.project, home: w.home, dataDir: w.dataDir, mine: w.mine });
  assert.deepEqual(result.log.openfilm, ['ad-editing', 'copy-rewrite', 'live-clips', 'talk-editing']);
  for (const skill of result.log.openfilm) assert.ok(existsSync(join(result.additionalDirectories[0], `.agents/skills/${skill}/SKILL.md`)));
  assert.ok(!existsSync(join(result.additionalDirectories[0], '.claude-plugin')));
  assert.equal(result.codexConfig['mcp_servers.personal.enabled'], false);
  assert.ok(!('mcp_servers.node_repl.enabled' in result.codexConfig));
  assert.deepEqual(result.codexConfig.skills.config.map((entry) => entry.enabled), [false]);
  assert.equal(readFileSync(w.config, 'utf8'), before);
  await assert.rejects(sessionSkills('byok', { cwd: w.project, dataDir: w.dataDir }), /Only Codex/);
});

test('two configurations as one', () => {
  assert.deepEqual(mergeConfig({ skills: { paths: ['a'] }, permission: { skill: { '*': 'deny' } } }, { experimental: { openTelemetry: true }, skills: { urls: ['u'] } }),
    { skills: { paths: ['a'], urls: ['u'] }, permission: { skill: { '*': 'deny' } }, experimental: { openTelemetry: true } });
  assert.deepEqual(mergeConfig({ developer_instructions: 'x' }, { skills: { config: [] } }), { developer_instructions: 'x', skills: { config: [] } });
});
