import React from 'react';
import { applyTextStyle, type TextStylePreset, type TextStyle } from 'openfilm/text-styles';
import { mountTextPage } from 'openfilm/text-page';
import { useT } from '@/i18n';
import { SettingsPage, SettingsSegmented } from './ui';
import { api, type TextStyleCollection } from '@/api';
import { useInstalledFonts } from '@/lib/use-fonts';

const WIDTH = 1080;
const HEIGHT = 420;

/** A view of the same text page that is saved in an edit and recognized by the native draft exporter. */
function StylePreview({ preset, text, light, title }: { preset: TextStylePreset; text: string; light: boolean; title: string }) {
  const container = React.useRef<HTMLDivElement>(null);
  const content = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState(0);
  React.useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  React.useEffect(() => {
    const element = content.current;
    if (!element) return;
    mountTextPage({ version: 1, width: WIDTH, height: HEIGHT, duration: 1,
      texts: [applyTextStyle({ text, x: WIDTH / 2, y: HEIGHT / 2, width: 960, align: 'center', fontSize: 64 },
        { ...preset, name: preset.name.trim() || 'Preview' })] }, element);
    return () => element.replaceChildren();
  }, [preset, text]);
  return (
    <div ref={container} className="relative overflow-hidden rounded-lg" style={{ aspectRatio: `${WIDTH}/${HEIGHT}`,
      background: light ? 'linear-gradient(135deg, #cbd5d1, #f4eee3)' : 'linear-gradient(135deg, #152a25, #25394c)' }}>
      <div ref={content} role="img" aria-label={title} data-style-preview=""
        className="pointer-events-none absolute left-0 top-0 origin-top-left"
        style={{ width: WIDTH, height: HEIGHT, transform: `scale(${width / WIDTH})` }} />
    </div>
  );
}

const FIELD = 'w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[13px] text-[var(--text)]';

