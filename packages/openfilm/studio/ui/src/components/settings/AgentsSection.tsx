/** The advertising client's single local agent, with connection and installation diagnostics. */
import React from 'react';
import { Copy, Download, Loader2 } from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { studioHost, type HostAgent, type HostAgentDiagnosis, type HostAgentId, type HostAgentUsage } from '@/lib/host';
import { ProviderMark } from './ProviderMark';
import { SettingsButton, SettingsGroup, SettingsInset, SettingsItem, SettingsLinkButton, SettingsPage, SettingsStatus, settingsError } from './ui';

const PLAN_AGENTS: readonly HostAgentId[] = ['codex'];

function useHostAgents(): HostAgent[] | null {
  const [agents, setAgents] = React.useState<HostAgent[] | null>(null);
  React.useEffect(() => {
    const host = studioHost?.agents;
    if (!host) return undefined;
    let live = true;
    void host.list().then((list) => { if (live) setAgents(list); }).catch(() => {});
    const stop = host.onChange((list) => setAgents(list));
    /* a sign-in finished in Terminal: coming back is the moment to look again */
    const onFocus = () => { void host.list().then((list) => { if (live) setAgents(list); }).catch(() => {}); };
    window.addEventListener('focus', onFocus);
    return () => { live = false; stop(); window.removeEventListener('focus', onFocus); };
  }, []);
  return agents;
}

/** The person's own agents (the app's AGENTS), in the roster's order. */
/** whose maker's mark is its company's */


/**
 * What is left of Codex's plan, when it is ready: asked as it becomes ready and when the window comes back into focus
 * (the app keeps an answer a minute). `undefined`: being asked; null: it can't say.
 */
function useAgentUsage(agents: HostAgent[] | null): Partial<Record<HostAgentId, HostAgentUsage | null | undefined>> {
  const [usage, setUsage] = React.useState<Partial<Record<HostAgentId, HostAgentUsage | null | undefined>>>({});
  const ready = (agents ?? []).filter((a) => PLAN_AGENTS.includes(a.id) && a.status === 'ready').map((a) => a.id).join(',');
  React.useEffect(() => {
    const ask = studioHost?.agents?.usage;
    if (!ask || !ready) return undefined;
    let live = true;
    const look = () => {
      for (const id of ready.split(',') as HostAgentId[]) {
        void ask(id).then((u) => { if (live) setUsage((was) => ({ ...was, [id]: u })); }).catch(() => { if (live) setUsage((was) => ({ ...was, [id]: null })); });
      }
    };
    look();
    window.addEventListener('focus', look);
    return () => { live = false; window.removeEventListener('focus', look); };
  }, [ready]);
  return usage;
}

