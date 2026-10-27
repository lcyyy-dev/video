import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Check, ChevronRight, Clapperboard, FileText, Layers, Mic, Radio, X } from 'lucide-react';
import SpotlightCard from './react-bits/SpotlightCard';
import Stepper, { Step } from './react-bits/Stepper';

import { app } from '../app-bridge';
import { AD_MODES, TEMPLATE_TYPES, initialTemplate, templateSummary, type EditTemplateConfig as Config } from '../../../src/edit-template.mjs';

const ICONS = { ad: Clapperboard, talk: Mic, copy: FileText, live: Radio };
const TYPES = TEMPLATE_TYPES.map(type => ({ ...type, icon: ICONS[type.id] }));
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

export function EditTemplateBuilder({ projectPath, busy, onSaved }: { projectPath: string; busy: boolean; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [config, setConfig] = useState<Config>(initialTemplate);
  const [applied, setApplied] = useState<Config>(initialTemplate);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setOpen(false); setStep(1); setSaveError(''); setConfig(initialTemplate()); setApplied(initialTemplate());
    void app.editTemplate.load(projectPath).then(value => {
      if (!cancelled) { setConfig(value); setApplied(value); }
    }).catch(error => { if (!cancelled) setSaveError(`读取失败：${error.message}。可重新配置并保存。`); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectPath]);
  useEffect(() => {
    if (!open) return;
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); trigger.current?.focus(); }
      if (e.key === 'Tab') {
        const nodes = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select, [tabindex="0"]') ?? []).filter(node => !node.closest('[inert], [aria-hidden="true"]'));
        if (!nodes?.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);
  const patch = (value: Partial<Config>) => { setConfig(c => ({ ...c, ...value })); setSaveError(''); };
  const pasteText = (key: 'titleText' | 'subtitleText' | 'bodyText' | 'locationText' | 'coverText' | 'source' | 'logic' | 'notes') => (event: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const target = event.currentTarget;
    const browserText = event.clipboardData.getData('text/plain');
    if (!browserText) return;
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? start;
    event.preventDefault();
    void app.clipboardText().catch(() => browserText).then(text => {
      const inserted = text || browserText;
      const next = `${target.value.slice(0, start)}${inserted}${target.value.slice(end)}`;
      patch({ [key]: next } as Partial<Config>);
      requestAnimationFrame(() => { target.focus(); const caret = start + inserted.length; target.setSelectionRange(caret, caret); });
    });
  };
  const text = (key: 'titleText' | 'subtitleText' | 'bodyText' | 'locationText' | 'coverText' | 'source' | 'logic' | 'notes', label: string, placeholder: string, multiline = false) => multiline
    ? <textarea aria-label={label} value={config[key]} onChange={e => patch({ [key]: e.target.value })} onPaste={pasteText(key)} placeholder={placeholder} rows={3} />
    : <input aria-label={label} value={config[key]} onChange={e => patch({ [key]: e.target.value })} onPaste={pasteText(key)} placeholder={placeholder} />;
  const elements = [config.title && '标题', config.subtitles && '副标题', config.body && '正文', config.body && config.highlight && '关键词高亮', config.location && '地点'].filter(Boolean);
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
      <span className="template-trigger-copy"><strong>剪辑模板</strong><span className="edit-template-tag">{loading ? '加载中…' : `${TYPES.find(t => t.id === applied.kind)!.name} · ${applied.adMode}`}</span></span>
      <ChevronRight size={15} aria-hidden="true" />
    </button>
    {open ? <div className="edit-template-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) { setOpen(false); trigger.current?.focus(); } }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="edit-template-title" tabIndex={-1} className="template-native-dialog">
        <h2 id="edit-template-title" className="sr-only">剪辑模板</h2>
        <button type="button" className="template-native-close" aria-label="关闭剪辑模板" onClick={() => { setOpen(false); trigger.current?.focus(); }}><X size={18} /></button>
          {saveError ? <p className="template-native-status" role="alert">{saveError}</p> : null}
          <Stepper className="template-native-stepper" width="100%" frame radius={20} style={WIZARD_STYLE}
            step={step} onStepChange={changeStep} onFinalStepCompleted={() => { void save(); }}
            backButtonText="上一步" nextButtonText="下一步" completeButtonText={saving ? '正在保存…' : '保存并输入需求'}
            nextButtonProps={{ disabled: saving || busy }} backButtonProps={{ disabled: saving }}
          >
          <Step title="欢迎">
            <h3 className="template-native-title">开始你的影片创作</h3>
            <p className="template-native-description">选择广告模板，设置画面元素并保存。回到右侧输入需求、添加素材，即可开始剪辑。</p>
          </Step>
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
          <Step title="元素">
          <section><h3><span>03</span>组合画面元素</h3><div className="edit-template-group">
            <Toggle label="标题" checked={config.title} onChange={title => patch({ title })}>{text('titleText', '标题内容', '输入标题，可稍后补充')}</Toggle>
            <Toggle label="副标题 · 支持多条" checked={config.subtitles} onChange={subtitles => patch({ subtitles })}>{text('subtitleText', '副标题内容', '每行一条副标题', true)}</Toggle>
            <Toggle label="正文 / 文案" checked={config.body} onChange={body => patch({ body })}><div className="edit-template-chips">{['直出', '跳出'].map(v => <button type="button" key={v} aria-pressed={config.reveal === v} onClick={() => patch({ reveal: v })}>{v}</button>)}</div><Toggle label="关键词高亮" checked={config.highlight} onChange={highlight => patch({ highlight })} />{text('bodyText', '正文内容', '输入正文或文案，可稍后补充', true)}</Toggle>
            <Toggle label="地点" checked={config.location} onChange={location => patch({ location })}>{text('locationText', '地点内容', '门店名称 / 地址 / 拍摄地点')}</Toggle>
          </div></section>
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
