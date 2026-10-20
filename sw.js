/* Ascent Log service worker: cache the app (and its font) so it works with no signal on the mountain. */
const CACHE = 'ascent-log-v13';
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&display=swap';
const FONT_HOSTS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

// Fetch the font stylesheet and every font file it references. Failure is fine (system font fallback).
async function cacheFonts(cache) {
  try {
    const res = await fetch(FONT_CSS, { mode: 'cors' });
    if (!res.ok) return;
    await cache.put(FONT_CSS, res.clone());
    const css = await res.text();
    const urls = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => m[1]);
    await Promise.all(urls.map((u) => fetch(u, { mode: 'cors' }).then((r) => (r.ok ? cache.put(u, r) : null)).catch(() => null)));
  } catch (e) { /* offline during install */ }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // cache: 'reload' skips the browser's HTTP cache so an update never stores stale files
      .then(async (cache) => { await cache.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' }))); await cacheFonts(cache); })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const origin = new URL(req.url).origin;

  // Fonts: cache-first, they never change
  if (FONT_HOSTS.includes(origin)) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const cached = await cache.match(req.url);
        if (cached) return cached;
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) cache.put(req.url, res.clone());
        return res;
      })
    );
    return;
  }
  if (origin !== self.location.origin) return;

  // Only navigations to the app page itself are served from the cached index.html;
  // opening any other file (an icon, the README) goes straight to the network.
  const path = new URL(req.url).pathname;
  const scope = new URL(self.registration.scope).pathname;
  const isAppPage = path === scope || path === scope + 'index.html';
  if (req.mode === 'navigate' && !isAppPage) return;

  // App files: serve from cache first (instant + offline), refresh the cache in the background
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const key = isAppPage ? './index.html' : req;
      const cached = await cache.match(key, { ignoreSearch: true });
      const network = fetch(isAppPage ? new URL('./index.html', self.registration.scope).href : req.url, { cache: 'no-cache' })
        .then((res) => {
          if (res && res.ok) cache.put(key, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
