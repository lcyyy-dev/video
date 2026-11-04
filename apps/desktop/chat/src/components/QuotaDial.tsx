import React from 'react';

/** Read-only: null is unknown, never an exhausted balance. */
export function QuotaDial({ percent = null, message = '暂无额度数据' }: { percent?: number | null; message?: string }) {
  const value = percent != null && Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null;
  const color = value == null ? '#8290a4' : value === 0 ? '#000000' : value >= 50 ? '#ffffff' : value >= 20 ? '#facc15' : '#ef4444';
  return <div className="quota-dial" role="img" aria-label={value == null ? `剩余额度：${message}` : `剩余额度 ${value}%`} style={{ color }}>
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <circle cx="100" cy="100" r="78" fill="none" stroke="currentColor" strokeOpacity="0.08" />
      {Array.from({ length: 60 }, (_, index) => {
        const lit = value != null && index < Math.ceil(value / 100 * 60);
        const tail = lit ? Math.max(0.25, 1 - (Math.ceil(value! / 100 * 60) - index - 1) / 18) : 0.12;
        return <line key={index} x1="100" y1={index % 5 === 0 ? '12' : '16'} x2="100" y2="23" transform={`rotate(${index * 6} 100 100)`} stroke={lit ? 'currentColor' : '#94a3b8'} strokeOpacity={lit ? tail : 0.18} strokeWidth={index % 5 === 0 ? 2.5 : 1.5} strokeLinecap="round" />;
      })}
      {value != null && value > 0 && <circle cx="100" cy="19" r="3.5" transform={`rotate(${value * 3.6} 100 100)`} fill="currentColor" className="quota-dial-head" />}
    </svg>
    <div className="quota-dial-copy"><strong>{value == null ? '—' : `${Math.round(value)}%`}</strong><span>剩余额度</span>{value == null && <small>{message}</small>}</div>
  </div>;
}