import { app, ipcMain, shell } from 'electron';
import type { ServiceId, Settings, StatusBarMetric } from '../shared/types';
import { startClaudeWatcher } from './claude-watcher';
import { lifecycle } from './lifecycle';
import { getSettings, loadSettings, updateSettings } from './settings';
import { store } from './store';
import { TrayController } from './tray/tray';
import { PopupWindow } from './windows/popup';
import { VpnWarningWindow } from './windows/vpn-warning';

// Строка Electron/Tally в User-Agent ломает вход в Google и часть проверок Cloudflare.
const chromeMajor = process.versions.chrome.split('.')[0];
app.userAgentFallback =
  process.platform === 'win32'
    ? `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Safari/537.36`
    : `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Safari/537.36`;

const tray = new TrayController();
const popup = new PopupWindow();
const vpnWarning = new VpnWarningWindow();

let refreshTimer: NodeJS.Timeout | null = null;
let stopClaudeWatcher: (() => void) | null = null;
/** Защита от повторных предупреждений, если Claude мигнёт процессом. */
let lastWarningAt = 0;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => popup.show(tray.getBounds()));
  void app.whenReady().then(start);
}

function start(): void {
  loadSettings();
  if (process.platform === 'darwin') app.dock?.hide();

  tray.create({
    onToggle: () => popup.toggle(tray.getBounds()),
    onRefresh: () => void store.refresh(),
    onCheckVpn: () => void handleManualVpnCheck(),
    onSelectMetric: (metric: StatusBarMetric) => applySettings({ statusBarMetric: metric }),
    onQuit: () => quit(),
  });

  store.subscribe((state) => {
    popup.send(state);
    void tray.update(state);
  });

  void store.refresh();
  scheduleRefresh();
  stopClaudeWatcher = startClaudeWatcher(() => void handleClaudeLaunched());

  registerIpc();

  // Трей-приложение живёт без окон.
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => {
    lifecycle.quitting = true;
    stopClaudeWatcher?.();
    if (refreshTimer) clearInterval(refreshTimer);
  });
}

function scheduleRefresh(): void {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(() => void store.refresh(), getSettings().refreshMinutes * 60_000);
}

function applySettings(patch: Partial<Settings>): Settings {
  const before = getSettings().refreshMinutes;
  const next = updateSettings(patch);
  if (next.refreshMinutes !== before) scheduleRefresh();
  store.emit();
  return next;
}

/** Claude запустился: проверяем VPN и предупреждаем, если Claude оттуда не работает. */
async function handleClaudeLaunched(): Promise<void> {
  if (!getSettings().vpnWarningEnabled) return;
  if (Date.now() - lastWarningAt < 30_000) return;

  const status = await store.refreshVpn();
  // Предупреждаем только когда доступ действительно закрыт: 'unknown' ловит
  // проверку Cloudflare и обрывы сети, из-за них дёргать пользователя незачем.
  if (status.verdict !== 'blocked') return;

  lastWarningAt = Date.now();
  vpnWarning.show({ status, vpnAppPath: getSettings().vpnAppPath });
}

async function handleManualVpnCheck(): Promise<void> {
  const status = await store.refreshVpn();
  if (status.verdict === 'ok') {
    popup.show(tray.getBounds());
    return;
  }
  vpnWarning.show({ status, vpnAppPath: getSettings().vpnAppPath });
}

function registerIpc(): void {
  ipcMain.handle('state:get', () => store.getState());
  ipcMain.handle('usage:refresh', async () => {
    await store.refresh();
    return store.getState();
  });
  ipcMain.handle('settings:update', (_event, patch: Partial<Settings>) => applySettings(patch ?? {}));
  ipcMain.handle('vpn:recheck', async () => {
    const status = await store.refreshVpn();
    vpnWarning.update(status);
    return status;
  });

  ipcMain.on('usage:login', (_event, service: ServiceId) => {
    if (service !== 'claude' && service !== 'chatgpt') return;
    popup.hide();
    store.login(service);
  });

  ipcMain.on('vpn:open-app', () => {
    const path = getSettings().vpnAppPath;
    if (path) void shell.openPath(path);
  });
  ipcMain.on('vpn:close', () => vpnWarning.hide());
  ipcMain.on('popup:hide', () => popup.hide());
  ipcMain.on('app:quit', () => quit());
  ipcMain.on('open-external', (_event, url: string) => {
    if (typeof url === 'string' && /^https:\/\//.test(url)) void shell.openExternal(url);
  });
}

function quit(): void {
  lifecycle.quitting = true;
  tray.destroy();
  app.quit();
}
