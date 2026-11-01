import React from 'react';
import { KeyRound, X } from 'lucide-react';
import { app } from '../app-bridge';

export function Sub2ApiSettings({ onClose }: { onClose: () => void }) {
  const [activationCode, setActivationCode] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [configured, setConfigured] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    void app.sub2api.get().then(value => setConfigured(value.configured))
      .catch(error => setMessage(error instanceof Error ? error.message : '无法读取激活状态。'));
  }, []);
  async function activate() {
    setBusy(true); setMessage('正在激活…');
    try {
      await app.sub2api.set({ activationCode: activationCode.trim() });
      setActivationCode(''); setConfigured(true); setMessage('激活成功，后续使用自动续期。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '激活失败。'); }
    finally { setBusy(false); }
  }
  async function test() {
    setBusy(true); setMessage('正在测试模型连接…');
    try { await app.sub2api.test(); setMessage('授权有效，模型连接成功。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '连接失败。'); }
    finally { setBusy(false); }
  }
  return <div role="dialog" aria-label="OpenFilm 激活" className="fixed bottom-[72px] right-3 z-[10000] w-[320px] rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-3 shadow-2xl">
    <div className="mb-3 flex items-center gap-2 text-[13px] font-medium text-[var(--text)]"><KeyRound size={14} />OpenFilm 激活<button className="ml-auto text-[var(--text-faint)]" onClick={onClose} aria-label="关闭"><X size={14} /></button></div>
    <p className="mb-3 text-[12px] text-[var(--text-muted)]">{configured ? '此设备已激活，日常使用无需再次输入激活码。' : '首次使用请输入激活码，将授权绑定到此设备。'}</p>
    <form onSubmit={event => { event.preventDefault(); void activate(); }}>
      <label className="mb-3 block text-[12px] text-[var(--text-muted)]">激活码<input type="password" autoComplete="off" value={activationCode} onChange={event => setActivationCode(event.target.value)} placeholder={configured ? '输入新激活码可更换授权' : '输入你的激活码'} disabled={busy} className="mt-1 h-9 w-full rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 text-[12px] text-[var(--text)]" /></label>
      <div className="flex items-center gap-2"><button type="submit" disabled={busy || !activationCode.trim()} className="h-8 rounded bg-[var(--accent)] px-3 text-[12px] text-white disabled:opacity-50">激活</button><button type="button" disabled={busy || !configured} onClick={() => void test()} className="h-8 rounded border border-[var(--border)] px-2 text-[12px] text-[var(--text)] disabled:opacity-50">测试连接</button></div>
    </form>
    <div role="status" className="mt-2 text-[12px] text-[var(--text-muted)]">{message || (configured ? '已激活' : '尚未激活')}</div>
  </div>;
}
