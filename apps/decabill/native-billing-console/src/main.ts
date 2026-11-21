/**
 * Desktop app: the console's SSR server on Electron's runtime, shown in app windows with their own frame.
 *
 * Start: splash (no frame, no buttons) -> SSR server on localhost -> main window: an own title bar (view, with the
 * settings gear and the window buttons) above the console (view); the splash closes once the console has loaded.
 * Pop-ups of console pages open as further app windows, other links in the system browser. The settings window is
 * a bundled page as well; the title bar, the splash and the settings follow the console theme (light / dark).
 */
import {
  app,
  BaseWindow,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  shell,
  utilityProcess,
  WebContentsView,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type UtilityProcess,
  type WebContents,
} from 'electron';
import * as fs from 'fs';
import { ChildProcess, spawn } from 'node:child_process';
import * as net from 'node:net';
import * as path from 'node:path';

import { APP_NAME, CHROME_BACKGROUND, isTheme, PAGE_BACKGROUND, type Theme } from './brand';
import { appOrigin, ipcSenderAllowed, isAppUrl, isExternalLink, parseConfigUrl, type IpcScope } from './ipc-sender';
import { effectiveUpdateChannel, isUpdateChannel } from './update/update-config';
import { DesktopUpdater } from './update/updater';

const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';
const TITLEBAR_HEIGHT = 36;
/** The splash stays at least this long, so it does not just flash. */
const SPLASH_MIN_MS = 1200;
/** Resolved in whenReady: from PORT env or a free port. */
let ssrPort = 0;

/** When packaged, write logs to userData so Windows users can inspect after crash. */
function debugLog(message: string, ...args: unknown[]): void {
  const line = `[${new Date().toISOString()}] ${message} ${args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ')}\n`;
  console.log('[Main Process]', message, ...args);
  if (!app.isPackaged) return;
  try {
    const userData = app.getPath('userData');
    const logDir = path.join(userData, 'logs');
    const logFile = path.join(logDir, 'main.log');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(logFile, line, 'utf-8');
  } catch {
    // ignore
  }
}

/** Call once at startup so user knows where to find the log (e.g. after crash). */
function initDebugLog(): void {
  if (!app.isPackaged) return;
  try {
    const userData = app.getPath('userData');
    const logDir = path.join(userData, 'logs');
    const logFile = path.join(logDir, 'main.log');
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    const banner = `\n===== ${new Date().toISOString()} =====\nLog file: ${logFile}\nUser data: ${userData}\n(Windows: %APPDATA%\\${path.basename(userData)}\\logs\\main.log)\n`;
    fs.appendFileSync(logFile, banner, 'utf-8');
  } catch {
    // ignore
  }
}

/** Packaged: use Electron's resources path (reliable on Windows). Dev: use __dirname. */
function getResourcesDir(): string {
  if (app.isPackaged) {
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    if (typeof resourcesPath === 'string') return resourcesPath;
  }
  return path.dirname(__dirname);
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr !== null && 'port' in addr ? addr.port : 0;
      debugLog('Found free port:', port);
      server.close(() => resolve(port));
    });
    server.once('error', reject);
  });
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
const rendererFile = (name: string) => path.join(__dirname, 'renderer', name);

/** An app window: the title bar view above the console view. */
interface AppWindow {
  win: BaseWindow;
  titlebar: WebContentsView;
  content: WebContentsView;
  title: string;
  theme: Theme;
}

let ssrProcess: ChildProcess | UtilityProcess | null = null;
const appWindows = new Set<AppWindow>();
let mainWindow: AppWindow | null = null;
let splash: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let settingsTheme: Theme = 'light';

// Config file path
const configFilePath = path.join(app.getPath('userData'), 'config.json');

interface AppConfig {
  configUrl?: string;
  /** In-app update channel (`stable` / `beta`); unset: the channel of the installed version. */
  updateChannel?: 'stable' | 'beta';
  /** Last console theme, for the splash and the frame before the console has loaded. */
  theme?: Theme;
}

// Read config from file
function readConfig(): AppConfig {
  try {
    if (fs.existsSync(configFilePath)) {
      const configData = fs.readFileSync(configFilePath, 'utf-8');
      return JSON.parse(configData);
    }
  } catch (error) {
    console.error('[Main Process] Error reading config file:', error);
  }
  return {};
}

