/**
 * The app's window: Studio's editor, as the open-source Studio is (its App, unchanged), and the chat in the column
 * Studio leaves for it (lib/host.ts `panel`). One page, one theme, one layer of dialogs over both.
 */
import { layoutReady } from './bridge';
import { ResizeCursor } from './ResizeCursor';
import { ActivationGate } from './ActivationGate';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from 'openfilm/studio-ui/App.tsx';
import { FocusNav } from 'openfilm/studio-ui/components/FocusNav.tsx';
import { applyStudioHost } from 'openfilm/studio-ui/lib/host.ts';
import { mountChat } from '../chat/src/mount';
import './shell.css';
import '../chat/src/chat.css';
import './polish.css';
import './workspace-theme.css';

function Workspace() {
  useEffect(() => {
    const controller = new AbortController();
    let stop: (() => void) | undefined;
    void mountChat(document.getElementById('of-chat')!, controller.signal).then(cleanup => {
      if (controller.signal.aborted) cleanup(); else stop = cleanup;
    });
    return () => { controller.abort(); stop?.(); };
  }, []);
  return <><FocusNav /><App /><ResizeCursor /></>;
}

async function start() {
  await layoutReady;
  applyStudioHost();
  createRoot(document.getElementById('root')!).render(<StrictMode><ActivationGate><Workspace /></ActivationGate></StrictMode>);
}
void start();
