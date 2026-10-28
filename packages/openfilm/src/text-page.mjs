// @ts-check
/** Structured, editable text. JSON is the source; HTML is only its preview. */

/**
 * @typedef {{ text: string, fontSize?: number, color?: string, bold?: boolean, italic?: boolean,
 *   underline?: boolean, stroke?: { color: string, width: number } }} TextRun
 * @typedef {{ text: string, x: number, y: number, fontSize: number, color?: string,
 *   fontFamily?: string, fontPath?: string, bold?: boolean, italic?: boolean,
 *   scale?: number, opacity?: number, backgroundColor?: string, backgroundOpacity?: number, borderRadius?: number,
 *   underline?: boolean, align?: 'left' | 'center' | 'right',
 *   width?: number, lineHeight?: number, letterSpacing?: number,
 *   stroke?: { color: string, width: number }, shadow?: { color: string, opacity: number, blur: number, x: number, y: number },
 *   runs?: TextRun[], keyframes?: Partial<Record<'x' | 'y' | 'scale' | 'opacity', { time: number, value: number }[]>> }} TextItem
 * @typedef {{ version: 1, width: number, height: number, duration: number, texts: TextItem[] }} TextPage
 */

/** @param {unknown} input @returns {TextPage} */
export function validateTextPage(input) {
  const page = /** @type {TextPage} */ (input);
  const positive = (/** @type {number} */ n) => Number.isFinite(n) && n > 0;
  if (!page || Object.keys(page).some((key) => !['version', 'width', 'height', 'duration', 'texts'].includes(key))
    || page.version !== 1 || !positive(page.width) || !positive(page.height) || !positive(page.duration)
    || !Array.isArray(page.texts) || !page.texts.length) throw new Error('Invalid OpenFilm text page');
  const keys = new Set(['text', 'x', 'y', 'fontSize', 'color', 'fontFamily', 'fontPath', 'bold', 'italic', 'scale', 'opacity', 'keyframes',
    'backgroundColor', 'backgroundOpacity', 'borderRadius', 'underline', 'align', 'width', 'lineHeight', 'letterSpacing', 'stroke', 'shadow', 'runs']);
  const color = (/** @type {string} */ value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  const stroke = (/** @type {NonNullable<TextItem['stroke']>} */ value) => value
    && Object.keys(value).every((key) => ['color', 'width'].includes(key))
    && color(value.color) && Number.isFinite(value.width) && value.width >= 0;
  for (const item of page.texts) {
    if (!item || Object.keys(item).some((k) => !keys.has(k)) || typeof item.text !== 'string' || !item.text.trim()
      || !Number.isFinite(item.x) || !Number.isFinite(item.y) || !positive(item.fontSize)
      || (item.color !== undefined && !/^#[0-9a-f]{6}$/i.test(item.color))
      || (item.fontFamily !== undefined && typeof item.fontFamily !== 'string')
      || (item.fontPath !== undefined && typeof item.fontPath !== 'string')
      || (item.bold !== undefined && typeof item.bold !== 'boolean')
      || (item.italic !== undefined && typeof item.italic !== 'boolean')
      || (item.underline !== undefined && typeof item.underline !== 'boolean')
      || (item.align !== undefined && !['left', 'center', 'right'].includes(item.align))
      || (item.width !== undefined && !positive(item.width))
      || (item.lineHeight !== undefined && !positive(item.lineHeight))
      || (item.letterSpacing !== undefined && !Number.isFinite(item.letterSpacing))
      || (item.stroke !== undefined && !stroke(item.stroke))
      || (item.shadow !== undefined && (!item.shadow || Object.keys(item.shadow).some((key) => !['color', 'opacity', 'blur', 'x', 'y'].includes(key))
        || !color(item.shadow.color) || !Number.isFinite(item.shadow.opacity)
        || item.shadow.opacity < 0 || item.shadow.opacity > 1 || !Number.isFinite(item.shadow.blur) || item.shadow.blur < 0
        || !Number.isFinite(item.shadow.x) || !Number.isFinite(item.shadow.y)))
      || (item.scale !== undefined && !positive(item.scale))
      || (item.opacity !== undefined && !(Number.isFinite(item.opacity) && item.opacity >= 0 && item.opacity <= 1))
      || (item.backgroundColor !== undefined && !color(item.backgroundColor))
      || (item.backgroundOpacity !== undefined && !(Number.isFinite(item.backgroundOpacity) && item.backgroundOpacity >= 0 && item.backgroundOpacity <= 1))
      || (item.borderRadius !== undefined && !(Number.isFinite(item.borderRadius) && item.borderRadius >= 0))
      || (item.keyframes !== undefined && (!item.keyframes || typeof item.keyframes !== 'object' || Array.isArray(item.keyframes)))) {
      throw new Error('Invalid OpenFilm text item');
    }
    if (item.runs !== undefined) {
      if (!Array.isArray(item.runs) || !item.runs.length || item.runs.map((r) => r?.text ?? '').join('') !== item.text) throw new Error('Text runs must cover exactly the full text');
      for (const run of item.runs) {
        if (!run || Object.keys(run).some((k) => !['text', 'fontSize', 'color', 'bold', 'italic', 'underline', 'stroke'].includes(k))
          || typeof run.text !== 'string'
          || (run.fontSize !== undefined && !positive(run.fontSize)) || (run.color !== undefined && !color(run.color))
          || (run.bold !== undefined && typeof run.bold !== 'boolean')
          || (run.italic !== undefined && typeof run.italic !== 'boolean')
          || (run.underline !== undefined && typeof run.underline !== 'boolean')
          || (run.stroke !== undefined && !stroke(run.stroke))) {
          throw new Error('Invalid text run style');
        }
      }
    }
    for (const [key, points] of Object.entries(item.keyframes ?? {})) {
      if (!['x', 'y', 'scale', 'opacity'].includes(key) || !Array.isArray(points) || !points.length) throw new Error('Invalid text keyframes');
      let previous = -1;
      for (const point of points) {
        if (!point || Object.keys(point).some((key) => !['time', 'value'].includes(key))
          || !Number.isFinite(point.time) || point.time < 0 || point.time > page.duration || point.time <= previous
          || !Number.isFinite(point.value) || (key === 'scale' && point.value <= 0)
          || (key === 'opacity' && (point.value < 0 || point.value > 1))) throw new Error('Invalid text keyframe');
        previous = point.time;
      }
    }
  }
  return page;
}

/** All nonempty runs inherit defaults. Draft ranges are [start, end] in UTF-16 code units. @param {TextItem} item */
export function textStyleRuns(item) {
  let offset = 0;
  return (item.runs ?? [{ text: item.text }]).filter((run) => run.text.length > 0).map((run) => {
    const length = run.text.length;
    const result = { ...item, ...run, range: [offset, offset + length] };
    offset += length;
    return result;
  });
}

/** Linear interpolation with held ends. @param {{ time: number, value: number }[]} points @param {number} time */
export function textValueAt(points, time) {
  if (time <= points[0].time) return points[0].value;
  for (let i = 1; i < points.length; i++) {
    if (time <= points[i].time) {
      const a = points[i - 1], b = points[i];
      return a.value + (b.value - a.value) * (time - a.time) / (b.time - a.time);
    }
  }
  return points[points.length - 1].value;
}

/** Mount validated data in a browser container; also embedded in standalone pages. @param {TextPage} page @param {HTMLElement} [root] */
export function mountTextPage(page, root = document.body) {
  const nodes = page.texts.map((item) => {
    const node = document.createElement('div');
    node.textContent = item.text;
    Object.assign(node.style, {
      position: 'absolute', whiteSpace: item.width ? 'pre-wrap' : 'pre', textAlign: item.align ?? 'center',
      width: item.width ? `${item.width}px` : 'max-content', overflowWrap: item.width ? 'break-word' : 'normal',
      lineHeight: String(item.lineHeight ?? 1.25), letterSpacing: `${item.letterSpacing ?? 0}px`,
      fontFamily: !item.fontFamily ? 'sans-serif'
        : /^(serif|sans-serif|monospace|cursive|fantasy|system-ui)$/.test(item.fontFamily) ? item.fontFamily : JSON.stringify(item.fontFamily),
      fontSize: `${item.fontSize}px`,
      fontWeight: item.bold ? '700' : '400', fontStyle: item.italic ? 'italic' : 'normal', color: item.color ?? '#ffffff',
      textDecoration: item.underline ? 'underline' : 'none',
      boxSizing: 'border-box', padding: item.backgroundColor ? '14px 24px' : '0',
      backgroundColor: item.backgroundColor ? `rgba(${parseInt(item.backgroundColor.slice(1, 3), 16)},${parseInt(item.backgroundColor.slice(3, 5), 16)},${parseInt(item.backgroundColor.slice(5, 7), 16)},${item.backgroundOpacity ?? .58})` : 'transparent',
      borderRadius: `${item.borderRadius ?? 16}px`,
      webkitTextStroke: item.stroke ? `${item.stroke.width}px ${item.stroke.color}` : '', paintOrder: 'stroke fill',
      textShadow: item.shadow ? `${item.shadow.x}px ${item.shadow.y}px ${item.shadow.blur}px rgba(${parseInt(item.shadow.color.slice(1, 3), 16)},${parseInt(item.shadow.color.slice(3, 5), 16)},${parseInt(item.shadow.color.slice(5, 7), 16)},${item.shadow.opacity})` : '',
    });
    if (item.runs) {
      node.textContent = '';
      for (const run of textStyleRuns(item)) {
        const span = document.createElement('span');
        span.textContent = run.text;
        Object.assign(span.style, {
          fontSize: `${run.fontSize}px`, fontWeight: run.bold ? '700' : '400', color: run.color ?? '#ffffff',
          fontStyle: run.italic ? 'italic' : 'normal', textDecoration: run.underline ? 'underline' : 'none',
          webkitTextStroke: run.stroke ? `${run.stroke.width}px ${run.stroke.color}` : '0px', paintOrder: 'stroke fill',
        });
        node.append(span);
      }
    }
    root.append(node);
    return node;
  });
  const film = {
    width: page.width, height: page.height, duration: page.duration, ready: document.fonts.ready,
    frame(/** @type {number} */ time) {
      page.texts.forEach((item, i) => {
        const value = (/** @type {'x' | 'y' | 'scale' | 'opacity'} */ key, /** @type {number} */ base) => item.keyframes?.[key] ? textValueAt(item.keyframes[key], time) : base;
        const node = nodes[i];
        node.style.left = `${value('x', item.x)}px`;
        node.style.top = `${value('y', item.y)}px`;
        node.style.transform = `translate(-50%,-50%) scale(${value('scale', item.scale ?? 1)})`;
        node.style.opacity = String(value('opacity', item.opacity ?? 1));
      });
    },
  };
  film.frame(0);
  return film;
}

/** Self-contained preview; insert in film.html as an ordinary iframe. @param {TextPage} input @param {{ fontCss?: string }} [options] */
export function textPageHtml(input, options = {}) {
  const page = validateTextPage(input);
  const json = JSON.stringify(page).replace(/</g, '\\u003c');
  return `<!doctype html><meta charset="utf-8"><style>${(options.fontCss ?? '').replace(/<\/style/gi, '<\\/style')}html,body{margin:0;background:transparent;width:${page.width}px;height:${page.height}px;overflow:hidden}</style><body>
<script id="openfilm-text" type="application/json">${json}</script>
<script>${textValueAt.toString()};${textStyleRuns.toString()};window.film=(${mountTextPage.toString()})(JSON.parse(document.getElementById('openfilm-text').textContent));</script></body>`;
}

/** Only explicitly structured pages opt in; arbitrary HTML stays a rendered page. @param {string} html */
export function readTextPage(html) {
  const match = html.match(/<script\s+id="openfilm-text"\s+type="application\/json">([\s\S]*?)<\/script>/);
  return match ? validateTextPage(JSON.parse(match[1])) : null;
}