// Write config to file
function writeConfig(config: AppConfig): void {
  try {
    fs.writeFileSync(configFilePath, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    console.error('[Main Process] Error writing config file:', error);
  }
}

// Get current config URL
function getConfigUrl(): string | undefined {
  const config = readConfig();
  return config.configUrl;
}

function getUpdateChannel(): 'stable' | 'beta' {
  return effectiveUpdateChannel(readConfig().updateChannel, app.getVersion());
}

/** The console theme of the last run; the system theme (what the console falls back to) on the first. */
function storedTheme(): Theme {
  const theme = readConfig().theme;

  return isTheme(theme) ? theme : nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

const updater = new DesktopUpdater({
  channel: getUpdateChannel,
  // Update dialogs belong to the settings window while it is open (its "Check for updates" button).
  window: () => (settingsWindow && !settingsWindow.isDestroyed() ? settingsWindow : (mainWindow?.win ?? null)),
  log: debugLog,
});

function setUpdateChannel(channel: unknown): 'stable' | 'beta' {
  if (!isUpdateChannel(channel)) return getUpdateChannel();

  const config = readConfig();

  config.updateChannel = channel;
  writeConfig(config);
  debugLog('Update channel set to:', channel);
  createMenu();

  return channel;
}

function startSSRServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    // Packaged: use process.resourcesPath (Electron API, reliable on Windows).
    // Dev: server is next to __dirname in dist/apps/native-billing-console/server/
    const ssrPath = app.isPackaged
      ? path.resolve(getResourcesDir(), 'server', 'server.cjs')
      : path.join(__dirname, 'server', 'server.cjs');

    debugLog('SSR server path:', ssrPath, 'exists:', fs.existsSync(ssrPath));
    if (!fs.existsSync(ssrPath)) {
      reject(new Error(`Application server not found at: ${ssrPath}`));
      return;
    }

    const configUrl = getConfigUrl();
    const env: NodeJS.ProcessEnv = { ...process.env, PORT: ssrPort.toString() };

    if (configUrl) {
      env.CONFIG = configUrl;
      debugLog('Starting SSR server with CONFIG:', configUrl);
    } else {
      debugLog('Starting SSR server without CONFIG');
    }

    // When packaged, set NODE_PATH so the server process can find its node_modules
    if (app.isPackaged) {
      const serverNodeModules = path.join(getResourcesDir(), 'server', 'node_modules');
      const existingNodePath = env.NODE_PATH || '';
      env.NODE_PATH = existingNodePath ? `${serverNodeModules}${path.delimiter}${existingNodePath}` : serverNodeModules;
      debugLog('Set NODE_PATH to:', env.NODE_PATH);
    }

    const cwd = path.dirname(ssrPath);

    const onStderr = (data: Buffer | string): void => console.error(`Application server error: ${data}`);
    const onError = (err: unknown): void => {
      const msg = err instanceof Error ? err.message : String(err);
      debugLog('SSR process error:', msg, err);
      reject(new Error(msg));
    };
    const onExit = (code: number | null): void => {
      debugLog('SSR process exit, code:', code);
      if (code !== 0 && code !== null) reject(new Error(`Application server exited with code ${code}`));
    };

    if (app.isPackaged) {
      // Use utilityProcess.fork() so the server runs with Electron's Node runtime.
      // On Windows, spawn('node', ...) fails because node is not in PATH when running the packaged exe.
      debugLog('Spawning utility process (packaged), cwd:', cwd);
      const proc = utilityProcess.fork(ssrPath, [], {
        stdio: 'pipe',
        cwd,
        env,
      });
      ssrProcess = proc;
      proc.stdout?.on('data', (data: Buffer | string) => {
        const s = data.toString();
        debugLog('[SSR stdout]', s.trim().slice(0, 200));
        if (s.includes('Express server running')) resolve();
      });
      proc.stderr?.on('data', (data: Buffer | string) => {
        onStderr(data);
        debugLog('[SSR stderr]', data.toString().trim());
      });
      proc.once('error', onError);
      proc.once('exit', onExit);
    } else {
      debugLog('Spawning node process (dev), cwd:', cwd);
      const proc = spawn('node', [ssrPath], {
        stdio: 'pipe',
        cwd,
        env,
      });
      ssrProcess = proc;
      proc.stdout?.on('data', (data: Buffer | string) => {
        if (data.toString().includes('Express server running')) resolve();
      });
      proc.stderr?.on('data', onStderr);
      proc.once('error', onError);
      proc.once('exit', onExit);
    }

    setTimeout(() => reject(new Error('Application server startup timeout')), 30000);
  });
}

