import { BrowserWindow, nativeImage } from 'electron';
import type { NativeImage } from 'electron';
import { join } from 'node:path';

export interface TrayIconRequest {
  text: string;
  color: string;
  /** 0..1 — заполнение полоски под цифрами. */
  fraction: number;
}

const CANVAS_SIZE = 32;

/**
 * В трее Windows у иконок нет текстовых подписей, поэтому процент приходится
 * рисовать прямо в битмап. Canvas живёт в скрытом окне — нативных зависимостей не нужно.
 */
export class TrayIconRenderer {
  private win: BrowserWindow | null = null;
  private ready: Promise<void> | null = null;
  private readonly cache = new Map<string, NativeImage>();

  private ensureWindow(): Promise<void> {
    if (this.ready) return this.ready;

    const win = new BrowserWindow({
      show: false,
      width: 64,
      height: 64,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    this.win = win;

    this.ready = win.loadFile(join(__dirname, '../renderer/icon/index.html'));
    return this.ready;
  }

  async render(request: TrayIconRequest): Promise<NativeImage | null> {
    const key = `${request.text}|${request.color}|${request.fraction.toFixed(2)}`;
    const cached = this.cache.get(key);
    if (cached) return cached;

    try {
      await this.ensureWindow();
      const win = this.win;
      if (!win || win.isDestroyed()) return null;

      const payload = JSON.stringify({ ...request, size: CANVAS_SIZE });
      const dataUrl = await win.webContents.executeJavaScript(`window.renderTrayIcon(${payload})`);
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) return null;

      const image = nativeImage.createFromDataURL(dataUrl);
      this.cache.set(key, image);
      return image;
    } catch (err) {
      console.error('[tray] не удалось отрисовать иконку:', err);
      return null;
    }
  }

  destroy(): void {
    this.cache.clear();
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
    this.win = null;
    this.ready = null;
  }
}
