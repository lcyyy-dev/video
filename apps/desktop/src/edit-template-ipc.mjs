import { resolve } from 'node:path';
import { loadTemplate, saveTemplate } from './edit-workflow.mjs';
import { normalizeTemplate } from './edit-template.mjs';
import { speechRequest } from './narration.mjs';
import { videoProjectRoot, assertVideoStorage } from './video-policy.mjs';

export function registerEditTemplateIpc(ipcMain, { trusted, projects, hosted }) {
  const handle = (channel, action) => ipcMain.handle(channel, async (event, opts) => {
    if (!trusted(event)) throw new Error('Not the window page.');
    if (typeof opts?.project !== 'string' || !opts.project) throw new Error('Missing project.');
    const project = resolve(opts.project);
    if (!(await projects()).some(path => resolve(path) === project)) throw new Error('Not a project of Studio.');
    videoProjectRoot(project, { projects: await projects() });
    assertVideoStorage(project);
    return action(project, opts);
  });
  handle('desktop:edit-template:load', project => loadTemplate(project));
  handle('desktop:edit-template:save', (project, opts) => saveTemplate(project, opts.config));
  handle('desktop:edit-template:voices', () => speechRequest(hosted(), 'voices', {}));
  handle('desktop:edit-template:preview', async (_project, opts) => {
    const config = normalizeTemplate(opts.config);
    if (config.kind !== 'ad' || !config.body || !config.narration) throw new Error('仅广告开启正文朗读后支持配音。');
    return speechRequest(hosted(), 'synthesize', { text: config.bodyText.slice(0, 100) || '欢迎使用广告文案朗读。', speaker: config.speaker, speechRate: config.speechRate });
  });
}
