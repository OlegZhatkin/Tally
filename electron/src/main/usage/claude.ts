import type { ServiceUsage, UsageBar } from '../../shared/types';
import { emptyUsage } from '../../shared/types';
import type { ServiceSession } from './service-session';

interface ClaudeResponse {
  loggedIn?: boolean;
  challenge?: boolean;
  usage?: { limits?: ClaudeLimit[] };
  error?: string;
  log?: string;
  raw?: string;
}

interface ClaudeLimit {
  kind?: string;
  /** Проценты 0..100. */
  percent?: number;
  resets_at?: string;
  scope?: { model?: { display_name?: string } };
}

// Тело async-функции, выполняемое на claude.ai: `limits` — источник истины по лимитам.
const CLAUDE_JS = `
let log = [];
try {
    const orgsResp = await fetch('/api/organizations', { credentials: 'include' });
    const contentType = orgsResp.headers.get('content-type') || '';
    // Заглушку Cloudflare нельзя путать с «не авторизован»: коды одинаковые (403).
    const challenge = Boolean(orgsResp.headers.get('cf-mitigated')) || contentType.includes('text/html');
    log.push('orgs:' + orgsResp.status + (challenge ? ' cf-challenge' : ''));
    if (challenge) {
        return { loggedIn: false, challenge: true, log: log.join(' ') };
    }
    if (orgsResp.status === 401 || orgsResp.status === 403) {
        return { loggedIn: false, log: log.join(' ') };
    }
    if (!orgsResp.ok) {
        return { loggedIn: false, error: 'orgs HTTP ' + orgsResp.status, log: log.join(' ') };
    }
    const orgs = await orgsResp.json();
    if (!orgs || orgs.length === 0) {
        return { loggedIn: true, error: 'нет организаций', log: log.join(' ') };
    }
    const orgId = orgs[0].uuid;
    log.push('org:' + orgId);

    const usageResp = await fetch('/api/organizations/' + orgId + '/usage', { credentials: 'include' });
    log.push('usage:' + usageResp.status);
    if (!usageResp.ok) {
        return { loggedIn: true, error: 'usage HTTP ' + usageResp.status, log: log.join(' ') };
    }
    const usage = await usageResp.json();
    return { loggedIn: true, usage: usage, log: log.join(' '), raw: JSON.stringify(usage).substring(0, 1800) };
} catch (e) {
    return { loggedIn: false, error: String(e), log: log.join(' ') };
}
`;

/** Порядок карточек в попапе и приоритет для статус-бара. */
const KIND_ORDER = ['session', 'weekly_all', 'weekly_scoped'];

function formatReset(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const formatted = new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
  return `Сброс ${formatted}`;
}

function labelFor(limit: ClaudeLimit): string {
  switch (limit.kind) {
    case 'session':
      return 'Текущая сессия (5 ч)';
    case 'weekly_all':
      return 'Неделя · все модели';
    case 'weekly_scoped': {
      const model = limit.scope?.model?.display_name;
      return model ? `Неделя · ${model}` : 'Неделя · отдельная модель';
    }
    default:
      return (limit.kind ?? 'неизвестный лимит').replace(/_/g, ' ');
  }
}

function parseBars(limits: ClaudeLimit[]): UsageBar[] {
  return limits
    .map((limit) => ({
      kind: limit.kind ?? 'unknown',
      label: labelFor(limit),
      percent: Math.min(Math.max((Number(limit.percent) || 0) / 100, 0), 1),
      resetAt: formatReset(limit.resets_at),
    }))
    .sort((a, b) => {
      const ai = KIND_ORDER.indexOf(a.kind);
      const bi = KIND_ORDER.indexOf(b.kind);
      return (ai === -1 ? KIND_ORDER.length : ai) - (bi === -1 ? KIND_ORDER.length : bi);
    });
}

export async function fetchClaudeUsage(session: ServiceSession): Promise<ServiceUsage> {
  const usage = emptyUsage();
  const json = await session.run<ClaudeResponse>(CLAUDE_JS);

  if (!json) {
    usage.error = 'Не удалось открыть claude.ai — проверьте интернет и VPN';
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

  const limits = json.usage?.limits;
  if (Array.isArray(limits)) {
    usage.bars = parseBars(limits);
    if (usage.bars.length > 0) usage.error = null;
  }

  usage.updatedAt = Date.now();
  return usage;
}
