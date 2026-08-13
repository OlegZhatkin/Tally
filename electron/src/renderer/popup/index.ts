import type { TallyApi } from '../../preload';
import { BRAND, METRIC_LABELS, fillColor, percentText } from '../../shared/format';
import type { AppState, ServiceId, StatusBarMetric, UsageBar } from '../../shared/types';
import { ICON, el } from '../dom';

declare global {
  interface Window {
    tally: TallyApi;
  }
}

const api = window.tally;
const root = document.getElementById('root') as HTMLElement;

const METRICS: StatusBarMetric[] = ['session', 'weekly_all', 'weekly_scoped', 'max', 'none'];

let state: AppState | null = null;
let tab: ServiceId = 'claude';
let showDebug = false;
let showSettings = false;
let spinning = false;

const clamp = (value: number) => Math.min(Math.max(value, 0), 1);
const accent = () => (tab === 'claude' ? BRAND.claude : BRAND.chatgpt);

// MARK: - Шапка и табы

function header(): HTMLElement {
  if (showSettings) {
    return el('header', { class: 'header' }, [
      el('button', {
        class: 'icon-btn',
        html: ICON.back,
        title: 'Назад',
        onClick: () => {
          showSettings = false;
          render();
        },
      }),
      el('h1', { text: 'Настройки' }),
      el('div', { class: 'spacer' }),
    ]);
  }

  return el('header', { class: 'header' }, [
    el('div', { class: 'badge', style: { background: accent() }, html: tab === 'claude' ? ICON.sparkles : ICON.chat }),
    el('h1', { text: tab === 'claude' ? 'Claude' : 'ChatGPT' }),
    el('div', { class: 'spacer' }),
    el('button', {
      class: `icon-btn${spinning ? ' spinning' : ''}`,
      html: ICON.refresh,
      title: 'Обновить',
      onClick: () => {
        spinning = true;
        render();
        setTimeout(() => {
          spinning = false;
        }, 500);
        void api.refresh();
      },
    }),
    el('button', {
      class: 'icon-btn',
      html: ICON.gear,
      title: 'Настройки',
      onClick: () => {
        showSettings = true;
        render();
      },
    }),
  ]);
}

function tabs(): HTMLElement {
  const make = (id: ServiceId, title: string, color: string) =>
    el('button', {
      class: `tab${tab === id ? ' active' : ''}`,
      text: title,
      style: tab === id ? { background: color } : {},
      onClick: () => {
        tab = id;
        render();
      },
    });

  return el('div', { class: 'tabs' }, [make('claude', 'Claude', BRAND.claude), make('chatgpt', 'ChatGPT', BRAND.chatgpt)]);
}

// MARK: - Карточки

function metricCard(bar: UsageBar): HTMLElement {
  const fraction = clamp(bar.percent);
  const color = fillColor(bar.kind, fraction);

  return el('div', { class: 'card fade-in' }, [
    el('div', { class: 'metric-head' }, [
      el('div', { class: 'metric-label', text: bar.label }),
      el('div', { class: 'metric-value', style: { color } }, [
        fraction > 0.8 ? el('span', { html: ICON.warning }) : null,
        el('span', { text: percentText(fraction) }),
      ]),
    ]),
    el('div', { class: 'bar-track' }, [
      el('div', { class: 'bar-fill', style: { width: `${fraction * 100}%`, background: color } }),
    ]),
    bar.resetAt
      ? el('div', { class: 'metric-reset' }, [el('span', { html: ICON.clock }), el('span', { text: bar.resetAt })])
      : null,
  ]);
}

function vpnChip(current: AppState): HTMLElement {
  const { verdict, country, reason } = current.vpn;
  const color = verdict === 'ok' ? BRAND.weekAll : verdict === 'blocked' ? BRAND.danger : 'var(--text-tertiary)';
  const text =
    verdict === 'ok' ? `Claude доступен${country ? ` · выход через ${country}` : ''}` : reason;

  return el('div', { class: 'vpn-chip' }, [
    el('span', { class: 'vpn-dot', style: { background: color } }),
    el('span', { text }),
    el('button', { text: 'Проверить', onClick: () => void api.recheckVpn() }),
  ]);
}

