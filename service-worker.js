const CACHE_NAME = "sedori-v4 ";

const ASSETS = [
  "./",
  "./index.html",
  "./report.html",
  "./manifest.json",
  "./css/style.css",
  "./js/utils.js",
  "./js/storage.js",
  "./js/analytics.js",
  "./js/map.js",
  "./js/app.js",
  "./js/report.js"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
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
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
