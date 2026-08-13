import { BrowserWindow, screen } from 'electron';
import type { VpnStatus } from '../../shared/types';
import { lifecycle } from '../lifecycle';
import { preloadPath, rendererPath } from '../paths';

const WIDTH = 470;
const HEIGHT = 300;

export interface VpnWarningPayload {
  status: VpnStatus;
  /** Путь к VPN-клиенту: если его нет, кнопка «Открыть VPN» не показывается. */
  vpnAppPath: string | null;
}

/** Предупреждение о том, что Claude запущен без работающего VPN. */
export class VpnWarningWindow {
  private win: BrowserWindow | null = null;
  private pending: VpnWarningPayload | null = null;

  private ensure(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win;

    const win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      webPreferences: {
        preload: preloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    win.setAlwaysOnTop(true, 'floating');
    win.loadFile(rendererPath('vpn', 'index.html'));
    win.on('close', (event) => {
      if (win.isDestroyed() || lifecycle.quitting) return;
      event.preventDefault();
      win.hide();
    });
    // Рендерер сам просит данные, когда готов, — так payload не теряется при первом открытии.
    win.webContents.on('did-finish-load', () => this.flush());

    this.win = win;
    return win;
  }

  show(payload: VpnWarningPayload): void {
    this.pending = payload;
    const win = this.ensure();

    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const { x, y, width, height } = display.workArea;
    win.setPosition(Math.round(x + (width - WIDTH) / 2), Math.round(y + (height - HEIGHT) / 3));

    win.show();
    win.focus();
    this.flush();
  }

  /** Отдаёт рендереру последние данные, если окно уже загрузилось. */
  flush(): void {
    if (!this.pending || !this.win || this.win.isDestroyed()) return;
    this.win.webContents.send('vpn:payload', this.pending);
  }

  update(status: VpnStatus): void {
    if (!this.pending) return;
    this.pending = { ...this.pending, status };
    this.flush();
  }

  hide(): void {
    if (this.win && !this.win.isDestroyed()) this.win.hide();
  }

  isVisible(): boolean {
    return Boolean(this.win && !this.win.isDestroyed() && this.win.isVisible());
  }
}
