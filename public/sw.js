const CACHE_NAME = 'flux-assets-v1';
const STATIC_ASSETS = [
  '/',
  '/icon.png',
  '/notification.mp3',
  '/ringtone.mp3',
  '/ringtone2.mp3',
  '/ringtone3.mp3'
];

// Install Event - Pre-cache essential static shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => {
      return self.skipWaiting();
    })
  );
});

// Activate Event - Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Fetch Event - Safe Stale-While-Revalidate for static assets, bypassing dynamic / non-http calls
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  let url;
  try {
    url = new URL(event.request.url);
  } catch {
    return;
  }

  // Only handle http/https requests. Skip unsupported schemes (chrome-extension:, blob:, etc.)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // Skip caching for Next.js HMR, WebSockets, APIs, Supabase, ngrok, telemetry
  if (
    url.pathname.startsWith('/_next/webpack-hmr') ||
    url.pathname.startsWith('/api') ||
    url.pathname.includes('/ws') ||
    url.hostname.includes('supabase') ||
    url.hostname.includes('ngrok')
  ) {
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cachedResponse = await cache.match(event.request);

      const fetchPromise = fetch(event.request).then(async (networkResponse) => {
        // If HTTP 200 or opaque cross-origin resource, update cache safely
        if (networkResponse && (networkResponse.status === 200 || networkResponse.status === 0 || networkResponse.type === 'opaque')) {
          try {
            await cache.put(event.request, networkResponse.clone());
          } catch {
            // Ignore cache.put failures (e.g. Vary: * headers, quota limits, unsupported headers)
          }
        }
        return networkResponse;
      }).catch(() => {
        // Network failure (offline mode)
        return cachedResponse;
      });

      // If we have a cached response (200 OK), return it immediately (Stale-While-Revalidate)
      if (cachedResponse) {
        // Trigger background revalidation silently
        fetchPromise.catch(() => {});
        return cachedResponse;
      }

      // If no cached response exists, wait for network fetch
      const response = await fetchPromise;
      if (response) {
        // If network returns 304 without cachedResponse, force re-fetch to get complete body (prevents broken 304 CSS)
        if (response.status === 304) {
          try {
            const freshResponse = await fetch(event.request, { cache: 'reload' });
            return freshResponse;
          } catch {
            return response;
          }
        }
        return response;
      }

      return cachedResponse;
    }).catch(() => {
      return fetch(event.request);
    })
  );
});
