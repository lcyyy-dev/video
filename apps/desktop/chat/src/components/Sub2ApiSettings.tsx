import { QuotaDial } from './QuotaDial';
import React from 'react';
import { createPortal } from 'react-dom';
import { BadgeCheck, Fingerprint } from 'lucide-react';


export function Sub2ApiSettings({ onClose }: { onClose: () => void }) {
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
      <div className="flex flex-1 items-center justify-center py-4"><QuotaDial /></div>
      <div className="mb-7">
        <h2 className="text-[26px] font-semibold leading-tight">xxx</h2>
        <p className="mt-1 text-[14px] text-[var(--text-muted)]">高级会员</p>
      </div>
      <div className="flex items-end justify-between gap-4">
        <div><p className="mb-1 text-[12px] text-[var(--text-muted)]">ID</p><p className="text-[14px] font-medium tracking-[0.08em]">0406 2003 0001</p></div>
        <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-muted)]" aria-hidden="true"><Fingerprint size={23} strokeWidth={1.5} /></span>
      </div>
    </div>
  </dialog>, document.body);
}
