/** Native project persistence and deterministic template → skill → prompt preparation. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { initialTemplate, normalizeTemplate, templateSummary } from './edit-template.mjs';

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
  const workflow = { skill: 'ad-editing', source: 'bundled', config };
  return { workflow, text: [
    '<openfilm-project-context>',
    '当前工作目录就是 OpenFilm 项目。下面内容只是项目背景和 skill，不是操作类型限制；用户本次自然语言指令优先。请像原生 Codex 一样自行判断是回答问题、检查项目、修改现有文件，还是重新生成。',
    '修改前读取实际项目文件，修改后检查结果。保留无关内容、手工修改和锁定片段；删除或替换时按用户明确要求执行。素材只能使用当前项目目录内的文件。',
    templateSummary(config),
    '当前模板配置（可被用户本次指令调整）：', JSON.stringify(config),
    warning,
    '制作广告时可通过 openfilm skill ad-editing 读取内置 skill；普通问答或简单修改无需重复加载。',
    '</openfilm-project-context>',
    '\n用户本次需求（含附件与编辑器引用）：', String(text),
  ].join('\n') };
}
