// VERSION and FILES are supplied by the public-file build.
const PREFIX = 'zlx-web:' + encodeURIComponent(self.registration.scope) + ':';
const CACHE = PREFIX + VERSION;
const urls = FILES.map(file => new URL(file, self.registration.scope).href);
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(urls.map(url => new Request(url, { cache: 'reload' }))))));
self.addEventListener('activate', event => event.waitUntil((async () => {
  const old = (await caches.keys()).filter(key => key.startsWith(PREFIX) && key !== CACHE);
  // Retain the preceding version for already-open tabs. Never touch user databases.
  await Promise.all(old.slice(0, -1).map(key => caches.delete(key)));
})()));
self.addEventListener('message', event => { if (event.data === 'activate-after-save') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url), base = new URL(self.registration.scope);
  if (url.origin !== base.origin) return;
  let target = url.href;
  if (event.request.mode === 'navigate' && (url.pathname === base.pathname || url.pathname === base.pathname + 'index.html')) target = new URL('index.html', base).href;
  if (!urls.includes(target)) return;
  event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(target)) || fetch(event.request)));
});
