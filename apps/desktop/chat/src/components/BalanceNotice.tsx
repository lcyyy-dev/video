/**
 * A turn the app's own agent could not finish because the service its model runs on has no balance left (lib/balance):
 * the same words for every service, and "Manage", its own page to top it up, when the app knows it.
 */
import { useT } from '@/i18n';
import type { Balance } from '@/lib/balance';

export function BalanceNotice({ balance }: { balance: Balance }) {
  const t = useT();
  return (
    <p role="status" className="text-xs text-[var(--warn)]">
      <b className="font-medium">{t('balance.title').replaceAll('{provider}', '服务')}</b>{' '}
      {t('balance.body').replaceAll('{provider}', '服务')}

    </p>
  );
}
