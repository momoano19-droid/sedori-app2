const CACHE_NAME = "sedori-v55";

const urlsToCache = [
  "./",
  "./index.html?v=ui3",
  "./report.html?v=reset1",
  "./css/style.css?v=ui3",
  "./js/app.js?v=ui3",
  "./js/report.js?v=reset1",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const reqUrl = new URL(event.request.url);

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;

      return fetch(event.request)
        .then(response => {
          if (!response || response.status !== 200) {
            return response;
          }

          if (
            reqUrl.origin === self.location.origin ||
            reqUrl.href.includes("unpkg.com/leaflet@1.9.4")
          ) {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseToCache);
            });
          }

          return response;
        })
        .catch(() => {
          if (event.request.mode === "navigate") {
            return caches.match("./index.html?v=ui3");
          }
        });
    })
  );
});
