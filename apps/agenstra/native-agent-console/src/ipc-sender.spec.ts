import {
  appOrigin,
  ipcSenderAllowed,
  isAppUrl,
  isExternalLink,
  isRendererPage,
  parseConfigUrl,
  type IpcSenderInfo,
} from './ipc-sender';

const origin = appOrigin(4321);
const renderer = 'file:///opt/app/resources/app.asar/renderer';
const titlebar: IpcSenderInfo = { url: `${renderer}/titlebar.html`, isTopFrame: true, fromExpectedView: true };
const settings: IpcSenderInfo = {
  url: `${renderer}/settings.html?theme=dark`,
  isTopFrame: true,
  fromExpectedView: true,
};
const console_: IpcSenderInfo = { url: `${origin}/agents`, isTopFrame: true, fromExpectedView: true };

describe('IPC sender validation', () => {
  it('allows each bundled page its own scope only', () => {
    expect(ipcSenderAllowed('titlebar', titlebar, origin)).toBe(true);
    expect(ipcSenderAllowed('settings', settings, origin)).toBe(true);
    expect(ipcSenderAllowed('settings', titlebar, origin)).toBe(false);
    expect(ipcSenderAllowed('titlebar', settings, origin)).toBe(false);
  });

  it('allows the console page on the app origin to report its theme', () => {
    expect(ipcSenderAllowed('console', console_, origin)).toBe(true);
    expect(ipcSenderAllowed('console', { ...console_, url: 'https://checkout.example/pay' }, origin)).toBe(false);
    expect(ipcSenderAllowed('console', { ...console_, url: 'http://localhost:9999/' }, origin)).toBe(false);
  });

  it('refuses the console page on the window and settings scopes', () => {
    expect(ipcSenderAllowed('titlebar', console_, origin)).toBe(false);
    expect(ipcSenderAllowed('settings', console_, origin)).toBe(false);
  });

  it('refuses other views, iframes, foreign files and vanished frames', () => {
    expect(ipcSenderAllowed('titlebar', { ...titlebar, fromExpectedView: false }, origin)).toBe(false);
    expect(ipcSenderAllowed('titlebar', { ...titlebar, isTopFrame: false }, origin)).toBe(false);
    expect(ipcSenderAllowed('titlebar', { ...titlebar, url: 'file:///tmp/titlebar.html' }, origin)).toBe(false);
    expect(ipcSenderAllowed('settings', { ...settings, url: 'data:text/html,<p>' }, origin)).toBe(false);
    expect(ipcSenderAllowed('titlebar', { ...titlebar, url: undefined }, origin)).toBe(false);
    expect(ipcSenderAllowed('console', { ...console_, url: 'not a url' }, origin)).toBe(false);
  });
});

describe('navigation policy', () => {
  it('recognises bundled pages', () => {
    expect(isRendererPage(`${renderer}/splash.html?version=1.0.0`, 'splash.html')).toBe(true);
    expect(isRendererPage('https://example.com/renderer/splash.html', 'splash.html')).toBe(false);
  });

  it('keeps app pages in the app and hands web links to the system browser', () => {
    expect(isAppUrl(`${origin}/clients/1/agents/2/vnc`, origin)).toBe(true);
    expect(isAppUrl('https://docs.example/', origin)).toBe(false);
    expect(isAppUrl(`${origin}/`, '')).toBe(false);
    expect(isExternalLink('https://docs.example/')).toBe(true);
    expect(isExternalLink('mailto:team@example.com')).toBe(true);
    expect(isExternalLink('file:///etc/passwd')).toBe(false);
    expect(isExternalLink('javascript:alert(1)')).toBe(false);
  });
});

describe('parseConfigUrl', () => {
  it('accepts http(s) URLs and resets on empty input', () => {
    expect(parseConfigUrl(' https://example.com/config.json ')).toBe('https://example.com/config.json');
    expect(parseConfigUrl('http://localhost:3000/config')).toBe('http://localhost:3000/config');
    expect(parseConfigUrl('')).toBe('');
    expect(parseConfigUrl('   ')).toBe('');
    expect(parseConfigUrl(null)).toBe('');
  });

  it('rejects anything else', () => {
    expect(parseConfigUrl('example.com/config.json')).toBeUndefined();
    expect(parseConfigUrl('file:///etc/config.json')).toBeUndefined();
    expect(parseConfigUrl(42)).toBeUndefined();
  });
});
