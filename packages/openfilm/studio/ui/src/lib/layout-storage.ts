/** Persist a layout preference locally and notify a desktop host to keep it across origins. */
export function keepLayout(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* storage may be unavailable */ }
  window.dispatchEvent(new CustomEvent('openfilm:keep-layout', { detail: { key, value } }));
}
