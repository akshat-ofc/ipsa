const CACHE_NAME = "v8-force-update";
const ASSETS = [
    "./",
    "./index.html",
    "./style.css",
    "./app.js",
    "./supabase-client.js",
    "./manifest.json",
    "./ipsalogo.png"
];

self.addEventListener("install", event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(ASSETS);
        })
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        (async () => {
            const cacheNames = await caches.keys();
            await Promise.all(
                cacheNames.map(cache => {
                    if (cache !== CACHE_NAME) {
                        return caches.delete(cache);
                    }
                })
            );
            await self.clients.claim();
        })()
    );
});

self.addEventListener("fetch", event => {
    event.respondWith(
        caches.match(event.request).then(res => res || fetch(event.request))
    );
});
