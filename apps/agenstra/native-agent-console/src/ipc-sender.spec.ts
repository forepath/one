import { appOrigin, ipcSenderAllowed, type IpcSenderInfo } from './ipc-sender';

const origin = appOrigin(4321);
const main: IpcSenderInfo = { url: `${origin}/agents`, isTopFrame: true, isMainWindow: true, isConfigDialog: false };

describe('IPC sender validation', () => {
  it('allows the main window on the app origin', () => {
    expect(ipcSenderAllowed('privileged', main, origin)).toBe(true);
    expect(ipcSenderAllowed('window', main, origin)).toBe(true);
  });

  it('allows the config dialog', () => {
    const dialog = {
      url: 'data:text/html;charset=utf-8,...',
      isTopFrame: true,
      isMainWindow: false,
      isConfigDialog: true,
    };

    expect(ipcSenderAllowed('privileged', dialog, origin)).toBe(true);
    expect(ipcSenderAllowed('privileged', { ...dialog, url: 'https://evil.example/' }, origin)).toBe(false);
  });

  it('refuses iframes, other origins and vanished frames', () => {
    expect(ipcSenderAllowed('privileged', { ...main, isTopFrame: false }, origin)).toBe(false);
    expect(ipcSenderAllowed('window', { ...main, url: 'https://evil.example/' }, origin)).toBe(false);
    expect(ipcSenderAllowed('privileged', { ...main, url: 'http://localhost:9999/' }, origin)).toBe(false);
    expect(ipcSenderAllowed('privileged', { ...main, url: undefined }, origin)).toBe(false);
    expect(ipcSenderAllowed('privileged', { ...main, url: 'not a url' }, origin)).toBe(false);
  });

  it('limits pop-ups on the app origin to window controls', () => {
    const popup = { ...main, isMainWindow: false };

    expect(ipcSenderAllowed('window', popup, origin)).toBe(true);
    expect(ipcSenderAllowed('privileged', popup, origin)).toBe(false);
  });
});
