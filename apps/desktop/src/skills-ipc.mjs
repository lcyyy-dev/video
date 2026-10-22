/** Read-only advertising workflow access for the client's composer. */
import { resolve } from 'node:path';
import { listSkills, skillText } from 'openfilm/skills';
import { CLIENT_SKILLS } from 'openfilm/client-scope';

export function registerSkillsIpc(ipcMain, { trusted, projects, mine }) {
  const project = async (path) => {
    if (!path) return null;
    const cwd = resolve(path);
    if (!(await projects()).some((entry) => resolve(entry) === cwd)) throw new Error('Not a project of Studio.');
    return cwd;
  };
  const read = async (path) => listSkills({ project: await project(path), mine }).filter((skill) => CLIENT_SKILLS.includes(skill.name));
  const handle = (channel, fn) => ipcMain.handle(channel, async (event, opts) => {
    if (!trusted(event)) throw new Error('Not the window page.');
    return fn(opts ?? {});
  });
  handle('desktop:skills:list', async ({ project: path, agent }) => ({
    openfilm: (await read(path)).map(({ name, description, folder, source, scripts, shown, kind, order, icon, version }) => ({ name, description, folder, source, scripts, shown, kind, order, icon, version })),
    own: { agent, filtered: true, skills: [] }, mine,
  }));
  handle('desktop:skills:texts', async ({ project: path, names }) => {
    const wanted = new Set(Array.isArray(names) ? names : []);
    return (await read(path)).filter((skill) => wanted.has(skill.name)).map((skill) => ({ name: skill.name, text: skillText(skill) }));
  });
}
