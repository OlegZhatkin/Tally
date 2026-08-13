import type { ServiceUsage } from '../../shared/types';
import { emptyUsage } from '../../shared/types';
import type { ServiceSession } from './service-session';

interface ChatGPTResponse {
  loggedIn?: boolean;
  challenge?: boolean;
  entitlement?: { subscription_plan?: string; has_active_subscription?: boolean; renews_at?: string };
  subscription?: { will_renew?: boolean };
  error?: string;
  log?: string;
  raw?: string;
}

// У ChatGPT нет эндпоинта с остатком лимитов, поэтому забираем тарифный план.
const CHATGPT_JS = `
let log = [];
try {
    const meR = await fetch('/backend-api/me', { credentials: 'include' });
    const contentType = meR.headers.get('content-type') || '';
    const challenge = Boolean(meR.headers.get('cf-mitigated')) || contentType.includes('text/html');
    log.push('me:' + meR.status + (challenge ? ' cf-challenge' : ''));
    if (challenge) {
        return { loggedIn: false, challenge: true, log: log.join(' ') };
    }
    if (meR.status === 401 || meR.status === 403) {
        return { loggedIn: false, log: log.join(' ') };
    }

    const r = await fetch('/backend-api/accounts/check/v4-2023-04-27', { credentials: 'include' });
    log.push('check:' + r.status);
    if (!r.ok) {
        return { loggedIn: true, error: 'check HTTP ' + r.status, log: log.join(' ') };
    }
    const data = await r.json();
    const accts = data.accounts || {};
    const acct = accts.default || Object.values(accts)[0] || {};
    const ent = acct.entitlement || null;
    const sub = acct.last_active_subscription || acct.active_subscription || null;
    return {
        loggedIn: true,
        entitlement: ent,
        subscription: sub,
        log: log.join(' '),
        raw: JSON.stringify({ entitlement: ent, subscription: sub }, null, 1).substring(0, 1800)
    };
} catch (e) {
    return { loggedIn: false, error: String(e), log: log.join(' ') };
}
`;

const PLAN_NAMES: Record<string, string> = {
  chatgptguestplan: 'Гость',
  chatgptfreeplan: 'Free',
  chatgptplusplan: 'Plus',
  chatgptproplan: 'Pro',
  chatgptteamplan: 'Team',
  chatgptenterpriseplan: 'Enterprise',
};

export async function fetchChatGPTPlan(session: ServiceSession): Promise<ServiceUsage> {
  const usage = emptyUsage();
  const json = await session.run<ChatGPTResponse>(CHATGPT_JS);

  if (!json) {
    usage.error = 'Не удалось открыть chatgpt.com — проверьте интернет';
    usage.debugRaw = 'страница не загрузилась';
    usage.updatedAt = Date.now();
    return usage;
  }

  usage.isLoggedIn = json.loggedIn === true;
  usage.needsChallenge = json.challenge === true;
  usage.error = json.error ?? null;
  usage.debugRaw = [json.log, json.error ? `error: ${json.error}` : '', json.raw]
    .filter((part): part is string => Boolean(part))
    .join('\n');

  const ent = json.entitlement;
  if (ent) {
    const slug = ent.subscription_plan ?? '';
    usage.planName = PLAN_NAMES[slug] ?? (slug || 'Неизвестно');

    if (ent.has_active_subscription) {
      let status = 'Активная подписка';
      if (ent.renews_at) {
        status += ` · продление ${ent.renews_at.slice(0, 10)}`;
      } else if (json.subscription?.will_renew === false) {
        status += ' · без автопродления';
      }
      usage.planStatus = status;
    } else {
      usage.planStatus = 'Без платной подписки';
    }
    usage.error = null;
  }

  usage.updatedAt = Date.now();
  return usage;
}
