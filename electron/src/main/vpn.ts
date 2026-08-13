import { net } from 'electron';
import type { Settings, VpnStatus } from '../shared/types';
import type { ServiceSession } from './usage/service-session';

const TRACE_URL = 'https://www.cloudflare.com/cdn-cgi/trace';
const TRACE_TIMEOUT_MS = 6_000;

/** GET с таймаутом через сетевой стек Chromium (уважает системный прокси). */
function httpGet(url: string, timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    const request = net.request({ url, method: 'GET', useSessionCookies: false });
    const timer = setTimeout(() => {
      request.abort();
      finish(null);
    }, timeoutMs);

    request.on('response', (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => finish(Buffer.concat(chunks).toString('utf8')));
      response.on('error', () => finish(null));
    });
    request.on('error', () => finish(null));
    request.end();
  });
}

/** Страна, из которой сеть видит исходящий трафик. `null` — определить не удалось. */
async function fetchExitCountry(): Promise<string | null> {
  const body = await httpGet(TRACE_URL, TRACE_TIMEOUT_MS);
  if (!body) return null;
  const match = /^loc=([A-Z]{2})$/m.exec(body.trim());
  return match ? match[1] : null;
}

/**
 * Проверяет, доступен ли Claude с текущим подключением.
 *
 * Два независимых сигнала:
 *  1. Страна выхода (cdn-cgi/trace) — быстрый и честный ответ обычному HTTP-клиенту.
 *  2. Реальный запрос к claude.ai из окна сессии — Cloudflare отдаёт 403 всем,
 *     кроме настоящего браузера, поэтому проверять доступность через net.request бесполезно.
 */
export async function checkVpn(session: ServiceSession, settings: Settings): Promise<VpnStatus> {
  const [country, reach] = await Promise.all([fetchExitCountry(), session.probeReachability()]);
  const checkedAt = Date.now();

  // Страна выхода — самый прямой ответ на вопрос «включён ли VPN».
  if (settings.blockedCountries.includes(country ?? '')) {
    return {
      verdict: 'blocked',
      country,
      reason: `Трафик выходит из страны ${country} — Claude оттуда недоступен. Похоже, VPN выключен.`,
      checkedAt,
    };
  }

  // Ответил сам сервис (в том числе 401/403 «не авторизован») — значит, соединение проходит.
  if (!reach.challenge && reach.status > 0) {
    return {
      verdict: 'ok',
      country,
      reason: country ? `Соединение через ${country}, claude.ai отвечает.` : 'claude.ai отвечает.',
      checkedAt,
    };
  }

  // Заглушка Cloudflare ничего не говорит о регионе: её получает любая свежая сессия.
  if (reach.challenge) {
    return {
      verdict: 'unknown',
      country,
      reason: 'Cloudflare показывает проверку — откройте окно Claude, чтобы её пройти.',
      checkedAt,
    };
  }

  if (!country) {
    return { verdict: 'unknown', country, reason: 'Нет подключения к интернету.', checkedAt };
  }

  return { verdict: 'unknown', country, reason: 'Не удалось проверить доступность claude.ai.', checkedAt };
}
