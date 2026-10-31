/** Native project persistence and deterministic template → skill → prompt preparation. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { initialTemplate, normalizeTemplate, templateRoute, templateSummary } from './edit-template.mjs';

const packageRoot = dirname(createRequire(import.meta.url).resolve('openfilm/package.json'));

export const templateFile = project => join(project, '.film', 'edit-template.json');
export function loadTemplate(project) {
  let raw;
  try { raw = JSON.parse(readFileSync(templateFile(project), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return initialTemplate(); throw new Error('剪辑模板读取失败，请重新保存模板配置。', { cause: error }); }
  if (!raw || raw.version !== 1) throw new Error('剪辑模板版本不受支持，请重新保存模板配置。');
  return normalizeTemplate(raw.config);
}
export function saveTemplate(project, raw) {
  const config = normalizeTemplate(raw);
  const file = templateFile(project);
  mkdirSync(join(project, '.film'), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ version: 1, config }, null, 2)}\n`);
  renameSync(temp, file);
  return config;
}

/** Add project context to a native Codex turn. The model decides whether to answer, inspect, or edit. */
export function prepareEditPrompt(project, text, { config } = {}) {
  let warning = '';
  if (!config) {
    try { config = loadTemplate(project); }
    catch (error) { config = initialTemplate(); warning = `模板配置无法读取，以下为默认配置。可继续处理用户要求，必要时检查 .film/edit-template.json。原因：${error.message}`; }
  }
  config = normalizeTemplate(config);
  const route = templateRoute(config.kind);
  const skillText = readFileSync(join(packageRoot, 'skills', route.skill, 'SKILL.zh-CN.md'), 'utf8');
  const workflow = { skill: route.skill, source: 'bundled', config };
  const styleInstruction = config.textStyleIds.length
    ? `模板已勾选文字样式 ${config.textStyleIds.join('、')}。生成所有结构化文字时，只能从这些样式 ID 中选择；不要使用未勾选的样式，也不要临时创建样式。多个样式可按文字角色或画面可读性分配，但每个文字角色内部保持一致。`
    : '模板未勾选固定文字样式。生成结构化文字时，从元素库自动组合原生兼容样式，并在同一文字角色内保持组合一致。';
  return { workflow, text: [
    '<openfilm-project-context>',
    '这是当前 OpenFilm 项目的工作流背景；用户本次自然语言指令优先。模板文案仍按原文处理，具体约束见会话指令。',
    templateSummary(config),
    styleInstruction,
    '字号是生成时的布局参数，不是样式锁定项。根据画布尺寸、文字长度、位置和可读性设置每个文字元素的绝对像素字号；使用已选样式时允许单独调整 fontSize，不改变选定的字体、颜色、描边等外观。',
    '执行链路：接收命令 → 执行命令 → 汇报结果。执行完成后直接汇报，不自动运行快速预览、完整检查、重复帧渲染或混音检测；只有用户本次明确要求预览或检查时才执行相应命令。不得把未执行的预览或检查报告为已通过。',
    '当前模板配置（可被用户本次指令调整）：', JSON.stringify(config),
    warning,
    `已选择并加载工作流：openfilm skill ${route.skill}。生成或剪辑时必须执行以下 skill；普通问答不触发影片修改。`,
    `<selected-workflow name="${route.skill}">`, skillText, '</selected-workflow>',
    ...(config.kind === 'copy' ? ['用户通过文案二创模板明确选择了改写：source 是待改写原文，按 rewrite 执行；titleText、bodyText 等明确填写的成品文案仍逐字保留。'] : []),
    '</openfilm-project-context>',
    '\n用户本次需求（含附件与编辑器引用）：', String(text),
  ].join('\n') };
}
