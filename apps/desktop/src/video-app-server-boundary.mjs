/** Defense in depth: ACP may call its workspace-write preset "read-only"; enforce the real policy on the wire. */
import { VideoPolicyError } from './video-policy.mjs';

const METHODS = new Set(['initialize', 'account/read', 'account/rateLimits/read', 'model/list', 'config/read', 'config/requirements/read',
  'thread/start', 'thread/read', 'thread/loaded/list', 'thread/turns/list', 'thread/unsubscribe', 'thread/settings/update',
  'thread/compact/start', 'turn/start', 'turn/interrupt', 'turn/steer', 'skills/list', 'skills/extraRoots/set', 'mcpServerStatus/list']);

export function videoAppServerRequest(message, workspace) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) throw new VideoPolicyError();
  if (!message.method) return message;
  if (message.method === 'initialized') return message;
  if (!METHODS.has(message.method)) throw new VideoPolicyError('此后台操作不属于视频规划能力。');
  const params = { ...(message.params ?? {}) };
  if (message.method === 'thread/start') {
    params.cwd = workspace; params.sandbox = 'read-only'; params.approvalPolicy = 'never'; params.approvalsReviewer = 'user';
    params.permissions = null; params.dynamicTools = []; params.runtimeWorkspaceRoots = [workspace]; params.environments = [];
    params.config = { ...(params.config ?? {}), sandbox_mode: 'read-only', approval_policy: 'never', project_doc_max_bytes: 0 };
  }
  if (['turn/start', 'turn/steer'].includes(message.method)) {
    params.cwd = workspace; params.approvalPolicy = 'never'; params.approvalsReviewer = 'user';
    params.sandboxPolicy = { type: 'readOnly' }; params.permissions = null; params.environments = [];
  }
  if (message.method === 'thread/settings/update') {
    // Model and effort changes cannot smuggle a permissions, provider or workspace change.
    const safe = ['threadId', 'model', 'reasoningEffort', 'serviceTier', 'summary', 'personality'];
    for (const key of Object.keys(params)) if (!safe.includes(key)) throw new VideoPolicyError('不能更改视频会话的安全策略。');
  }
  if (message.method === 'skills/extraRoots/set') params.extraRoots = [];
  return { ...message, params };
}
