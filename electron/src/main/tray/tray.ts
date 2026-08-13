import { Menu, Tray, nativeImage } from 'electron';
import type { NativeImage } from 'electron';
import { BRAND, METRIC_LABELS, fillColor, percentText, pickStatusBar } from '../../shared/format';
import type { AppState, StatusBarMetric } from '../../shared/types';
import { assetPath } from '../paths';
import { TrayIconRenderer } from './icon-renderer';

export interface TrayCallbacks {
  onToggle: () => void;
  onRefresh: () => void;
  onCheckVpn: () => void;
  onSelectMetric: (metric: StatusBarMetric) => void;
  onQuit: () => void;
}

const METRIC_ORDER: StatusBarMetric[] = ['session', 'weekly_all', 'weekly_scoped', 'max', 'none'];

export class TrayController {
  private tray: Tray | null = null;
  private readonly iconRenderer = new TrayIconRenderer();
  private baseIcon: NativeImage | null = null;
  private callbacks: TrayCallbacks | null = null;

  create(callbacks: TrayCallbacks): Tray {
    this.callbacks = callbacks;

    // На macOS template-иконка сама подстраивается под светлое/тёмное меню.
    const iconFile = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray-win.png';
    this.baseIcon = nativeImage.createFromPath(assetPath(iconFile));
    if (process.platform === 'darwin') this.baseIcon.setTemplateImage(true);

    const tray = new Tray(this.baseIcon);
    tray.setToolTip('Tally');
    tray.on('click', () => callbacks.onToggle());
    tray.on('right-click', () => tray.popUpContextMenu(this.buildMenu('session')));
    this.tray = tray;
    return tray;
  }

  private buildMenu(activeMetric: StatusBarMetric): Menu {
    const cb = this.callbacks;
    return Menu.buildFromTemplate([
      { label: 'Открыть', click: () => cb?.onToggle() },
      { label: 'Обновить', click: () => cb?.onRefresh() },
      { label: 'Проверить VPN', click: () => cb?.onCheckVpn() },
      { type: 'separator' },
      {
        label: 'Показывать в трее',
        submenu: METRIC_ORDER.map((metric) => ({
          label: METRIC_LABELS[metric],
          type: 'radio' as const,
          checked: metric === activeMetric,
          click: () => cb?.onSelectMetric(metric),
        })),
      },
      { type: 'separator' },
      { label: 'Выход', click: () => cb?.onQuit() },
    ]);
  }

  getBounds(): Electron.Rectangle | null {
    return this.tray ? this.tray.getBounds() : null;
  }

  async update(state: AppState): Promise<void> {
    const tray = this.tray;
    if (!tray || tray.isDestroyed()) return;

    tray.removeAllListeners('right-click');
    tray.on('right-click', () => tray.popUpContextMenu(this.buildMenu(state.settings.statusBarMetric)));

    const bar = state.claude.isLoggedIn ? pickStatusBar(state.claude.bars, state.settings.statusBarMetric) : null;
    const text = bar ? percentText(bar.percent) : '';
    const color = bar ? fillColor(bar.kind, bar.percent) : BRAND.claude;

    if (process.platform === 'darwin') {
      tray.setTitle(text, { fontType: 'monospacedDigit' });
    } else if (!bar) {
      if (this.baseIcon) tray.setImage(this.baseIcon);
    } else {
      // Проценты в иконке: подписи к иконкам трея Windows не поддерживает.
      const image = await this.iconRenderer.render({
        text: String(Math.round(bar.percent * 100)),
        color,
        fraction: bar.percent,
      });
      if (image) tray.setImage(image);
      else if (this.baseIcon) tray.setImage(this.baseIcon);
    }

    tray.setToolTip(this.buildTooltip(state));
  }

  /** Тултип Windows обрезается на 127 символах — держим коротким. */
  private buildTooltip(state: AppState): string {
    if (!state.claude.isLoggedIn) return 'Tally — нужен вход в Claude';
    if (state.claude.bars.length === 0) return 'Tally — лимиты не найдены';

    const parts = state.claude.bars.map((bar) => {
      const short = bar.kind === 'session' ? 'Сессия' : bar.kind === 'weekly_all' ? 'Неделя' : 'Модель';
      return `${short} ${percentText(bar.percent)}`;
    });
    const vpn = state.vpn.verdict === 'blocked' ? '\n⚠ VPN не работает' : '';
    return `Claude · ${parts.join(' · ')}${vpn}`.slice(0, 127);
  }

  destroy(): void {
    this.iconRenderer.destroy();
    if (this.tray && !this.tray.isDestroyed()) this.tray.destroy();
    this.tray = null;
  }
}
