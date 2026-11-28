const CACHE = 'care-compass-pro-v5';
const shell = ['./', './consultation.js', './consultation-voice.js', './manifest.json', './icon.svg', './knowledge/dedup.mjs', './knowledge/evidence.json'];
const urls = new Set(shell.map(path => new URL(path, self.registration.scope).href));
self.addEventListener('install', event => event.waitUntil(
  caches.open(CACHE).then(cache => cache.addAll(shell.map(path => new Request(path, { cache: 'reload' }))))
    .then(() => self.skipWaiting())
));
self.addEventListener('activate', event => event.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('care-compass-pro-') && key !== CACHE)
    .map(key => caches.delete(key)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.registration.scope)) return;
  const url = new URL(event.request.url);
  if (url.pathname.includes('/api/')) return;
  const navigation = event.request.mode === 'navigate';
  if (!navigation && !urls.has(url.href)) return;
  const cacheKey = navigation ? './' : event.request;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(event.request, { cache: 'no-cache' });
      if (response.ok && (!navigation || response.headers.get('content-type')?.includes('text/html'))) {
        await cache.put(cacheKey, response.clone());
      }
      return response;
    } catch {
      return await cache.match(cacheKey) || Response.error();
    }
  })());
});
