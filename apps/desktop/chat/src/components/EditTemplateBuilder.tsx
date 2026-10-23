import { useEffect, useRef, useState } from 'react';
import { Check, ChevronRight, Clapperboard, FileText, Layers, Mic, Radio, X } from 'lucide-react';
import SpotlightCard from './react-bits/SpotlightCard';
import Stepper, { Step } from './react-bits/Stepper';

const TYPES = [
  { id: 'ad', name: '广告素材', hint: '素材组合 · 视觉包装', icon: Clapperboard },
  { id: 'talk', name: '口播', hint: '封面 · 文字 · 场景剪辑', icon: Mic },
  { id: 'copy', name: '文案二创', hint: '已有文案 · 改写设计', icon: FileText },
  { id: 'live', name: '直播切片', hint: '内容逻辑 · 1 分钟成片', icon: Radio },
] as const;
const AD_MODES = ['文案朗读 + 音频', '原声 · 无朗读', '动作分享', '大字报', '正确动作教学'];
type Kind = typeof TYPES[number]['id'];
type Config = { kind: Kind; adMode: string; title: boolean; titleText: string; subtitles: boolean; subtitleText: string; body: boolean; bodyText: string; reveal: string; highlight: boolean; location: boolean; locationText: string; opening: boolean; pip: boolean; cover: boolean; coverText: string; scenes: boolean; source: string; rewrite: string; logic: string; notes: string };
const initial = (): Config => ({ kind: 'ad', adMode: AD_MODES[0], title: true, titleText: '', subtitles: false, subtitleText: '', body: true, bodyText: '', reveal: '直出', highlight: true, location: false, locationText: '', opening: true, pip: false, cover: true, coverText: '', scenes: true, source: '', rewrite: '保留原意，优化表达', logic: '亮点开场 → 核心观点 → 论据 / 演示 → 总结', notes: '' });

function Toggle({ label, checked, onChange, children }: { label: string; checked: boolean; onChange: (value: boolean) => void; children?: React.ReactNode }) {
  return <div className="edit-template-element"><label className="edit-template-toggle"><span>{label}</span><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} /><span className="edit-template-switch" aria-hidden="true" /></label>{checked && children ? <div className="edit-template-element-fields">{children}</div> : null}</div>;
}