export function TextStylesSection() {
  React.useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/api/text-styles/fonts.css';
    document.head.append(link);
    return () => link.remove();
  }, []);
  const t = useT();
  const fonts = useInstalledFonts();
  const sample = t('settings.textStyles.sample');
  const [library, setLibrary] = React.useState<TextStyleCollection | null>(null);
  const [draft, setDraft] = React.useState<TextStylePreset | null>(null);
  const [text, setText] = React.useState('');
  const [background, setBackground] = React.useState<'dark' | 'light'>('dark');
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [reload, setReload] = React.useState(0);
  const nameOf = (preset: TextStylePreset, data = library) => {
    const key = `settings.textStyles.names.${preset.id}`;
    return data?.builtinIds.includes(preset.id) && t(key) !== key ? t(key) : preset.name;
  };
  const choose = (preset: TextStylePreset, data = library) => {
    setDraft({ ...structuredClone(preset), name: nameOf(preset, data) });
    setError(''); setNotice('');
  };
  React.useEffect(() => {
    let alive = true;
    api.textStyles().then((data) => {
      if (!alive) return;
      setLibrary(data);
      choose(data.presets.find((preset) => preset.id === data.defaultId)!, data);
    }, (err: Error) => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, [reload]);
  const original = library?.presets.find((preset) => preset.id === draft?.id);
  const dirty = !!(draft && original && (JSON.stringify(draft.style) !== JSON.stringify(original.style) || draft.name !== nameOf(original)));
  const custom = !!(draft && library && !library.builtinIds.includes(draft.id));
  const patch = (style: Partial<TextStyle>) => { setDraft((current) => current ? { ...current, style: { ...current.style, ...style } } : null); setNotice(''); };
  const action = async (work: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  const save = (copy: boolean) => action(async () => {
    if (!draft) return;
    const result = await api.saveTextStyle({ name: draft.name, style: draft.style, version: draft.version }, copy ? undefined : draft.id);
    setLibrary(result.library); choose(result.preset, result.library); setNotice(t('settings.textStyles.saved'));
  });
  const number = (label: string, value: number, update: (value: number) => void, min: number, max: number, step = 1) => (
    <label className="flex flex-col gap-1 text-[12px] text-[var(--text-muted)]">{label}
      <input type="number" aria-label={label} className={FIELD} value={value} min={min} max={max} step={step}
        onChange={(event) => { const n = Number(event.target.value); if (Number.isFinite(n) && n >= min && n <= max) update(n); }} />
    </label>
  );
  const color = (label: string, value: string, update: (value: string) => void) => (
    <label className="flex items-center justify-between gap-2 text-[13px] text-[var(--text-muted)]">{label}
      <input type="color" aria-label={label} value={value} onChange={(event) => update(event.target.value)} className="h-8 w-12 cursor-pointer rounded border border-[var(--border)]" />
    </label>
  );
  return (
    <SettingsPage note={t('settings.textStyles.intro')}>
      {error && <div className="mb-3"><p role="alert" className="text-[13px] text-[var(--err)]">{error}</p>
        <button type="button" className="mt-2 text-[13px] underline" onClick={() => { setError(''); setReload((value) => value + 1); }}>{t('settings.textStyles.reload')}</button></div>}
      {!library || !draft ? <p className="text-[var(--text-muted)]">{t('settings.textStyles.loading')}</p> : <>
        <label className="mb-4 flex flex-col gap-2 text-[14px] text-[var(--text)]">{t('settings.textStyles.preset')}
          <select aria-label={t('settings.textStyles.preset')} className={FIELD} disabled={busy} value={draft.id}
            onChange={(event) => choose(library.presets.find((preset) => preset.id === event.target.value)!)}>
            {library.presets.map((preset) => <option key={preset.id} value={preset.id}>{nameOf(preset)}{preset.id === library.defaultId ? ` · ${t('settings.textStyles.default')}` : ''}</option>)}
          </select>
        </label>
        <label htmlFor="text-style-preview" className="mb-2 text-[14px] text-[var(--text)]">{t('settings.textStyles.previewText')}</label>
        <textarea id="text-style-preview" value={text} onChange={(event) => setText(event.target.value)} rows={2} maxLength={100}
          placeholder={sample} className={`${FIELD} mb-4 resize-y`} />
        <div className="mb-4 flex items-center justify-between gap-3">
          <span className="text-[13px] text-[var(--text-muted)]">{t('settings.textStyles.background')}</span>
          <SettingsSegmented<'dark' | 'light'> label={t('settings.textStyles.background')} value={background} onChange={setBackground}
            options={[{ value: 'dark', label: t('settings.textStyles.dark') }, { value: 'light', label: t('settings.textStyles.light') }]} />
        </div>
        <div data-text-style={draft.id} className="mb-5"><StylePreview preset={draft} text={text.trim() ? text : sample} light={background === 'light'} title={draft.name} /></div>
        <fieldset disabled={busy} className="flex flex-col gap-4 disabled:opacity-60">
          <label className="flex flex-col gap-1 text-[12px] text-[var(--text-muted)]">{t('settings.textStyles.name')}
            <input aria-label={t('settings.textStyles.name')} className={FIELD} maxLength={80} value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-[12px] text-[var(--text-muted)]">{t('settings.textStyles.font')}
              <input aria-label={t('settings.textStyles.font')} list="text-style-fonts" className={FIELD} value={draft.style.fontFamily ?? 'sans-serif'}
                onChange={(event) => patch({ fontFamily: event.target.value, fontPath: undefined })} />
              <datalist id="text-style-fonts">{(fonts ?? []).map((font) => <option key={font.family} value={font.family} />)}</datalist>
            </label>
            {number(t('settings.textStyles.size'), draft.style.fontSize, (fontSize) => patch({ fontSize }), 1, 500)}
          </div>
          <label className="flex flex-col gap-1 text-[12px] text-[var(--text-muted)]">{t('settings.textStyles.fontPath')}
            <input aria-label={t('settings.textStyles.fontPath')} className={FIELD} value={draft.style.fontPath ?? ''}
              onChange={(event) => patch({ fontPath: event.target.value || undefined })} />
          </label>
          <div className="flex flex-wrap items-center gap-5">
            {(['bold', 'italic', 'underline'] as const).map((key) => <label key={key} className="flex items-center gap-2 text-[13px] text-[var(--text)]">
              <input type="checkbox" checked={draft.style[key] ?? false} onChange={(event) => patch({ [key]: event.target.checked })} />{t(`settings.textStyles.${key}`)}
            </label>)}
          </div>
          {color(t('settings.textStyles.fill'), draft.style.color ?? '#ffffff', (color) => patch({ color }))}
          <section className="rounded-lg border border-[var(--border)] p-3">
            <label className="flex items-center gap-2 text-[14px] text-[var(--text)]"><input type="checkbox" checked={!!draft.style.stroke}
              onChange={(event) => patch({ stroke: event.target.checked ? { color: '#000000', width: 4 } : undefined })} />{t('settings.textStyles.stroke')}</label>
            {draft.style.stroke && <div className="mt-3 grid grid-cols-2 gap-3">
              {color(t('settings.textStyles.strokeColor'), draft.style.stroke.color, (color) => patch({ stroke: { ...draft.style.stroke!, color } }))}
              {number(t('settings.textStyles.strokeWidth'), draft.style.stroke.width, (width) => patch({ stroke: { ...draft.style.stroke!, width } }), 0, 40)}
            </div>}
          </section>
          <section className="rounded-lg border border-[var(--border)] p-3">
            <label className="flex items-center gap-2 text-[14px] text-[var(--text)]"><input type="checkbox" checked={!!draft.style.shadow}
              onChange={(event) => patch({ shadow: event.target.checked ? { color: '#000000', opacity: 0.8, blur: 3, x: 4, y: 5 } : undefined })} />{t('settings.textStyles.shadow')}</label>
            {draft.style.shadow && <div className="mt-3 grid grid-cols-2 gap-3">
              {color(t('settings.textStyles.shadowColor'), draft.style.shadow.color, (color) => patch({ shadow: { ...draft.style.shadow!, color } }))}
              {number(t('settings.textStyles.opacity'), draft.style.shadow.opacity, (opacity) => patch({ shadow: { ...draft.style.shadow!, opacity } }), 0, 1, 0.05)}
              {number(t('settings.textStyles.blur'), draft.style.shadow.blur, (blur) => patch({ shadow: { ...draft.style.shadow!, blur } }), 0, 100)}
              {number(t('settings.textStyles.offsetX'), draft.style.shadow.x, (x) => patch({ shadow: { ...draft.style.shadow!, x } }), -100, 100)}
              {number(t('settings.textStyles.offsetY'), draft.style.shadow.y, (y) => patch({ shadow: { ...draft.style.shadow!, y } }), -100, 100)}
            </div>}
          </section>
          <div className="flex flex-wrap gap-2">
            <button className={FIELD + ' w-auto'} type="button" onClick={() => void save(true)}>{t('settings.textStyles.saveAs')}</button>
            {custom && <button className={FIELD + ' w-auto'} type="button" disabled={!dirty} onClick={() => void save(false)}>{t('settings.textStyles.save')}</button>}
            <button className={FIELD + ' w-auto'} type="button" disabled={dirty || draft.id === library.defaultId} onClick={() => void action(async () => {
              setLibrary(await api.defaultTextStyle(draft.id)); setNotice(t('settings.textStyles.defaultSaved'));
            })}>{draft.id === library.defaultId ? t('settings.textStyles.default') : t('settings.textStyles.setDefault')}</button>
            <button className={FIELD + ' w-auto'} type="button" disabled={!dirty} onClick={() => choose(original!)}>{t('settings.textStyles.reset')}</button>
            {custom && <button className={FIELD + ' w-auto'} type="button" onClick={() => void action(async () => {
              const data = await api.deleteTextStyle(draft.id); setLibrary(data); choose(data.presets.find((preset) => preset.id === data.defaultId)!, data);
            })}>{t('settings.textStyles.delete')}</button>}
          </div>
        </fieldset>
        {dirty && <p className="mt-3 text-[12px] text-[var(--text-muted)]">{t('settings.textStyles.unsaved')}</p>}
        {notice && <p role="status" className="mt-3 text-[13px] text-[var(--text)]">{notice}</p>}
        <p className="mt-5 text-[13px] leading-relaxed text-[var(--text-muted)]">{t('settings.textStyles.note')}</p>
      </>}
    </SettingsPage>
  );
}
