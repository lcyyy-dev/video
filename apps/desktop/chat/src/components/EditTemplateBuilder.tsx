import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Check, ChevronRight, Clapperboard, FileText, Layers, Mic, Radio, X } from 'lucide-react';
import SpotlightCard from './react-bits/SpotlightCard';
import Stepper, { Step } from './react-bits/Stepper';
import { applyTextStyle, getTextElementLibrary, listTextStyles, type TextStylePreset } from 'openfilm/text-styles';

import { mountTextPage } from 'openfilm/text-page';
import { app } from '../app-bridge';
import { AD_MODES, TEMPLATE_TYPES, initialTemplate, templateSummary, type EditTemplateConfig as Config } from '../../../src/edit-template.mjs';

const ICONS = { ad: Clapperboard, talk: Mic, copy: FileText, live: Radio };
const TYPES = TEMPLATE_TYPES.map(type => ({ ...type, icon: ICONS[type.id] }));
const BUILTIN_TEXT_STYLES = listTextStyles();
const FONT_CHOICES = getTextElementLibrary().elements.fonts;
const BUILTIN_IDS = new Set(BUILTIN_TEXT_STYLES.map(preset => preset.id));
const WIZARD_STYLE = {
  '--stepper-frame': 'var(--surface)',
  '--stepper-frame-edge': 'var(--border-strong)',
  '--stepper-frame-highlight': 'var(--border-soft)',
  '--stepper-frame-shadow': '0 24px 72px #00000030',
  '--stepper-tile': 'var(--surface-3)',
  '--stepper-tile-edge': 'var(--border-strong)',
  '--stepper-tile-highlight': 'var(--border-soft)',
  '--stepper-well': 'var(--bg)',
  '--stepper-track': 'var(--border)',
  '--stepper-ink': 'var(--text)',
  '--stepper-muted': 'var(--text-muted)',
  '--stepper-faint': 'var(--text-faint)',
  '--stepper-ring': 'var(--border-strong)',
  '--stepper-solid': '#3b66cf',
  '--stepper-solid-ink': '#ffffff',
} as CSSProperties;

function Toggle({ label, checked, onChange, children }: { label: string; checked: boolean; onChange: (value: boolean) => void; children?: React.ReactNode }) {
  return <div className="edit-template-element"><label className="edit-template-toggle"><span>{label}</span><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} /><span className="edit-template-switch" aria-hidden="true" /></label>{checked && children ? <div className="edit-template-element-fields">{children}</div> : null}</div>;
}

function TextStylePreview({ preset, text }: { preset: TextStylePreset; text: string }) {
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!stage.current) return;
    const target = stage.current;
    const film = mountTextPage({ version: 1, width: 1080, height: 300, duration: 1,
      texts: [applyTextStyle({ text, x: 540, y: 150, width: 1000, fontSize: 64 }, preset)] }, target);
    film.frame(0);
    return () => target.replaceChildren();
  }, [preset, text]);
  return <div ref={root} className="edit-template-live-preview" role="img" aria-label={`文字样式预览：${preset.name}`}>
    <div ref={stage} style={{ position: 'absolute', width: 1080, height: 300, transformOrigin: 'top left', transform: `scale(${width / 1080})` }} />
  </div>;
}

