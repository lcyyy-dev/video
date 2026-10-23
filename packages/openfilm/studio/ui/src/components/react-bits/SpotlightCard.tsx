'use client';

import React, { useEffect, useMemo, useRef } from 'react';

import './SpotlightCard.css';

export type SpotlightShape = 'circle' | 'beam';

export type SpotlightCardProps = React.HTMLAttributes<HTMLDivElement> & {
  spotlightColor?: string;
  intensity?: number;
  spotlightSize?: number;
  softness?: number;
  shape?: SpotlightShape;
  borderGlow?: number;
  proximity?: number;
  smoothing?: number;
  ambient?: boolean;
  flare?: boolean;
  grain?: number;
  theme?: 'dark' | 'light';
};

type Palette = { surface: string; border: string; shadow: string; light: string; fill: number; edge: number };

type Settings = {
  shape: SpotlightShape;
  fill: string;
  edge: string;
  size: number;
  intensity: number;
  borderGlow: number;
  proximity: number;
  smoothing: number;
  ambient: boolean;
  flare: boolean;
  grain: number;
};

const THEMES: Record<'dark' | 'light', Palette> = {
  dark: {
    surface: '#111111',
    border: 'rgba(255, 255, 255, 0.08)',
    shadow: '0 24px 48px -24px rgba(0, 0, 0, 0.6)',
    light: '#ffffff',
    fill: 1,
    edge: 1
  },
  light: {
    surface: '#ffffff',
    border: 'rgba(24, 24, 27, 0.1)',
    shadow: '0 1px 2px rgba(24, 24, 27, 0.04), 0 18px 40px -20px rgba(24, 24, 27, 0.16)',
    light: '#18181b',
    fill: 0.28,
    edge: 0.7
  }
};

const SHAPES: SpotlightShape[] = ['circle', 'beam'];

const NOISE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const falloff = (color: string, softness: number) => {
  const soft = clamp(softness, 0, 1);
  const core = (1 - soft) ** 1.5 * 0.85;
  const stop = (alpha: number, at: number) =>
    `color-mix(in srgb, ${color} ${(alpha * 100).toFixed(2)}%, transparent) ${(at * 100).toFixed(2)}%`;
  const list = [stop(1, 0)];
  for (let i = 0; i <= 14; i++) {
    const t = core + ((1 - core) * i) / 14;
    const g = (t - core) / (1 - core);
    const smooth = 1 - g * g * (3 - 2 * g);
    const glow = Math.exp(-4.6 * g * g) * (1 - g ** 6);
    list.push(stop(smooth + (glow - smooth) * soft, t));
  }
  return list.join(', ');
};

