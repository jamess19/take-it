// Đăng ký nhận thông báo đẩy từ server và đồng bộ lịch nhắc sắp tới lên server,
// để vẫn được nhắc khi đã tắt app. Không có server thì module tự tắt, app dùng nhắc cục bộ.
const PushSync = (() => {
  const DEVICE_KEY = "todo.deviceId";
  const ENABLED_KEY = "todo.push";
  let active = false;
  let syncTimer = null;
  let pendingEvents = null;

  function supported() {
    return location.protocol.startsWith("http") && "serviceWorker" in navigator && "PushManager" in window;
  }

  function deviceId() {
    let id = null;
    try { id = localStorage.getItem(DEVICE_KEY); } catch { /* bỏ qua */ }
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9-]/g, "");
      try { localStorage.setItem(DEVICE_KEY, id); } catch { /* bỏ qua */ }
    }
    return id;
  }

  function setFlag(on) {
    try { on ? localStorage.setItem(ENABLED_KEY, "1") : localStorage.removeItem(ENABLED_KEY); } catch { /* bỏ qua */ }
  }

  function getFlag() {
    try { return localStorage.getItem(ENABLED_KEY) === "1"; } catch { return false; }
  }

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    return res.json();
  }

  // Khoá công khai dạng base64url → Uint8Array cho pushManager.subscribe
  function keyToBytes(base64) {
    const pad = "=".repeat((4 - (base64.length % 4)) % 4);
    const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }

  async function subscribe() {
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await api("GET", "/api/push/public-key");
    let sub = await reg.pushManager.getSubscription();
    // Server đổi khoá thì subscription cũ không dùng được → đăng ký lại
    if (sub && sub.options && sub.options.applicationServerKey) {
      const current = btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      if (current !== publicKey) { await sub.unsubscribe(); sub = null; }
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) });
    await api("POST", "/api/push/subscribe", { deviceId: deviceId(), subscription: sub.toJSON() });
  }

  /** Bật thông báo đẩy (gọi sau khi người dùng đã cho phép thông báo). Trả về true nếu thành công. */
  async function enable() {
    if (!supported() || Notification.permission !== "granted") return false;
    try {
      await subscribe();
      active = true;
      setFlag(true);
      if (pendingEvents) flush();
      return true;
    } catch (err) {
      console.warn("Không bật được thông báo đẩy:", err);
      active = false;
      return false;
    }
  }

  // Khi mở app: nếu trước đó đã bật thì đăng ký lại cho chắc (subscription có thể đã đổi)
  async function init() {
    if (supported() && getFlag() && "Notification" in window && Notification.permission === "granted") await enable();
  }

  async function flush() {
    if (!active || !pendingEvents) return;
    const reminders = pendingEvents;
    try {
      await api("PUT", "/api/push/reminders", { deviceId: deviceId(), reminders });
      if (pendingEvents === reminders) pendingEvents = null;
    } catch (err) {
      // Server quên thiết bị (vd: subscription hết hạn) → đăng ký lại rồi gửi lại
      if (err.status === 404 && (await enable())) return;
      console.warn("Đồng bộ lịch nhắc lỗi, sẽ thử lại:", err.message);
    }
  }

  /** Lên lịch gửi danh sách nhắc [{ key, at, title, body }] lên server (gộp các thay đổi liên tiếp). */
  function sync(events) {
    pendingEvents = events;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(flush, 500);
  }

  async function test() {
    return api("POST", "/api/push/test", { deviceId: deviceId() });
  }

  return { supported, enable, init, sync, flush, test, isActive: () => active };
})();