/** One window of a plan: what it is, a bar of its share used, and when it resets. */
function UsageBar({ window: w }: { window: HostAgentUsage['windows'][number] }) {
  const t = useT();
  const language = useLanguage();
  const label = w.kind === 'five_hour' ? t('settings.agents.usageFiveHour')
    : w.kind === 'seven_day' ? t('settings.agents.usageWeek')
    : t('settings.agents.usageWindow').replace('{hours}', String(Math.round((w.minutes ?? 0) / 60)));
  const used = Math.round(w.usedPercent);
  const resets = (() => {
    if (w.resetsAt == null) return null;
    const minutes = Math.max(0, Math.round((w.resetsAt - Date.now()) / 60_000));
    const rtf = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
    const when = minutes < 60 ? rtf.format(minutes, 'minute') : minutes < 48 * 60 ? rtf.format(Math.round(minutes / 60), 'hour') : rtf.format(Math.round(minutes / 1440), 'day');
    return t('settings.agents.usageResets').replace('{time}', when);
  })();
  return (
    <div className="flex items-center gap-3 text-[13px]">
      <span className="w-[92px] shrink-0 text-[var(--text-muted)]">{label}</span>
      <div className="h-1.5 min-w-[80px] flex-1 overflow-hidden rounded-full bg-[var(--fill-tsp)]" role="progressbar" aria-label={label} aria-valuenow={used} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full rounded-full ${used >= 90 ? 'bg-[var(--danger,#e5484d)]' : used >= 70 ? 'bg-[var(--warn,#f5a524)]' : 'bg-[var(--text)]'}`} style={{ width: `${Math.max(used, 1.5)}%` }} />
      </div>
      <span className="w-[64px] shrink-0 text-right tabular-nums text-[var(--text)]">{t('settings.agents.usageUsed').replace('{percent}', String(used))}</span>
      <span className="w-[120px] shrink-0 truncate text-[var(--text-faint)]">{resets ?? ''}</span>
    </div>
  );
}

export function AgentsSection() {
  const t = useT();
  const agents = useHostAgents();
  const usage = useAgentUsage(agents?.filter((agent) => agent.id === 'codex') ?? null);
  const host = studioHost?.agents;
  const agent = agents?.find((entry) => entry.id === 'codex');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [diagnosis, setDiagnosis] = React.useState<HostAgentDiagnosis | null>(null);
  const [looking, setLooking] = React.useState(false);
  if (!host) return null;

  const act = async (run: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const result = await run() as { ok?: boolean; error?: string } | undefined;
      if (result?.ok === false) setError(result.error ?? t('settings.agents.failed'));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };
  const locate = () => act(async () => {
    const result = await host.locate!('codex', {
      title: t('settings.agents.locateTitle').replace('{name}', 'Codex'),
      button: t('settings.agents.locateButton'),
    });
    if (result.ok) setDiagnosis(null);
    if (result.ok || (!result.error && !result.code)) return { ok: true };
    return result;
  });
  const diagnose = async () => {
    setLooking(true);
    setError(null);
    try { setDiagnosis(await host.diagnose!('codex')); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLooking(false); }
  };
  const status = !agent || agent.status === 'checking' ? 'checking'
    : agent.status === 'ready' ? 'ready'
    : agent.status === 'sign-in' ? 'signedOut'
    : agent.status === 'waiting' ? 'waiting'
    : agent.status === 'missing' ? 'missing' : 'off';
  const account = usage.codex?.account ?? agent?.account;
  const accountLabel = [account?.email, account?.plan].filter(Boolean).join(' · ');
  const plan = usage.codex;
  return (
    <SettingsPage note={t(agent?.managed ? 'settings.agents.managedIntro' : 'settings.agents.intro')}>
      <SettingsGroup title="Codex">
        <SettingsItem title="Codex" mark={<ProviderMark id="openai" size={17} />}
          badge={agent?.status === 'ready' ? <SettingsStatus>{t('settings.agents.ready')}</SettingsStatus> : undefined}
          description={accountLabel || t(`settings.agents.${status}`)}
          control={(
            <>
              {status === 'checking' ? <Loader2 size={16} className="animate-spin" /> : null}
              {agent?.status === 'ready' ? (
                <SettingsButton disabled={busy} onClick={() => void act(() => host.disconnect('codex'))}>{t('settings.agents.disconnect')}</SettingsButton>
              ) : agent && status !== 'checking' ? (
                <>
                  {agent.status === 'missing' && agent.install ? <SettingsLinkButton href={agent.install}><Download size={16} />{t('settings.agents.install')}</SettingsLinkButton> : null}
                  {!agent.managed && host.locate && (agent.status === 'missing' || agent.status === 'off') ? <SettingsButton disabled={busy} onClick={() => void locate()}>{t('settings.agents.locate')}</SettingsButton> : null}
                  {agent.status !== 'missing' ? <SettingsButton disabled={busy || agent.status === 'waiting'} onClick={() => void act(() => host.connect('codex'))}>
                    {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                    {t(agent.status === 'sign-in' ? 'settings.agents.signIn' : 'settings.agents.connect')}
                  </SettingsButton> : null}
                </>
              ) : null}
            </>
          )}>
          <div className="flex flex-col gap-3 pl-[34px]">
            {agent?.path ? <p className="break-all text-[12px] text-[var(--text-faint)]">{agent.path}</p> : null}
            {agent?.chosen && host.useAutomatic ? <SettingsButton disabled={busy} onClick={() => void act(() => host.useAutomatic!('codex'))}>{t('settings.agents.automatic')}</SettingsButton> : null}
            {agent?.status === 'waiting' ? <p className="text-[13px] text-[var(--text-muted)]">{t('settings.agents.waitingHint')} <button type="button" className="underline" disabled={busy} onClick={() => void act(() => host.connect('codex'))}>{t('settings.agents.startAgain')}</button></p> : null}
            {agent?.status === 'ready' && host.usage && plan === undefined ? <p className="text-[13px] text-[var(--text-muted)]">{t('settings.agents.usageLoading')}</p> : null}
            {agent?.status === 'ready' ? plan?.windows.map((window) => <UsageBar key={window.kind + (window.minutes ?? '')} window={window} />) : null}
            {error || agent?.error || agent?.problem ? <p role="alert" className={settingsError}>{error ?? agent?.error ?? agent?.problem}</p> : null}
            {host.diagnose ? <SettingsButton disabled={looking} onClick={() => void diagnose()}>{looking ? t('settings.agents.searching') : t('settings.agents.whyMissing')}</SettingsButton> : null}
            {diagnosis ? <SettingsInset>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all text-[12px] text-[var(--text-muted)]">{diagnosis.text}</pre>
              <SettingsButton onClick={() => { void navigator.clipboard.writeText(diagnosis.text).catch(() => setError(t('settings.agents.failed'))); }}><Copy size={14} />{t('settings.agents.copyReport')}</SettingsButton>
            </SettingsInset> : null}
          </div>
        </SettingsItem>
      </SettingsGroup>
    </SettingsPage>
  );
}
