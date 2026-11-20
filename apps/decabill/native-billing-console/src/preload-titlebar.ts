/** Preload of the title bar view: window buttons, the settings gear and the window state. */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

export interface TitlebarState {
  title: string;
  maximized: boolean;
  focused: boolean;
  theme: 'light' | 'dark';
  platform: string;
}

contextBridge.exposeInMainWorld('titlebar', {
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  openSettings: () => ipcRenderer.invoke('settings:open'),
  onState: (listener: (state: TitlebarState | undefined) => void) => {
    ipcRenderer.on('window:state', (_event: IpcRendererEvent, state: TitlebarState) => listener(state));
    void ipcRenderer.invoke('window:get-state').then(listener);
  },
});
