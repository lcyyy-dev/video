/** Advertising entry points. A suggestion fills the composer without starting generation. */
import type { CSSProperties } from 'react';
import { ArrowUpRight, Dumbbell, Scissors, ShoppingBag, Store } from 'lucide-react';
import { useT } from '@/i18n';
import SpotlightCard from './react-bits/SpotlightCard';
import { BrandLogo } from './BrandLogo';

const STARTERS = [
  { id: 's1', icon: Store },
  { id: 's3', icon: ShoppingBag },
  { id: 's13', icon: Dumbbell },
  { id: 's4', icon: Scissors },
] as const;

export function ProjectStarters({ onPick }: {
  onPick: (text: string) => void;
}) {
  const t = useT();
  return (
    <div className="starter-welcome mx-auto w-full max-w-[400px] py-2">
      <div className="starter-emblem" aria-hidden="true">
        <span className="starter-orbit" />
        <span className="starter-emblem-core"><BrandLogo size={30} /></span>
      </div>
      <h2 className="starter-heading mt-4 text-[20px] font-semibold tracking-[-0.02em] text-[var(--text)]">{t('starter.title')}</h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--text-muted)]">{t('starter.hint')}</p>
      <p className="mt-5 text-[12px] text-[var(--text-faint)]">{t('starter.tryLabel')}</p>
      <ul className="mt-3 flex flex-col gap-2">
        {STARTERS.map(({ id, icon: Icon }, index) => (
          <li key={id} className="starter-entry" style={{ '--entry-index': index } as CSSProperties}>
            <SpotlightCard className="starter-card" spotlightColor="var(--accent)" intensity={0.12} borderGlow={0.35} proximity={30} spotlightSize={180}>
            <button type="button" onClick={() => onPick(t(`starter.${id}`))}
              className="starter-spotlight group flex w-full items-center gap-3 rounded-xl px-4 py-3.5 text-left text-[13.5px] leading-snug text-[var(--text)] transition hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]">
              <Icon aria-hidden size={15} strokeWidth={1.8} className="starter-icon shrink-0" />
              <span className="min-w-0 flex-1">{t(`starter.${id}`)}</span>
              <ArrowUpRight size={14} className="starter-arrow shrink-0 text-[var(--text-faint)]" />
            </button>
            </SpotlightCard>
          </li>
        ))}
      </ul>
    </div>
  );
}
