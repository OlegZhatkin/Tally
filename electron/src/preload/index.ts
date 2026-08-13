import { contextBridge, ipcRenderer } from 'electron';
import type { AppState, ServiceId, Settings, VpnStatus } from '../shared/types';
import type { VpnWarningPayload } from '../main/windows/vpn-warning';

/** Единственный мост между рендерерами и main-процессом. */
const api = {
  getState: (): Promise<AppState> => ipcRenderer.invoke('state:get'),
  onState: (callback: (state: AppState) => void): void => {
    ipcRenderer.on('state:update', (_event, state: AppState) => callback(state));
  },
  refresh: (): Promise<AppState> => ipcRenderer.invoke('usage:refresh'),
  login: (service: ServiceId): void => ipcRenderer.send('usage:login', service),
  updateSettings: (patch: Partial<Settings>): Promise<Settings> => ipcRenderer.invoke('settings:update', patch),
  hidePopup: (): void => ipcRenderer.send('popup:hide'),
  quit: (): void => ipcRenderer.send('app:quit'),
  openExternal: (url: string): void => ipcRenderer.send('open-external', url),

  // Окно предупреждения о VPN
  onVpnPayload: (callback: (payload: VpnWarningPayload) => void): void => {
    ipcRenderer.on('vpn:payload', (_event, payload: VpnWarningPayload) => callback(payload));
  },
  recheckVpn: (): Promise<VpnStatus> => ipcRenderer.invoke('vpn:recheck'),
  openVpnApp: (): void => ipcRenderer.send('vpn:open-app'),
  closeVpnWarning: (): void => ipcRenderer.send('vpn:close'),
};

export type TallyApi = typeof api;

contextBridge.exposeInMainWorld('tally', api);
