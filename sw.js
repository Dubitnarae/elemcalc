/* Offline support: serve the app files from the cache, refresh them in the background.
   Bump VERSION when the files change so phones pick up the new ones. */
var VERSION = "elemcalc-2";
var FILES = ["./", "index.html", "core.js", "app.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"];

self.addEventListener("install", function (e) {
  // cache: "reload" skips the browser's HTTP cache, so a new version never stores old files.
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return c.addAll(FILES.map(function (f) { return new Request(f, { cache: "reload" }); }));
  }));
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  var page = e.request.mode === "navigate";
  e.respondWith(caches.open(VERSION).then(function (cache) {
    return cache.match(e.request, { ignoreSearch: true }).then(function (hit) {
      // Any page address of the app (start page, index.html?..., opened from a link) is the one page.
      return hit || (page ? cache.match("./") : undefined);
    }).then(function (hit) {
      var fresh = fetch(e.request).then(function (res) {
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      }).catch(function () {
        return hit || new Response("오프라인이라 열 수 없습니다. 인터넷에 연결한 뒤 다시 열어 주세요.",
          { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      });
      return hit || fresh;
    });
  }));
});
