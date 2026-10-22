/** Browse local project folders and relocate projects whose folders moved. */
import React from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp, ChevronRight, Clapperboard, Clock3, Folder, Loader2, X } from 'lucide-react';
import { useT } from '@/i18n';
import { SourceError, pathCrumbs, sourcesApi, type BrowseListing } from '@/lib/project-sources';
import { CardButton } from './Card';

/** A dialog over the Projects window: a card in the middle; Escape and a click outside close it (not the window). */
function SourceDialog({
  label,
  width,
  onClose,
  closeOnOutside = true,
  children,
}: {
  label: string;
  width: number;
  onClose: () => void;
  /** false: a click outside does nothing (a download running is not stopped by a stray click) */
  closeOnOutside?: boolean;
  children: React.ReactNode;
}) {
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      /* this Escape closes the dialog, not the Projects window under it */
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return createPortal(
    <div
      role="dialog"
      aria-modal
      aria-label={label}
      className="fixed inset-0 z-[10100] flex items-center justify-center bg-black/35 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => { if (closeOnOutside && event.target === event.currentTarget) onClose(); }}
    >
      <div
        className="flex max-h-[calc(100vh-48px)] w-full flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)]"
        style={{ maxWidth: width, animation: 'openfilm-pop 0.16s ease-out both' }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

function DialogHead({ title, subtitle, onClose }: { title: string; subtitle?: string; onClose: () => void }) {
  const t = useT();
  return (
    <div className="flex items-start gap-3 px-5 pb-3 pt-5">
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-semibold text-[var(--text)]">{title}</p>
        {subtitle ? <p className="mt-0.5 truncate text-[12.5px] text-[var(--text-muted)]">{subtitle}</p> : null}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label={t('confirm.cancel')}
        className="-mr-1.5 -mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
      >
        <X size={15} />
      </button>
    </div>
  );
}

/**
 * The folders under the home folder, to pick one: places on the left (home, the library, the usual folders, where
 * recent projects are), the folder's folders on the right (a film folder marked, with its own Open), the path above
 * (typed and Enter to go there; Open opens what is typed, even outside the home folder).
 *
 * `mode` 'open': any folder (one without a film is offered as a new film there); 'locate': a folder with a film, for a
 * project whose folder moved. `onPick` resolves when done (the caller closes the dialog) or throws what to say.
 */
export function FolderBrowserDialog({
  mode,
  title,
  subtitle,
  onPick,
  onClose,
}: {
  mode: 'open' | 'locate';
  title: string;
  subtitle?: string;
  /** `start`: the person chose to start a film in a folder without one */
  onPick: (path: string, start: boolean) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const [listing, setListing] = React.useState<BrowseListing | null>(null);
  const [typed, setTyped] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const asked = React.useRef(0);

  const go = React.useCallback(async (path?: string | null) => {
    const ask = ++asked.current;
    try {
      const next = await sourcesApi.browse(path);
      if (ask !== asked.current) return;
      setListing(next);
      setTyped(next.path);
      setError(null);
    } catch (e) {
      if (ask !== asked.current) return;
      const code = e instanceof SourceError ? e.code : null;
      const key = code === 'outside' ? 'outside' : code === 'denied' ? 'denied' : code === 'not-found' ? 'notFound' : code === 'file' ? 'file' : null;
      setError(key ? t(`projects.browse.error.${key}`) : e instanceof Error ? e.message : String(e));
    }
  }, [t]);
  React.useEffect(() => { void go(null); }, [go]);

  async function pick(path: string, start: boolean) {
    if (busy || !path.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onPick(path.trim(), start);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const here = listing && typed.trim() === listing.path ? listing : null;
  /* the home folder itself is never a project (the server refuses it too): only a folder in it */
  const atHome = here != null && here.path === here.root;
  const crumbs = listing ? pathCrumbs(listing.path, listing.root, t('projects.browse.place.home')) : [];
  const action = mode === 'locate'
    /* a typed path the browser cannot show (outside the home folder) is still used: the server checks it */
    ? { label: t('projects.browse.useFolder'), disabled: here ? !here.film : !typed.trim(), start: false }
    : here && !here.film ? { label: t('projects.browse.startHere'), disabled: atHome, start: true } : { label: t('projects.browse.open'), disabled: !typed.trim() || atHome, start: false };
  const status = !here || atHome ? null : here.film ? t('projects.browse.hasFilm') : mode === 'locate' ? t('projects.browse.locateNoFilm') : t('projects.browse.noFilm');
  const place = (id: string) => t(`projects.browse.place.${id}`);
  const lastName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  const side = (active: boolean) => `flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition ${
    active ? 'bg-[var(--bg-active)] text-[var(--text)]' : 'text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'
  }`;

  return (
    <SourceDialog label={title} width={720} onClose={onClose}>
      <DialogHead title={title} subtitle={subtitle} onClose={onClose} />
      <form
        className="flex items-center gap-2 px-5 pb-3"
        onSubmit={(event) => { event.preventDefault(); void go(typed.trim()); }}
      >
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t('projects.browse.pathLabel')}</span>
          <input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            spellCheck={false}
            autoComplete="off"
            className="h-8 w-full rounded-lg bg-[var(--surface-2)] px-3 font-mono text-[12px] text-[var(--text)] outline-none focus:ring-1 focus:ring-[var(--border-strong)]"
          />
        </label>
        <CardButton type="submit" weight="secondary">{t('projects.browse.go')}</CardButton>
      </form>
      {/* a steady height, however many folders there are (not flex-1: in a column of auto height it would collapse) */}
      <div className="flex min-h-0 shrink border-y border-[var(--border-soft)]" style={{ height: 'min(380px, 56vh)' }}>
        <nav className="w-[168px] shrink-0 overflow-y-auto border-r border-[var(--border-soft)] p-2" aria-label={t('projects.browse.places')}>
          <p className="px-2.5 pb-1 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--text-faint)]">{t('projects.browse.places')}</p>
          {listing?.places.map((p) => (
            <button key={p.path} type="button" onClick={() => void go(p.path)} className={side(listing.path === p.path)} title={p.path}>
              <Folder size={14} className="shrink-0" />
              <span className="truncate">{place(p.id)}</span>
            </button>
          ))}
          {listing?.recent.length ? (
            <>
              <p className="px-2.5 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-[var(--text-faint)]">{t('projects.browse.recent')}</p>
              {listing.recent.map((path) => (
                <button key={path} type="button" onClick={() => void go(path)} className={side(listing.path === path)} title={path}>
                  <Clock3 size={14} className="shrink-0" />
                  <span className="truncate">{lastName(path)}</span>
                </button>
              ))}
            </>
          ) : null}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1 px-3 py-2">
            <button
              type="button"
              onClick={() => listing?.parent && void go(listing.parent)}
              disabled={!listing?.parent}
              aria-label={t('projects.browse.up')}
              title={t('projects.browse.up')}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-35"
            >
              <ArrowUp size={14} />
            </button>
            <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden text-[12.5px]">
              {crumbs.map((crumb, i) => (
                <React.Fragment key={crumb.path}>
                  {i > 0 ? <ChevronRight size={12} className="shrink-0 text-[var(--text-faint)]" /> : null}
                  <button
                    type="button"
                    onClick={() => void go(crumb.path)}
                    className={`truncate rounded px-1 py-0.5 transition hover:bg-[var(--bg-hover)] ${i === crumbs.length - 1 ? 'font-semibold text-[var(--text)]' : 'text-[var(--text-muted)]'}`}
                  >
                    {crumb.name}
                  </button>
                </React.Fragment>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {!listing ? (
              <div className="flex h-full items-center justify-center text-[var(--text-muted)]"><Loader2 size={16} className="animate-spin" /></div>
            ) : listing.folders.length === 0 ? (
              <div className="flex h-full items-center justify-center text-[12.5px] text-[var(--text-faint)]">{t('projects.browse.empty')}</div>
            ) : (
              listing.folders.map((folder) => (
                <div key={folder.path} className="group flex items-center gap-2 rounded-lg pr-1.5 transition hover:bg-[var(--bg-hover)]">
                  <button type="button" onClick={() => void go(folder.path)} className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-1.5 text-left">
                    {folder.film ? <Clapperboard size={15} className="shrink-0 text-[var(--accent)]" /> : <Folder size={15} className="shrink-0 text-[var(--text-faint)]" />}
                    <span className="truncate text-[13px] text-[var(--text)]">{folder.name}</span>
                    {folder.film ? (
                      <span className="shrink-0 rounded-full border border-[var(--border)] px-1.5 text-[10.5px] font-medium text-[var(--text-muted)]">{t('projects.browse.film')}</span>
                    ) : null}
                  </button>
                  {folder.film ? (
                    <CardButton weight="secondary" disabled={busy} onClick={() => void pick(folder.path, false)} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100">
                      {mode === 'locate' ? t('projects.browse.useFolder') : t('projects.browse.open')}
                    </CardButton>
                  ) : (
                    <ChevronRight size={14} className="shrink-0 text-[var(--text-faint)]" />
                  )}
                </div>
              ))
            )}
            {listing?.more ? <p className="px-2.5 py-2 text-[11.5px] text-[var(--text-faint)]">{t('projects.browse.more')}</p> : null}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 px-5 py-3">
        <p role={error ? 'alert' : undefined} className={`min-w-0 flex-1 text-[12px] leading-snug ${error ? 'text-[var(--err)]' : 'text-[var(--text-muted)]'}`}>
          {error ?? status}
        </p>
        <CardButton weight="quiet" onClick={onClose}>{t('confirm.cancel')}</CardButton>
        <CardButton weight="primary" disabled={action.disabled || busy} onClick={() => void pick(typed, action.start)}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : null}
          {action.label}
        </CardButton>
      </div>
    </SourceDialog>
  );
}
