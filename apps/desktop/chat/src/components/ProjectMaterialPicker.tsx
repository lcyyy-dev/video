import { useEffect, useState } from 'react';
import { Check, FileAudio, FileText, Film, Image, X } from 'lucide-react';
import { app } from '@/app-bridge';

type Material = { path: string; kind: string; size: number };
const icon = (kind: string) => kind === 'video' ? <Film size={15} /> : kind === 'image' ? <Image size={15} /> : kind === 'audio' ? <FileAudio size={15} /> : <FileText size={15} />;

export function ProjectMaterialPicker({ onPick, onClose }: { onPick: (files: Material[]) => void; onClose: () => void }) {
  const [files, setFiles] = useState<Material[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { let live = true; void app.projectFiles().then((listing) => {
    if (!live) return;
    setFiles([...listing.files, ...(listing.pages ?? []).map((page) => ({ ...page, kind: 'page' }))].filter((file) => file.path.startsWith('assets/')));
    setLoading(false);
  }).catch(() => { if (live) setLoading(false); }); return () => { live = false; }; }, []);
  const toggle = (path: string) => setSelected((list) => list.includes(path) ? list.filter((item) => item !== path) : [...list, path]);
  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-5" role="dialog" aria-modal="true" aria-label="选择项目素材">
    <div className="flex max-h-[min(680px,85vh)] w-[min(620px,calc(100vw-40px))] flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3"><strong className="text-sm">选择项目素材</strong><button type="button" onClick={onClose} className="rounded p-1 text-[var(--text-muted)] hover:bg-[var(--bg-hover)]"><X size={16} /></button></div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{loading ? <p className="p-5 text-center text-sm text-[var(--text-muted)]">正在读取项目素材…</p> : files.length ? <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">{files.map((file) => { const picked = selected.includes(file.path); return <button key={file.path} type="button" onClick={() => toggle(file.path)} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition ${picked ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border)] hover:bg-[var(--bg-hover)]'}`}><span className="text-[var(--accent)]">{icon(file.kind)}</span><span className="min-w-0 flex-1 truncate">{file.path}</span>{picked ? <Check size={14} className="shrink-0 text-[var(--accent)]" /> : null}</button>; })}</div> : <p className="p-5 text-center text-sm text-[var(--text-muted)]">项目素材区暂无文件</p>}</div>
      <div className="flex justify-end gap-2 border-t border-[var(--border)] px-4 py-3"><button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs hover:bg-[var(--bg-hover)]">取消</button><button type="button" disabled={!selected.length} onClick={() => { onPick(files.filter((file) => selected.includes(file.path))); onClose(); }} className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs text-white disabled:opacity-40">添加到对话{selected.length ? `（${selected.length}）` : ''}</button></div>
    </div>
  </div>;
}
