// Service worker: cache file để app chạy offline, nhận thông báo đẩy và xử lý nút bấm trên thông báo.
importScripts("js/alert-actions.js");
const CACHE = "todo-cache-v46";
const ASSETS = [
  "./",
  "index.html",
  "css/styles.css",
  "js/time-utils.js",
  "js/storage.js",
  "js/reminder.js",
  "js/alert-actions.js",
  "js/api.js",
  "js/task-sync.js",
  "js/push-sync.js",
  "js/profile.js",
  "js/custom-select.js",
  "js/page-dialog.js",
  "js/notes.js",
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
      data: { taskId: data.taskId, kind: data.kind },
      // Nút bấm trên thông báo (iPhone không hiển thị nút → bấm thông báo sẽ mở app kèm nút)
      actions: (ALERT_ACTIONS[data.kind] || []).map((a) => ({ action: a.action, title: a.label })),
    })
  );
});

// Bấm vào thông báo hoặc nút trên thông báo: chuyển thao tác cho app xử lý
self.addEventListener("notificationclick", (event) => {
  const { taskId, kind } = event.notification.data || {};
  const act = event.action || "open";
  event.notification.close();
  if (act === "dismiss") return;
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (list.length) {
      await list[0].focus();
      if (taskId) list[0].postMessage({ type: "alert-action", act, taskId, kind });
      return;
    }
    // App đang tắt → mở app, truyền thao tác qua địa chỉ
    const q = taskId ? `?act=${encodeURIComponent(act)}&task=${encodeURIComponent(taskId)}&kind=${encodeURIComponent(kind || "")}` : "";
    await self.clients.openWindow("./" + q);
  })());
});
