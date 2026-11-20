// Settings window: server configuration URL and updates. Values come from the main process (`window.settings`),
// never from the page URL, so nothing is put into the markup unescaped.
const api = window.settings;
const params = new URLSearchParams(location.search);
const input = document.getElementById('configUrl');
const error = document.getElementById('configUrlError');
const save = document.getElementById('save');
const reset = document.getElementById('reset');
const check = document.getElementById('check');
let savedUrl = '';

document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light';

function enteredUrl() {
  return input.value.trim();
}

/** Same rule as the main process: empty, or an http(s) URL. */
function validUrl(value) {
  if (!value) return true;
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

function channel() {
  return document.querySelector('input[name="channel"]:checked')?.value === 'beta' ? 'beta' : 'stable';
}

function refresh() {
  const restart = enteredUrl() !== savedUrl;
  save.textContent = restart ? 'Save and restart' : 'Save';
  reset.disabled = !enteredUrl();
  if (validUrl(enteredUrl())) {
    error.textContent = '';
    input.removeAttribute('aria-invalid');
  }
}

async function submit() {
  const configUrl = enteredUrl();
  if (!validUrl(configUrl)) {
    error.textContent = 'Enter a URL starting with https:// or http://, or leave the field empty.';
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    return;
  }
  save.disabled = true;
  const result = await api.save({ configUrl, updateChannel: channel() });
  if (result === 'invalid') {
    save.disabled = false;
    error.textContent = 'This URL cannot be used.';
    input.setAttribute('aria-invalid', 'true');
  } else if (result === 'saved') {
    void api.close();
  }
  // 'restart': the app restarts and closes this window.
}

document.getElementById('close').addEventListener('click', () => api.close());
document.getElementById('cancel').addEventListener('click', () => api.close());
save.addEventListener('click', submit);
reset.addEventListener('click', () => {
  input.value = '';
  refresh();
  input.focus();
});
check.addEventListener('click', async () => {
  check.disabled = true;
  try {
    await api.checkForUpdates();
  } finally {
    check.disabled = false;
  }
});
input.addEventListener('input', refresh);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') void api.close();
  else if (event.key === 'Enter' && event.target === input) void submit();
});

api.get().then((settings) => {
  if (!settings) return;
  document.documentElement.dataset.theme = settings.theme;
  savedUrl = settings.configUrl;
  input.value = settings.configUrl;
  document.getElementById(settings.updateChannel === 'beta' ? 'channelBeta' : 'channelStable').checked = true;
  document.getElementById('version').textContent = `Installed: version ${settings.version}.`;
  refresh();
  document.body.classList.add('ready');
  input.focus();
});
