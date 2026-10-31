import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initialTemplate } from './edit-template.mjs';
import { loadTemplate, prepareEditPrompt, saveTemplate, templateFile } from './edit-workflow.mjs';

const project = () => mkdtempSync(join(tmpdir(), 'of-edit-workflow-'));

test('native project context preserves ordinary conversation and user wording', () => {
  const root = project();
  const prepared = prepareEditPrompt(root, '删除配音轨，只保留视频和文字；字体改成黄色。');
  assert.equal(prepared.workflow.skill, 'ad-editing');
  assert.match(prepared.text, /用户本次需求/);
  assert.match(prepared.text, /删除配音轨/);
  assert.match(prepared.text, /用户本次自然语言指令优先/);
  assert.doesNotMatch(prepared.text, /固定路由/);
});

test('project template remains local context and malformed files fail clearly', () => {
  const root = project();
  const config = { ...initialTemplate(), titleText: '夏季活动' };
  saveTemplate(root, config);
  assert.deepEqual(loadTemplate(root), config);
  assert.match(prepareEditPrompt(root, '继续').text, /夏季活动/);
  writeFileSync(templateFile(root), '{broken');
  assert.match(prepareEditPrompt(root, '继续').text, /模板配置无法读取/);
  assert.match(prepareEditPrompt(root, '1\+1').text, /1\+1/);
});

test('each enabled template routes to its own bundled workflow', () => {
  const root = project();
  for (const [kind, skill] of [['ad', 'ad-editing'], ['talk', 'talk-editing'], ['copy', 'copy-rewrite'], ['live', 'live-clips']]) {
    saveTemplate(root, { ...initialTemplate(), kind });
    const prepared = prepareEditPrompt(root, '继续');
    assert.equal(prepared.workflow.skill, skill);
    assert.match(prepared.text, new RegExp(`openfilm skill ${skill}`));
    assert.match(prepared.text, new RegExp(`<selected-workflow name="${skill}">`));
    assert.match(prepared.text, new RegExp(`name: ${skill}`));
    assert.match(prepared.text, /生成或剪辑时必须执行以下 skill/);
  }
});

test('selected text styles become a strict generation constraint in the agent context', () => {
  const root = project();
  const config = { ...initialTemplate(), textStyleIds: ['yellow-headline', 'red-emphasis'] };
  const prepared = prepareEditPrompt(root, '生成标题', { config });
  assert.match(prepared.text, /yellow-headline、red-emphasis/);
  assert.match(prepared.text, /只能从这些样式 ID 中选择/);
  assert.match(prepared.text, /"textStyleIds":\["yellow-headline","red-emphasis"\]/);
});

test('copy template authorizes its source rewrite while final wording remains locked', () => {
  const prepared = prepareEditPrompt(project(), '生成视频', { config: {
    ...initialTemplate(), kind: 'copy', source: '原始事实', rewrite: '增强开头吸引力', titleText: '固定标题', bodyText: '固定正文',
  } });
  assert.equal(prepared.workflow.skill, 'copy-rewrite');
  assert.match(prepared.text, /source 是待改写原文，按 rewrite 执行/);
  assert.match(prepared.text, /titleText、bodyText 等明确填写的成品文案仍逐字保留/);
  assert.match(prepared.text, /二创方向：增强开头吸引力/);
  assert.match(prepared.text, /固定正文/);
});

test('every selected workflow executes and reports without automatic preview or verification', () => {
  for (const kind of ['ad', 'talk', 'copy', 'live']) {
    const prepared = prepareEditPrompt(project(), '修改标题', { config: { ...initialTemplate(), kind } });
    assert.match(prepared.text, /不自动运行快速预览、完整检查/);
    assert.match(prepared.text, /默认执行链路：接收命令 → 执行命令 → 汇报结果/);
    assert.doesNotMatch(prepared.text, /修改后默认只运行|快速预览后直接汇报/);
    assert.doesNotMatch(prepared.text, /最后只做一次完整/);
  }
});
