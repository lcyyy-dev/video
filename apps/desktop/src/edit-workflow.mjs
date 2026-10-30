/** Native project persistence and deterministic template → skill → prompt preparation. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { initialTemplate, normalizeTemplate, templateRoute, templateSummary } from './edit-template.mjs';

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
  const workflow = { skill: route.skill, source: 'bundled', config };
  return { workflow, text: [
    '<openfilm-project-context>',
    '这是当前 OpenFilm 项目的工作流背景；用户本次自然语言指令优先。模板文案仍按原文处理，具体约束见会话指令。',
    templateSummary(config),
    '当前模板配置（可被用户本次指令调整）：', JSON.stringify(config),
    warning,
    `当前工作流可通过 openfilm skill ${route.skill} 读取内置 skill；普通问答或简单修改无需重复加载。`,
    '</openfilm-project-context>',
    '\n用户本次需求（含附件与编辑器引用）：', String(text),
  ].join('\n') };
}