export function EditTemplateBuilder({ projectPath, busy, onSaved }: { projectPath: string; busy: boolean; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [config, setConfig] = useState<Config>(initialTemplate);
  const [applied, setApplied] = useState<Config>(initialTemplate);
  const [loading, setLoading] = useState(true);
  const [textStyles, setTextStyles] = useState<TextStylePreset[]>([]);
  const [styleQuery, setStyleQuery] = useState('');
  const [fontFilter, setFontFilter] = useState('');
  const [previewId, setPreviewId] = useState('');
  const [addingStyle, setAddingStyle] = useState(false);
  const [styleName, setStyleName] = useState('');
  const [styleDraft, setStyleDraft] = useState<TextStylePreset['style']>({ fontFamily: FONT_CHOICES[0].family, fontPath: FONT_CHOICES[0].fontPath, color: '#F2DA2D', bold: true, stroke: { color: '#000000', width: 4 } });
  const [creatingStyle, setCreatingStyle] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setOpen(false); setStep(1); setSaveError(''); setConfig(initialTemplate()); setApplied(initialTemplate());
    void app.editTemplate.load(projectPath).then(value => {
      if (!cancelled) { const customOnly = { ...value, textStyleIds: value.textStyleIds.filter(id => !BUILTIN_IDS.has(id)) }; setConfig(customOnly); setApplied(customOnly); }
    }).catch(error => { if (!cancelled) setSaveError(`读取失败：${error.message}。可重新配置并保存。`); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectPath]);
  useEffect(() => {
    let cancelled = false;
    const fontCss = document.createElement('link'); fontCss.rel = 'stylesheet'; fontCss.href = '/api/text-styles/fonts.css'; document.head.append(fontCss);
    void fetch('/api/text-styles').then(async response => {
      if (!response.ok) throw new Error(`文字样式库读取失败（${response.status}）`);
      const data = await response.json() as { presets?: TextStylePreset[] };
      if (!cancelled && Array.isArray(data.presets) && data.presets.length) setTextStyles(data.presets.filter(preset => !BUILTIN_IDS.has(preset.id)));
    }).catch(error => { if (!cancelled) setSaveError(`读取自建样式失败：${error.message}`); });
    return () => { cancelled = true; fontCss.remove(); };
  }, []);
  useEffect(() => {
    if (!open) return;
    dialog.current?.focus();
  }, [open]);
  const patch = (value: Partial<Config>) => { setConfig(c => ({ ...c, ...value })); setSaveError(''); };
  const textKeys = ['titleText', 'bodyText', 'locationText', 'coverText', 'source', 'logic', 'notes'] as const;
  const composing = useRef(false);
  const textChange = (key: typeof textKeys[number]) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    /* Do not replace the DOM value while an IME is composing a candidate. React's controlled
       rerender can otherwise cancel the composition before the candidate is committed. */
    if (composing.current || (event.nativeEvent as InputEvent).isComposing) return;
    patch({ [key]: event.currentTarget.value } as Partial<Config>);
  };
  const compositionStart = () => { composing.current = true; };
  const compositionEnd = (key: typeof textKeys[number]) => (event: React.CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    composing.current = false;
    patch({ [key]: event.currentTarget.value } as Partial<Config>);
  };
  const pasteInto = (event: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>, apply: (value: string) => void) => {
    const plain = event.clipboardData.getData('text/plain');
    const html = event.clipboardData.getData('text/html');
    if (!plain && !html) return;
    /* Some Windows clipboard producers expose a damaged text/plain flavor while their HTML
       flavor still contains valid Unicode. Prefer that clean flavor when replacement or
       classic UTF-8-as-Western mojibake is present. */
    const damage = (text: string) => (text.match(/\uFFFD/g)?.length ?? 0) * 10 + (text.match(/(?:Ã.|Â.|â.|ï.)/g)?.length ?? 0) * 2;
    const damaged = damage(plain) > 0;
    let htmlText = '';
    if (html) {
      const body = new DOMParser().parseFromString(html, 'text/html').body;
      body.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
      htmlText = body.textContent ?? '';
    }
    const target = event.currentTarget;
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? start;
    event.preventDefault();
    const finish = (nativeText: string) => {
      const candidates = [plain, htmlText, nativeText].filter(Boolean);
      const inserted = candidates.sort((a, b) => damage(a) - damage(b))[0] ?? '';
      const next = `${target.value.slice(0, start)}${inserted}${target.value.slice(end)}`;
      /* These fields are intentionally uncontrolled while editing. Set the DOM value first so a
         paste and a following IME composition are not replaced by React's next render. */
      target.value = next;
      apply(next);
      requestAnimationFrame(() => { target.focus(); const caret = start + inserted.length; target.setSelectionRange(caret, caret); });
    };
    /* Only ask Electron for the native clipboard when Chromium reported suspicious text; a
       clean browser value remains authoritative and avoids reintroducing the old corruption. */
    if (damaged || !plain) void app.clipboardText().catch(() => '').then(finish);
    else finish('');
  };
  const pasteText = (key: typeof textKeys[number]) => (event: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) => pasteInto(event, value => patch({ [key]: value } as Partial<Config>));
  const subtitleChange = (index: number) => (event: React.ChangeEvent<HTMLInputElement>) => {
    if (composing.current || (event.nativeEvent as InputEvent).isComposing) return;
    const subtitleTexts = [...config.subtitleTexts]; subtitleTexts[index] = event.currentTarget.value;
    patch({ subtitleTexts });
  };
  const subtitleCompositionEnd = (index: number) => (event: React.CompositionEvent<HTMLInputElement>) => {
    composing.current = false;
    const subtitleTexts = [...config.subtitleTexts]; subtitleTexts[index] = event.currentTarget.value;
    patch({ subtitleTexts });
  };
  const subtitlePaste = (index: number) => (event: React.ClipboardEvent<HTMLInputElement>) => pasteInto(event, value => {
    const subtitleTexts = [...config.subtitleTexts]; subtitleTexts[index] = value;
    patch({ subtitleTexts });
  });
  const onDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    /* Keep keyboard shortcuts used by an input method inside the native composition flow. */
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); return; }
    if (event.key !== 'Tab') return;
    const nodes = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select, [tabindex="0"]') ?? []).filter(node => !node.closest('[inert], [aria-hidden="true"]'));
    if (!nodes.length) return;
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  const text = (key: typeof textKeys[number], label: string, placeholder: string, multiline = false) => multiline
    ? <textarea aria-label={label} defaultValue={config[key]} onChange={textChange(key)} onCompositionStart={compositionStart} onCompositionEnd={compositionEnd(key)} onPaste={pasteText(key)} placeholder={placeholder} rows={3} />
    : <input aria-label={label} defaultValue={config[key]} onChange={textChange(key)} onCompositionStart={compositionStart} onCompositionEnd={compositionEnd(key)} onPaste={pasteText(key)} placeholder={placeholder} />;
  const subtitleFields = config.subtitleTexts.length ? config.subtitleTexts : [''];
  const addSubtitle = () => patch({ subtitles: true, subtitleTexts: [...config.subtitleTexts, ''] });
  const removeSubtitle = (index: number) => patch({ subtitleTexts: config.subtitleTexts.filter((_, item) => item !== index) });
  const selectedTextStyleIds = new Set(config.textStyleIds);
  const toggleTextStyle = (id: string) => patch({ textStyleIds: selectedTextStyleIds.has(id)
    ? config.textStyleIds.filter(value => value !== id)
    : [...config.textStyleIds, id] });
  const elements = [config.title && '标题', config.subtitles && '副标题', config.body && '正文', config.body && config.highlight && '关键词高亮', config.location && '地点', config.textStyleIds.length ? `文字样式 ${config.textStyleIds.length} 个` : '自动文字样式'].filter(Boolean);
  const visibleStyles = textStyles.filter(preset => (!fontFilter || preset.style.fontFamily === fontFilter)
    && `${preset.name} ${preset.description}`.toLowerCase().includes(styleQuery.toLowerCase()));
  const previewPreset = textStyles.find(preset => preset.id === previewId) ?? textStyles.find(preset => selectedTextStyleIds.has(preset.id)) ?? visibleStyles[0];
  const newPreset: TextStylePreset = { id: 'preview-custom', version: 1, name: styleName || '新增样式', description: '自建文字样式', style: styleDraft };
  const createStyle = async () => {
    if (!styleName.trim() || creatingStyle) return;
    setCreatingStyle(true); setSaveError('');
    try {
      const response = await fetch('/api/text-styles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: styleName.trim(), description: '自建文字样式', style: styleDraft }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? '新增文字样式失败');
      setTextStyles(result.library.presets.filter((preset: TextStylePreset) => !BUILTIN_IDS.has(preset.id))); setPreviewId(result.preset.id);
      patch({ textStyleIds: [...config.textStyleIds, result.preset.id] });
      setAddingStyle(false); setStyleName(''); setFontFilter(''); setStyleQuery('');
    } catch (error) { setSaveError((error as Error).message); }
    finally { setCreatingStyle(false); }
  };
  const summary = templateSummary(config);
  const save = async () => {
    if (saving || busy) return;
    setSaving(true); setSaveError('');
    try {
      const value = await app.editTemplate.save(projectPath, config);
      setApplied(value); setConfig(value); setOpen(false); onSaved();
    } catch (error) { setSaveError(`保存失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { setSaving(false); }
  };
  const changeStep = (next: number) => {
    setStep(next);
    dialog.current?.querySelector('.stepper__viewport')?.scrollTo({ top: 0 });
  };
  return <>
    <button ref={trigger} type="button" className="edit-template-trigger" title={busy ? '剪辑执行中，结束后可调整模板' : '选择并配置本项目的剪辑模板'} disabled={loading || busy} onClick={() => { setConfig(applied); setStep(1); setOpen(true); }}>
      <span className="workspace-step-number" aria-hidden="true">02</span>
      <span className="template-trigger-icon" aria-hidden="true"><Layers size={18} strokeWidth={1.5} /></span>
      <span className="template-trigger-copy"><strong>剪辑模板</strong><span className="edit-template-tag">{loading ? '加载中…' : `${TYPES.find(t => t.id === applied.kind)!.name}${applied.kind === 'ad' ? ` · ${applied.adMode}` : ''}`}</span></span>
      <ChevronRight size={15} aria-hidden="true" />
    </button>
    {open ? <div className="edit-template-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) { setOpen(false); trigger.current?.focus(); } }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="edit-template-title" tabIndex={-1} onKeyDown={onDialogKeyDown} className="template-native-dialog">
        <h2 id="edit-template-title" className="sr-only">剪辑模板</h2>
        <button type="button" className="template-native-close" aria-label="关闭剪辑模板" onClick={() => { setOpen(false); trigger.current?.focus(); }}><X size={18} /></button>
          {saveError ? <p className="template-native-status" role="alert">{saveError}</p> : null}
          <Stepper className="template-native-stepper" width="100%" frame radius={20} style={WIZARD_STYLE}
            step={step} onStepChange={changeStep} onFinalStepCompleted={() => { void save(); }}
            backButtonText="上一步" nextButtonText="下一步" completeButtonText={saving ? '正在保存…' : '保存并输入需求'}
            nextButtonProps={{ disabled: saving || busy }} backButtonProps={{ disabled: saving }}
          >
          <Step title="模板">
            <h3 className="template-native-title">选择剪辑模板</h3>
          <section><h3><span>01</span>选择剪辑类型</h3><div className="edit-template-types">{TYPES.map(({ id, name, hint, skill, icon: Icon }) => <SpotlightCard key={id} className={`edit-template-type ${config.kind === id ? 'is-selected' : ''}`} spotlightColor="var(--tl-accent)" proximity={0} intensity={0.1}><button type="button" disabled={!skill} aria-pressed={config.kind === id} onClick={() => patch({ kind: id })}><Icon size={21} /><strong>{name}</strong><small>{hint}</small>{config.kind === id ? <Check size={14} className="edit-template-selected" /> : null}</button></SpotlightCard>)}</div></section>
          <section><h3><span>02</span>{config.kind === 'ad' ? '广告形式' : '模板设置'}</h3>
            {config.kind === 'ad' ? <><div className="edit-template-chips">{AD_MODES.map(mode => <button type="button" key={mode} aria-pressed={config.adMode === mode} onClick={() => patch({ adMode: mode })}>{mode}</button>)}</div>{config.adMode === '动作分享' ? <div className="edit-template-group"><Toggle label="添加开头" checked={config.opening} onChange={opening => patch({ opening })} /><Toggle label="画中画（使用已有素材）" checked={config.pip} onChange={pip => patch({ pip })} /><p className="edit-template-help">是否带文案，可在下一步“正文 / 文案”中选择。</p></div> : null}</> : null}
            {config.kind === 'talk' ? <div className="edit-template-group"><Toggle label="设计封面" checked={config.cover} onChange={cover => patch({ cover })}>{text('coverText', '封面文字', '封面标题、人物与视觉风格')}</Toggle><Toggle label="场景剪辑" checked={config.scenes} onChange={scenes => patch({ scenes })} /><p className="edit-template-help">下一步可选择标题、正文与关键词高亮。</p></div> : null}
            {config.kind === 'copy' ? <div className="edit-template-fields"><label>原始文案{text('source', '原始文案', '粘贴需要二创的文案，本页不提供爬取功能', true)}</label><label>二创方向<select value={config.rewrite} onChange={e => patch({ rewrite: e.target.value })}>{['保留原意，优化表达', '增强开头吸引力', '改成口语化表达', '精简为短视频文案'].map(v => <option key={v}>{v}</option>)}</select></label></div> : null}
            {config.kind === 'live' ? <div className="edit-template-fields"><div className="edit-template-duration"><Radio size={17} /><span>成品长度</span><strong>01:00</strong></div><label>切片内容逻辑{text('logic', '切片内容逻辑', '描述开头、核心内容与结尾的组织方式', true)}</label></div> : null}
          </section>
          </Step>
          <Step title="内容">
          <section><h3><span>03</span>填写画面内容</h3><div className="edit-template-group">
            <Toggle label="标题" checked={config.title} onChange={title => patch({ title })}>{text('titleText', '标题内容', '输入标题，可稍后补充')}</Toggle>
            <Toggle label="副标题 · 支持多条" checked={config.subtitles} onChange={subtitles => patch({ subtitles, ...(subtitles && !config.subtitleTexts.length ? { subtitleTexts: [''] } : {}) })}>
              <div className="edit-template-subtitles">{subtitleFields.map((value, index) => <div className="edit-template-subtitle-row" key={index}>
                <input aria-label={`副标题 ${index + 1}`} defaultValue={value} onChange={subtitleChange(index)} onCompositionStart={compositionStart} onCompositionEnd={subtitleCompositionEnd(index)} onPaste={subtitlePaste(index)} placeholder={`输入第 ${index + 1} 条副标题`} />
                <button type="button" className="edit-template-remove-subtitle" aria-label={`删除副标题 ${index + 1}`} onClick={() => removeSubtitle(index)} disabled={subtitleFields.length === 1}>删除</button>
              </div>)}</div>
              <button type="button" className="edit-template-add-subtitle" onClick={addSubtitle}>＋ 添加副标题</button>
              <p className="edit-template-help">每个输入框只对应一条副标题，生成时逐条保留，不会把多条合并成一条。</p>
            </Toggle>
            <Toggle label="正文 / 文案" checked={config.body} onChange={body => patch({ body })}>{text('bodyText', '正文内容', '输入正文或文案，可稍后补充', true)}</Toggle>
            <Toggle label="地点" checked={config.location} onChange={location => patch({ location })}>{text('locationText', '地点内容', '门店名称 / 地址 / 拍摄地点')}</Toggle>
          </div></section>
          </Step>
          <Step title="文字样式">
          <section className="edit-template-style-library"><h3><span>03</span>文字样式</h3>
            <p className="edit-template-help">这里只展示你创建的样式，可多选。未选择时由智能体决定外观；字号根据画布、文字长度和位置决定，不保存在新建样式中。</p>
            {config.title ? <p className="edit-template-help">标题字号由智能体根据画布、文字长度和位置决定，优先保持单行。</p> : null}
            {config.body ? <div className="edit-template-group"><label>正文呈现方式</label><div className="edit-template-chips">{['直出', '跳出'].map(value => <button type="button" key={value} aria-pressed={config.reveal === value} onClick={() => patch({ reveal: value })}>{value}</button>)}</div><Toggle label="关键词高亮" checked={config.highlight} onChange={highlight => patch({ highlight })} /></div> : null}
            <div className="edit-template-style-filters">
              <input aria-label="搜索文字样式" placeholder="搜索样式" value={styleQuery} onChange={e => setStyleQuery(e.target.value)} />
              <select aria-label="筛选字体" value={fontFilter} onChange={e => setFontFilter(e.target.value)}><option value="">全部字体</option>{[...new Set(textStyles.map(preset => preset.style.fontFamily).filter(Boolean))].map(font => <option key={font} value={font}>{FONT_CHOICES.find(item => item.family === font)?.name ?? font}</option>)}</select>
              <button type="button" onClick={() => setAddingStyle(value => !value)}>＋ 新增样式</button>
            </div>
            {addingStyle ? <div className="edit-template-new-style">
              <label>样式名称<input value={styleName} onChange={e => setStyleName(e.target.value)} placeholder="例如：黄色黑边标题" /></label>
              <label>字体<select value={styleDraft.fontFamily} onChange={e => { const font = FONT_CHOICES.find(item => item.family === e.target.value)!; setStyleDraft(value => ({ ...value, fontFamily: font.family, fontPath: font.fontPath })); }}>{FONT_CHOICES.map(font => <option key={font.id} value={font.family}>{font.name}</option>)}</select></label>
              <label>文字颜色<input type="color" value={styleDraft.color} onChange={e => setStyleDraft(value => ({ ...value, color: e.target.value }))} /></label>
              <label>描边颜色<input type="color" value={styleDraft.stroke?.color ?? '#000000'} onChange={e => setStyleDraft(value => ({ ...value, stroke: { width: value.stroke?.width ?? 0, color: e.target.value } }))} /></label>
              <label>描边宽度（px）<input type="number" min="0" max="100" value={styleDraft.stroke?.width ?? 0} onChange={e => { const width = Number(e.target.value); if (width >= 0 && width <= 100) setStyleDraft(value => ({ ...value, stroke: { color: value.stroke?.color ?? '#000000', width } })); }} /></label>
              <Toggle label="加粗" checked={Boolean(styleDraft.bold)} onChange={bold => setStyleDraft(value => ({ ...value, bold }))} />
              <button type="button" disabled={!styleName.trim() || creatingStyle} onClick={() => void createStyle()}>{creatingStyle ? '正在保存…' : '保存并选用'}</button>
            </div> : null}
            {addingStyle || previewPreset ? <><TextStylePreview preset={addingStyle ? newPreset : previewPreset!} text={config.titleText || config.bodyText || '预览文字：发现生活中的精彩'} /><p className="edit-template-help">{addingStyle ? newPreset.name : previewPreset?.name} · 预览字号仅作示意，生成时自动适配</p></> : null}
            <div className="edit-template-style-actions">
              <strong>已选择 {config.textStyleIds.length} 个 · 当前显示 {visibleStyles.length} 个</strong>
              {config.textStyleIds.length ? <button type="button" onClick={() => patch({ textStyleIds: [] })}>清空选择</button> : null}
            </div>
            {!visibleStyles.length ? <p className="edit-template-help">{textStyles.length ? '没有匹配的样式。' : '还没有自建样式，点击“新增样式”创建。'}</p> : null}
            <div className="edit-template-style-grid">{visibleStyles.map(preset => {
              const checked = selectedTextStyleIds.has(preset.id);
              const fill = preset.style.color ?? '#ffffff';
              const stroke = preset.style.stroke?.color;
              return <label key={preset.id} className={`edit-template-style-option${checked ? ' is-selected' : ''}`} title={preset.description}>
                <input type="checkbox" checked={checked} onChange={() => { toggleTextStyle(preset.id); setPreviewId(preset.id); }} />
                <span className="edit-template-style-swatch" style={{ color: fill, fontFamily: preset.style.fontFamily, fontWeight: preset.style.bold ? 700 : 400, WebkitTextStroke: stroke ? `${Math.min(3, (preset.style.stroke!.width / (preset.style.fontSize ?? 64)) * 15)}px ${stroke}` : undefined, paintOrder: 'stroke fill' }} aria-hidden="true">Aa</span>
                <span className="edit-template-style-copy"><strong>{preset.name}</strong><small>{preset.description}</small></span>
              </label>;
            })}</div>
          </section>
          </Step>
          <Step title="确认">
          <section><h3><span>04</span>确认模板配置</h3><p className="edit-template-step-intro">检查配置预览，补充要求后保存。也可以点击上方步骤返回调整。</p><label className="edit-template-notes-label">补充要求</label>{text('notes', '补充要求', '例如：节奏轻快、保留动作完整性、文字避开人物…', true)}</section>
            <div className="template-native-summary"><div className="template-native-tags">{elements.map(item => <span key={String(item)}>{item}</span>)}</div><pre>{summary}</pre></div>
            <p className="template-native-status" role="status">配置保存在当前项目。保存后，在右侧输入生成视频或修改影片的需求。</p>
          </Step>
          </Stepper>

      </div>
    </div> : null}
  </>;
}
