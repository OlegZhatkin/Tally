/** Типы, общие для main-процесса и рендереров. */

export type ServiceId = 'claude' | 'chatgpt';

/** Вид лимита в ответе Claude: `limits[].kind`. */
export type LimitKind = 'session' | 'weekly_all' | 'weekly_scoped';

export interface UsageBar {
  kind: LimitKind | string;
  label: string;
  /** 0..1 */
  percent: number;
  /** Готовая строка «Сброс 26 июня, 07:00» — пусто, если API не отдал resets_at. */
  resetAt: string;
}

export interface ServiceUsage {
  bars: UsageBar[];
  isLoggedIn: boolean;
  isLoading: boolean;
  error: string | null;
  /**
   * Cloudflare отдал челлендж вместо ответа API. Решается только в видимом окне,
   * поэтому в интерфейсе показываем кнопку, а не молчаливую ошибку.
   */
  needsChallenge: boolean;
  debugRaw: string;
  /** Только ChatGPT: счётчиков лимитов у него нет, есть тарифный план. */
  planName: string;
  planStatus: string;
  updatedAt: number | null;
}

export type VpnVerdict = 'ok' | 'blocked' | 'unknown';

export interface VpnStatus {
  verdict: VpnVerdict;
  /** ISO-код страны, из которой виден исходящий трафик (по данным cdn-cgi/trace). */
  country: string | null;
  reason: string;
  checkedAt: number | null;
}

/** Какой лимит показывать процентом в статус-баре. */
export type StatusBarMetric = 'session' | 'weekly_all' | 'weekly_scoped' | 'max' | 'none';

export interface Settings {
  statusBarMetric: StatusBarMetric;
  refreshMinutes: number;
  vpnWarningEnabled: boolean;
  /** Страны, из которых Claude недоступен: если трафик выходит отсюда — считаем, что VPN не работает. */
  blockedCountries: string[];
  /** Путь к VPN-клиенту для кнопки «Открыть VPN» в предупреждении. */
  vpnAppPath: string | null;
  launchAtLogin: boolean;
}

export interface AppState {
  claude: ServiceUsage;
  chatgpt: ServiceUsage;
  vpn: VpnStatus;
  settings: Settings;
  platform: NodeJS.Platform;
}

export function emptyUsage(): ServiceUsage {
  return {
    bars: [],
    isLoggedIn: false,
    isLoading: false,
    error: null,
    needsChallenge: false,
    debugRaw: '',
    planName: '',
    planStatus: '',
    updatedAt: null,
  };
}
