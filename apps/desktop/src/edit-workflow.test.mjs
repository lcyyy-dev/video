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
    if (kind === 'copy') {
      assert.match(prepared.text, /文案二创是纯文字润色/);
      assert.doesNotMatch(prepared.text, /文字颜色与行宽规则|同屏文案规则|去标点规则：/);
      continue;
    }
    assert.match(prepared.text, /只有广告模板开启文案朗读/);
    assert.match(prepared.text, /失败明确报告/);
    assert.match(prepared.text, /其他模板不生成旁白/);
    assert.match(prepared.text, /不删字、不精简、不只用标题/);
    assert.match(prepared.text, /保持用户指定时长/);
    assert.match(prepared.text, /同一画面允许同时展示两句或多句文案/);
    assert.match(prepared.text, /标题、多个副标题和正文文案应使用不同的文字填充色/);
    assert.match(prepared.text, /每行尽量铺满可用宽度/);
    assert.match(prepared.text, /不以 JSON 文本框宽度代替文字宽度/);
    assert.match(prepared.text, /人物避让优先于铺满行宽/);
    assert.match(prepared.text, /每个小句必须是结构化文字 JSON 的独立 texts 元素/);
    assert.match(prepared.text, /画面文字去掉语句标点/);
    assert.match(prepared.text, /原始输入和模板配置原样保存/);
    assert.match(prepared.text, /主视频画面必须铺满画布/);
    assert.match(prepared.text, /任何文字排版规则都不能成为缩小主视频的理由/);
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

test('copy template polishes source without video context or hidden advertising fields', () => {
  const prepared = prepareEditPrompt(project(), '生成视频', { config: {
    ...initialTemplate(), kind: 'copy', source: '原始事实', rewrite: '增强开头吸引力', titleText: '固定标题', bodyText: '固定正文',
  } });
  assert.equal(prepared.workflow.skill, 'copy-rewrite');
  assert.match(prepared.text, /原始事实/);
  assert.match(prepared.text, /不剪辑视频、不修改工程/);
  assert.match(prepared.text, /正常保留标点和段落/);
  assert.doesNotMatch(prepared.text, /二创方向：增强开头吸引力/);
  assert.doesNotMatch(prepared.text, /固定正文|固定标题/);
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

test('advertising read-aloud requires the native command before reporting availability',()=>{
 const root=project();
 const prepared=prepareEditPrompt(root,'按模板生成视频',{config:{...initialTemplate(),narration:true,bodyText:'完整正文。'}});
 assert.match(prepared.text,/请先在工程目录执行 openfilm narrate/);
 assert.match(prepared.text,/不得跳过已勾选旁白/);
 assert.match(prepared.text,/只有命令真实失败才可报告旁白未完成/);
 const disabled=prepareEditPrompt(root,'生成视频',{config:{...initialTemplate(),narration:false}});assert.match(disabled.text,/当前未启用广告正文朗读/);
});