function resolveAppIconPath(): string | undefined {
  const candidates =
    process.platform === 'win32'
      ? [path.join(__dirname, 'icon.ico'), path.join(__dirname, 'icon.png')]
      : [path.join(__dirname, 'icon.png'), path.join(__dirname, 'icon.ico')];
  return candidates.find((iconPath) => fs.existsSync(iconPath));
}

function webPreferences(preload?: string): Electron.WebPreferences {
  return {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    devTools: isDev,
    ...(preload ? { preload: path.join(__dirname, preload) } : {}),
  };
}

// --------------------------------------------------------------------------------------- guards

/** Bundled pages stay on themselves; links on them open in the system browser. */
function guardBundledPage(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (isExternalLink(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event) => event.preventDefault());
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

/**
 * Pop-ups of the console: its own pages (agent desktop, file editor, docs, ...) open as further app windows, links to
 * other sites in the system browser. The console window itself may still navigate away (sign-in, payment checkout)
 * and come back, as before.
 */
function guardConsole(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url, appOrigin(ssrPort))) void createAppWindow(url).catch((err) => debugLog('Pop-up failed:', err));
    else if (isExternalLink(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

/** Reload, zoom and settings shortcuts (the frameless windows have no menu bar); dev tools in development. */
function addShortcuts(contents: WebContents, owner: () => AppWindow | undefined): void {
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const mod = process.platform === 'darwin' ? input.meta : input.control;
    const key = input.key.toLowerCase();
    if (key === 'f5' || (mod && key === 'r')) contents.reload();
    else if (mod && (key === '=' || key === '+')) contents.setZoomLevel(contents.getZoomLevel() + 0.5);
    else if (mod && key === '-') contents.setZoomLevel(contents.getZoomLevel() - 0.5);
    else if (mod && key === '0') contents.setZoomLevel(0);
    else if (mod && key === ',') openSettings(owner());
    else if (isDev && (key === 'f12' || (mod && input.shift && key === 'i'))) contents.toggleDevTools();
    else return;
    event.preventDefault();
  });
}

// --------------------------------------------------------------------------------------- splash

/** Frameless splash in the console theme (logo, name, progress, version). Resolves once it is on screen. */
function showSplash(): Promise<number> {
  const theme = storedTheme();
  const icon = resolveAppIconPath();
  const window = new BrowserWindow({
    width: 440,
    height: 300,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    center: true,
    backgroundColor: CHROME_BACKGROUND[theme],
    title: APP_NAME,
    ...(icon ? { icon } : {}),
    webPreferences: { ...webPreferences(), devTools: false },
  });
  splash = window;
  guardBundledPage(window.webContents);
  window.on('closed', () => {
    if (splash === window) splash = null;
  });
  const shown = new Promise<number>((resolve) =>
    window.once('ready-to-show', () => {
      window.show();
      resolve(Date.now());
    }),
  );
  void window.loadFile(rendererFile('splash.html'), {
    query: { name: APP_NAME, version: app.getVersion(), theme },
  });
  return shown;
}

function closeSplash(): void {
  if (splash && !splash.isDestroyed()) splash.destroy();
  splash = null;
}

// ---------------------------------------------------------------------------------- app windows

function titlebarState(w: AppWindow) {
  return {
    title: w.title,
    maximized: w.win.isMaximized(),
    focused: w.win.isFocused(),
    theme: w.theme,
    platform: process.platform,
  };
}

function sendTitlebarState(w: AppWindow): void {
  if (!w.titlebar.webContents.isDestroyed()) w.titlebar.webContents.send('window:state', titlebarState(w));
}

