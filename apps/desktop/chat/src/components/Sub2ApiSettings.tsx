import { app } from '../app-bridge';
import { QuotaDial } from './QuotaDial';
import React from 'react';
import { createPortal } from 'react-dom';
import { BadgeCheck, Fingerprint, Pencil } from 'lucide-react';


export function Sub2ApiSettings({ onClose }: { onClose: () => void }) {
  const [profile, setProfile] = React.useState<{ username: string; userId: string } | null>(null);
  const [profileError, setProfileError] = React.useState('');
  const [editing, setEditing] = React.useState(false);
  const [username, setUsername] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  React.useEffect(() => {
    let active = true;
    app.sub2api.profile().then(result => { if (active) setProfile(result); })
      .catch(() => { if (active) setProfileError('用户资料加载失败，请重新打开重试'); });
    return () => { active = false; };
  }, []);
  async function saveUsername(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    const value = username.trim();
    if (!value || [...value].length > 8 || /[\p{C}]/u.test(value)) { setProfileError('用户名需要为 1–8 个字符'); return; }
    setSaving(true); setProfileError('');
    try { setProfile(await app.sub2api.rename(value)); setEditing(false); }
    catch { setProfileError('保存失败，请稍后重试'); }
    finally { setSaving(false); }
  }
  const [quota, setQuota] = React.useState<Awaited<ReturnType<typeof app.sub2api.quota>> | null>(null);
  const [quotaMessage, setQuotaMessage] = React.useState('正在查询额度');
  React.useEffect(() => {
    let active = true;
    app.sub2api.quota().then(result => {
      if (active) { setQuota(result); setQuotaMessage(result.limit === null ? '未设置 Key 总额度' : '暂无额度数据'); }
    }).catch(() => { if (active) setQuotaMessage('额度查询失败，请重新打开重试'); });
    return () => { active = false; };
  }, []);
  const dialog = React.useRef<HTMLDialogElement>(null);
  const entrance = React.useRef<Animation | null>(null);
  const entering = React.useRef(false);
  React.useEffect(() => {
    const card = dialog.current;
    if (!card) return;
    card.showModal();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    entering.current = true;
    entrance.current = card.animate([
      { '--reflect-x': '0%', '--reflect-y': '5%', offset: 0 },
      { '--reflect-x': '100%', '--reflect-y': '85%', offset: 0.65 },
      { '--reflect-x': '30%', '--reflect-y': '10%', offset: 1 },
    ], { duration: 1400, easing: 'ease-in-out' });
    entrance.current.onfinish = () => { entering.current = false; };
    return () => { entering.current = false; entrance.current?.cancel(); };
  }, []);
  return createPortal(<dialog ref={dialog} className="mine-reflective-card" aria-label="我的授权" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }} onPointerLeave={event => { if (entering.current) return; event.currentTarget.style.setProperty('--reflect-x', '30%'); event.currentTarget.style.setProperty('--reflect-y', '10%'); }} onPointerMove={event => { if (entering.current) return; const rect = event.currentTarget.getBoundingClientRect(); event.currentTarget.style.setProperty('--reflect-x', `${Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100))}%`); event.currentTarget.style.setProperty('--reflect-y', `${Math.max(0, Math.min(100, (event.clientY - rect.top) / rect.height * 100))}%`); }}>
    <div className="flex min-h-[440px] flex-col">
      <div className="flex items-center justify-between text-[13px] font-medium">
        <span className="flex items-center gap-2"><BadgeCheck size={16} />已验证</span>
        <span className="flex items-center gap-2 text-[var(--text-muted)]"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Action</span>
      </div>
      <div className="flex flex-1 items-center justify-center py-4"><div className="text-center"><QuotaDial percent={quota?.percent} message={quotaMessage} />{quota?.remaining != null && <p className="text-xs text-[var(--text-muted)]">剩余 ${quota.remaining.toFixed(2)} / ${quota.limit?.toFixed(2)} USD</p>}</div></div>
      <div className="mb-7">
        {editing ? <form onSubmit={saveUsername} className="flex items-center gap-2">
          <input autoFocus aria-label="用户名" value={username} onChange={event => setUsername([...event.target.value].slice(0, 8).join(''))} disabled={saving} className="min-w-0 w-40 rounded border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-lg" />
          <button type="submit" disabled={saving} className="text-sm">{saving ? '保存中' : '保存'}</button>
          <button type="button" disabled={saving} onClick={() => { setEditing(false); setProfileError(''); }} className="text-sm">取消</button>
        </form> : <button type="button" disabled={!profile} aria-label="修改用户名" onClick={() => { setUsername(profile?.username ?? ''); setProfileError(''); setEditing(true); }} className="flex items-center gap-2 text-left">
          <h2 className="text-[26px] font-semibold leading-tight">{profile?.username ?? '—'}</h2><Pencil size={14} className="text-[var(--text-muted)]" />
        </button>}
        {profileError && <p role="alert" className="mt-2 text-xs text-red-400">{profileError}</p>}
        <p className="mt-1 text-[14px] text-[var(--text-muted)]">高级会员</p>
      </div>
      <div className="flex items-end justify-between gap-4">
        <div><p className="mb-1 text-[12px] text-[var(--text-muted)]">ID</p><p className="text-[14px] font-medium tracking-[0.08em]">{profile?.userId ?? '—'}</p></div>
        <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)]" aria-hidden="true"><Fingerprint size={23} strokeWidth={1.5} /></span>
      </div>
    </div>
  </dialog>, document.body);
}
