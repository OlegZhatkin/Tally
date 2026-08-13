import type { TallyApi } from '../../preload';
import { BRAND } from '../../shared/format';
import type { VpnStatus } from '../../shared/types';
import { ICON, el } from '../dom';

declare global {
  interface Window {
    tally: TallyApi;
  }
}

const api = window.tally;
const root = document.getElementById('root') as HTMLElement;

let status: VpnStatus | null = null;
let vpnAppPath: string | null = null;
let checking = false;

function title(): string {
  if (checking) return 'Проверяю соединение…';
  if (status?.verdict === 'ok') return 'Всё в порядке — Claude доступен';
  if (status?.verdict === 'unknown') return 'Не удалось проверить доступ к Claude';
  return 'Claude запущен без работающего VPN';
}

function accent(): string {
  if (status?.verdict === 'ok') return BRAND.weekAll;
  if (status?.verdict === 'unknown') return BRAND.warning;
  return BRAND.danger;
}

/** Строка под текстом: время проверки и страна выхода — без повтора причины. */
function metaText(): string {
  const parts: string[] = [];
  if (status?.checkedAt) {
    const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(new Date(status.checkedAt));
    parts.push(`Проверено в ${time}`);
  }
  parts.push(status?.country ? `выход через ${status.country}` : 'страну выхода определить не удалось');
  return parts.join(' · ');
}

function render(): void {
  const color = accent();
  const isOk = status?.verdict === 'ok';

  root.replaceChildren(
    el('div', { class: 'warn-head' }, [
      el('div', {
        class: 'warn-circle',
        style: { background: `${color}26`, color },
        html: isOk ? ICON.shield : ICON.warning,
      }),
      el('div', { class: 'warn-title', text: title() }),
    ]),

    el('div', {
      class: 'warn-reason',
      text: isOk
        ? 'Соединение проходит, десктопным приложением можно пользоваться.'
        : `${status?.reason ?? ''} Включите VPN и перезапустите Claude — иначе приложение не сможет подключиться.`,
    }),

    el('div', { class: 'warn-meta' }, [
      el('span', { html: ICON.globe }),
      el('span', { text: metaText() }),
    ]),

    el('div', { class: 'warn-actions' }, [
      vpnAppPath && !isOk
        ? el('button', { class: 'btn-secondary', text: 'Открыть VPN', onClick: () => api.openVpnApp() })
        : null,
      el('button', {
        class: 'btn-secondary',
        text: checking ? 'Проверяю…' : 'Проверить снова',
        onClick: () => void recheck(),
      }),
      el('button', {
        class: 'btn-primary',
        text: 'Понятно',
        style: { background: color },
        onClick: () => api.closeVpnWarning(),
      }),
    ]),

    el('div', { class: 'warn-foot' }, [
      el('button', {
        text: 'Больше не предупреждать',
        onClick: () => {
          void api.updateSettings({ vpnWarningEnabled: false });
          api.closeVpnWarning();
        },
      }),
    ])
  );
}

async function recheck(): Promise<void> {
  if (checking) return;
  checking = true;
  render();

  status = await api.recheckVpn();
  checking = false;
  render();

  if (status.verdict === 'ok') setTimeout(() => api.closeVpnWarning(), 1500);
}

api.onVpnPayload((payload) => {
  status = payload.status;
  vpnAppPath = payload.vpnAppPath;
  render();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') api.closeVpnWarning();
});

render();
