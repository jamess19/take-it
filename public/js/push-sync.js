// Đăng ký nhận thông báo đẩy từ server và gửi lịch nhắc sắp tới của tài khoản lên server,
// để mọi thiết bị đã đăng nhập vẫn được nhắc khi đã tắt app.
const PushSync = (() => {
  const DEVICE_KEY = "todo.deviceId";
  const ENABLED_KEY = "todo.push";
  let active = false;

  function supported() {
    return Api.available() && "serviceWorker" in navigator && "PushManager" in window;
  }

  function deviceId() {
    let id = Storage.loadValue(DEVICE_KEY);
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2))
        .replace(/[^A-Za-z0-9-]/g, "");
      Storage.saveValue(DEVICE_KEY, id);
    }
    return id;
  }

  // Khoá công khai dạng base64url → Uint8Array cho pushManager.subscribe
  function keyToBytes(base64) {
    const pad = "=".repeat((4 - (base64.length % 4)) % 4);
    const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }

  const bytesToKey = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  async function subscribe() {
    const reg = await navigator.serviceWorker.ready;
    const { publicKey } = await Api.request("GET", "/api/push/public-key");
    let sub = await reg.pushManager.getSubscription();
    // Server đổi khoá thì subscription cũ không dùng được → đăng ký lại
    if (sub && sub.options?.applicationServerKey && bytesToKey(sub.options.applicationServerKey) !== publicKey) {
      await sub.unsubscribe();
      sub = null;
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) });
    await Api.request("POST", "/api/push/subscribe", { deviceId: deviceId(), subscription: sub.toJSON() });
  }

  /** Bật thông báo đẩy (cần đã cho phép thông báo và đã đăng nhập). Trả về true nếu thành công. */
  async function enable() {
    if (!supported() || !Api.isLoggedIn() || Notification.permission !== "granted") return false;
    try {
      await subscribe();
      active = true;
      Storage.saveValue(ENABLED_KEY, "1");
      return true;
    } catch (err) {
      console.warn("Không bật được thông báo đẩy:", err);
      active = false;
      return false;
    }
  }

  // Khi mở app / sau khi đăng nhập: nếu máy này từng bật thì đăng ký lại (subscription có thể đã đổi)
  async function init() {
    if (supported() && Storage.loadValue(ENABLED_KEY) === "1" && Notification.permission === "granted") await enable();
  }

  /** Gỡ máy này khỏi tài khoản (khi đăng xuất). Giữ cờ bật để lần đăng nhập sau tự bật lại. */
  async function disable() {
    if (!active) return;
    active = false;
    try { await Api.request("DELETE", "/api/push/subscribe", { deviceId: deviceId() }); } catch { /* bỏ qua */ }
  }

  /** Gửi toàn bộ lịch nhắc [{ key, at, title, body }] của tài khoản lên server. */
  async function sync(events) {
    if (!active) return;
    try {
      await Api.request("PUT", "/api/push/reminders", { reminders: events });
    } catch (err) {
      console.warn("Gửi lịch nhắc lỗi, sẽ gửi lại ở lần đồng bộ sau:", err.message);
    }
  }

  return { supported, enable, init, disable, sync, isActive: () => active };
})();
