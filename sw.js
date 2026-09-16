/* ============================================
   CONVENIENCE STORE - SERVICE WORKER
   ============================================ */
'use strict';

var CACHE_NAME = 'cs-pwa-v4';
var APP_SHELL = [
    './',
    './index.html',
    './styles.css?v=4',
    './app.js?v=4',
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
        })
    );
});

self.addEventListener('fetch', function (event) {
    var request = event.request;

    if (request.method !== 'GET') return;

    var url = new URL(request.url);
    if (url.origin !== self.location.origin) return;

    // Pages + JS + CSS: network-first so fresh code always loads when online.
    var isCode = request.mode === 'navigate' ||
        url.pathname.endsWith('.js') ||
        url.pathname.endsWith('.css');
    if (isCode) {
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
                    if (cached) return cached;
                    if (request.mode === 'navigate') {
                        return caches.match('./index.html').then(function (cachedIndex) {
                            return cachedIndex || new Response('<h1>Offline</h1>', {
                                status: 503,
                                statusText: 'Offline',
                                headers: { 'Content-Type': 'text/html' }
                            });
                        });
                    }
                    return new Response('', { status: 408, statusText: 'Offline' });
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