// Keeps the app and the reader models on the phone so it opens and reads with no signal.
// The page itself and its scripts are fetched fresh when there is signal; the big model files come from cache.
const CACHE = "relevo-v1";
const CORE = [
  "./", "index.html", "config.js", "elegir.js", "paddle-lite.js", "manifest.json", "icon.svg",
  "vendor/zxing-reader.js", "vendor/zxing_reader.wasm",
  "vendor/ort/ort.wasm.bundle.min.mjs", "vendor/ort/ort-wasm-simd-threaded.wasm",
  "vendor/paddle/det-onnx.wasm", "vendor/paddle/rec-onnx.wasm", "vendor/paddle/keys.txt",
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;  // the spreadsheet goes straight to Google
  if (url.pathname.includes("/vendor/")) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
    return;
  }
  e.respondWith(
    fetch(e.request)
      .then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
