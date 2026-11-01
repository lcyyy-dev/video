import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { native } from './bridge';

/** Nothing in the workspace is mounted until the server accepts the device authorization. */
export function ActivationGate({ children }: { children: ReactNode }) {
  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [message, setMessage] = useState('正在验证授权…');
  const dialog = useRef<HTMLDialogElement>(null);
  const revision = useRef(0);
  const check = useCallback(async () => {
    const current = ++revision.current;
    setChecking(true);
    try {
      const result = await native.sub2api.status();
      if (current !== revision.current) return;
      setAuthorized(result.authorized);
      setMessage(result.message || (result.authorized ? '' : '请输入激活码以使用 OpenFilm。'));
    } catch { if (current === revision.current) { setAuthorized(false); setMessage('无法验证授权，请检查网络后重试。'); } }
    finally { if (current === revision.current) setChecking(false); }
  }, []);
  useEffect(() => {
    void check();
    const stop = native.sub2api.onAuthorization(value => {
      revision.current++;
      setAuthorized(value);
      setChecking(false);
      if (!value) setMessage('授权已失效，请重新激活。');
    });
    const timer = setInterval(() => { void check(); }, 60_000);
    const focus = () => { void check(); };
    window.addEventListener('focus', focus);
    return () => { revision.current++; stop(); clearInterval(timer); window.removeEventListener('focus', focus); };
  }, [check]);
  useEffect(() => {
    document.body.dataset.authorized = String(authorized);
    if (!authorized && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [authorized]);
  async function activate() {
    setBusy(true); setMessage('正在激活…');
    try {
      await native.sub2api.set({ activationCode: code.trim() });
      setCode('');
      await check();
    } catch (error) { setMessage(error instanceof Error ? error.message : '激活失败，请检查激活码。'); }
    finally { setBusy(false); }
  }
  if (authorized) return children;
  return <div className="activation-lock">
    <dialog ref={dialog} className="activation-dialog" aria-labelledby="activation-title" aria-describedby="activation-message" onCancel={event => event.preventDefault()}>
      <div className="activation-mark" aria-hidden="true">OF</div>
      <h1 id="activation-title">激活 OpenFilm</h1>
      <p>请输入激活码以继续使用，授权将绑定到此设备。</p>
      <form onSubmit={event => { event.preventDefault(); void activate(); }}>
        <label>激活码<input autoFocus autoComplete="off" type="password" value={code} onChange={event => setCode(event.target.value)} placeholder="输入你的激活码" disabled={busy || checking} /></label>
        <button type="submit" disabled={busy || checking || !code.trim()}>{busy ? '正在激活…' : '激活并进入'}</button>
        <button type="button" className="activation-retry" onClick={() => void check()} disabled={busy || checking}>重新验证授权</button>
      </form>
      <div id="activation-message" role="status">{message}</div>
    </dialog>
  </div>;
}
