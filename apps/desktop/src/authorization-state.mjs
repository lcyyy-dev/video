const BOOTSTRAP = new Set(['desktop:hello', 'desktop:clipboard-text', 'desktop:sub2api:get', 'desktop:sub2api:set', 'desktop:sub2api:test', 'desktop:sub2api:status', 'desktop:tabs:list']);

/** The same gate is used for every build. Renderer dialogs are not the IPC security boundary. */
export function authorizationState(onChange = () => {}) {
  let authorized = false;
  return {
    get: () => authorized,
    set(next) { if (authorized === next) return; authorized = next; onChange(next); },
    guard(channel) { if (!authorized && !BOOTSTRAP.has(channel)) throw new Error('请先激活 OpenFilm。'); },
  };
}

/** Ignore checks against credentials that have since been replaced by activation. */
export function authorizationController(verify, onChange) {
  const state = authorizationState(onChange);
  let revision = 0;
  let pending = null;
  return {
    ...state,
    status() {
      if (pending) return pending;
      const current = revision;
      const request = Promise.resolve().then(verify).catch(() => ({ authorized: false, message: '无法验证授权，请检查网络后重试。' })).then(result => {
        if (current !== revision) return { authorized: state.get() };
        state.set(result.authorized === true);
        return result;
      }).finally(() => { if (pending === request) pending = null; });
      pending = request;
      return request;
    },
    async activate(action) {
      revision++;
      pending = null;
      try {
        const result = await action();
        state.set(true);
        return result;
      } finally { revision++; pending = null; }
    },
  };
}
