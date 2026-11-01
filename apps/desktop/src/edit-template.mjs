/** Template defaults and routing shared by the desktop composer and main process. */
export const TEMPLATE_TYPES = Object.freeze([
  { id: 'ad', name: '广告素材', hint: '素材组合 · 视觉包装', skill: 'ad-editing' },
  { id: 'talk', name: '口播', hint: '节奏剪辑 · 字幕整理', skill: 'talk-editing' },
  { id: 'copy', name: '文案二创', hint: '保留原意 · 润色文案', skill: 'copy-rewrite' },
  { id: 'live', name: '直播切片', hint: '完整观点 · 精华剪辑', skill: 'live-clips' },
]);
export const initialTemplate = () => ({ kind: 'ad', narration: false, speaker: 'zh_female_vv_uranus_bigtts', speechRate: 0, title: true, titleText: '', subtitles: false, subtitleTexts: [], body: true, bodyText: '', reveal: '直出', highlight: true, location: false, locationText: '', source: '', notes: '', textStyleIds: [] });

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
  const migrated = { ...raw, subtitleTexts: legacySubtitleTexts(raw), narration: raw.narration ?? (raw.adMode === '文案朗读 + 音频') };
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
  if (config.kind === 'ad' && !['直出', '跳出'].includes(config.reveal)) throw new Error('无效的文字呈现方式。');
  if (config.kind === 'copy') {
    config.title = false; config.titleText = '';
    config.subtitles = false; config.subtitleTexts = [];
    config.body = true; config.bodyText = '';
    config.location = false; config.locationText = '';
    config.narration = false; config.textStyleIds = [];
  }
  if (config.kind !== 'ad') config.narration = false;
  if (!/^[a-zA-Z0-9_]{1,120}$/.test(config.speaker)) throw new Error('无效的配音音色。');
  if (!Number.isInteger(config.speechRate) || config.speechRate < -50 || config.speechRate > 100) throw new Error('无效的配音语速。');
  config.reveal = '直出';
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
  const narration = `文案朗读：${config.kind === 'ad' && config.body && config.narration ? `已勾选；豆包 seed-tts-2.0；音色 ${config.speaker}；语速 ${config.speechRate}；生成正文全文旁白，失败必须报告，禁止静默跳过` : '未勾选；不生成配音，保留视频原声'}`;
  const title = config.title
    ? [`标题：${config.titleText || '需要，内容待补充'}`, '标题排版：根据画布尺寸、文字长度和位置选择绝对像素字号，优先单行，不换行']
    : ['标题：不需要'];
  if (config.kind === 'talk') return [
    `剪辑模板：${route.name}`,
    textStyle,
    narration,
    ...title,
    ...subtitles,
    `正文：${config.body ? `${config.reveal}；关键词${config.highlight ? '高亮' : '不高亮'}；${config.bodyText || '根据口播整理'}` : '不需要'}`,
    ...(config.notes ? [`补充要求：${config.notes}`] : []),
  ].join('\n');
  if (config.kind === 'copy') return [
    `剪辑模板：${route.name}`,
    `原始文案：${config.source || '待补充'}`,
    ...(config.notes ? [`补充要求：${config.notes}`] : []),
  ].join('\n');
  if (config.kind === 'live') return [
    `剪辑模板：${route.name}`,
    textStyle,
    narration,
    ...title,
    `正文：${config.body ? `${config.reveal}；${config.bodyText || '根据原声整理字幕'}` : '不需要'}`,
    ...(config.notes ? [`补充要求：${config.notes}`] : []),
  ].join('\n');
  return [
    `剪辑模板：${route.name}`,
    textStyle,
    narration,
    ...title,
    ...subtitles,
    `正文：${config.body ? `${config.reveal}；关键词${config.highlight ? '高亮' : '不高亮'}；${config.bodyText || '内容待补充'}` : '不需要'}`,
    `地点：${config.location ? config.locationText || '需要，内容待补充' : '不需要'}`,
    ...(config.notes ? [`补充要求：${config.notes}`] : []),
  ].join('\n');
}
