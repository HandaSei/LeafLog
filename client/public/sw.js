const CACHE_NAME = 'leaflog-cache-v20260426150830';

const PRECACHE_ASSETS = [
  '/',
  '/full-logo.webp',
  '/leaf-logo.webp',
  '/steepin-bg-watercolor.webp',
  '/steepin-bg-watercolor-dark.webp',
  '/favicon.png',
  '/icon-192.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.includes('_capacitor_') || url.pathname.includes('_cap_')) {
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    return;
  }

  if (event.request.method !== 'GET') {
    return;
  }

  // HTML navigation requests - Network First strategy
  // This ensures fresh HTML shell with correct loading state
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            // Update cache with fresh HTML
            const cloned = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, cloned);
            }).catch(() => {});
          }
          return response;
        })
        .catch(() => {
          // Offline - fall back to cached HTML or root
          return caches.open(CACHE_NAME).then((cache) =>
            cache.match(event.request).then((cached) => {
              return cached || cache.match('/');
            })
          );
        })
    );
    return;
  }

  // Static assets - Cache First strategy
  if (url.pathname.startsWith('/assets/') || url.pathname.match(/\.(js|css|png|jpg|webp|svg|woff2?)$/)) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(event.request).then((cached) => {
          const networkFetch = fetch(event.request).then((response) => {
            if (response.ok) {
              try { cache.put(event.request, response.clone()); } catch (e) {}
            }
            return response;
          }).catch(() => cached);

          return cached || networkFetch;
        })
      )
    );
    return;
  }

  // Other requests - Cache First with network update
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(event.request).then((cached) => {
        const networkFetch = fetch(event.request).then((response) => {
          if (response.ok) {
            try { cache.put(event.request, response.clone()); } catch (e) {}
          }
          return response;
        }).catch(() => cached);

        return cached || networkFetch;
      })
    )
  );
});
