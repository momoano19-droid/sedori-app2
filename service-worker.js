const CACHE_NAME = "sedori-v10";

const urlsToCache = [
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
  "./js/report.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
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
          if(key !== CACHE_NAME){
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if(event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if(cached) return cached;

      return fetch(event.request)
        .then(response => {
          if(!response || response.status !== 200 || response.type !== "basic"){
            return response;
          }

          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });

          return response;
        })
        .catch(() => {
          return caches.match("./index.html");
        });
    })
  );
});
