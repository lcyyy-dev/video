import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useT } from '@/i18n';
import { useThemeMode } from './settings/theme';
import { Tooltip } from './Tooltip';

function subscribeSystemTheme(onChange: () => void) {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

/** One click chooses an explicit theme; Settings still offers following the system. */
export function ThemeToggle() {
  const t = useT();
  const [mode, setMode] = useThemeMode();
  const systemDark = React.useSyncExternalStore(subscribeSystemTheme,
    () => window.matchMedia('(prefers-color-scheme: dark)').matches, () => true);
  const isDark = mode === 'dark' || (mode === 'system' && systemDark);
  const next = isDark ? 'light' : 'dark';
  const label = t(`settings.appearance.${next}`);
  const description = `${t('settings.appearance.theme')}: ${label}`;
  const Icon = isDark ? Sun : Moon;
  return <Tooltip label={description} side="bottom">
    <button type="button" className="workspace-theme-toggle" aria-label={description} onClick={() => setMode(next)}>
      <Icon size={14} strokeWidth={1.7} aria-hidden="true" /><span>{label}</span>
    </button>
  </Tooltip>;
}
