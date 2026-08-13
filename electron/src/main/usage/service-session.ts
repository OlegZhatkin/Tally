import { BrowserWindow } from 'electron';
import type { ServiceId } from '../../shared/types';
import { lifecycle } from '../lifecycle';

interface ServiceSessionOptions {
  id: ServiceId;
  /** Например `https://claude.ai` — с этого origin выполняются все fetch-и. */
  origin: string;
  loginUrl: string;
  title: string;
}

const LOAD_TIMEOUT_MS = 20_000;

/**
 * Одно скрытое окно на сервис, живущее весь сеанс работы приложения.
 * Логин и запросы данных идут через один и тот же webContents, поэтому куки
 * и сессия гарантированно общие — как это было с общим WKWebView в Swift-версии.
 */
export class ServiceSession {
  private win: BrowserWindow | null = null;
  private pendingLoad: Promise<boolean> | null = null;
  private loginMode = false;
  private loginDone: (() => void) | null = null;

  constructor(private readonly opts: ServiceSessionOptions) {}

  private ensureWindow(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win;

    const win = new BrowserWindow({
      show: false,
      width: 1000,
      height: 760,
      title: this.opts.title,
      webPreferences: {
        partition: `persist:${this.opts.id}`,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });

    // Заголовок наш, а не тот, что подставит страница.
    win.on('page-title-updated', (event) => event.preventDefault());

    // Окно нужно переиспользовать, поэтому закрытие превращаем в скрытие.
    win.on('close', (event) => {
      if (win.isDestroyed() || lifecycle.quitting) return;
      event.preventDefault();
      win.hide();
      this.finishLogin();
    });

    // Всплывающие окна OAuth (Google, Apple) должны открываться в том же partition.
    win.webContents.setWindowOpenHandler(() => ({ action: 'allow' }));

    // Пока открыт логин — после каждой навигации проверяем, не авторизовались ли уже.
    const onNavigate = () => {
      if (this.loginMode) setTimeout(() => void this.checkLoginFinished(), 1200);
    };
    win.webContents.on('did-navigate', onNavigate);
    win.webContents.on('did-navigate-in-page', onNavigate);

    this.win = win;
    return win;
  }

  /** Гарантирует, что окно открыто на нужном origin. `false` — загрузить не удалось. */
  async ready(): Promise<boolean> {
    const win = this.ensureWindow();
    const url = win.webContents.getURL();
    if (url.startsWith(this.opts.origin) && !win.webContents.isLoading()) return true;
    if (this.pendingLoad) return this.pendingLoad;

    this.pendingLoad = new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        win.webContents.off('did-finish-load', onLoad);
        win.webContents.off('did-fail-load', onFail);
        resolve(ok);
      };
      const onLoad = () => done(true);
      const onFail = (_e: unknown, code: number, desc: string) => {
        // -3 (ABORTED) прилетает при редиректах — это не отказ загрузки.
        if (code === -3) return;
        console.error(`[${this.opts.id}] загрузка не удалась: ${code} ${desc}`);
        done(false);
      };
      const timer = setTimeout(() => done(false), LOAD_TIMEOUT_MS);

      win.webContents.on('did-finish-load', onLoad);
      win.webContents.on('did-fail-load', onFail);
      win.loadURL(this.opts.origin).catch(() => done(false));
    }).finally(() => {
      this.pendingLoad = null;
    }) as Promise<boolean>;

    return this.pendingLoad;
  }

  /**
   * Выполняет тело async-функции в контексте страницы сервиса.
   * `body` пишется как тело функции: с `return`, без обёртки.
   */
  async run<T>(body: string): Promise<T | null> {
    if (!(await this.ready())) return null;
    const win = this.win;
    if (!win || win.isDestroyed()) return null;
    try {
      return (await win.webContents.executeJavaScript(`(async () => {\n${body}\n})()`, true)) as T;
    } catch (err) {
      console.error(`[${this.opts.id}] ошибка выполнения JS:`, err);
      return null;
    }
  }

  /** Показывает то же самое окно со страницей логина. */
  showLogin(onDone: () => void): void {
    const win = this.ensureWindow();
    this.loginMode = true;
    this.loginDone = onDone;
    win.loadURL(this.opts.loginUrl).catch((err) => console.error(`[${this.opts.id}] логин:`, err));
    win.show();
    win.focus();
  }

  /** Проверяет, завершился ли логин, и если да — прячет окно. */
  private async checkLoginFinished(): Promise<void> {
    if (!this.loginMode) return;
    const win = this.win;
    if (!win || win.isDestroyed()) return;
    if (!win.webContents.getURL().startsWith(this.opts.origin)) return;

    const loggedIn = await this.probeLoggedIn();
    if (loggedIn) {
      win.hide();
      this.finishLogin();
    }
  }

  /** Лёгкая проверка авторизации, не зависящая от парсинга лимитов. */
  private async probeLoggedIn(): Promise<boolean> {
    const result = await this.probe();
    return result.status === 200;
  }

  /**
   * Дёргает служебный эндпоинт сервиса из контекста страницы.
   * Cloudflare помечает свои заглушки заголовком `cf-mitigated` и отдаёт HTML —
   * по нему челлендж отличается от честного «не авторизован» (тоже 403).
   */
  private async probe(): Promise<ProbeResult> {
    const path = this.opts.id === 'claude' ? '/api/organizations' : '/backend-api/me';
    const result = await this.run<ProbeResult | null>(`
      try {
        const r = await fetch('${path}', { credentials: 'include', cache: 'no-store' });
        const ct = r.headers.get('content-type') || '';
        return { status: r.status, challenge: Boolean(r.headers.get('cf-mitigated')) || ct.includes('text/html') };
      } catch (e) {
        return { status: 0, challenge: false };
      }
    `);
    return result ?? { status: -1, challenge: false };
  }

  private finishLogin(): void {
    if (!this.loginMode) return;
    this.loginMode = false;
    const callback = this.loginDone;
    this.loginDone = null;
    // Небольшая пауза, чтобы куки успели записаться на диск.
    setTimeout(() => callback?.(), 500);
  }

  /**
   * Доступность сервиса из контекста реальной страницы — обычным HTTP-клиентом
   * её не проверить: Cloudflare отдаёт таким 403 даже при рабочем VPN.
   * `status: 0` — сеть недоступна, `-1` — окно не поднялось.
   */
  async probeReachability(): Promise<ProbeResult> {
    return this.probe();
  }
}

export interface ProbeResult {
  status: number;
  /** Ответ пришёл от Cloudflare, а не от сервиса. */
  challenge: boolean;
}
