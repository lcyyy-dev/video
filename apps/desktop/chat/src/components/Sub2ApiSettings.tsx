import React from 'react';
import { KeyRound, Save, X } from 'lucide-react';
import { app } from '../app-bridge';

export function Sub2ApiSettings({ onClose }: { onClose: () => void }) {
  const [baseUrl, setBaseUrl] = React.useState('http://127.0.0.1:8188/v1');
  const [key, setKey] = React.useState('');
  const [model, setModel] = React.useState('gpt-6.1-sol');
  const [message, setMessage] = React.useState('');
  const [configured, setConfigured] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => { void app.sub2api.get().then(value => { setBaseUrl(value.baseUrl); setModel(value.model); setConfigured(value.configured); }); }, []);
  async function save() {
    setBusy(true); setMessage('');
    try { const value = await app.sub2api.set({ baseUrl, apiKey: key, model }); setBaseUrl(value.baseUrl); setKey(''); setConfigured(true); setMessage('已保存'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '保存失败。'); }
    finally { setBusy(false); }
  }
  async function test() {
    setBusy(true); setMessage('正在测试连接…');
    try { await app.sub2api.test({ baseUrl, apiKey: key }); setMessage('连接成功'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '连接失败。'); }
    finally { setBusy(false); }
  }
  return <div role="dialog" aria-label="Sub2API 视频模型连接" className="fixed bottom-[72px] right-3 z-[10000] w-[320px] rounded-[12px] border border-[var(--border)] bg-[var(--surface)] p-3 shadow-2xl">
    <div className="mb-3 flex items-center gap-2 text-[13px] font-medium text-[var(--text)]"><KeyRound size={14} />Sub2API 视频模型连接<button className="ml-auto text-[var(--text-faint)]" onClick={onClose} aria-label="关闭"><X size={14} /></button></div>
    <label className="mb-2 block text-[11px] text-[var(--text-muted)]">服务地址（固定域名 + /v1）<input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://xxx.ngrok-free.dev/v1" className="mt-1 h-8 w-full rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 text-[12px] text-[var(--text)]" /></label>
    <label className="mb-2 block text-[11px] text-[var(--text-muted)]">用户 Key<input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder={configured ? 'Key 已保存，留空保持不变' : '输入 Sub2API 用户 Key'} className="mt-1 h-8 w-full rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 text-[12px] text-[var(--text)]" /></label>
    <label className="mb-3 block text-[11px] text-[var(--text-muted)]">模型<input value={model} onChange={e => setModel(e.target.value)} className="mt-1 h-8 w-full rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 text-[12px] text-[var(--text)]" /></label>
    <div className="flex items-center gap-2"><button disabled={busy} onClick={() => void test()} className="h-8 rounded border border-[var(--border)] px-2 text-[12px] text-[var(--text)] disabled:opacity-50">测试连接</button><button disabled={busy} onClick={() => void save()} className="flex h-8 items-center gap-1 rounded bg-[var(--accent)] px-3 text-[12px] text-white disabled:opacity-50"><Save size={13} />保存</button></div><div className="mt-2 text-[11px] text-[var(--text-muted)]">{message || (configured ? '已保存连接信息' : '尚未配置 Key')}</div>
  </div>;
}