export function EditTemplateBuilder({ projectKey }: { projectKey: string }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [config, setConfig] = useState<Config>(initial);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const storageKey = `openfilm:edit-template:${projectKey}`;
  useEffect(() => {
    setConfig(initial()); setSaved(false); setStep(1);
    try { const stored = JSON.parse(localStorage.getItem(storageKey) || 'null'); if (stored?.version === 1 && TYPES.some(t => t.id === stored.config?.kind)) setConfig({ ...initial(), ...stored.config }); } catch { /* A missing or unreadable draft starts fresh. */ }
  }, [storageKey]);
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
  const patch = (value: Partial<Config>) => { setConfig(c => ({ ...c, ...value })); setSaved(false); setSaveError(''); };
  const text = (key: 'titleText' | 'subtitleText' | 'bodyText' | 'locationText' | 'coverText' | 'source' | 'logic' | 'notes', label: string, placeholder: string, multiline = false) => multiline
    ? <textarea aria-label={label} value={config[key]} onChange={e => patch({ [key]: e.target.value })} placeholder={placeholder} rows={3} />
    : <input aria-label={label} value={config[key]} onChange={e => patch({ [key]: e.target.value })} placeholder={placeholder} />;
  const kind = TYPES.find(t => t.id === config.kind)!;
  const elements = [config.title && '标题', config.subtitles && '副标题', config.body && '正文', config.body && config.highlight && '关键词高亮', config.location && '地点'].filter(Boolean);
  const summary = [
    `剪辑模板：${kind.name}${config.kind === 'ad' ? ` / ${config.adMode}` : ''}`,
    ...(config.kind === 'ad' ? [config.adMode === AD_MODES[0] ? '声音：文案朗读 + 音频' : config.adMode === AD_MODES[1] ? '声音：保留原声，不添加朗读' : `声音：${config.adMode === '大字报' ? '以文字呈现为主' : '随素材配置'}`] : []),
    ...(config.kind === 'ad' && config.adMode === '动作分享' ? [`开头：${config.opening ? '需要' : '不需要'}`, `AI 画中画：${config.pip ? '需要' : '不需要'}`] : []),
    ...(config.kind === 'talk' ? [`封面：${config.cover ? config.coverText || '需要，内容待补充' : '不需要'}`, `场景剪辑：${config.scenes ? '需要' : '不需要'}`] : []),
    ...(config.kind === 'copy' ? [`原始文案：${config.source || '待提供'}`, `二创方向：${config.rewrite}`] : []),
    ...(config.kind === 'live' ? ['成品长度：1 分钟', `内容逻辑：${config.logic || '待补充'}`] : []),
    `标题：${config.title ? config.titleText || '需要，内容待补充' : '不需要'}`,
    `副标题：${config.subtitles ? config.subtitleText || '需要，内容待补充' : '不需要'}`,
    `正文：${config.body ? `${config.reveal}；关键词${config.highlight ? '高亮' : '不高亮'}；${config.bodyText || '内容待补充'}` : '不需要'}`,
    `地点：${config.location ? config.locationText || '需要，内容待补充' : '不需要'}`,
    ...(config.notes ? [`补充要求：${config.notes}`] : []),
  ].join('\n');
  const save = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ version: 1, config, summary }));
      setSaved(true); setSaveError('');
    } catch { setSaveError('保存失败，浏览器存储不可用，请重试'); }
  };
  const changeStep = (next: number) => {
    setStep(next);
    dialog.current?.querySelector('.stepper__viewport')?.scrollTo({ top: 0 });
  };
  return <>
    <button ref={trigger} type="button" className="edit-template-trigger" onClick={() => { setStep(1); setOpen(true); }}><span><Layers size={15} />剪辑模板<span className="edit-template-tag">{kind.name}</span></span><ChevronRight size={14} /></button>
    {open ? <div className="edit-template-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) { setOpen(false); trigger.current?.focus(); } }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="edit-template-title" tabIndex={-1} className="template-native-dialog">
        <h2 id="edit-template-title" className="sr-only">剪辑模板</h2>
        <button type="button" className="template-native-close" aria-label="关闭剪辑模板" onClick={() => { setOpen(false); trigger.current?.focus(); }}><X size={18} /></button>
          <Stepper className="template-native-stepper" width="100%" frame radius={28} theme="dark"
            step={step} onStepChange={changeStep} onFinalStepCompleted={save}
            backButtonText="上一步" nextButtonText="下一步" completeButtonText={saved ? '已保存模板配置' : '保存模板配置'}
            nextButtonProps={{ disabled: step === 4 && saved }}
          >
          <Step title="欢迎">
            <h3 className="template-native-title">开始你的影片创作</h3>
            <p className="template-native-description">通过几个简单的步骤，选择剪辑模板、组合画面元素，整理出你的专属剪辑配置。</p>
          </Step>
          <Step title="模板">
            <h3 className="template-native-title">选择剪辑模板</h3>
          <section><h3><span>01</span>选择剪辑类型</h3><div className="edit-template-types">{TYPES.map(({ id, name, hint, icon: Icon }) => <SpotlightCard key={id} className={`edit-template-type ${config.kind === id ? 'is-selected' : ''}`} spotlightColor="var(--tl-accent)" proximity={0} intensity={0.1}><button type="button" aria-pressed={config.kind === id} onClick={() => patch({ kind: id })}><Icon size={21} /><strong>{name}</strong><small>{hint}</small>{config.kind === id ? <Check size={14} className="edit-template-selected" /> : null}</button></SpotlightCard>)}</div></section>
          <section><h3><span>02</span>{config.kind === 'ad' ? '广告形式' : '模板设置'}</h3>
            {config.kind === 'ad' ? <><div className="edit-template-chips">{AD_MODES.map(mode => <button type="button" key={mode} aria-pressed={config.adMode === mode} onClick={() => patch({ adMode: mode })}>{mode}</button>)}</div>{config.adMode === '动作分享' ? <div className="edit-template-group"><Toggle label="添加开头" checked={config.opening} onChange={opening => patch({ opening })} /><Toggle label="AI 生成画中画" checked={config.pip} onChange={pip => patch({ pip })} /><p className="edit-template-help">是否带文案，可在下一步“正文 / 文案”中选择。</p></div> : null}</> : null}
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
            <p className="template-native-status" role="status">{saveError || (saved ? '已保存到当前浏览器，可随时重新调整。' : '保存后可继续修改这份剪辑配置。')}</p>
          </Step>
          </Stepper>

      </div>
    </div> : null}
  </>;
}
