import React from 'react';
import { applyTextStyle, listTextStyles, type TextStylePreset } from 'openfilm/text-styles';
import { mountTextPage } from 'openfilm/text-page';
import { useT } from '@/i18n';
import { SettingsPage, SettingsSegmented } from './ui';

const PRESETS = listTextStyles();
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
      texts: [applyTextStyle({ text, x: WIDTH / 2, y: HEIGHT / 2, width: 960, align: 'center', fontSize: 64 }, preset)] }, element);
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

export function TextStylesSection() {
  const t = useT();
  const sample = t('settings.textStyles.sample');
  const [text, setText] = React.useState('');
  const [background, setBackground] = React.useState<'dark' | 'light'>('dark');
  return (
    <SettingsPage note={t('settings.textStyles.intro')}>
      <label htmlFor="text-style-preview" className="mb-2 text-[14px] text-[var(--text)]">{t('settings.textStyles.previewText')}</label>
      <textarea id="text-style-preview" value={text} onChange={(event) => setText(event.target.value)} rows={2} maxLength={100}
        placeholder={sample} className="mb-4 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-[14px] text-[var(--text)] outline-none focus:border-[var(--text-muted)]" />
      <div className="mb-5 flex items-center justify-between gap-3">
        <span className="text-[13px] text-[var(--text-muted)]">{t('settings.textStyles.background')}</span>
        <SettingsSegmented<'dark' | 'light'> label={t('settings.textStyles.background')} value={background} onChange={setBackground}
          options={[{ value: 'dark', label: t('settings.textStyles.dark') }, { value: 'light', label: t('settings.textStyles.light') }]} />
      </div>
      <div className="flex flex-col gap-5">
        {PRESETS.map((preset) => {
          const key = `settings.textStyles.names.${preset.id}`;
          const name = t(key) === key ? preset.name : t(key);
          return (
            <article key={preset.id} className="rounded-xl border border-[var(--border)] p-3" data-text-style={preset.id}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[15px] font-medium text-[var(--text)]">{name}</h3>
                <span className="text-[12px] text-[var(--text-muted)]">{preset.style.fontSize} px · {(preset.style.color ?? '#ffffff').toUpperCase()}</span>
              </div>
              <StylePreview preset={preset} text={text.trim() ? text : sample} light={background === 'light'} title={name} />
              <p className="mt-2 text-[12px] text-[var(--text-faint)]">{preset.id} · v{preset.version}</p>
            </article>
          );
        })}
      </div>
      <p className="mt-5 text-[13px] leading-relaxed text-[var(--text-muted)]">{t('settings.textStyles.note')}</p>
    </SettingsPage>
  );
}
