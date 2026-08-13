import { BrowserWindow, screen } from 'electron';
import type { AppState } from '../../shared/types';
import { lifecycle } from '../lifecycle';
import { preloadPath, rendererPath } from '../paths';

const WIDTH = 340;
const HEIGHT = 480;
const GAP = 6;

/** Попап у иконки трея: без рамки, скрывается по клику мимо. */
export class PopupWindow {
  private win: BrowserWindow | null = null;

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
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: true,
      webPreferences: {
        preload: preloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    win.loadFile(rendererPath('popup', 'index.html'));
    win.on('blur', () => win.hide());
    win.on('close', (event) => {
      if (win.isDestroyed() || lifecycle.quitting) return;
      event.preventDefault();
      win.hide();
    });

    this.win = win;
    return win;
  }

  /** Ставит попап рядом с иконкой трея, не вылезая за рабочую область экрана. */
  private position(win: BrowserWindow, trayBounds: Electron.Rectangle | null): void {
    const display = trayBounds
      ? screen.getDisplayMatching(trayBounds)
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const area = display.workArea;

    if (!trayBounds || trayBounds.width === 0) {
      win.setPosition(Math.round(area.x + area.width - WIDTH - GAP), Math.round(area.y + GAP));
      return;
    }

    let x = Math.round(trayBounds.x + trayBounds.width / 2 - WIDTH / 2);
    x = Math.min(Math.max(x, area.x + GAP), area.x + area.width - WIDTH - GAP);

    // Панель задач Windows обычно снизу — тогда попап открывается вверх.
    const trayIsAtBottom = trayBounds.y > area.y + area.height / 2;
    const y = trayIsAtBottom
      ? Math.round(trayBounds.y - HEIGHT - GAP)
      : Math.round(trayBounds.y + trayBounds.height + GAP);

    win.setPosition(x, Math.min(Math.max(y, area.y + GAP), area.y + area.height - HEIGHT - GAP));
  }

  toggle(trayBounds: Electron.Rectangle | null): void {
    const win = this.ensure();
    if (win.isVisible()) {
      win.hide();
      return;
    }
    this.show(trayBounds);
  }

  show(trayBounds: Electron.Rectangle | null): void {
    const win = this.ensure();
    this.position(win, trayBounds);
    win.show();
    win.focus();
  }

  hide(): void {
    if (this.win && !this.win.isDestroyed()) this.win.hide();
  }

  send(state: AppState): void {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('state:update', state);
  }

  isVisible(): boolean {
    return Boolean(this.win && !this.win.isDestroyed() && this.win.isVisible());
  }
}
