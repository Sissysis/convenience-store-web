/* ============================================
   CONVENIENCE STORE - SERVICE WORKER
   ============================================ */
'use strict';

var CACHE_NAME = 'cs-pwa-v2';
var APP_SHELL = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
    event.waitUntil(
        caches.open(CACHE_NAME).then(function (cache) {
            return cache.addAll(APP_SHELL);
        }).then(function () {
            return self.skipWaiting();
        })
    );
});

self.addEventListener('activate', function (event) {
    event.waitUntil(
        caches.keys().then(function (keys) {
            return Promise.all(
                keys.filter(function (key) {
                    return key !== CACHE_NAME;
                }).map(function (key) {
                    return caches.delete(key);
                })
            );
        }).then(function () {
            return self.clients.claim();
        }).then(function () {
            // Tell open windows to reload so they get new content now.
            return self.clients.matchAll({ type: 'window', includeUncontrolled: false })
                .then(function (clients) {
                    return Promise.all(clients.map(function (client) {
                        if (client && client.navigate && client.url) {
                            return client.navigate(client.url).catch(function () {});
                        }
                        return Promise.resolve();
                    }));
                });
        })
    );
});

self.addEventListener('fetch', function (event) {
    var request = event.request;

    if (request.method !== 'GET') return;

    var url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    // Pages: network-first so the latest version is always shown online.
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request).then(function (response) {
                if (response && response.status === 200) {
                    var copy = response.clone();
                    caches.open(CACHE_NAME).then(function (cache) {
                        cache.put(request, copy);
                    });
                }
                return response;
            }).catch(function () {
                return caches.match(request).then(function (cached) {
                    return cached || caches.match('./index.html');
                }).catch(function () {
                    return new Response('<h1>Offline</h1>', {
                        status: 503,
                        statusText: 'Offline',
                        headers: { 'Content-Type': 'text/html' }
                    });
                });
            })
        );
        return;
    }

    // Assets: stale-while-revalidate (serve fast, refresh cache in background).
    event.respondWith(
        caches.match(request).then(function (cached) {
            var network = fetch(request).then(function (response) {
                if (response && response.status === 200) {
                    var copy = response.clone();
                    caches.open(CACHE_NAME).then(function (cache) {
                        cache.put(request, copy);
                    });
                }
                return response;
            }).catch(function () {
                return cached;
            });
            return cached || network;
        })
    );
});