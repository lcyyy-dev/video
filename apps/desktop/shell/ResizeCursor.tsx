import { useEffect } from 'react';

/** Hold the native resize cursor while the separator has captured the pointer. */
export function ResizeCursor() {
  useEffect(() => {
    const root = document.documentElement;
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || event.pointerType !== 'mouse') return;
      const handle = event.target instanceof Element ? event.target.closest('[role="separator"][aria-orientation]') : null;
      const axis = handle?.getAttribute('aria-orientation');
      if (axis) root.dataset.resizeAxis = axis;
    };
    const end = () => { delete root.dataset.resizeAxis; };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', end, true);
    window.addEventListener('blur', end);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', end, true);
      window.removeEventListener('pointercancel', end, true);
      window.removeEventListener('blur', end);
      end();
    };
  }, []);
  return null;
}
