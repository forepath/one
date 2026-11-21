/** Preload of the settings window: reads and changes the app settings. */
import { contextBridge, ipcRenderer } from 'electron';

export interface DesktopSettings {
  configUrl: string;
  updateChannel: 'stable' | 'beta';
  version: string;
  theme: 'light' | 'dark';
}

export interface SettingsChange {
  configUrl: string;
  updateChannel: 'stable' | 'beta';
}

contextBridge.exposeInMainWorld('settings', {
  get: (): Promise<DesktopSettings | undefined> => ipcRenderer.invoke('settings:get'),
  /** Resolves with `restart` when the server URL changed (the app restarts), `saved` otherwise, or `invalid`. */
  save: (change: SettingsChange): Promise<'restart' | 'saved' | 'invalid'> =>
    ipcRenderer.invoke('settings:save', change),
  checkForUpdates: (): Promise<boolean> => ipcRenderer.invoke('settings:check-for-updates'),
  close: (): Promise<boolean> => ipcRenderer.invoke('settings:close'),
});