function stateCard(icon: string, title: string, text: string, color: string, action?: HTMLElement): HTMLElement {
  return el('div', { class: 'state fade-in' }, [
    el('div', { class: 'state-circle', style: { background: `${color}26`, color }, html: icon }),
    el('div', { class: 'state-title', text: title }),
    text ? el('div', { class: 'state-text', text }) : null,
    action ?? null,
  ]);
}

function loginCard(service: ServiceId): HTMLElement {
  const name = service === 'claude' ? 'Claude' : 'ChatGPT';
  const color = service === 'claude' ? BRAND.claude : BRAND.chatgpt;
  const button = el('button', {
    class: 'btn-primary',
    text: `Войти в ${name}`,
    style: { background: color, 'margin-top': '6px' },
    onClick: () => api.login(service),
  });
  return stateCard(
    service === 'claude' ? ICON.sparkles : ICON.chat,
    `Войдите в ${name}`,
    'Для отображения лимитов нужна авторизация',
    color,
    button
  );
}

/** Cloudflare решается только в видимом окне — предлагаем его открыть. */
function challengeCard(service: ServiceId): HTMLElement {
  const button = el('button', {
    class: 'btn-primary',
    text: 'Открыть окно проверки',
    style: { background: BRAND.scoped, 'margin-top': '6px' },
    onClick: () => api.login(service),
  });
  return stateCard(
    ICON.shield,
    'Cloudflare просит проверку',
    'Окно откроется, проверка пройдёт сама за пару секунд и закроется',
    BRAND.scoped,
    button
  );
}

function claudeView(current: AppState): HTMLElement[] {
  const usage = current.claude;

  if (usage.isLoading && usage.bars.length === 0) {
    return [el('div', { class: 'state' }, [el('div', { class: 'spinner' }), el('div', { class: 'state-text', text: 'Загрузка…' })])];
  }
  if (usage.needsChallenge) return [vpnChip(current), challengeCard('claude')];
  if (!usage.isLoggedIn) return [vpnChip(current), loginCard('claude')];
  if (usage.error && usage.bars.length === 0) {
    return [vpnChip(current), stateCard(ICON.warning, 'Не удалось получить лимиты', usage.error, BRAND.warning)];
  }
  if (usage.bars.length === 0) {
    return [vpnChip(current), stateCard(ICON.seal, 'Лимиты не найдены', 'Возможно, у вас безлимитный план', BRAND.weekAll)];
  }
  return [vpnChip(current), ...usage.bars.map(metricCard)];
}

function chatgptView(current: AppState): HTMLElement[] {
  const usage = current.chatgpt;

  if (usage.isLoading && !usage.planName) {
    return [el('div', { class: 'state' }, [el('div', { class: 'spinner' }), el('div', { class: 'state-text', text: 'Загрузка…' })])];
  }
  if (usage.needsChallenge) return [challengeCard('chatgpt')];
  if (!usage.isLoggedIn) return [loginCard('chatgpt')];
  if (usage.error) return [stateCard(ICON.warning, 'Ошибка', usage.error, BRAND.warning)];

  return [
    el('div', { class: 'card fade-in' }, [
      el('div', { class: 'metric-label', text: 'Тарифный план' }),
      el('div', { class: 'plan-row' }, [
        el('div', { class: 'badge', style: { background: BRAND.chatgpt }, html: ICON.chat }),
        el('div', { class: 'plan-name', text: usage.planName || '—' }),
      ]),
      usage.planStatus ? el('div', { class: 'metric-reset', text: usage.planStatus }) : null,
      el('div', {
        class: 'card-note',
        text: 'ChatGPT не отдаёт остаток лимитов через API, поэтому показывается только план подписки.',
      }),
    ]),
  ];
}

// MARK: - Настройки

function toggleRow(label: string, hint: string | null, value: boolean, onToggle: (next: boolean) => void): HTMLElement {
  return el('div', { class: 'settings-row clickable', onClick: () => onToggle(!value) }, [
    el('div', { class: 'label' }, [
      el('div', { text: label }),
      hint ? el('div', { class: 'hint', text: hint }) : null,
    ]),
    el('div', { class: `switch${value ? ' on' : ''}` }, [el('div', { class: 'knob' })]),
  ]);
}