function layoutViews(w: AppWindow): void {
  const { width, height } = w.win.getContentBounds();
  w.titlebar.setBounds({ x: 0, y: 0, width, height: TITLEBAR_HEIGHT });
  w.content.setBounds({ x: 0, y: TITLEBAR_HEIGHT, width, height: Math.max(0, height - TITLEBAR_HEIGHT) });
}

function applyTheme(w: AppWindow, theme: Theme): void {
  w.theme = theme;
  w.win.setBackgroundColor(PAGE_BACKGROUND[theme]);
  w.titlebar.setBackgroundColor(CHROME_BACKGROUND[theme]);
  w.content.setBackgroundColor(PAGE_BACKGROUND[theme]);
  sendTitlebarState(w);
}

/**
 * Opens an app window on a console URL. Resolves once the console has loaded and the window is shown; rejects when the
 * page cannot be loaded (the main window then reports a startup error).
 */
function createAppWindow(url: string, isMain = false): Promise<AppWindow> {
  const theme = storedTheme();
  const icon = resolveAppIconPath();
  const win = new BaseWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    frame: false,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: PAGE_BACKGROUND[theme],
    title: APP_NAME,
    ...(icon ? { icon } : {}),
  });
  const titlebar = new WebContentsView({ webPreferences: webPreferences('preload-titlebar.js') });
  const content = new WebContentsView({ webPreferences: webPreferences('preload-console.js') });
  const w: AppWindow = { win, titlebar, content, title: APP_NAME, theme };

  appWindows.add(w);
  if (isMain) mainWindow = w;
  win.contentView.addChildView(titlebar);
  win.contentView.addChildView(content);
  applyTheme(w, theme);
  layoutViews(w);

  for (const e of ['resize', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'] as const) {
    win.on(e as 'resize', () => {
      layoutViews(w);
      sendTitlebarState(w);
    });
  }
  win.on('focus', () => {
    // Keyboard input belongs to the console, not to the title bar view.
    if (!content.webContents.isDestroyed()) content.webContents.focus();
    sendTitlebarState(w);
  });
  win.on('blur', () => sendTitlebarState(w));
  win.on('closed', () => {
    appWindows.delete(w);
    if (!titlebar.webContents.isDestroyed()) titlebar.webContents.close();
    if (!content.webContents.isDestroyed()) content.webContents.close();
    if (mainWindow === w) {
      // The console windows share the server of the main window: closing it quits the app.
      mainWindow = null;
      app.quit();
    }
  });

  guardBundledPage(titlebar.webContents);
  // Clicking a title bar button must not take the keyboard away from the console.
  titlebar.webContents.on('focus', () => {
    if (!content.webContents.isDestroyed()) content.webContents.focus();
  });
  guardConsole(content.webContents);
  addShortcuts(content.webContents, () => w);
  content.webContents.on('page-title-updated', (_event, title) => {
    w.title = title || APP_NAME;
    win.setTitle(w.title);
    sendTitlebarState(w);
  });
  content.webContents.on('render-process-gone', (_event, details) => debugLog('Console page gone:', details.reason));

  void titlebar.webContents.loadFile(rendererFile('titlebar.html'));

  return new Promise<AppWindow>((resolve, reject) => {
    const show = () => {
      if (win.isDestroyed()) return;
      win.show();
      win.focus();
      content.webContents.focus();
      if (isMain) closeSplash();
      resolve(w);
    };
    content.webContents.once('did-finish-load', show);
    content.webContents.on('did-fail-load', (_event, code, description, failedUrl, isMainFrame) => {
      // -3 (ERR_ABORTED): a redirect or a navigation replaced the load, not an error.
      if (!isMainFrame || code === -3 || win.isVisible()) return;
      debugLog('Console page failed to load:', code, description, failedUrl);
      if (isMain) reject(new Error(`Could not load the console (${description}, ${code}) from ${failedUrl}`));
      else show();
    });
    void content.webContents.loadURL(url).catch(() => undefined);
  });
}

