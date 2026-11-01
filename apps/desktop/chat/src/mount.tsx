/**
 * The chat, mounted in Studio's page (apps/desktop/shell): its column beside Studio, under the top bar. The theme is
 * the page's (`<html data-theme>`, Studio's), so there is nothing to follow; the language is Studio's too, and the
 * chat's own words follow it.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { app } from './app-bridge';
import { setLanguage } from './i18n';

export async function mountChat(root: HTMLElement, signal?: AbortSignal) {
  const hello = await app.hello();
  if (signal?.aborted) return () => {};
  setLanguage(hello.language);
  const stop = app.onLanguage(setLanguage);
  const tree = createRoot(root);
  tree.render(
    <StrictMode><App initialProject={hello.project} initialSelection={hello.selection} initialFfmpeg={hello.ffmpeg} /></StrictMode>,
  );
  return () => { stop(); tree.unmount(); };
}