function numberRow(label: string, hint: string | null, value: number, onCommit: (next: number) => void): HTMLElement {
  const input = el('input', { attrs: { type: 'number', min: '1', max: '240', value: String(value) } });
  input.addEventListener('change', () => onCommit(Number(input.value)));
  return el('div', { class: 'settings-row' }, [
    el('div', { class: 'label' }, [el('div', { text: label }), hint ? el('div', { class: 'hint', text: hint }) : null]),
    input,
  ]);
}

function settingsView(current: AppState): HTMLElement[] {
  const { settings } = current;

  const metricRows = METRICS.map((metric) =>
    el('div', { class: 'settings-row clickable', onClick: () => void api.updateSettings({ statusBarMetric: metric }) }, [
      el('div', { class: 'label', text: METRIC_LABELS[metric] }),
      el('div', { class: 'radio-mark', html: settings.statusBarMetric === metric ? ICON.check : '' }),
    ])
  );

  const countriesInput = el('input', {
    attrs: { type: 'text', value: settings.blockedCountries.join(', ') },
    title: 'Коды стран через запятую',
  });
  countriesInput.addEventListener('change', () => {
    void api.updateSettings({
      blockedCountries: countriesInput.value
        .split(',')
        .map((code) => code.trim().toUpperCase())
        .filter(Boolean),
    });
  });

  const vpnAppName = settings.vpnAppPath ? settings.vpnAppPath.split(/[/\\]/).pop() ?? '' : 'не найден';

  return [
    el('div', { class: 'settings-group' }, [
      el('div', { class: 'settings-title', text: 'Процент в статус-баре' }),
      ...metricRows,
    ]),
    el('div', { class: 'settings-group' }, [
      el('div', { class: 'settings-title', text: 'VPN' }),
      toggleRow(
        'Предупреждать при запуске Claude',
        'Проверяет доступность Claude, когда открывается десктопное приложение',
        settings.vpnWarningEnabled,
        (next) => void api.updateSettings({ vpnWarningEnabled: next })
      ),
      el('div', { class: 'settings-row' }, [
        el('div', { class: 'label' }, [
          el('div', { text: 'Страны без доступа' }),
          el('div', { class: 'hint', text: 'Коды через запятую' }),
        ]),
        countriesInput,
      ]),
      el('div', { class: 'settings-row' }, [
        el('div', { class: 'label' }, [
          el('div', { text: 'VPN-клиент' }),
          el('div', { class: 'hint', text: vpnAppName }),
        ]),
      ]),
    ]),
    el('div', { class: 'settings-group' }, [
      el('div', { class: 'settings-title', text: 'Обновление' }),
      numberRow('Интервал, мин', 'Как часто перезапрашивать лимиты', settings.refreshMinutes, (next) =>
        void api.updateSettings({ refreshMinutes: next })
      ),
      toggleRow('Запускать при входе в систему', null, settings.launchAtLogin, (next) =>
        void api.updateSettings({ launchAtLogin: next })
      ),
    ]),
  ];
}

// MARK: - Подвал

function footer(current: AppState): HTMLElement {
  return el('footer', { class: 'footer' }, [
    el('button', {
      class: `debug-btn${showDebug ? ' active' : ''}`,
      html: `${ICON.search}<span>Debug</span>`,
      onClick: () => {
        showDebug = !showDebug;
        render();
      },
    }),
    el('div', { class: 'spacer' }),
    el('div', { text: `Обновляется каждые ${current.settings.refreshMinutes} мин` }),
    el('div', { class: 'spacer' }),
    el('button', { text: 'Выход', onClick: () => api.quit() }),
  ]);
}

// MARK: - Сборка

function render(): void {
  if (!state) return;
  const current = state;

  const body = showSettings
    ? settingsView(current)
    : tab === 'claude'
      ? claudeView(current)
      : chatgptView(current);

  if (showDebug && !showSettings) {
    const raw = (tab === 'claude' ? current.claude.debugRaw : current.chatgpt.debugRaw).trim();
    body.push(el('div', { class: 'card' }, [el('div', { class: 'debug', text: raw || '(пусто — JS не вернул данных)' })]));
  }

  root.replaceChildren(
    header(),
    ...(showSettings ? [] : [tabs()]),
    el('main', { class: 'content' }, body),
    footer(current)
  );
}

api.onState((next) => {
  state = next;
  render();
});

void api.getState().then((initial) => {
  state = initial;
  render();
});

// Esc закрывает попап — привычнее, чем искать иконку в трее.
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') api.hidePopup();
});
