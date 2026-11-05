import { resolve } from 'node:path';
import { loadTemplate, saveTemplate } from './edit-workflow.mjs';
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

}
