import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, FileAudio, Film, Image, Loader2, Plus, Upload } from 'lucide-react';
import SpotlightCard from './react-bits/SpotlightCard';
import { useT } from '@/i18n';
import { filesFromTransfer, transferHasFiles } from '@/lib/composer-attachments';
import type { DesktopAttachment } from '@/lib/desktop-attachments';
import { transferHasStudioRefs } from '@/lib/studio-transfer';

/** A visible entry to the same project import used by the composer, paste and file picker. */
export function MaterialUploadArea({ files, onFiles, onChoose, children }: {
  files: readonly DesktopAttachment[];
  onFiles: (files: File[]) => void;
  onChoose: () => void;
  children?: ReactNode;
}) {
  const t = useT();
  const titleId = useId();
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const importing = files.filter(file => file.state === 'importing').length;
  const failed = files.filter(file => file.state === 'failed').length;
  const ready = files.filter(file => file.state === 'ready').length;
  const accepts = (data: DataTransfer) => transferHasFiles(data) && !transferHasStudioRefs(data);
  const reset = () => { depth.current = 0; setDragging(false); };

  useEffect(() => {
    window.addEventListener('dragend', reset);
    window.addEventListener('drop', reset);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('dragend', reset);
      window.removeEventListener('drop', reset);
      window.removeEventListener('blur', reset);
    };
  }, []);

  const status = importing
    ? t('composer.uploadImporting').replace('{count}', String(importing))
    : failed ? t('composer.uploadFailed').replace('{count}', String(failed))
      : ready ? t('composer.uploadReady').replace('{count}', String(ready)) : '';

  return <section className={`material-upload-area${files.length ? ' has-files' : ''}`} aria-labelledby={titleId}>
    <div className="material-upload-heading">
      <span className="workspace-step-label"><span className="workspace-step-number" aria-hidden="true">01</span><span id={titleId}>{t('composer.uploadTitle')}</span></span>
      <span className="material-upload-formats">{t('composer.uploadFormats')}</span>
    </div>
    <SpotlightCard className="material-upload-spotlight" spotlightColor="var(--accent)" intensity={0.13} borderGlow={0.5} proximity={0} flare={false}>
    <button type="button" className={`material-upload-dropzone${dragging ? ' is-dragging' : ''}`}
      aria-label={t('composer.uploadChoose')} onClick={onChoose}
      onDragEnter={event => {
        if (!accepts(event.dataTransfer)) return;
        event.preventDefault(); event.stopPropagation();
        depth.current += 1; setDragging(true);
      }}
      onDragOver={event => {
        if (!accepts(event.dataTransfer)) return;
        event.preventDefault(); event.stopPropagation();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={event => {
        if (depth.current === 0) return;
        event.stopPropagation();
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={event => {
        if (!accepts(event.dataTransfer)) return;
        event.preventDefault(); event.stopPropagation(); reset();
        onFiles(filesFromTransfer(event.dataTransfer));
      }}>
      <span className="material-upload-art" aria-hidden="true">
        <span className="material-art-card material-art-image"><Image size={19} strokeWidth={1.5} /></span>
        <span className="material-art-card material-art-audio"><FileAudio size={19} strokeWidth={1.5} /></span>
        <span className="material-art-card material-art-video"><Film size={23} strokeWidth={1.5} /><span /><span /></span>
        <span className="material-upload-icon"><Upload size={15} strokeWidth={1.8} /></span>
      </span>
      <span className="material-upload-copy">
        <strong>{t(dragging ? 'composer.uploadDropActive' : 'composer.uploadDrop')}</strong>
        <span>{t('composer.uploadClick')}</span>
      </span>
      <span className="material-upload-action"><Plus size={13} aria-hidden="true" />{t('workspace.chooseFiles')}</span>
    </button>
    </SpotlightCard>
    {children}
    {ready ? <p className="material-upload-guidance">{t('composer.materialDescribeHint')}</p> : null}
    {status ? <p className={`material-upload-status${failed && !importing ? ' is-error' : ''}`} role="status" aria-live="polite">
      {importing ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : !failed ? <CheckCircle2 size={13} aria-hidden="true" /> : null}
      {status}
    </p> : null}
  </section>;
}
