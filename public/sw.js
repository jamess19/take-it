// Service worker: cache file để app chạy offline, và xử lý khi bấm vào thông báo.
const CACHE = "todo-cache-v5";
const ASSETS = [
  "./",
  "index.html",
  "css/styles.css",
  "js/time-utils.js",
  "js/storage.js",
  "js/reminder.js",
  "js/push-sync.js",
  "js/app.js",
  "manifest.webmanifest",
  "icons/icon-180.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Ưu tiên mạng để luôn lấy bản mới, mất mạng thì dùng cache
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).pathname.startsWith("/api/")) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }))
  );
});

// Nhận thông báo đẩy từ server (kể cả khi app đã tắt). iOS bắt buộc mỗi lần đẩy phải hiện thông báo.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  event.waitUntil(
    self.registration.showNotification(data.title || "Nhắc việc", {
      body: data.body || "",
      tag: data.tag,
      icon: "icons/icon-192.png",
      badge: "icons/icon-192.png",
      requireInteraction: true,
    })
  );
});

// Bấm vào thông báo: mở lại app
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      if (list.length) return list[0].focus();
      return self.clients.openWindow("./");
    })
  );
});
