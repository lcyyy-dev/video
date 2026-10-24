import React from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Clapperboard, FolderOpen, Loader2, X } from 'lucide-react';
import { api, projectEvents } from '@/api';
import { useT } from '@/i18n';
import { studioHost } from '@/lib/host';
import { cancelExport, jobIsActive, listExports, revealExport, startExports, type ExportJob } from '@/lib/export-jobs';
import styles from './JianyingExportDialog.module.css';

/** A direct, folder-first export of the editable timeline, with no video-format choices. */
export function JianyingExportDialog({ open, onClose, projectId, title, durationMs, fps, missingFiles, beforeExport, onQueued }: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  title: string;
  durationMs: number;
  fps: number;
  missingFiles: readonly string[];
  beforeExport: () => Promise<unknown>;
  onQueued: (jobs: ExportJob[]) => void;
}) {
  const t = useT();
  const panel = React.useRef<HTMLDivElement>(null);
  const [folder, setFolder] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [picking, setPicking] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState('');
  const [job, setJob] = React.useState<ExportJob | null>(null);
  const active = Boolean(job && jobIsActive(job));
  const disabled = loading || picking || submitting || active;

  React.useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true); setError(''); setJob(null); setFolder('');
    void Promise.all([api.prefs(), listExports(projectId)]).then(([prefs, exports]) => {
      if (live) setFolder(prefs.draftExportFolder || exports.draftFolders?.jianying || exports.folder);
    }).catch(() => { if (live) setError(t('draftExport.loadFailed')); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [open, projectId, t]);

  React.useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => { previous?.focus(); };
  }, [open]);

  React.useEffect(() => {
    if (!open || !job || !jobIsActive(job)) return;
    let live = true;
    const id = job.id;
    const apply = (next: ExportJob) => {
      if (live) setJob(current => current?.id === id && jobIsActive(current) ? next : current);
    };
    const refresh = () => { void listExports(projectId).then(result => {
      const found = result.exports.find(entry => entry.id === id);
      if (found) apply(found);
      else apply({ ...job, status: 'failed', error: t('draftExport.interrupted'), finishedAt: Date.now() });
    }).catch(() => {}); };
    const stop = projectEvents(projectId, event => { if (event.type === 'export' && event.job.id === id) apply(event.job); });
    refresh();
    const timer = setInterval(refresh, 1500);
    return () => { live = false; clearInterval(timer); stop(); };
  }, [open, projectId, job?.id, active, t]); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseFolder = async () => {
    if (disabled) return;
    setPicking(true); setError('');
    try {
      const selected = await studioHost?.folders?.pick({ title: t('draftExport.chooseTitle'), button: t('draftExport.choose'), at: folder || undefined });
      if (selected) setFolder(selected);
      else if (!studioHost?.folders?.pick) setError(t('draftExport.pickerUnavailable'));
    } catch { setError(t('draftExport.pickerUnavailable')); }
    finally { setPicking(false); }
  };

  const start = async () => {
    if (disabled || !folder.trim() || durationMs <= 0 || missingFiles.length) return;
    setSubmitting(true); setError(''); setJob(null);
    try {
      // Stored in the native engine's prefs.json, independent of window address or browser storage.
      const prefs = await api.setPrefs({ draftExportFolder: folder.trim() });
      const selected = prefs.draftExportFolder;
      if (!selected) throw new Error(t('draftExport.invalidFolder'));
      setFolder(selected);
      await beforeExport();
      const queued = await startExports(projectId, [{
        kind: 'nle', format: 'jianying', fps, audio: 'clips', media: 'copy', subtitles: true, label: t('draftExport.title'),
      }], selected);
      setJob(queued[0] ?? null);
      onQueued(queued);
    } catch (cause) {
      setError(cause instanceof Error ? `${t('draftExport.startFailed')} ${cause.message}` : t('draftExport.startFailed'));
    } finally { setSubmitting(false); }
  };

  if (!open) return null;
  const reason = durationMs <= 0 ? t('draftExport.emptyFilm') : missingFiles.length
    ? t('draftExport.missingFiles').replace('{files}', missingFiles.slice(0, 3).map(file => file.split(/[\\/]/).pop()).join('、')) : '';
  const progress = Math.max(0, Math.min(100, Math.round((job?.progress ?? 0) * 100)));
  const outputFolder = job?.outputs[0]?.replace(/[\\/][^\\/]+$/, '') ?? '';

  return createPortal(<div className={styles.backdrop} onMouseDown={event => { if (event.target === event.currentTarget && !submitting && !picking) onClose(); }}>
    <div ref={panel} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="jianying-export-title" tabIndex={-1}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!submitting && !picking) onClose(); }
        if (event.key === 'Tab') {
          const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? []);
          const first = controls[0], last = controls.at(-1);
          if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <header className={styles.header}>
        <span className={styles.emblem}><Clapperboard size={22} aria-hidden="true" /></span>
        <div><h2 id="jianying-export-title">{t('draftExport.title')}</h2><p>{title}</p></div>
        <button type="button" className={styles.close} aria-label={t('draftExport.close')} disabled={submitting || picking} onClick={onClose}><X size={18} /></button>
      </header>
      <div className={styles.body}>
        <p className={styles.description}>{t('draftExport.description')}</p>
        <label className={styles.label} htmlFor="jianying-export-folder">{t('draftExport.folder')}</label>
        <div className={styles.folderRow}>
          <input id="jianying-export-folder" value={folder} disabled={disabled} spellCheck={false} placeholder={loading ? t('draftExport.loading') : t('draftExport.folderPlaceholder')}
            onChange={event => { setFolder(event.target.value); setError(''); }} />
          <button type="button" disabled={disabled} onClick={() => void chooseFolder()}><FolderOpen size={15} />{t(picking ? 'draftExport.choosing' : 'draftExport.choose')}</button>
        </div>
        <p className={styles.hint}>{t('draftExport.rememberFolder')}</p>
        <p className={styles.note}>{t('draftExport.note')}</p>
        {reason ? <p className={styles.error} role="status">{reason}</p> : null}
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        {active ? <div className={styles.result} role="status">
          <p><Loader2 size={15} className={styles.spinner} />{t(job?.cancelling ? 'draftExport.cancelling' : 'draftExport.exporting')}<strong>{progress}%</strong></p>
          <progress max={100} value={progress} aria-label={t('draftExport.progress')} />
          <span>{t('draftExport.background')}</span>
        </div> : job?.status === 'done' ? <div className={styles.result} role="status">
          <p><CheckCircle2 size={17} />{t('draftExport.completed')}</p>
          <span>{t('draftExport.outputFolder')}</span><code className={styles.path}>{outputFolder}</code>
          <button type="button" onClick={() => { void revealExport(projectId, job.id).catch(() => setError(t('draftExport.openFailed'))); }}><FolderOpen size={14} />{t('draftExport.openFolder')}</button>
        </div> : job?.status === 'failed' ? <div className={styles.error} role="alert">
          <p>{t('draftExport.failed')}</p><details><summary>{t('draftExport.details')}</summary>{job.error}</details>
        </div> : job?.status === 'cancelled' ? <p role="status">{t('draftExport.cancelled')}</p> : null}
      </div>
      <footer className={styles.footer}>
        <button type="button" disabled={submitting || picking} onClick={onClose}>{t('draftExport.close')}</button>
        {active && job ? <button type="button" disabled={job.cancelling} onClick={() => {
          setJob(current => current && jobIsActive(current) ? { ...current, cancelling: true } : current);
          void cancelExport(projectId, job.id).catch(() => { setError(t('draftExport.cancelFailed')); setJob(current => current ? { ...current, cancelling: false } : current); });
        }}>{t('draftExport.cancel')}</button> : <button type="button" className={styles.primary} disabled={disabled || !folder.trim() || Boolean(reason)} onClick={() => void start()}>
          {submitting ? <Loader2 size={15} className={styles.spinner} /> : <Clapperboard size={15} />}{t(submitting ? 'draftExport.starting' : job ? 'draftExport.exportAgain' : 'draftExport.start')}
        </button>}
      </footer>
    </div>
  </div>, document.body);
}
