// Đồng bộ danh sách việc giữa các thiết bị qua server: gửi các việc đã đổi, nhận lại bản gộp.
// Quy tắc gộp: với mỗi việc, bản có updatedAt mới hơn thắng (sửa sau cùng được giữ).
// Việc bị xoá được giữ dưới dạng "dấu xoá" (deleted: true) để thiết bị khác cũng xoá theo.
const TaskSync = (() => {
  const DIRTY_KEY = "todo.dirty";           // id các việc đổi trên máy này nhưng chưa gửi được lên server
  const NOTIFY_FLAGS = ["notifiedBefore", "notifiedStart", "notifiedDue"];
  const POLL_MS = 60 * 1000;                // đang mở app: hỏi server mỗi phút để nhận thay đổi từ máy khác
  const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

  let dirty = new Set(readDirty());
  let timer = null;
  let running = null;                       // Promise của lượt đồng bộ đang chạy
  let again = false;
  let hooks = { getTasks: () => [], setTasks: () => {}, onStatus: () => {}, onSynced: () => {} };

  function readDirty() {
    try { return JSON.parse(Storage.loadValue(DIRTY_KEY)) || []; } catch { return []; }
  }

  function persist() {
    Storage.saveValue(DIRTY_KEY, dirty.size ? JSON.stringify([...dirty]) : null);
  }

  const enabled = () => Api.available() && Api.isLoggedIn();

  function schedule(delay = 800) {
    if (!enabled()) return;
    clearTimeout(timer);
    timer = setTimeout(run, delay);
  }

  const sameSchedule = (a, b) => a.start === b.start && a.due === b.due && a.remindBefore === b.remindBefore;

  function merge(local, remote) {
    const map = new Map(local.map((t) => [t.id, t]));
    for (const r of remote) {
      const l = map.get(r.id);
      if (l && r.updatedAt <= l.updatedAt) continue;
      // Lịch không đổi thì giữ cờ "đã nhắc" của máy này, tránh nhắc lại việc đã nhắc
      if (l && !r.deleted && sameSchedule(l, r)) for (const f of NOTIFY_FLAGS) r[f] = r[f] || l[f];
      map.set(r.id, r);
    }
    const cutoff = Date.now() - TOMBSTONE_TTL_MS;
    return [...map.values()].filter((t) => !(t.deleted && t.updatedAt < cutoff && !dirty.has(t.id)));
  }

  async function doRun() {
    hooks.onStatus("syncing");
    try {
      const sending = hooks.getTasks().filter((t) => dirty.has(t.id));
      // Ghi lại phiên bản lúc gửi: việc bị sửa tiếp trong lúc chờ thì vẫn giữ trong hàng chờ
      const sentAt = new Map(sending.map((t) => [t.id, t.updatedAt]));
      const res = await Api.request("POST", "/api/tasks/sync", { tasks: sending });

      const current = hooks.getTasks();
      const byId = new Map(current.map((t) => [t.id, t]));
      for (const [id, at] of sentAt) if (byId.get(id)?.updatedAt === at) dirty.delete(id);
      for (const id of [...dirty]) if (!byId.has(id)) dirty.delete(id);
      persist();

      hooks.setTasks(merge(current, res.tasks));
      hooks.onStatus("ok");
      hooks.onSynced();
    } catch (err) {
      hooks.onStatus(err.status === 401 ? "idle" : err.status ? "error" : "offline");
    }
  }

  function run() {
    if (!enabled()) return Promise.resolve();
    if (running) { again = true; return running; }
    running = doRun().finally(() => {
      running = null;
      if (again) { again = false; schedule(0); }
    });
    return running;
  }

  function init(h) {
    hooks = { ...hooks, ...h };
    setInterval(() => { if (!document.hidden) schedule(0); }, POLL_MS);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) schedule(0); });
    window.addEventListener("online", () => schedule(0));
  }

  return {
    init,
    /** Đánh dấu việc vừa đổi trên máy này, lên lịch gửi lên server. */
    markDirty(id) { dirty.add(id); persist(); schedule(); },
    /** Đánh dấu toàn bộ (dùng khi đưa việc có sẵn trên máy lên tài khoản lần đầu). */
    markAll(tasks) { tasks.forEach((t) => dirty.add(t.id)); persist(); },
    clear() { dirty.clear(); persist(); },
    /** Đồng bộ ngay, chờ xong. */
    async syncNow() { if (running) await running; return run(); },
    hasPending: () => dirty.size > 0,
  };
})();
