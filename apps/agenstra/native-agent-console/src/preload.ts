import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods that allow the renderer process to use
// the window controls
contextBridge.exposeInMainWorld('electronAPI', {
  minimizeWindow: () => {
    console.log('[Electron API] minimizeWindow called');
    return ipcRenderer.invoke('window-minimize');
  },
  maximizeWindow: () => {
    console.log('[Electron API] maximizeWindow called');
    return ipcRenderer.invoke('window-maximize');
  },
  closeWindow: () => {
    console.log('[Electron API] closeWindow called');
    return ipcRenderer.invoke('window-close');
  },
  isMaximized: () => {
    return ipcRenderer.invoke('window-is-maximized');
  },
  getConfigUrl: () => {
    return ipcRenderer.invoke('get-config-url');
  },
  setConfigUrl: (url: string | null) => {
    return ipcRenderer.invoke('set-config-url', url);
  },
  openConfigDialog: () => {
    return ipcRenderer.invoke('open-config-dialog');
  },
});

console.log('[Electron Preload] Preload script loaded, electronAPI exposed');

// Inject custom titlebar
function injectTitlebar() {
  // Wait for body to exist
  if (!document.body) {
    setTimeout(injectTitlebar, 100);
    return;
  }

  // Don't inject if already injected
  if (document.getElementById('electron-titlebar')) {
    return;
  }

  const titlebarHTML = `
    <div id="electron-titlebar" style="
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 32px;
      background: #1e1e1e;
      border-bottom: 1px solid #333;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 0 0 12px;
      z-index: 999999;
      -webkit-app-region: drag;
      user-select: none;
      font-family: 'Plus Jakarta Sans Variable', sans-serif;
      font-size: 12px;
      color: #ffffff;
    ">
      <div style="display: flex; align-items: flex-start; gap: 8px; -webkit-app-region: no-drag;">
        <span style="font-weight: 500;">Agenstra Agent Console</span>
      </div>
      <div style="display: flex; align-items: flex-end; gap: 4px; -webkit-app-region: no-drag;">
        <button id="titlebar-settings" style="
          width: 32px;
          height: 32px;
          border: none;
          border-radius: 0;
          background: transparent;
          color: #ffffff;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          transition: background 0.2s;
          margin-right: 4px;
        " title="Settings">⚙</button>
        <button id="titlebar-minimize" style="
          width: 32px;
          height: 32px;
          border: none;
          border-radius: 0;
          background: transparent;
          color: #ffffff;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          transition: background 0.2s;
        " title="Minimize">−</button>
        <button id="titlebar-maximize" style="
          width: 32px;
          height: 32px;
          border: none;
          border-radius: 0;
          background: transparent;
          color: #ffffff;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          transition: background 0.2s;
        " title="Maximize">□</button>
        <button id="titlebar-close" style="
          width: 32px;
          height: 32px;
          border: none;
          border-radius: 0;
          background: transparent;
          color: #ffffff;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          transition: background 0.2s;
        " title="Close">×</button>
      </div>
    </div>
    <style>
      #electron-titlebar button:hover {
        background: rgba(255, 255, 255, 0.1);
      }
      #titlebar-settings:hover {
        background: rgba(255, 255, 255, 0.15) !important;
      }
      #titlebar-close:hover {
        background: #e81123 !important;
        color: #ffffff;
      }
      body {
        padding-top: 32px;
      }
    </style>
  `;

  // Add electron class to body for CSS targeting
  document.body.classList.add('electron-app');

  // Inject titlebar
  document.body.insertAdjacentHTML('afterbegin', titlebarHTML);

  // Inject a script into the page context (not preload context) to set up listeners
  // This script runs in the page's main world where electronAPI is available
  const setupScript = document.createElement('script');
  setupScript.textContent = `
    (function() {
      function setupTitlebarListeners() {
        const electronAPI = window.electronAPI;

        if (!electronAPI) {
          console.warn('[Electron Titlebar] electronAPI not yet available, retrying...');
          setTimeout(setupTitlebarListeners, 100);
          return;
        }

        console.log('[Electron Titlebar] Setting up listeners, electronAPI available');

        const settingsBtn = document.getElementById('titlebar-settings');
        const minimizeBtn = document.getElementById('titlebar-minimize');
        const maximizeBtn = document.getElementById('titlebar-maximize');
        const closeBtn = document.getElementById('titlebar-close');

        if (settingsBtn) {
          settingsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('[Electron Titlebar] Settings clicked');
            electronAPI.openConfigDialog()
              .then(() => console.log('[Electron Titlebar] Config dialog opened'))
              .catch((err) => console.error('[Electron Titlebar] Failed to open config dialog:', err));
          });
        }

        if (minimizeBtn) {
          minimizeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('[Electron Titlebar] Minimize clicked');
            electronAPI.minimizeWindow()
              .then(() => console.log('[Electron Titlebar] Minimize successful'))
              .catch((err) => console.error('[Electron Titlebar] Failed to minimize:', err));
          });
        }

        if (maximizeBtn) {
          maximizeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('[Electron Titlebar] Maximize clicked');
            electronAPI.maximizeWindow()
              .then(() => console.log('[Electron Titlebar] Maximize successful'))
              .catch((err) => console.error('[Electron Titlebar] Failed to maximize:', err));
          });

          // Update maximize button icon based on window state
          const updateMaximizeButton = async () => {
            try {
              const isMaximized = await electronAPI.isMaximized();
              maximizeBtn.textContent = isMaximized ? '❐' : '□';
              maximizeBtn.title = isMaximized ? 'Restore' : 'Maximize';
            } catch (err) {
              console.error('[Electron Titlebar] Failed to check maximize state:', err);
            }
          };

          setTimeout(updateMaximizeButton, 200);
          setInterval(updateMaximizeButton, 500);
        }

        if (closeBtn) {
          closeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            console.log('[Electron Titlebar] Close clicked');
            electronAPI.closeWindow()
              .then(() => console.log('[Electron Titlebar] Close successful'))
              .catch((err) => console.error('[Electron Titlebar] Failed to close:', err));
          });
        }
      }

      // Wait for DOM to be ready
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setupTitlebarListeners);
      } else {
        setupTitlebarListeners();
      }
    })();
  `;
  document.body.appendChild(setupScript);
}

// Event delegation as a fallback (runs in page context via injected script)
// This is handled by the injected script above

// Try to inject immediately and also on DOMContentLoaded
injectTitlebar();

window.addEventListener('DOMContentLoaded', () => {
  injectTitlebar();
});

document.addEventListener('readystatechange', () => {
  if (document.readyState === 'complete') {
    injectTitlebar();
  }
});
