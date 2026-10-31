/** Template defaults and routing shared by the desktop composer and main process. */
export const TEMPLATE_TYPES = Object.freeze([
  { id: 'ad', name: '广告素材', hint: '素材组合 · 视觉包装', skill: 'ad-editing' },
  { id: 'talk', name: '口播', hint: '节奏剪辑 · 字幕整理', skill: 'talk-editing' },
  { id: 'copy', name: '文案二创', hint: '改写表达 · 视频重组', skill: 'copy-rewrite' },
  { id: 'live', name: '直播切片', hint: '完整观点 · 精华剪辑', skill: 'live-clips' },
]);
export const AD_MODES = ['文案朗读 + 音频', '原声 · 无朗读', '动作分享', '大字报', '正确动作教学'];
export const initialTemplate = () => ({ kind: 'ad', adMode: AD_MODES[0], title: true, titleText: '', subtitles: false, subtitleTexts: [], body: true, bodyText: '', reveal: '直出', highlight: true, location: false, locationText: '', opening: true, pip: false, cover: true, coverText: '', scenes: true, source: '', rewrite: '保留原意，优化表达', logic: '亮点开场 → 核心观点 → 论据 / 演示 → 总结', notes: '', textStyleIds: [] });

/** The title is fitted before a page is written. CJK characters are full-width; Latin text is narrower. */
export function titleFontSize(text, { maxWidth = 930, max = 112, min = 42 } = {}) {
  const cells = [...String(text ?? '')].reduce((sum, char) => sum + (/[\x00-\xff]/.test(char) ? 0.58 : 1), 0);
  if (!cells) return max;
  return Math.max(min, Math.min(max, Math.floor((maxWidth / cells) * 0.9)));
}

function legacySubtitleTexts(raw) {
  if (Array.isArray(raw.subtitleTexts) && (raw.subtitleTexts.length || typeof raw.subtitleText !== 'string')) return raw.subtitleTexts;
  if (typeof raw.subtitleText === 'string') return raw.subtitleText.split(/\r?\n/);
  return [];
}

export function templateRoute(kind) {
  const route = TEMPLATE_TYPES.find(t => t.id === kind);
  if (!route?.skill) throw new Error('该剪辑模板尚未开放，请选择其他模板。');
  return route;
}

/** Validate at the native boundary; never silently route an unknown type to advertising. */
export function normalizeTemplate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('无效的剪辑模板配置。');
  templateRoute(raw.kind);
  const migrated = { ...raw, subtitleTexts: legacySubtitleTexts(raw) };
  const config = initialTemplate();
  for (const key of Object.keys(config)) {
    if (migrated[key] === undefined) continue;
    if (typeof migrated[key] !== typeof config[key] && !(Array.isArray(config[key]) && Array.isArray(migrated[key]))) throw new Error(`无效的模板字段：${key}`);
    if (typeof migrated[key] === 'string' && migrated[key].length > 20000) throw new Error('模板文字过长。');
    if (key === 'subtitleTexts') {
      if (!Array.isArray(migrated[key])) throw new Error('副标题格式或长度无效。');
      if (!migrated[key].every(text => typeof text === 'string' && text.length <= 2000)) throw new Error('副标题格式或长度无效。');
      config[key] = migrated[key].slice(0, 12);
    } else if (key === 'textStyleIds') {
      if (!Array.isArray(migrated[key]) || !migrated[key].every(id => typeof id === 'string' && /^[a-z][a-z0-9-]*$/.test(id) && id.length <= 160)) throw new Error('文字样式格式或长度无效。');
      config[key] = [...new Set(migrated[key])].slice(0, 100);
    } else config[key] = migrated[key];
  }
  if (config.kind === 'ad' && (!AD_MODES.includes(config.adMode) || !['直出', '跳出'].includes(config.reveal))) throw new Error('无效的广告形式或文字呈现方式。');
  return config;
}

export function templateSummary(config) {
  const route = templateRoute(config.kind);
  const textStyle = config.textStyleIds.length
    ? `文字样式：仅使用已勾选样式（${config.textStyleIds.join('、')}）`
    : '文字样式：未指定，使用元素库自动组合';
  const subtitles = config.subtitles
    ? (config.subtitleTexts?.filter(Boolean).length
      ? config.subtitleTexts.filter(Boolean).map((text, index) => `副标题${index + 1}：${text}`)
      : ['副标题：需要，内容待补充'])
    : ['副标题：不需要'];
  const title = config.title
    ? [`标题：${config.titleText || '需要，内容待补充'}`, `标题排版：${config.titleText ? `${titleFontSize(config.titleText)}px，单行，不换行` : '根据实际文案计算，单行，不换行'}`]
    : ['标题：不需要'];
  if (config.kind === 'talk') return [
    `剪辑模板：${route.name}`,
    textStyle,
    `封面：${config.cover ? config.coverText || '需要，内容待补充' : '不需要'}`,
    `场景剪辑：${config.scenes ? '需要' : '不需要'}`,
    ...title,
    ...subtitles,
    `正文：${config.body ? `${config.reveal}；关键词${config.highlight ? '高亮' : '不高亮'}；${config.bodyText || '根据口播整理'}` : '不需要'}`,
    ...(config.notes ? [`补充要求：${config.notes}`] : []),
  ].join('\n');
  if (config.kind === 'copy') return [
    `剪辑模板：${route.name}`,
    textStyle,
    `原始文案：${config.source || '待补充'}`,
    `二创方向：${config.rewrite}`,
    ...title,
    `正文：${config.body ? `${config.reveal}；${config.bodyText || '根据改写后的文案生成'}` : '不需要'}`,
    ...(config.notes ? [`补充要求：${config.notes}`] : []),
  ].join('\n');
  if (config.kind === 'live') return [
    `剪辑模板：${route.name}`,
    textStyle,
    '成品长度：约 01:00（以完整观点边界为准）',
    `切片内容逻辑：${config.logic || '开头引题 → 核心内容 → 完整结论'}`,
    ...title,
    `正文：${config.body ? `${config.reveal}；${config.bodyText || '根据原声整理字幕'}` : '不需要'}`,
    ...(config.notes ? [`补充要求：${config.notes}`] : []),
  ].join('\n');
  return [
    `剪辑模板：${route.name} / ${config.adMode}`,
    textStyle,
    `声音：${config.adMode === AD_MODES[0] ? '文案朗读 + 音频（优先使用提供的录音；没有录音时使用本地 TTS，TTS 暂不可用也不要阻断剪辑）' : config.adMode === AD_MODES[1] ? '保留原声，不添加朗读' : config.adMode === '大字报' ? '以文字呈现为主' : '随素材配置'}`,
    ...(config.adMode === '动作分享' ? [`开头：${config.opening ? '需要' : '不需要'}`, `AI 画中画：${config.pip ? '需要（当前仅使用提供的素材，缺失时说明）' : '不需要'}`] : []),
    ...title,
    ...subtitles,
    `正文：${config.body ? `${config.reveal}；关键词${config.highlight ? '高亮' : '不高亮'}；${config.bodyText || '内容待补充'}` : '不需要'}`,
    `地点：${config.location ? config.locationText || '需要，内容待补充' : '不需要'}`,
    ...(config.notes ? [`补充要求：${config.notes}`] : []),
  ].join('\n');
}