function appWindowOf(event: IpcMainInvokeEvent | IpcMainEvent, view: 'titlebar' | 'content'): AppWindow | undefined {
  for (const w of appWindows) if (w[view].webContents === event.sender) return w;
  return undefined;
}

/** Only the app's own pages may use the IPC bridge, each for its own scope; see `ipc-sender.ts`. */
function trustedSender(event: IpcMainInvokeEvent | IpcMainEvent, scope: IpcScope, fromExpectedView: boolean): boolean {
  const frame = event.senderFrame;
  const allowed = ipcSenderAllowed(
    scope,
    { url: frame?.url, isTopFrame: !!frame && frame.parent === null, fromExpectedView },
    appOrigin(ssrPort),
  );

  if (!allowed) debugLog('Refused IPC from an untrusted sender:', frame?.url ?? '(no frame)');

  return allowed;
}

/** The app window whose title bar sent this, when the sender may use the window buttons. */
function titlebarWindow(event: IpcMainInvokeEvent): AppWindow | undefined {
  const w = appWindowOf(event, 'titlebar');

  return trustedSender(event, 'titlebar', !!w) ? w : undefined;
}

function fromSettings(event: IpcMainInvokeEvent): boolean {
  const isSettings = !!settingsWindow && !settingsWindow.isDestroyed() && event.sender === settingsWindow.webContents;

  return trustedSender(event, 'settings', isSettings);
}

// ------------------------------------------------------------------------------------- settings

/** Modal settings window over an app window, in its theme; focuses the open one instead of a second. */
function openSettings(parent: AppWindow | undefined | null): void {
  const owner = parent ?? mainWindow;

  if (!owner) return;

  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsTheme = owner.theme;
  const icon = resolveAppIconPath();
  const window = new BrowserWindow({
    parent: owner.win,
    modal: true,
    width: 540,
    height: 424,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    show: false,
    backgroundColor: PAGE_BACKGROUND[settingsTheme],
    title: `Settings – ${APP_NAME}`,
    ...(icon ? { icon } : {}),
    webPreferences: webPreferences('preload-settings.js'),
  });
  settingsWindow = window;
  guardBundledPage(window.webContents);
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    if (settingsWindow === window) settingsWindow = null;
  });
  void window.loadFile(rendererFile('settings.html'), { query: { theme: settingsTheme } });
}

/** Stores a new server URL and restarts the app so the SSR server picks it up. */
function applyConfigUrl(value: string): void {
  const config = readConfig();

  if (value) config.configUrl = value;
  else delete config.configUrl;
  writeConfig(config);
  debugLog(value ? 'Config URL set to:' : 'Config URL reset', value);

  // Kill SSR server before restarting to ensure clean restart
  if (ssrProcess) {
    ssrProcess.kill();
    ssrProcess = null;
  }

  setTimeout(() => {
    app.relaunch();
    app.exit(0);
  }, 100);
}

// ------------------------------------------------------------------------------------------ ipc

// Window buttons and the settings gear (title bar views)
ipcMain.handle('window:minimize', (event) => {
  const w = titlebarWindow(event);
  w?.win.minimize();
  return !!w;
});

ipcMain.handle('window:toggle-maximize', (event) => {
  const w = titlebarWindow(event);
  if (!w) return false;
  if (w.win.isMaximized()) w.win.unmaximize();
  else w.win.maximize();
  return true;
});

ipcMain.handle('window:close', (event) => {
  const w = titlebarWindow(event);
  w?.win.close();
  return !!w;
});

ipcMain.handle('window:get-state', (event) => {
  const w = titlebarWindow(event);
  return w ? titlebarState(w) : undefined;
});

ipcMain.handle('settings:open', (event) => {
  const w = titlebarWindow(event);
  if (w) openSettings(w);
  return !!w;
});

// Theme of the console page (console views)
ipcMain.on('console:theme', (event, theme: unknown) => {
  const w = appWindowOf(event, 'content');

  if (!trustedSender(event, 'console', !!w) || !w || !isTheme(theme) || theme === w.theme) return;

  applyTheme(w, theme);
  if (w === mainWindow && readConfig().theme !== theme) writeConfig({ ...readConfig(), theme });
});

