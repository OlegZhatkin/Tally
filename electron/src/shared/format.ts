import type { StatusBarMetric, UsageBar } from './types';

/** Фирменные цвета из дизайн-спеки. */
export const BRAND = {
  claude: '#D97757',
  chatgpt: '#10A37F',
  weekAll: '#1D9E75',
  scoped: '#378ADD',
  warning: '#E8743B',
  danger: '#E24B4A',
} as const;

/** Базовый цвет метрики по виду лимита. */
export function metricColor(kind: string): string {
  if (kind === 'weekly_all') return BRAND.weekAll;
  if (kind === 'weekly_scoped') return BRAND.scoped;
  return BRAND.claude;
}

/** Заполнение выше порогов перекрывает фирменный цвет. */
export function fillColor(kind: string, fraction: number): string {
  if (fraction > 0.95) return BRAND.danger;
  if (fraction > 0.8) return BRAND.warning;
  return metricColor(kind);
}

export function percentText(fraction: number): string {
  return `${Math.round(Math.min(Math.max(fraction, 0), 1) * 100)}%`;
}

/** Бар, который показывается процентом в статус-баре. */
export function pickStatusBar(bars: UsageBar[], metric: StatusBarMetric): UsageBar | null {
  if (metric === 'none' || bars.length === 0) return null;
  if (metric === 'max') {
    return bars.reduce((best, bar) => (bar.percent > best.percent ? bar : best), bars[0]);
  }
  return bars.find((bar) => bar.kind === metric) ?? null;
}

export const METRIC_LABELS: Record<StatusBarMetric, string> = {
  session: 'Сессия (5 ч)',
  weekly_all: 'Неделя · все модели',
  weekly_scoped: 'Неделя · отдельная модель',
  max: 'Максимальный из лимитов',
  none: 'Не показывать',
};
