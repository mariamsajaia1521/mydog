'use strict';

const CACHE_NAME = 'petlog-cache-v1';
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './app-logo.png'
];

/* ---- install: pre-cache the app shell ---- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

/* ---- activate: drop stale caches from previous versions ---- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

/* ---- fetch: cache-first, falling back to network, then to index.html
   for navigations so the app still opens fully offline ---- */
self.addEventListener('fetch', (event) => {
  if(event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if(cached) return cached;

      return fetch(event.request)
        .then((response) => {
          if(response && response.ok && response.type === 'basic'){
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          if(event.request.mode === 'navigate'){
            return caches.match('./index.html');
          }
          return undefined;
        });
    })
  );
});
