// เปลี่ยนเลขเวอร์ชันทุกครั้งที่แก้ไฟล์แอป เพื่อให้เครื่องที่ติดตั้งไว้โหลดของใหม่
const CACHE = "reading-journal-v8";
const SHELL = ["./", "index.html", "app.css", "config.js", "app.js", "board.js", "manifest.webmanifest", "icons/icon.svg", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", e => {
  // cache: "reload" = ดึงไฟล์ใหม่จากเซิร์ฟเวอร์เสมอ ไม่ใช้ไฟล์เก่าในแคชของเบราว์เซอร์
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ไฟล์ของแอป: ใช้จากแคชก่อน แล้วอัปเดตเบื้องหลัง
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // ฟอนต์และไลบรารีจาก CDN เก็บแคชได้ ส่วนการเรียก Supabase ต้องผ่านเครือข่ายเสมอ
  const isCdn = ["fonts.googleapis.com", "fonts.gstatic.com", "cdn.jsdelivr.net"].includes(url.hostname);
  if (url.origin !== location.origin && !isCdn) return;

  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const cached = await cache.match(req, { ignoreSearch: url.origin === location.origin });
      const network = fetch(req).then(res => {
        if (res.ok || res.type === "opaque") cache.put(req, res.clone());
        return res;
      }).catch(() => cached || (req.mode === "navigate" ? cache.match("index.html") : undefined));
      return cached || network;
    })
  );
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      const open = list.find(c => "focus" in c);
      return open ? open.focus() : self.clients.openWindow("./");
    })
  );
});
