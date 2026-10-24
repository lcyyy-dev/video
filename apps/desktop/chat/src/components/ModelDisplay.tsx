/** The current model and reasoning effort, displayed without configuration controls. */
import React from 'react';
import { KeyRound } from 'lucide-react';
import { useT } from '@/i18n';
import { AgentIcon } from './AgentIcons';
import { agentModelSummary, agentOptions, currentAgent, effectivePrefs, optionLabel, optionValue, shownAgents, useLocalAgents } from '@/state/local-agent-store';

export function ModelDisplay() {
  const t = useT();
  const state = useLocalAgents();
  const { hydrate, ensureOptions } = state;
  React.useEffect(() => { hydrate(); }, [hydrate]);
  const agent = currentAgent(state);
  const current = shownAgents(state.roster).find(entry => entry.id === agent);
  const ready = current?.status === 'ready';
  React.useEffect(() => { if (ready) void ensureOptions(agent); }, [agent, ready, ensureOptions]);
  const options = agentOptions(state, agent);
  const prefs = effectivePrefs(state.prefs, agent, state.roster, options);
  const summary = agentModelSummary(options, prefs);
  const modelOption = options?.find(option => option.category === 'model' || option.id === 'model');
  const modelValue = modelOption ? optionValue(options, prefs, modelOption.id) : null;
  // Show the actual identifier in full, rather than the adapter's shortened menu label.
  const fullModel = typeof modelValue === 'string' && modelValue !== 'default' ? modelValue
    : modelOption ? optionLabel(options, modelOption.id, modelValue) : null;
  const name = (ready && (fullModel || summary.model)) || (current ? agent === 'byok' ? t('composer.agentOwnKey') : current.name : t('composer.agentNone'));
  const effort = ready ? summary.effort : null;
  return <div className="composer-model-display" aria-label={t('composer.model')} title={[name, effort].filter(Boolean).join(' · ')}>
    <span className="composer-model-icon" aria-hidden="true">{agent === 'byok' ? <KeyRound size={13} /> : <AgentIcon id={agent} size={13} />}</span>
    <span className="composer-model-name">{name}</span>
    {effort ? <span className="composer-model-effort">{effort}</span> : null}
  </div>;
}
