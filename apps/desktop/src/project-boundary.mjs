import { isAbsolute, relative, resolve } from 'node:path';

const inside = (root, file) => { const rel = relative(root, file); return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)); };

/** Fix the native sandbox at the app-server boundary, without interpreting the user's requests. */
export function projectRequest(message, root) {
  if (!message?.method) return message;
  const params = { ...message.params };
  if (['config/value/write', 'config/batchWrite', 'account/login/start', 'account/logout'].includes(message.method)) throw new Error('Project sessions cannot change host settings or execute outside the native sandbox');
  /* Older Codex builds expose command/fs requests through the app-server. Keep those requests usable for the active
     project and let the native workspace sandbox enforce the actual filesystem boundary. */
  if (['command/exec', 'process/exec'].includes(message.method)) {
    params.cwd = root;
    params.sandboxPolicy = { type: 'workspaceWrite', writableRoots: [root], networkAccess: true, excludeTmpdirEnvVar: true, excludeSlashTmp: true };
  }
  if (message.method === 'fs/writeFile') {
    const path = params.path ?? params.filePath ?? params.filename;
    if (typeof path !== 'string' || !inside(resolve(root), isAbsolute(path) ? resolve(path) : resolve(root, path))) throw new Error('Project sessions cannot write outside the active project');
  }
  if (['thread/start', 'thread/resume', 'thread/fork', 'turn/start', 'turn/steer'].includes(message.method)) {
    params.cwd = root;
    params.approvalPolicy = 'never';
    params.permissions = null;
    // Omit environments so Codex creates its native local execution environment. An empty list disables execution.
    delete params.environments;
    if (message.method.startsWith('thread/')) {
      params.sandbox = 'workspace-write';
      params.runtimeWorkspaceRoots = [root];
      params.config = { ...params.config, sandbox_mode: 'workspace-write', approval_policy: 'never',
        sandbox_workspace_write: { writable_roots: [root], network_access: true, exclude_tmpdir_env_var: true, exclude_slash_tmp: true } };
    } else {
      params.sandboxPolicy = { type: 'workspaceWrite', writableRoots: [root], networkAccess: true, excludeTmpdirEnvVar: true, excludeSlashTmp: true };
    }
  }
  if (message.method === 'thread/settings/update') {
    for (const key of Object.keys(params)) if (!['threadId', 'model', 'reasoningEffort', 'serviceTier', 'summary', 'personality', 'collaborationMode'].includes(key)) throw new Error('Project sandbox settings are fixed');
  }
  return { ...message, params };
}
