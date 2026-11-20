// Title bar of an app window: the console's page title, the settings gear and the window buttons.
const api = window.titlebar;
const maximize = document.getElementById('maximize');

// Like native caption buttons, these never take the keyboard focus: it stays with the console below.
document.addEventListener('mousedown', (event) => event.preventDefault());

document.getElementById('settings').addEventListener('click', () => api.openSettings());
document.getElementById('minimize').addEventListener('click', () => api.minimize());
maximize.addEventListener('click', () => api.toggleMaximize());
document.getElementById('close').addEventListener('click', () => api.close());

api.onState((state) => {
  if (!state) return;
  document.documentElement.dataset.theme = state.theme;
  document.getElementById('title').textContent = state.title;
  document.title = state.title;
  document.body.classList.toggle('maximized', state.maximized);
  document.body.classList.toggle('blurred', !state.focused);
  maximize.title = state.maximized ? 'Restore' : 'Maximize';
  maximize.setAttribute('aria-label', maximize.title);
});