// Settings window
ipcMain.handle('settings:get', (event) => {
  if (!fromSettings(event)) return undefined;

  return {
    configUrl: getConfigUrl() ?? '',
    updateChannel: getUpdateChannel(),
    version: app.getVersion(),
    theme: settingsTheme,
  };
});

ipcMain.handle('settings:save', (event, change: unknown) => {
  if (!fromSettings(event)) return 'invalid';

  const { configUrl, updateChannel } = (change ?? {}) as { configUrl?: unknown; updateChannel?: unknown };
  const url = parseConfigUrl(configUrl);

  if (url === undefined) return 'invalid';

  if (isUpdateChannel(updateChannel) && updateChannel !== getUpdateChannel()) setUpdateChannel(updateChannel);

  if (url === (getConfigUrl() ?? '')) return 'saved';

  applyConfigUrl(url);

  return 'restart';
});

ipcMain.handle('settings:check-for-updates', async (event) => {
  if (!fromSettings(event)) return false;

  await updater.check(true);

  return true;
});

ipcMain.handle('settings:close', (event) => {
  if (!fromSettings(event)) return false;

  settingsWindow?.close();

  return true;
});

// Create application menu (macOS menu bar; shortcuts elsewhere — the frameless windows show no menu bar)
function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Settings',
      submenu: [
        {
          label: 'Settings...',
          accelerator: 'CmdOrCtrl+,',
          click: () => openSettings(mainWindow),
        },
        { type: 'separator' },
        {
          label: 'Check for Updates...',
          click: () => void updater.check(true),
        },
        {
          label: 'Update Channel',
          submenu: (['stable', 'beta'] as const).map((channel) => ({
            label: channel === 'stable' ? 'Stable' : 'Beta',
            type: 'radio' as const,
            checked: getUpdateChannel() === channel,
            click: () => setUpdateChannel(channel),
          })),
        },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            app.quit();
          },
        },
      ],
    },
    ...(process.platform === 'darwin' ? [{ role: 'editMenu' as const }, { role: 'windowMenu' as const }] : []),
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function showStartupError(message: string, detail?: string): void {
  dialog.showErrorBox(`${APP_NAME} – Startup Error`, detail ? `${message}\n\n${detail}` : message);
  console.error('[Main Process] Startup error:', message, detail ?? '');
}

app.whenReady().then(async () => {
  initDebugLog();
  debugLog('app whenReady');
  try {
    createMenu();
    const shownAt = await showSplash();
    ssrPort =
      process.env.PORT !== undefined && process.env.PORT !== '' ? parseInt(process.env.PORT, 10) : await getFreePort();
    if (!Number.isInteger(ssrPort) || ssrPort <= 0) {
      ssrPort = await getFreePort();
    }
    debugLog('Using port:', ssrPort);
    debugLog('Starting SSR server...');
    await startSSRServer();
    debugLog('SSR server ready, creating window');
    await delay(shownAt + SPLASH_MIN_MS - Date.now());
    await createAppWindow(appOrigin(ssrPort), true);
    debugLog('Window created');
    updater.start();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    debugLog('Startup failed:', message, err);
    closeSplash();
    showStartupError('Failed to start the application server.', message);
    ssrProcess?.kill();
    ssrProcess = null;
    app.quit();
  }
});

app.on('before-quit', () => {
  debugLog('before-quit');
  updater.stop();
  ssrProcess?.kill();
});
app.on('window-all-closed', () => {
  debugLog('window-all-closed');
  ssrProcess?.kill();
  app.quit();
});

// Log uncaught errors so Windows users can see them in the log file after crash
process.on('uncaughtException', (err) => {
  debugLog('uncaughtException:', err.message, err);
  try {
    dialog.showErrorBox(
      'Uncaught Exception',
      `${err.message}\n\nSee logs in: ${app.getPath('userData')}/logs/main.log`,
    );
  } catch {
    // ignore
  }
});
process.on('unhandledRejection', (reason, promise) => {
  debugLog('unhandledRejection:', reason, promise);
  try {
    dialog.showErrorBox(
      'Unhandled Rejection',
      `${String(reason)}\n\nSee logs in: ${app.getPath('userData')}/logs/main.log`,
    );
  } catch {
    // ignore
  }
});
