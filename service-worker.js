const CACHE_NAME = "sedori-v171";

const STATIC_URLS = [
  "./",
  "./index.html",
  "./report.html",
  "./manifest.json",
  "./css/style.css?v=ui13",
  "./js/app.js?v=ui17",
  "./js/report.js?v=cal5",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map(key => {
        if (key !== CACHE_NAME) {
          return caches.delete(key);
        }
        return Promise.resolve();
      })
    );
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isLeafletCdn = url.href.includes("unpkg.com/leaflet@1.9.4");

  if (!isSameOrigin && !isLeafletCdn) return;

  if (event.request.mode === "navigate") {
    event.respondWith(networkFirstPage(event.request));
    return;
  }

  event.respondWith(staleWhileRevalidateAsset(event.request));
});

async function networkFirstPage(request) {
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, fresh.clone());
    }
    return fresh;
  } catch (error) {
    const cached = await caches.match(request);
    if (cached) return cached;

    const fallback = await caches.match("./index.html");
    if (fallback) return fallback;

    throw error;
  }
}

async function staleWhileRevalidateAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkPromise = fetch(request)
    .then(response => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    networkPromise.catch(() => null);
    return cached;
  }

  const networkResponse = await networkPromise;
  if (networkResponse) return networkResponse;

  if (request.mode === "navigate") {
    const fallback = await caches.match("./index.html");
    if (fallback) return fallback;
  }

  return new Response("Offline", {
    status: 503,
    statusText: "Offline"
  });
}
