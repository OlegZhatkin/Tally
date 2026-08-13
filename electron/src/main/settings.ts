import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Settings } from '../shared/types';

const DEFAULTS: Settings = {
  statusBarMetric: 'session',
  refreshMinutes: 15,
  vpnWarningEnabled: true,
  blockedCountries: ['RU', 'BY'],
  vpnAppPath: null,
  launchAtLogin: false,
};

/** Кандидаты для кнопки «Открыть VPN» — берём первый существующий. */
const VPN_APP_CANDIDATES: Record<'darwin' | 'win32', string[]> = {
  darwin: [
    '/Applications/AmneziaVPN.app',
    '/Applications/Outline.app',
    '/Applications/WireGuard.app',
    '/Applications/Cloudflare WARP.app',
    '/Applications/ProtonVPN.app',
    '/Applications/NordVPN.app',
    '/Applications/Mullvad VPN.app',
    '/Applications/Windscribe.app',
  ],
  win32: [
    'C:\\Program Files\\AmneziaVPN\\AmneziaVPN.exe',
    'C:\\Program Files\\WireGuard\\wireguard.exe',
    'C:\\Program Files (x86)\\Outline\\Outline.exe',
    'C:\\Program Files\\Cloudflare\\Cloudflare WARP\\Cloudflare WARP.exe',
    'C:\\Program Files\\Proton\\VPN\\ProtonVPN.exe',
    'C:\\Program Files\\NordVPN\\NordVPN.exe',
    'C:\\Program Files\\Mullvad VPN\\Mullvad VPN.exe',
  ],
};

function detectVpnApp(): string | null {
  const candidates = VPN_APP_CANDIDATES[process.platform as 'darwin' | 'win32'] ?? [];
  return candidates.find((path) => existsSync(path)) ?? null;
}

let current: Settings = { ...DEFAULTS };
let filePath = '';
const listeners = new Set<(settings: Settings) => void>();

/** Приводит прочитанный с диска объект к валидным настройкам, отбрасывая мусор. */
function sanitize(raw: unknown): Settings {
  const input = (raw ?? {}) as Partial<Settings>;
  const metrics: Settings['statusBarMetric'][] = ['session', 'weekly_all', 'weekly_scoped', 'max', 'none'];
  return {
    statusBarMetric: metrics.includes(input.statusBarMetric as Settings['statusBarMetric'])
      ? (input.statusBarMetric as Settings['statusBarMetric'])
      : DEFAULTS.statusBarMetric,
    refreshMinutes: Math.min(240, Math.max(1, Number(input.refreshMinutes) || DEFAULTS.refreshMinutes)),
    vpnWarningEnabled: typeof input.vpnWarningEnabled === 'boolean' ? input.vpnWarningEnabled : DEFAULTS.vpnWarningEnabled,
    blockedCountries: Array.isArray(input.blockedCountries)
      ? input.blockedCountries.filter((c): c is string => typeof c === 'string').map((c) => c.trim().toUpperCase()).filter(Boolean)
      : [...DEFAULTS.blockedCountries],
    vpnAppPath: typeof input.vpnAppPath === 'string' && input.vpnAppPath ? input.vpnAppPath : null,
    launchAtLogin: typeof input.launchAtLogin === 'boolean' ? input.launchAtLogin : DEFAULTS.launchAtLogin,
  };
}

export function loadSettings(): Settings {
  filePath = join(app.getPath('userData'), 'settings.json');
  if (existsSync(filePath)) {
    try {
      current = sanitize(JSON.parse(readFileSync(filePath, 'utf8')));
    } catch (err) {
      console.error('[settings] не удалось прочитать, беру значения по умолчанию:', err);
      current = { ...DEFAULTS };
    }
  } else {
    current = { ...DEFAULTS, vpnAppPath: detectVpnApp() };
    persist();
  }
  syncLoginItem();
  return current;
}

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  current = sanitize({ ...current, ...patch });
  persist();
  syncLoginItem();
  listeners.forEach((fn) => fn(current));
  return current;
}

export function onSettingsChange(fn: (settings: Settings) => void): void {
  listeners.add(fn);
}

function persist(): void {
  if (!filePath) return;
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(current, null, 2), 'utf8');
  } catch (err) {
    console.error('[settings] не удалось сохранить:', err);
  }
}

/** Держит системный автозапуск в согласии с настройкой. */
function syncLoginItem(): void {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return;
  const actual = app.getLoginItemSettings().openAtLogin;
  if (actual !== current.launchAtLogin) {
    app.setLoginItemSettings({ openAtLogin: current.launchAtLogin, openAsHidden: true });
  }
}
