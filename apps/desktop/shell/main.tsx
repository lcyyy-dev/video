/**
 * The app's window: Studio's editor, as the open-source Studio is (its App, unchanged), and the chat in the column
 * Studio leaves for it (lib/host.ts `panel`). One page, one theme, one layer of dialogs over both.
 */
import { layoutReady } from './bridge';
import { ResizeCursor } from './ResizeCursor';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from 'openfilm/studio-ui/App.tsx';
import { FocusNav } from 'openfilm/studio-ui/components/FocusNav.tsx';
import { applyStudioHost } from 'openfilm/studio-ui/lib/host.ts';
import { mountChat } from '../chat/src/mount';
import './shell.css';
import '../chat/src/chat.css';
import './polish.css';
import './workspace-theme.css';

async function start() {
  await layoutReady;
  applyStudioHost();
  createRoot(document.getElementById('root')!).render(<StrictMode><FocusNav /><App /><ResizeCursor /></StrictMode>);
  void mountChat(document.getElementById('of-chat')!);
}
void start();
