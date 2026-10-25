// يتيح عمل التطبيق دون اتصال بالإنترنت بعد أول فتح
const CACHE = "halaqa-v9";
const FILES = ["./", "index.html", "styles.css", "app.js", "data.js", "program.js", "sync.js", "manifest.json", "icon.svg", "quran-data.js", "mushaf-lines.js", "fonts/amiri-quran.woff2"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== QURAN_CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// صفحات المصحف وخطوطها من Quran.com: تُحفظ عند أول فتح لتعمل الصفحة بعدها دون إنترنت
const QURAN_CACHE = "halaqa-quran-v1";
const QURAN_HOSTS = ["api.quran.com", "static.qurancdn.com", "verses.quran.foundation"];

// الشبكة أولاً ثم النسخة المخزنة، حتى تصل التحديثات فور توفر الاتصال
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (QURAN_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.open(QURAN_CACHE).then((c) => c.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }))));
    return;
  }
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("index.html")))
  );
});
