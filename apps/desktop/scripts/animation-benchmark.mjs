/** Chromium animation benchmark, runnable against the Windows desktop build too.
 * Start the client with --remote-debugging-port=9333, then run this script. */
import { chromium } from 'playwright-core';
import { writeFile } from 'node:fs/promises';

const option = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const endpoint = option('cdp', 'http://127.0.0.1:9333');
const output = option('output', 'animation-performance.json');
const slowdown = Number(option('cpu', '1'));
if (!Number.isFinite(slowdown) || slowdown < 1) throw new Error('--cpu must be at least 1');
const browser = await chromium.connectOverCDP(endpoint);
let page, session, wasOpen = false, previousStep = 1;
const errors = [];
try {
  for (const candidate of browser.contexts().flatMap(context => context.pages())) {
    if (await candidate.evaluate(() => document.visibilityState === 'visible' && location.pathname.startsWith('/projects/'))) { page = candidate; break; }
  }
  if (!page) throw new Error('Open a project in the visible desktop client first');
  if (process.argv.includes('--reload')) { await page.reload(); await page.locator('.edit-template-trigger').waitFor(); await page.waitForTimeout(1000); }
  const graphics = await (await browser.newBrowserCDPSession()).send('SystemInfo.getInfo');
  session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate: slowdown });
  page.on('pageerror', error => errors.push(error.message));
  const dialog = page.getByRole('dialog', { name: '剪辑模板', exact: true });
  wasOpen = await dialog.count() > 0;
  if (wasOpen) {
    previousStep = Number(await dialog.locator('[aria-current="step"]').getAttribute('aria-label').then(value => /Step (\d+)/.exec(value)?.[1] ?? '1'));
    await page.keyboard.press('Escape');
  }
  const measure = async (name, action = async () => {}, duration = 2400) => {
    await page.evaluate(duration => {
      const tasks = [];
      const observer = new PerformanceObserver(list => { for (const item of list.getEntries()) tasks.push(item.duration); });
      observer.observe({ type: 'longtask', buffered: false });
      window.__openfilmAnimationSample = new Promise(resolve => {
        const frames = [];
        let start = null, previous = null;
        const frame = now => {
          if (start === null) start = now;
          if (previous !== null) frames.push(now - previous);
          previous = now;
          if (now - start < duration) { requestAnimationFrame(frame); return; }
          for (const item of observer.takeRecords()) tasks.push(item.duration);
          observer.disconnect();
          const sorted = [...frames].sort((a,b) => a-b);
          const at = fraction => Math.round((sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0) * 100) / 100;
          resolve({ fps: Math.round(frames.length * 10000 / (now - start)) / 10, frames: frames.length, p50Ms: at(.5), p95Ms: at(.95), maxMs: at(1), framesOver33Ms: frames.filter(ms => ms > 33.4).length, longTasks: tasks.length, longTaskMs: Math.round(tasks.reduce((sum,ms)=>sum+ms,0)) });
        };
        requestAnimationFrame(frame);
      });
    }, duration);
    await action();
    const result = await page.evaluate(() => window.__openfilmAnimationSample);
    console.log(name, result);
    return { name, ...result };
  };
  const scenarios = [];
  let transitionAnimations = [];
  scenarios.push(await measure('editor-idle'));
  const card = page.locator('.starter-card').first();
  if (await card.count()) scenarios.push(await measure('card-hover', async () => {
    const box = await card.boundingBox();
    for (let index = 0; index < 5; index++) {
      await page.mouse.move(box.x + 16, box.y + box.height / 2);
      await page.mouse.move(box.x + box.width - 16, box.y + box.height / 2, { steps: 12 });
    }
    await page.mouse.move(10, 15);
  }));
  scenarios.push(await measure('template-open', async () => {
    if (await dialog.count()) await page.keyboard.press('Escape');
    await page.locator('.edit-template-trigger').click();
  }));
  scenarios.push(await measure('step-transitions', async () => {
    for (const number of [2, 3, 4, 1]) {
      await dialog.locator('.stepper__segment').nth(number - 1).click();
      if (number === 2) transitionAnimations = await dialog.locator('.stepper').evaluate(root => root.getAnimations({ subtree: true }).map(animation => ({
        target: animation.effect?.target?.className,
        durationMs: animation.effect?.getTiming().duration,
        properties: [...new Set(animation.effect?.getKeyframes().flatMap(frame => Object.keys(frame).filter(key => !['offset', 'computedOffset', 'easing', 'composite'].includes(key))) ?? [])],
      })));
      await page.waitForTimeout(600);
    }
  }, 3000));
  const animations = await dialog.locator('.stepper').evaluate(root => ({
    fullScreenBlur: getComputedStyle(document.querySelector('.edit-template-backdrop')).backdropFilter,
    frameBlur: getComputedStyle(root).backdropFilter,
    width: root.clientWidth, overflow: root.scrollWidth > root.clientWidth,
  }));
  const report = { at: new Date().toISOString(), platform: process.platform, userAgent: await page.evaluate(() => navigator.userAgent), cpuSlowdown: slowdown, browser: browser.version(), renderer: graphics.gpu.auxAttributes?.glRenderer, graphics: graphics.gpu.featureStatus, scenarios, animations, transitionAnimations, errors };
  await writeFile(output, JSON.stringify(report, null, 2));
  const failed = errors.length > 0 || animations.overflow || scenarios.some(s => s.fps < 55 || s.p95Ms > 20 || s.longTasks > 0);
  if (process.argv.includes('--assert') && failed) process.exitCode = 1;
  console.log(`Report: ${output}${failed ? ' (review slow frames or errors)' : ''}`);
} finally {
  if (session) await session.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {});
  if (page) {
    const dialog = page.getByRole('dialog', { name: '剪辑模板', exact: true });
    if (wasOpen && await dialog.count()) {
      const target = dialog.locator('.stepper__segment').nth(previousStep - 1);
      if (await target.isEnabled()) await target.click();
    } else if (!wasOpen && await dialog.count()) await page.keyboard.press('Escape');
  }
  await browser.close();
}
