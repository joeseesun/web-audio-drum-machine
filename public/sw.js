/* DR-808 service worker — offline shell for a fully client-side instrument.
 *
 * The whole app is static: no API, no server state. That makes aggressive
 * caching safe, with one trap — Vite emits content-hashed asset filenames, so
 * the JS/CSS URLs change on every deploy while `/` (index.html) does not.
 *
 * So: navigations are network-first (always get the fresh shell and therefore
 * the fresh asset URLs), and hashed assets are cache-first (their content can
 * never change for a given URL). A version bump on activate drops stale caches.
 */

const VERSION = 'v1';
const SHELL_CACHE = `dr808-shell-${VERSION}`;
const ASSET_CACHE = `dr808-assets-${VERSION}`;

const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      // Individually, so one 404 cannot fail the whole install.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: network first, fall back to the precached shell offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy));
          return response;
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
    );
    return;
  }

  // Hashed build output + static media: cache first, then network.
  const isImmutable = url.pathname.startsWith('/assets/') ||
    /\.(?:png|jpe?g|svg|webp|ico|woff2?)$/i.test(url.pathname);

  if (isImmutable) {
    event.respondWith(
      caches.match(request).then((hit) => {
        if (hit) return hit;
        return fetch(request).then((response) => {
          // Only cache successful, same-origin, basic responses.
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      })
    );
  }
});
