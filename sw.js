// เปลี่ยนเลขเวอร์ชันทุกครั้งที่แก้ไฟล์แอป เพื่อให้เครื่องที่ติดตั้งไว้โหลดของใหม่
const CACHE = "reading-journal-v21";
const SHELL = ["./", "index.html", "theme-init.js", "app.css", "config.js", "app.js", "board.js", "shelf.js", "onboard.js", "privacy.html", "manifest.webmanifest", "icons/icon.svg", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png"];

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

// ไฟล์ของแอป: ดึงจากเว็บก่อนเสมอ (ได้เวอร์ชันล่าสุดทันที) ถ้าออฟไลน์ค่อยใช้ฉบับในเครื่อง
// ฟอนต์และไลบรารีจาก CDN: ใช้ฉบับในเครื่องก่อน เพราะลิงก์ระบุเวอร์ชันตายตัวอยู่แล้ว
// การเรียก Supabase ไม่ผ่านตรงนี้ (ต้องออนไลน์เสมอ)
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // ฟอนต์ ไลบรารี และภาพปกหนังสือ: เก็บไว้ใช้ตอนออฟไลน์
  const isCdn = ["fonts.googleapis.com", "fonts.gstatic.com", "cdn.jsdelivr.net", "covers.openlibrary.org", "books.google.com", "books.googleusercontent.com"].includes(url.hostname);
  const sameOrigin = url.origin === location.origin;
  if (!sameOrigin && !isCdn) return;

  e.respondWith(caches.open(CACHE).then(async cache => {
    if (isCdn) {
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === "opaque") cache.put(req, res.clone());
      return res;
    }
    try {
      const res = await fetch(req, { cache: "no-cache" });
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return (await cache.match(req, { ignoreSearch: true }))
        || (req.mode === "navigate" ? cache.match("index.html") : Response.error());
    }
  }));
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
