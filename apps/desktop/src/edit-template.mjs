/** Template defaults and routing shared by the desktop composer and main process. */
export const TEMPLATE_TYPES = Object.freeze([
  { id: 'ad', name: '广告素材', hint: '素材组合 · 视觉包装', skill: 'ad-editing' },
  { id: 'talk', name: '口播', hint: '暂未开放', skill: null },
  { id: 'copy', name: '文案二创', hint: '暂未开放', skill: null },
  { id: 'live', name: '直播切片', hint: '暂未开放', skill: null },
]);
export const AD_MODES = ['文案朗读 + 音频', '原声 · 无朗读', '动作分享', '大字报', '正确动作教学'];
export const initialTemplate = () => ({ kind: 'ad', adMode: AD_MODES[0], title: true, titleText: '', subtitles: false, subtitleText: '', body: true, bodyText: '', reveal: '直出', highlight: true, location: false, locationText: '', opening: true, pip: false, cover: true, coverText: '', scenes: true, source: '', rewrite: '保留原意，优化表达', logic: '亮点开场 → 核心观点 → 论据 / 演示 → 总结', notes: '' });

export function templateRoute(kind) {
  const route = TEMPLATE_TYPES.find(t => t.id === kind);
  if (!route?.skill) throw new Error('该剪辑模板尚未开放，请选择广告素材模板。');
  return route;
}

/** Validate at the native boundary; never silently route an unknown type to advertising. */
export function normalizeTemplate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('无效的剪辑模板配置。');
  templateRoute(raw.kind);
  const config = initialTemplate();
  for (const key of Object.keys(config)) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== typeof config[key]) throw new Error(`无效的模板字段：${key}`);
    if (typeof raw[key] === 'string' && raw[key].length > 20000) throw new Error('模板文字过长。');
    config[key] = raw[key];
  }
  if (!AD_MODES.includes(config.adMode) || !['直出', '跳出'].includes(config.reveal)) throw new Error('无效的广告形式或文字呈现方式。');
  return config;
}

export function templateSummary(config) {
  const route = templateRoute(config.kind);
  return [
    `剪辑模板：${route.name} / ${config.adMode}`,
    `声音：${config.adMode === AD_MODES[0] ? '文案朗读 + 音频（使用提供的录音；缺少录音时先说明，不默认生成配音）' : config.adMode === AD_MODES[1] ? '保留原声，不添加朗读' : config.adMode === '大字报' ? '以文字呈现为主' : '随素材配置'}`,
    ...(config.adMode === '动作分享' ? [`开头：${config.opening ? '需要' : '不需要'}`, `AI 画中画：${config.pip ? '需要（当前仅使用提供的素材，缺失时说明）' : '不需要'}`] : []),
    `标题：${config.title ? config.titleText || '需要，内容待补充' : '不需要'}`,
    `副标题：${config.subtitles ? config.subtitleText || '需要，内容待补充' : '不需要'}`,
    `正文：${config.body ? `${config.reveal}；关键词${config.highlight ? '高亮' : '不高亮'}；${config.bodyText || '内容待补充'}` : '不需要'}`,
    `地点：${config.location ? config.locationText || '需要，内容待补充' : '不需要'}`,
    ...(config.notes ? [`补充要求：${config.notes}`] : []),
  ].join('\n');
}
