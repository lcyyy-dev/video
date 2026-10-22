/** Advertising entry points. A suggestion fills the composer without starting generation. */
import { ArrowUpRight, Dumbbell, Scissors, ShoppingBag, Store, Upload } from 'lucide-react';
import { useT } from '@/i18n';
import { BrandLogo } from './BrandLogo';

const STARTERS = [
  { id: 's1', icon: Store },
  { id: 's3', icon: ShoppingBag },
  { id: 's13', icon: Dumbbell },
  { id: 's4', icon: Scissors },
] as const;

export function ProjectStarters({ onPick, onAttach }: {
  onPick: (text: string) => void;
  onAttach: () => void;
}) {
  const t = useT();
  return (
    <div className="mx-auto w-full max-w-[400px] py-2">
      <BrandLogo size={26} />
      <h2 className="mt-4 text-[20px] font-semibold tracking-[-0.02em] text-[var(--text)]">{t('starter.title')}</h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--text-muted)]">{t('starter.hint')}</p>
      <p className="mt-5 text-[12px] text-[var(--text-faint)]">{t('starter.tryLabel')}</p>
      <ul className="mt-2 flex flex-col gap-1.5">
        {STARTERS.map(({ id, icon: Icon }) => (
          <li key={id}>
            <button type="button" onClick={() => onPick(t(`starter.${id}`))}
              className="group flex w-full items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-left text-[13.5px] leading-snug text-[var(--text)] transition hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]">
              <Icon aria-hidden size={15} strokeWidth={1.8} className="shrink-0" />
              <span className="min-w-0 flex-1">{t(`starter.${id}`)}</span>
              <ArrowUpRight size={14} className="shrink-0 text-[var(--text-faint)]" />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onAttach}
        className="mt-4 inline-flex items-center gap-1.5 rounded-lg px-1 py-1 text-[12.5px] text-[var(--text-muted)] transition hover:text-[var(--text)]">
        <Upload size={14} />{t('starter.attach')}
      </button>
    </div>
  );
}