const SpotlightCard = ({
  children, className = '', style, spotlightColor, intensity = 0.15,
  spotlightSize = 240, softness = 0.7, shape = 'circle', borderGlow = 0.6,
  proximity = 80, smoothing = 0.3, ambient = false, flare = true, grain = 0,
  theme = 'dark', ...rest
}: SpotlightCardProps) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const lightRef = useRef<HTMLSpanElement>(null);
  const grainRef = useRef<HTMLSpanElement>(null);
  const edgeRef = useRef<HTMLSpanElement>(null);
  const wakeRef = useRef<(() => void) | null>(null);
  const palette = THEMES[theme] ?? THEMES.dark;
  const color = spotlightColor ?? palette.light;
  const settings = useMemo(() => ({
    shape: SHAPES.includes(shape) ? shape : 'circle' as SpotlightShape,
    fill: falloff(color, softness), edge: falloff(color, 1),
    size: Math.max(20, spotlightSize),
    intensity: clamp(intensity, 0, 1) * palette.fill,
    borderGlow: clamp(borderGlow, 0, 1) * palette.edge,
    proximity: Math.max(0, proximity), smoothing: clamp(smoothing, 0, 1),
    ambient, flare, grain: clamp(grain, 0, 1),
  }), [shape, color, softness, spotlightSize, intensity, borderGlow, proximity, smoothing, ambient, flare, grain, palette]);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  useEffect(() => { wakeRef.current?.(); }, [settings]);

  useEffect(() => {
    const root = rootRef.current, light = lightRef.current, noise = grainRef.current, edge = edgeRef.current;
    if (!root || !light || !noise || !edge) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduce = motion.matches;
    let rect = root.getBoundingClientRect();
    let rectDirty = false;
    let focused = false;
    let focusPoint: { x: number; y: number } | null = null;
    let applied: Settings | null = null;
    let alive = true, visible = true, raf = 0, last = 0;
    const pointer = { x: 0, y: 0, active: false };
    const state = { x: 0, y: 0, presence: 0, flare: 0, time: 0, pressed: false };
    const idle = () => { light.style.willChange = ''; noise.style.willChange = ''; };
    const configure = (s: Settings) => {
      if (applied === s) return;
      applied = s;
      // Rasterize each gradient once per setting change. Moving the fill is a
      // composited transform; only the thin masked border changes its position.
      light.style.background = `radial-gradient(ellipse at 50% ${s.shape === 'beam' ? '0%' : '50%'}, ${s.fill})`;
      light.style.width = light.style.height = `${s.size * 2}px`;
      edge.style.background = `radial-gradient(ellipse at center, ${s.edge})`;
      edge.style.backgroundRepeat = 'no-repeat';
      noise.style.width = noise.style.height = `${s.size * 2}px`;
      noise.style.maskImage = 'radial-gradient(ellipse, #000, transparent 70%)';
      noise.style.display = s.grain > 0 ? '' : 'none';
    };
    const tick = (now: number) => {
      raf = 0;
      if (!alive || !visible || document.hidden) { idle(); return; }
      const s = settingsRef.current;
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000)); last = now;
      // Layout reads precede writes, and are invalidated by layout/scroll rather
      // than repeated for every interpolation frame.
      if (rectDirty) { rect = root.getBoundingClientRect(); rectDirty = false; }
      let tx = state.x, ty = state.y, target = 0;
      if (focused) {
        if (!focusPoint) {
          const element = document.activeElement;
          const box = element && root.contains(element) ? element.getBoundingClientRect() : rect;
          focusPoint = { x: box.left + box.width / 2 - rect.left, y: box.top + box.height / 2 - rect.top };
        }
        tx = focusPoint.x; ty = focusPoint.y; target = 1;
      } else if (pointer.active) {
        tx = pointer.x - rect.left; ty = pointer.y - rect.top;
        const gap = Math.hypot(Math.max(0, -tx, tx - rect.width), Math.max(0, -ty, ty - rect.height));
        target = gap === 0 ? 1 : s.proximity > 0 ? Math.max(0, 1 - gap / s.proximity) ** 2 : 0;
      }
      if (target < 0.6 && s.ambient) {
        if (!reduce) state.time += dt;
        const drift = (0.6 - target) / 0.6;
        tx += (rect.width * (0.5 + 0.34 * Math.sin(state.time * 0.43)) - tx) * drift;
        ty += (rect.height * (0.5 + 0.3 * Math.sin(state.time * 0.61 + 1.3)) - ty) * drift;
        target = 0.6;
      }
      if (state.presence < 0.02 && target > 0 && !s.ambient) { state.x = tx; state.y = ty; }
      const follow = reduce || s.smoothing === 0 ? 1 : 1 - Math.exp(-dt / (0.015 + s.smoothing * 0.22));
      state.x += (tx - state.x) * follow; state.y += (ty - state.y) * follow;
      const fade = reduce ? 1 : 1 - Math.exp(-dt / (target > state.presence ? 0.1 : 0.32));
      state.presence += (target - state.presence) * fade;
      if (Math.abs(target - state.presence) < 0.002) state.presence = target;
      const press = state.pressed && s.flare && !reduce ? 1 : 0;
      state.flare += (press - state.flare) * (1 - Math.exp(-dt / (press ? 0.05 : 0.28)));
      if (Math.abs(press - state.flare) < 0.002) state.flare = press;
      configure(s);
      const scale = 1 + 0.2 * state.flare, boost = 1 + 0.7 * state.flare;
      const transform = `translate3d(${state.x - s.size}px, ${state.y - s.size}px, 0) scale(${scale})`;
      light.style.transform = transform;
      light.style.opacity = String(Math.min(1, state.presence * s.intensity * boost));
      edge.style.backgroundSize = `${s.size * 1.2 * scale}px ${s.size * 1.2 * scale}px`;
      edge.style.backgroundPosition = `${state.x - s.size * 0.6 * scale}px ${state.y - s.size * 0.6 * scale}px`;
      edge.style.opacity = String(Math.min(1, state.presence * s.borderGlow * boost));
      if (s.grain > 0) { noise.style.transform = transform; noise.style.opacity = String(state.presence * s.grain); }
      const moving = Math.abs(tx - state.x) > 0.1 || Math.abs(ty - state.y) > 0.1;
      if (moving || state.presence !== target || state.flare !== press || (s.ambient && !reduce)) raf = requestAnimationFrame(tick);
      else idle();
    };
    const wake = () => {
      if (raf || !alive || !visible || document.hidden) return;
      rectDirty = true; last = performance.now();
      light.style.willChange = 'transform, opacity';
      if (settingsRef.current.grain > 0) noise.style.willChange = 'transform, opacity';
      raf = requestAnimationFrame(tick);
    };
    wakeRef.current = wake;
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      pointer.x = event.clientX; pointer.y = event.clientY; pointer.active = true;
      const s = settingsRef.current;
      const near = event.clientX >= rect.left - s.proximity && event.clientX <= rect.right + s.proximity
        && event.clientY >= rect.top - s.proximity && event.clientY <= rect.bottom + s.proximity;
      if (state.presence > 0 || root.contains(event.target as Node | null) || (s.proximity > 0 && near)) wake();
    };
    const onLeave = () => { pointer.active = false; wake(); };
    const onOut = (event: PointerEvent) => { if (!event.relatedTarget) onLeave(); };
    const onDown = (event: PointerEvent) => { state.pressed = true; onMove(event); wake(); };
    const onUp = () => { if (state.pressed) { state.pressed = false; wake(); } };
    const onFocus = (event: FocusEvent) => {
      focused = event.target instanceof Element && event.target.matches(':focus-visible');
      focusPoint = null; wake();
    };
    const onBlur = () => { focused = false; focusPoint = null; wake(); };
    const invalidate = () => { rectDirty = true; focusPoint = null; if (state.presence > 0 || settingsRef.current.ambient) wake(); };
    const onVisibility = () => {
      if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = 0; idle(); }
      else { pointer.active = false; wake(); }
    };
    const onMotion = () => { reduce = motion.matches; wake(); };
    const observer = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      if (visible) wake(); else { if (raf) cancelAnimationFrame(raf); raf = 0; idle(); }
    });
    const resize = new ResizeObserver(invalidate);
    observer.observe(root); resize.observe(root);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp);
    window.addEventListener('scroll', invalidate, { capture: true, passive: true });
    window.addEventListener('resize', invalidate); window.addEventListener('blur', onLeave);
    document.addEventListener('pointerout', onOut); document.addEventListener('visibilitychange', onVisibility);
    motion.addEventListener('change', onMotion);
    root.addEventListener('pointerdown', onDown); root.addEventListener('focusin', onFocus); root.addEventListener('focusout', onBlur);
    configure(settingsRef.current); wake();
    return () => {
      alive = false; wakeRef.current = null;
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect(); resize.disconnect();
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('scroll', invalidate, true); window.removeEventListener('resize', invalidate); window.removeEventListener('blur', onLeave);
      document.removeEventListener('pointerout', onOut); document.removeEventListener('visibilitychange', onVisibility); motion.removeEventListener('change', onMotion);
      root.removeEventListener('pointerdown', onDown); root.removeEventListener('focusin', onFocus); root.removeEventListener('focusout', onBlur);
    };
  }, []);
  return <div ref={rootRef} className={`spotlight-card${className ? ` ${className}` : ''}`} style={{ '--spotlight-card-surface': palette.surface, '--spotlight-card-border': palette.border, '--spotlight-card-shadow': palette.shadow, ...style } as React.CSSProperties} {...rest}>
    <span ref={lightRef} className="spotlight-card__light" aria-hidden="true" />
    <span ref={grainRef} className="spotlight-card__grain" style={{ backgroundImage: NOISE }} aria-hidden="true" />
    {children}
    <span className="spotlight-card__border" aria-hidden="true" />
    <span ref={edgeRef} className="spotlight-card__edge" aria-hidden="true" />
  </div>;
};
export default SpotlightCard;
