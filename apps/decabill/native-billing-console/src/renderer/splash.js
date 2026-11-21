// Splash: the main process passes the app name, version and theme as `?name=&version=&theme=`.
const params = new URLSearchParams(location.search);
const name = params.get('name') || '';
const version = params.get('version');

document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.title = name;
document.getElementById('name').textContent = name;
if (version) document.getElementById('version').textContent = `Version ${version}`;
