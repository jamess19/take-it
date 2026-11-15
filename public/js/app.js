// Logic giao diện chính: thêm/sửa/xoá công việc, lọc, tìm kiếm, hiển thị và nối với bộ nhắc việc.
(() => {
  const $ = (sel) => document.querySelector(sel);

  const state = {
    tasks: Storage.loadTasks(),
    filter: "all",
    query: "",
  };

  const FILTER_TITLES = { all: "Tất cả", today: "Hôm nay", upcoming: "Sắp tới", overdue: "Quá hạn", done: "Đã xong" };
  const PRIORITY_LABEL = { high: "Cao", medium: "Trung bình", low: "Thấp" };
  const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
  const DEFAULT_REMIND = 15;
  const DEFAULT_DURATION = 30;

  // ---------- Tiện ích ----------
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function save() {
    Storage.saveTasks(state.tasks);
    PushSync.sync(pushEvents());
  }

  function findTask(id) {
    return state.tasks.find((t) => t.id === id);
  }

  function remindLabel(minutes) {
    const opt = Reminder.OPTIONS.find((o) => o.value === minutes);
    if (!opt || minutes < 0) return "";
    return minutes === 0 ? "Nhắc đúng giờ" : `Nhắc trước ${opt.label}`;
  }

  function fillSelect(select, options, value) {
    select.innerHTML = options.map((o) => `<option value="${o.value}">${o.label}</option>`).join("");
    select.value = String(value);
  }
  const fillRemindSelect = (select, value) => fillSelect(select, Reminder.OPTIONS, value);
  const fillDurationSelect = (select, value) => fillSelect(select, Reminder.DURATIONS, value);

  // Dòng "→ Kết thúc dự kiến: ..." hiện dưới ô nhập giờ bắt đầu
  function updateEndPreview(startInput, durationSelect, previewEl) {
    const start = startInput.value;
    const minutes = Number(durationSelect.value);
    previewEl.hidden = !start || !minutes;
    if (previewEl.hidden) return;
    const end = TimeUtils.parse(TimeUtils.addMinutes(start, minutes));
    previewEl.textContent = `→ Kết thúc dự kiến: ${TimeUtils.formatDue(end)}`;
  }

  // ---------- Phân loại ----------
  function category(t, now = Date.now()) {
    if (t.done) return "done";
    if (!t.due) return "nodate";
    const start = Reminder.startOf(t);
    const end = TimeUtils.parse(t.due);
    if (end < now) return "overdue";
    if (start <= now) return "doing"; // đã bắt đầu, chưa hết thời gian dự kiến
    if (TimeUtils.isSameDay(start, now)) return "today";
    return "upcoming";
  }

  function matchesFilter(t, filter) {
    const c = category(t);
    switch (filter) {
      case "all": return !t.done;
      case "today": return c === "doing" || (!t.done && !!t.due && TimeUtils.isSameDay(Reminder.startOf(t), Date.now()));
      case "upcoming": return c === "upcoming";
      case "overdue": return c === "overdue";
      case "done": return t.done;
    }
    return true;
  }

  // Việc chưa xong: giờ bắt đầu sớm nhất lên trước, cùng hạn thì ưu tiên cao trước. Việc xong: mới xong lên trước.
  function compare(a, b) {
    if (a.done && b.done) return (b.completedAt || 0) - (a.completedAt || 0);
    const da = a.due ? Reminder.startOf(a) : Infinity;
    const db = b.due ? Reminder.startOf(b) : Infinity;
    if (da !== db) return da - db;
    if (PRIORITY_RANK[a.priority] !== PRIORITY_RANK[b.priority]) return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    return a.createdAt - b.createdAt;
  }

  // ---------- Hiển thị ----------
  function taskHtml(t) {
    const now = Date.now();
    const cat = category(t, now);
    let dueChip = "";
    let durationChip = "";
    if (t.due) {
      const start = Reminder.startOf(t);
      const end = TimeUtils.parse(t.due);
      let cls = "", rel = "";
      if (!t.done) {
        if (cat === "overdue") { cls = "is-overdue"; rel = ` · quá giờ ${TimeUtils.duration(now - end)}`; }
        else if (cat === "doing") { cls = "is-doing"; rel = ` · ▶ đang làm, còn ${TimeUtils.duration(end - now)}`; }
        else { cls = start - now <= TimeUtils.HOUR ? "is-soon" : ""; rel = ` · bắt đầu sau ${TimeUtils.duration(start - now)}`; }
      }
      dueChip = `<span class="chip ${cls}">⏰ ${TimeUtils.formatRange(start, end)}${rel}</span>`;
      if (end > start) durationChip = `<span class="chip chip-muted">⏳ ${TimeUtils.duration(end - start)}</span>`;
    }
    const remind = t.due && !t.done && t.remindBefore >= 0
      ? `<span class="chip chip-muted">🔔 ${t.snoozeUntil ? `Báo lại lúc ${TimeUtils.formatDue(t.snoozeUntil)}` : remindLabel(t.remindBefore)}</span>`
      : "";
    const prio = `<span class="chip chip-prio prio-${t.priority}">${PRIORITY_LABEL[t.priority]}</span>`;

    return `
      <li class="task prio-${t.priority} ${t.done ? "is-done" : ""}" data-id="${t.id}">
        <button class="check" data-action="toggle" aria-label="${t.done ? "Đánh dấu chưa xong" : "Đánh dấu đã xong"}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </button>
        <div class="task-body" data-action="edit">
          <div class="task-title">${escapeHtml(t.title)}</div>
          ${t.note ? `<div class="task-note">${escapeHtml(t.note)}</div>` : ""}
          <div class="task-meta">${prio}${dueChip}${durationChip}${remind}</div>
        </div>
        <div class="task-actions">
          <button class="icon-btn" data-action="edit" title="Sửa" aria-label="Sửa">✏️</button>
          <button class="icon-btn" data-action="delete" title="Xoá" aria-label="Xoá">🗑️</button>
        </div>
      </li>`;
  }

  function groupHtml(title, tasks, extraClass = "") {
    if (!tasks.length) return "";
    return `
      <div class="group ${extraClass}">
        <h2 class="group-title">${title} <span>${tasks.length}</span></h2>
        <ul class="tasks">${tasks.map(taskHtml).join("")}</ul>
      </div>`;
  }

  function renderCounts() {
    const counts = { all: 0, today: 0, upcoming: 0, overdue: 0, done: 0 };
    for (const t of state.tasks) for (const f of Object.keys(counts)) if (matchesFilter(t, f)) counts[f]++;
    document.querySelectorAll("[data-count]").forEach((el) => {
      el.textContent = counts[el.dataset.count];
      el.classList.toggle("has-alert", el.dataset.count === "overdue" && counts.overdue > 0);
    });

    const total = state.tasks.length;
    const done = counts.done;
    $("#progress").hidden = total === 0;
    $("#progress-fill").style.width = total ? `${(done / total) * 100}%` : "0";
    $("#progress-text").textContent = `Đã xong ${done}/${total}`;
  }

  function render() {
    const q = state.query.trim().toLowerCase();
    const visible = state.tasks
      .filter((t) => matchesFilter(t, state.filter))
      .filter((t) => !q || t.title.toLowerCase().includes(q) || (t.note || "").toLowerCase().includes(q))
      .sort(compare);

    let html = "";
    if (state.filter === "all") {
      const by = (c) => visible.filter((t) => category(t) === c);
      html =
        groupHtml("Quá hạn", by("overdue"), "group-overdue") +
        groupHtml("Đang làm", by("doing"), "group-doing") +
        groupHtml("Hôm nay", by("today")) +
        groupHtml("Sắp tới", by("upcoming")) +
        groupHtml("Không có hạn", by("nodate"));
    } else {
      html = groupHtml(FILTER_TITLES[state.filter], visible);
    }

    $("#list").innerHTML = html;
    $("#empty").hidden = visible.length > 0;
    if (!visible.length) {
      $("#empty-title").textContent = q ? "Không tìm thấy" : state.filter === "done" ? "Chưa xong việc nào" : "Không có việc nào";
      $("#empty-text").textContent = q
        ? `Không có công việc nào khớp "${state.query}".`
        : state.filter === "overdue" ? "Tuyệt vời, không có việc quá hạn 🎉" : "Thêm việc mới ở ô phía trên nhé.";
    }
    $("#view-title").textContent = FILTER_TITLES[state.filter];
    renderCounts();
  }

  // ---------- Toast ----------
  function toast(message, { actions = [], timeout = 4000, variant = "" } = {}) {
    const el = document.createElement("div");
    el.className = `toast ${variant}`;
    el.innerHTML = `<div class="toast-msg">${message}</div><div class="toast-actions"></div>`;
    const box = el.querySelector(".toast-actions");
    const close = () => { el.classList.add("leaving"); setTimeout(() => el.remove(), 200); };
    for (const a of actions) {
      const b = document.createElement("button");
      b.className = "btn btn-sm " + (a.primary ? "btn-primary" : "btn-ghost");
      b.textContent = a.label;
      b.onclick = () => { a.onClick(); close(); };
      box.appendChild(b);
    }
    const x = document.createElement("button");
    x.className = "toast-close";
    x.setAttribute("aria-label", "Đóng");
    x.textContent = "×";
    x.onclick = close;
    el.appendChild(x);
    $("#toasts").appendChild(el);
    if (timeout) setTimeout(close, timeout);
    return close;
  }

  // ---------- Thao tác công việc ----------
  // Giờ kết thúc (due) luôn được suy ra từ giờ bắt đầu + thời lượng
  function addTask(data) {
    const start = data.start || null;
    const duration = start ? Number(data.duration) || 0 : 0;
    state.tasks.push({
      id: uid(),
      title: data.title.trim(),
      note: data.note.trim(),
      start,
      duration,
      due: TimeUtils.addMinutes(start, duration),
      remindBefore: start ? Number(data.remindBefore) : -1,
      priority: data.priority,
      done: false,
      createdAt: Date.now(),
      completedAt: null,
      notifiedBefore: false,
      notifiedStart: false,
      notifiedDue: false,
      snoozeUntil: null,
    });
    save();
    render();
  }

  function toggleTask(id) {
    const t = findTask(id);
    if (!t) return;
    t.done = !t.done;
    t.completedAt = t.done ? Date.now() : null;
    t.snoozeUntil = null;
    save();
    render();
    if (t.done) toast(`Đã xong: <b>${escapeHtml(t.title)}</b> 🎉`, { actions: [{ label: "Hoàn tác", onClick: () => toggleTask(id) }] });
  }

  function deleteTask(id) {
    const idx = state.tasks.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const [removed] = state.tasks.splice(idx, 1);
    save();
    render();
    toast(`Đã xoá <b>${escapeHtml(removed.title)}</b>`, {
      timeout: 6000,
      actions: [{ label: "Hoàn tác", primary: true, onClick: () => { state.tasks.splice(idx, 0, removed); save(); render(); } }],
    });
  }

  function snooze(id, minutes = 5) {
    const t = findTask(id);
    if (!t) return;
    t.snoozeUntil = Date.now() + minutes * TimeUtils.MIN;
    save();
    render();
  }

  // ---------- Nhắc việc ----------
  // Nội dung lời nhắc tại thời điểm `at` (mặc định là bây giờ)
  function alertText(t, kind, at = Date.now()) {
    const start = Reminder.startOf(t);
    const end = TimeUtils.parse(t.due);
    const headings = { before: "Sắp bắt đầu", start: "Đến giờ bắt đầu", due: "Hết thời gian dự kiến", snooze: "Nhắc lại" };
    const heading = headings[kind];
    const range = TimeUtils.formatRange(start, end);
    const detail =
      kind === "before" ? `${range} · bắt đầu sau ${TimeUtils.duration(start - at)}`
      : kind === "start" && end > start ? `${range} · dự kiến ${TimeUtils.duration(end - start)}`
      : range;
    return { heading, detail };
  }

  // Lịch các mốc nhắc trong tương lai, gửi lên server để đẩy thông báo kể cả khi app đã tắt
  function pushEvents() {
    const now = Date.now();
    const events = [];
    const add = (t, kind, at) => {
      if (at <= now) return;
      const { heading, detail } = alertText(t, kind, at);
      events.push({ key: `${t.id}:${kind}`, at, title: `${heading}: ${t.title}`, body: detail });
    };
    for (const t of state.tasks) {
      if (t.done || !t.due || t.remindBefore < 0) continue;
      const start = Reminder.startOf(t);
      const end = TimeUtils.parse(t.due);
      if (t.snoozeUntil) { add(t, "snooze", t.snoozeUntil); continue; }
      if (t.remindBefore > 0) add(t, "before", start - t.remindBefore * TimeUtils.MIN);
      add(t, "start", start);
      if (end > start) add(t, "due", end);
    }
    return events;
  }

  function onAlert(t, kind) {
    const { heading, detail } = alertText(t, kind);
    Reminder.beep();
    Reminder.flashTitle(t.title);
    // Đã bật thông báo đẩy thì server gửi thông báo hệ thống, tránh hiện 2 lần
    if (!PushSync.isActive()) Reminder.systemNotify(`${heading}: ${t.title}`, detail);
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);

    toast(`<div class="toast-heading">🔔 ${heading}</div><b>${escapeHtml(t.title)}</b><div class="toast-sub">${detail}</div>`, {
      variant: kind === "before" ? "toast-warn" : "toast-alert",
      timeout: 0, // giữ đến khi người dùng xử lý
      actions: [
        { label: "Hoàn thành", primary: true, onClick: () => toggleTask(t.id) },
        { label: "Báo lại 5 phút", onClick: () => snooze(t.id, 5) },
      ],
    });
  }

  function tick() {
    if (Reminder.check(state.tasks, onAlert)) save();
    render(); // cập nhật "còn x phút"
  }

  // ---------- Form thêm nhanh ----------
  function quickDate(kind) {
    const d = new Date();
    if (kind === "1h") d.setTime(d.getTime() + TimeUtils.HOUR);
    if (kind === "tonight") d.setHours(20, 0, 0, 0);
    if (kind === "tomorrow") { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
    return kind === "clear" ? "" : TimeUtils.toLocalInput(d);
  }

  function initComposer() {
    fillRemindSelect($("#new-remind"), DEFAULT_REMIND);
    fillDurationSelect($("#new-duration"), DEFAULT_DURATION);
    const preview = () => updateEndPreview($("#new-start"), $("#new-duration"), $("#new-end"));
    $("#new-start").oninput = preview;
    $("#new-duration").onchange = preview;

    document.querySelectorAll("[data-quick]").forEach((b) => {
      b.onclick = () => { $("#new-start").value = quickDate(b.dataset.quick); preview(); };
    });

    $("#composer").onsubmit = (e) => {
      e.preventDefault();
      const title = $("#new-title").value;
      if (!title.trim()) return;
      const start = $("#new-start").value;
      const duration = $("#new-duration").value;
      const end = TimeUtils.addMinutes(start, duration);
      if (end && TimeUtils.parse(end) < Date.now()) {
        toast("Giờ kết thúc đã qua — việc sẽ nằm trong mục Quá hạn.", { variant: "toast-warn" });
      }
      addTask({ title, note: $("#new-note").value, start, duration, remindBefore: $("#new-remind").value, priority: $("#new-priority").value });
      $("#composer").reset();
      fillRemindSelect($("#new-remind"), DEFAULT_REMIND);
      fillDurationSelect($("#new-duration"), DEFAULT_DURATION);
      preview();
      $("#new-priority").value = "medium";
      $("#new-title").focus();
      maybeAskPermission();
    };
  }

  // ---------- Hộp thoại sửa ----------
  let editingId = null;

  function openEdit(id) {
    const t = findTask(id);
    if (!t) return;
    editingId = id;
    $("#edit-title").value = t.title;
    $("#edit-note").value = t.note || "";
    $("#edit-start").value = t.start || t.due || "";
    fillDurationSelect($("#edit-duration"), t.duration || 0);
    // Thời lượng cũ không nằm trong danh sách chọn sẵn → thêm vào để không bị mất
    if (t.duration && !Reminder.DURATIONS.some((d) => d.value === t.duration)) {
      $("#edit-duration").add(new Option(TimeUtils.duration(t.duration * TimeUtils.MIN), t.duration));
      $("#edit-duration").value = String(t.duration);
    }
    fillRemindSelect($("#edit-remind"), t.remindBefore < 0 && !t.due ? DEFAULT_REMIND : t.remindBefore);
    updateEndPreview($("#edit-start"), $("#edit-duration"), $("#edit-end"));
    $("#edit-priority").value = t.priority;
    $("#edit-dialog").showModal();
    $("#edit-title").focus();
  }

  function initEditDialog() {
    $("#edit-cancel").onclick = () => $("#edit-dialog").close();
    const preview = () => updateEndPreview($("#edit-start"), $("#edit-duration"), $("#edit-end"));
    $("#edit-start").oninput = preview;
    $("#edit-duration").onchange = preview;
    $("#edit-form").onsubmit = (e) => {
      e.preventDefault();
      const t = findTask(editingId);
      if (!t) return $("#edit-dialog").close();
      const start = $("#edit-start").value || null;
      const duration = start ? Number($("#edit-duration").value) || 0 : 0;
      const due = TimeUtils.addMinutes(start, duration);
      const remind = start ? Number($("#edit-remind").value) : -1;
      // Đổi thời gian hoặc mốc nhắc → nhắc lại từ đầu
      if (start !== (t.start || t.due) || due !== t.due || remind !== t.remindBefore) {
        t.notifiedBefore = false;
        t.notifiedStart = false;
        t.notifiedDue = false;
        t.snoozeUntil = null;
      }
      Object.assign(t, {
        title: $("#edit-title").value.trim() || t.title,
        note: $("#edit-note").value.trim(),
        start,
        duration,
        due,
        remindBefore: remind,
        priority: $("#edit-priority").value,
      });
      save();
      $("#edit-dialog").close();
      render();
    };
    // Bấm ra ngoài hộp thoại để đóng
    $("#edit-dialog").addEventListener("click", (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  }

  // ---------- Quyền thông báo ----------
  function updateNotifyCard() {
    $("#notify-card").hidden = !Reminder.needsPermission();
  }

  let askedThisSession = false;
  function maybeAskPermission() {
    const hasDue = state.tasks.some((t) => t.due && !t.done);
    if (askedThisSession || !hasDue || !Reminder.needsPermission()) return;
    askedThisSession = true;
    toast("Bật thông báo để được nhắc ngay cả khi bạn đang ở tab/app khác?", {
      timeout: 10000,
      actions: [{ label: "Bật", primary: true, onClick: enableNotify }],
    });
  }

  async function enableNotify() {
    const res = await Reminder.requestPermission();
    updateNotifyCard();
    if (res === "granted") {
      const pushed = await PushSync.enable();
      if (pushed) PushSync.sync(pushEvents());
      toast(pushed ? "Đã bật thông báo ✅ — vẫn được nhắc kể cả khi tắt app." : "Đã bật thông báo ✅ (chỉ nhắc khi app đang mở).");
    }
    else if (res === "denied") toast("Thông báo bị chặn. Bạn có thể bật lại trong cài đặt trình duyệt.", { variant: "toast-warn" });
    else if (res === "unsupported") toast("Trình duyệt này không hỗ trợ thông báo. Trên iPhone, hãy thêm app vào Màn hình chính trước.", { variant: "toast-warn", timeout: 7000 });
  }

  // ---------- Giao diện sáng/tối ----------
  function applyTheme(theme) {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }

  function toggleTheme() {
    const current = document.documentElement.dataset.theme
      || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
    Storage.saveTheme(next);
  }

  // ---------- Sự kiện chung ----------
  function initEvents() {
    $("#filters").onclick = (e) => {
      const btn = e.target.closest("[data-filter]");
      if (!btn) return;
      state.filter = btn.dataset.filter;
      document.querySelectorAll(".filter").forEach((b) => b.classList.toggle("active", b === btn));
      render();
    };

    $("#search").oninput = (e) => { state.query = e.target.value; render(); };

    $("#list").onclick = (e) => {
      const actionEl = e.target.closest("[data-action]");
      const item = e.target.closest(".task");
      if (!actionEl || !item) return;
      const id = item.dataset.id;
      const action = actionEl.dataset.action;
      if (action === "toggle") toggleTask(id);
      if (action === "edit") openEdit(id);
      if (action === "delete") deleteTask(id);
    };

    $("#enable-notify").onclick = enableNotify;
    $("#theme-toggle").onclick = toggleTheme;
    $("#test-alert").onclick = async () => {
      Reminder.beep();
      if (!PushSync.isActive()) {
        Reminder.systemNotify("Thử nhắc việc", "Thông báo đang hoạt động 👍");
        return toast("🔔 Chuông nhắc hoạt động. Thông báo đẩy từ server chưa bật.");
      }
      try {
        await PushSync.test();
        toast("🔔 Server đã gửi thông báo đẩy thử.");
      } catch {
        toast("Không gửi được thông báo đẩy thử. Kiểm tra server.", { variant: "toast-warn" });
      }
    };

    // Phím tắt: N = thêm việc, / = tìm kiếm
    document.addEventListener("keydown", (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      if (typing || e.metaKey || e.ctrlKey || e.altKey || $("#edit-dialog").open) return;
      if (e.key === "n" || e.key === "N") { e.preventDefault(); $("#new-title").focus(); }
      if (e.key === "/") { e.preventDefault(); $("#search").focus(); }
    });
  }

  function initHeader() {
    const label = new Date().toLocaleDateString("vi-VN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    $("#today-label").textContent = label.charAt(0).toUpperCase() + label.slice(1);
  }

  // Service worker chỉ chạy khi mở qua http(s), mở file trực tiếp thì bỏ qua
  function registerServiceWorker() {
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("sw.js").catch((err) => console.warn("Không đăng ký được service worker:", err));
    }
  }

  // ---------- Khởi động ----------
  applyTheme(Storage.loadTheme());
  initHeader();
  initComposer();
  initEditDialog();
  initEvents();
  updateNotifyCard();
  registerServiceWorker();
  Reminder.start(tick);
  // Mở app: đăng ký lại thông báo đẩy (nếu đã bật trước đó) rồi đồng bộ lịch nhắc
  PushSync.init().then(() => PushSync.sync(pushEvents()));
})();
