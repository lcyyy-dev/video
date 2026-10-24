import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Images, Loader2, Maximize2, MessageSquarePlus, Play, Plus, Search, X } from 'lucide-react';
import { useT } from '@/i18n';
import { type DesktopAttachment, formatFileSize } from '@/lib/desktop-attachments';
import { attachmentIcon } from '@/lib/project-resources';
import { filesFromTransfer, isVideoAttachment, transferHasFiles } from '@/lib/composer-attachments';
import { transferHasStudioRefs } from '@/lib/studio-transfer';
import { chatLayer } from '@/lib/chat-layer';

/** Name every file beside its preview and let people reference it without typing a filename. */
export function MaterialAttachmentList({ files, onPreview, onDescribe, onRemove, onChoose, onFiles }: {
  files: readonly DesktopAttachment[];
  onPreview: (file: DesktopAttachment) => void;
  onDescribe: (file: DesktopAttachment) => void;
  onRemove: (id: string) => void;
  onChoose: () => void;
  onFiles: (files: File[]) => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!expanded) return;
    const previous = document.activeElement as HTMLElement | null;
    search.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [expanded]);
  const count = t('composer.materialCount').replace('{count}', String(files.length));
  const needle = query.trim().toLocaleLowerCase();
  const filtered = files.filter(file => !needle || `${file.name} ${t('composer.materialNumber').replace('{number}', String(file.labelNumber))}`.toLocaleLowerCase().includes(needle));
  const describe = (file: DesktopAttachment) => { setExpanded(false); onDescribe(file); };
  const preview = (file: DesktopAttachment) => { setExpanded(false); onPreview(file); };
  const renderFile = (file: DesktopAttachment) => {
      const Icon = attachmentIcon(file);
      const picture = file.kind === 'image' ? file.previewUrl : file.thumb;
      const label = t('composer.materialNumber').replace('{number}', String(file.labelNumber));
      const state = t(file.state === 'importing' ? 'composer.materialImporting' : file.state === 'failed' ? 'composer.materialFailed' : 'composer.materialReady');
      return <li key={file.id} className={`material-file-card${file.state === 'failed' ? ' is-error' : ''}`} data-material-number={file.labelNumber}>
        <button type="button" className="material-file-preview" disabled={!file.previewUrl}
          aria-label={t('composer.openAttachment').replace('{name}', `${label} · ${file.name}`)} onClick={() => preview(file)}>
          {picture ? <img src={picture} alt="" /> : <Icon size={20} aria-hidden="true" />}
          {file.state === 'importing' ? <Loader2 size={15} className="material-file-overlay animate-spin" aria-hidden="true" />
            : isVideoAttachment(file) ? <Play size={13} className="material-file-overlay" aria-hidden="true" /> : null}
        </button>
        <div className="material-file-info">
          <span className="material-file-label">{label}<span>{formatFileSize(file.size)}</span></span>
          <strong title={file.name}>{file.name}</strong>
          <span className={`material-file-state${file.state === 'failed' ? ' is-error' : ''}`} title={file.error}>{state}</span>
        </div>
        <button type="button" className="material-file-describe" disabled={file.state !== 'ready' || !file.path}
          aria-label={t('composer.materialDescribeLabel').replace('{name}', `${label} · ${file.name}`)}
          title={file.state === 'importing' ? t('composer.materialDescribeWait') : undefined}
          onClick={() => describe(file)}><MessageSquarePlus size={13} aria-hidden="true" />{t('composer.materialDescribe')}</button>
        <button type="button" className="material-file-remove" aria-label={t('composer.materialRemove').replace('{name}', `${label} · ${file.name}`)}
          onClick={() => onRemove(file.id)}><X size={14} aria-hidden="true" /></button>
      </li>;
  };
  return <div className="material-browser">
    <div className="material-browser-toolbar">
      <span>{count}</span>
      <button type="button" className="material-expand-button" onClick={() => { setQuery(''); setExpanded(true); }}>
        <Maximize2 size={13} aria-hidden="true" />{files.length > 4 ? t('composer.materialMore').replace('{count}', String(files.length)) : t('composer.materialExpand')}
      </button>
    </div>
    <ul className="material-upload-files material-file-list material-inline-grid" aria-label={t('composer.materialList')}>
      {files.slice(0, 4).map(renderFile)}
    </ul>
    {expanded ? createPortal(<div className="material-library-backdrop" onMouseDown={event => { if (event.currentTarget === event.target) setExpanded(false); }}>
      <div ref={panel} className="material-library-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}
        onDragOver={event => { if (transferHasFiles(event.dataTransfer) && !transferHasStudioRefs(event.dataTransfer)) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy'; } }}
        onDrop={event => { if (transferHasFiles(event.dataTransfer) && !transferHasStudioRefs(event.dataTransfer)) { event.preventDefault(); event.stopPropagation(); onFiles(filesFromTransfer(event.dataTransfer)); } }}
        onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setExpanded(false); }
          if (event.key === 'Tab') {
            const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? []);
            const first = controls[0], last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }
        }}>
        <header className="material-library-header">
          <span className="material-library-emblem" aria-hidden="true"><Images size={22} strokeWidth={1.5} /></span>
          <div><h2 id={titleId}>{t('composer.materialLibrary')}</h2><p>{t('composer.materialLibraryHint')}</p></div>
          <button type="button" className="material-library-close" aria-label={t('composer.materialLibraryClose')} onClick={() => setExpanded(false)}><X size={19} /></button>
        </header>
        <div className="material-library-tools">
          <label className="material-library-search"><Search size={16} aria-hidden="true" /><input ref={search} value={query} onChange={event => setQuery(event.target.value)} aria-label={t('composer.materialSearch')} placeholder={t('composer.materialSearch')} /></label>
          <span>{count}</span>
          <button type="button" className="material-library-add" onClick={onChoose}><Plus size={15} />{t('composer.materialAddMore')}</button>
        </div>
        <div className="material-library-content">
          {filtered.length ? <ul className="material-file-list material-library-grid" aria-label={t('composer.materialList')}>{filtered.map(renderFile)}</ul>
            : <p className="material-library-empty" role="status">{t('composer.materialNoResults')}</p>}
        </div>
      </div>
    </div>, chatLayer()) : null}
  </div>;
}
