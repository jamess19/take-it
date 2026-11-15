// Đồng bộ việc và ghi chú giữa các thiết bị qua server: gửi các bản ghi đã đổi, nhận lại bản gộp.
// Quy tắc gộp: với mỗi bản ghi, bản có updatedAt mới hơn thắng (sửa sau cùng được giữ).
// Bản ghi bị xoá được giữ dưới dạng "dấu xoá" (deleted: true) để thiết bị khác cũng xoá theo.
const TaskSync = (() => {
  const NOTIFY_FLAGS = ["notifiedBefore", "notifiedStart", "notifiedDue"];
  const POLL_MS = 60 * 1000;                // đang mở app: hỏi server mỗi phút để nhận thay đổi từ máy khác
  const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  // Mỗi loại bản ghi có hàng chờ riêng: id đã đổi trên máy này nhưng chưa gửi được lên server
  const KINDS = { tasks: "todo.dirty", notes: "todo.dirty.notes" };

  const dirty = {};
  for (const [kind, key] of Object.entries(KINDS)) dirty[kind] = new Set(readDirty(key));
  let timer = null;
  let running = null;                       // Promise của lượt đồng bộ đang chạy
  let again = false;
  let hooks = {
    getTasks: () => [], setTasks: () => {}, getNotes: () => [], setNotes: () => {},
    onStatus: () => {}, onSynced: () => {},
  };
  const getList = (kind) => (kind === "tasks" ? hooks.getTasks() : hooks.getNotes());
  const setList = (kind, list) => (kind === "tasks" ? hooks.setTasks(list) : hooks.setNotes(list));

  function readDirty(key) {
    try { return JSON.parse(Storage.loadValue(key)) || []; } catch { return []; }
  }

  function persist() {
    for (const [kind, key] of Object.entries(KINDS)) {
      Storage.saveValue(key, dirty[kind].size ? JSON.stringify([...dirty[kind]]) : null);
    }
  }

  const enabled = () => Api.available() && Api.isLoggedIn();

  function schedule(delay = 800) {
    if (!enabled()) return;
    clearTimeout(timer);
    timer = setTimeout(run, delay);
  }

  const sameSchedule = (a, b) => a.start === b.start && a.due === b.due && a.remindBefore === b.remindBefore;

  function merge(kind, local, remote) {
    const map = new Map(local.map((t) => [t.id, t]));
    for (const r of remote) {
      const l = map.get(r.id);
      if (l && r.updatedAt <= l.updatedAt) continue;
      // Việc: lịch không đổi thì giữ cờ "đã nhắc" của máy này, tránh nhắc lại việc đã nhắc
      if (kind === "tasks" && l && !r.deleted && sameSchedule(l, r)) for (const f of NOTIFY_FLAGS) r[f] = r[f] || l[f];
      map.set(r.id, r);
    }
    const cutoff = Date.now() - TOMBSTONE_TTL_MS;
    return [...map.values()].filter((t) => !(t.deleted && t.updatedAt < cutoff && !dirty[kind].has(t.id)));
  }

  async function doRun() {
    hooks.onStatus("syncing");
    try {
      const body = {};
      const sentAt = {};
      for (const kind of Object.keys(KINDS)) {
        body[kind] = getList(kind).filter((t) => dirty[kind].has(t.id));
        // Ghi lại phiên bản lúc gửi: bản ghi bị sửa tiếp trong lúc chờ thì vẫn giữ trong hàng chờ
        sentAt[kind] = new Map(body[kind].map((t) => [t.id, t.updatedAt]));
      }
      const res = await Api.request("POST", "/api/tasks/sync", body);

      for (const kind of Object.keys(KINDS)) {
        // Server bản cũ chưa biết ghi chú (không trả notes) → giữ nguyên hàng chờ, gửi lại lần sau
        if (!Array.isArray(res[kind])) continue;
        const current = getList(kind);
        const byId = new Map(current.map((t) => [t.id, t]));
        for (const [id, at] of sentAt[kind]) if (byId.get(id)?.updatedAt === at) dirty[kind].delete(id);
        for (const id of [...dirty[kind]]) if (!byId.has(id)) dirty[kind].delete(id);
        // Tự lành: bản ghi có trên máy mà server không có (server mất dữ liệu) → gửi lại ở lượt sau
        const onServer = new Set(res[kind].map((t) => t.id));
        for (const t of current) if (!onServer.has(t.id)) dirty[kind].add(t.id);
        setList(kind, merge(kind, current, res[kind]));
      }
      persist();
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

  function mark(kind, id) { dirty[kind].add(id); persist(); schedule(); }

  return {
    init,
    /** Đánh dấu việc vừa đổi trên máy này, lên lịch gửi lên server. */
    markDirty: (id) => mark("tasks", id),
    /** Đánh dấu ghi chú vừa đổi trên máy này. */
    markNoteDirty: (id) => mark("notes", id),
    /** Đánh dấu toàn bộ (dùng khi đưa dữ liệu có sẵn trên máy lên tài khoản lần đầu). */
    markAll(tasks, notes = []) {
      tasks.forEach((t) => dirty.tasks.add(t.id));
      notes.forEach((n) => dirty.notes.add(n.id));
      persist();
    },
    clear() { for (const k of Object.keys(KINDS)) dirty[k].clear(); persist(); },
    /** Đồng bộ ngay, chờ xong. */
    async syncNow() { if (running) await running; return run(); },
    hasPending: () => Object.values(dirty).some((s) => s.size > 0),
  };
})();
