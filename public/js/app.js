// Logic giao diện chính: thêm/sửa/xoá công việc, lọc, tìm kiếm, hiển thị và nối với bộ nhắc việc.
(() => {
  const $ = (sel) => document.querySelector(sel);

  const state = {
    // Việc tạo trước khi có tính năng đồng bộ chưa có updatedAt → lấy createdAt
    tasks: Storage.loadTasks().map((t) => ({ ...t, updatedAt: t.updatedAt || t.createdAt || Date.now() })),
    filter: "all",
    query: "",
  };

  const FILTER_TITLES = { all: "Tất cả", today: "Hôm nay", upcoming: "Sắp tới", overdue: "Quá hạn", done: "Đã xong" };
  const PRIORITY_LABEL = { high: "Cao", medium: "Trung bình", low: "Thấp" };
  const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
  const DEFAULT_REMIND = 15;
  const DEFAULT_DURATION = 30;
  const OWNER_KEY = "todo.owner"; // email của tài khoản sở hữu dữ liệu đang lưu trên máy

  // ---------- Tiện ích ----------
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // Lưu xuống máy; các việc truyền vào là việc vừa đổi → cập nhật mốc thời gian và đánh dấu để đồng bộ
  function save(...changed) {
    for (const t of changed) {
      t.updatedAt = Date.now();
      TaskSync.markDirty(t.id);
    }
    Storage.saveTasks(state.tasks);
  }

  // Việc đang hiển thị (bỏ các việc đã xoá — chỉ còn giữ dấu xoá để đồng bộ)
  const live = () => state.tasks.filter((t) => !t.deleted);

  // Ô ghi chú tự giãn theo nội dung; chạm chiều cao tối đa (CSS max-height) thì cuộn bên trong
  function autosize(el) {
    el.style.height = "auto";
    const max = parseFloat(getComputedStyle(el).maxHeight) || Infinity;
    const h = el.scrollHeight + (el.offsetHeight - el.clientHeight); // cộng viền để không bị hụt
    el.style.height = `${Math.min(h, max)}px`;
    el.style.overflowY = h > max ? "auto" : "hidden";
  }
  document.addEventListener("input", (e) => { if (e.target.matches?.("textarea[data-autosize]")) autosize(e.target); });

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
    startInput.closest(".dt")?.classList.toggle("is-empty", !start);
    const minutes = Number(durationSelect.value);
    previewEl.hidden = !start || !minutes;
    if (previewEl.hidden) return;
    const end = TimeUtils.parse(TimeUtils.addMinutes(start, minutes));
    previewEl.textContent = `→ Kết thúc dự kiến: ${TimeUtils.formatDue(end)}`;
  }

  // ---------- Phân loại ----------
  function category(t, now = Date.now()) {
    if (t.done) return "done";
    if (t.startedAt) return "doing"; // đã bấm "Bắt đầu" → đang xử lý
    if (!t.due) return "nodate";
    const start = Reminder.startOf(t);
    const end = TimeUtils.parse(t.due);
    if (end < now) return "overdue"; // hết khung giờ mà chưa bắt đầu
    if (start <= now || TimeUtils.isSameDay(start, now)) return "today";
    return "upcoming";
  }

  function matchesFilter(t, filter) {
    const c = category(t);
    switch (filter) {
      case "all": return !t.done;
      case "today": return c === "doing" || c === "today";
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
  // Thẻ việc: 1 nhãn trạng thái nổi bật cạnh tiêu đề + 1 dòng thông tin chữ nhạt (không xếp nhiều nhãn ngang nhau)
  function taskHtml(t) {
    const now = Date.now();
    const cat = category(t, now);
    const start = t.due ? Reminder.startOf(t) : null;
    const end = t.due ? TimeUtils.parse(t.due) : null;
    const hasDuration = t.duration > 0;
    let status = null; // { text, cls }
    const meta = [];

    if (cat === "doing") {
      if (end && hasDuration) {
        status = end >= now
          ? { text: `▶ Đang làm · còn ${TimeUtils.duration(end - now)}`, cls: "is-doing" }
          : { text: `▶ Quá dự kiến ${TimeUtils.duration(now - end)}`, cls: "is-soon" };
        meta.push(`▶ Bắt đầu ${TimeUtils.formatDue(t.startedAt)}`, `🏁 Xong lúc ${TimeUtils.formatDue(end)}`);
      } else {
        status = { text: "▶ Đang làm", cls: "is-doing" };
        meta.push(`▶ Bắt đầu ${TimeUtils.formatDue(t.startedAt)}`);
      }
    } else if (t.due) {
      meta.push(`⏰ ${TimeUtils.formatRange(start, end)}`);
      if (hasDuration) meta.push(`⏳ ${TimeUtils.duration(t.duration * TimeUtils.MIN)}`);
      if (!t.done) {
        if (cat === "overdue") status = { text: `Quá giờ ${TimeUtils.duration(now - end)}`, cls: "is-overdue" };
        else if (start <= now) status = { text: "Đã đến giờ", cls: "is-soon" };
        else status = { text: `Sau ${TimeUtils.duration(start - now)}`, cls: start - now <= TimeUtils.HOUR ? "is-soon" : "" };
      }
    }
    if (t.due && !t.done && !t.startedAt && t.remindBefore >= 0) {
      meta.push(t.snoozeUntil ? `🔔 báo lại ${TimeUtils.formatDue(t.snoozeUntil)}`
        : t.remindBefore === 0 ? "🔔 đúng giờ" : `🔔 trước ${TimeUtils.duration(t.remindBefore * TimeUtils.MIN)}`);
    }
    // "Trung bình" là mặc định → không ghi; mức ưu tiên đã có vạch màu ở mép trái thẻ
    if (t.priority !== "medium") meta.push(`<span class="prio-text prio-${t.priority}">Ưu tiên ${PRIORITY_LABEL[t.priority].toLowerCase()}</span>`);

    const statusHtml = status ? `<span class="status ${status.cls}">${status.text}</span>` : "";
    const metaHtml = meta.length ? `<div class="task-meta">${meta.map((m) => `<span>${m}</span>`).join("")}</div>` : "";
    const noteCount = Notes.countFor(t.id);
    const cta = [
      !t.done && !t.startedAt ? `<button class="start-btn" data-action="start">▶ Bắt đầu</button>` : "",
      `<button class="note-btn ${noteCount ? "has-note" : ""}" data-action="note">📝 Ghi chú${noteCount ? ` · ${noteCount}` : ""}</button>`,
    ].join("");
    const startBtn = `<div class="task-cta">${cta}</div>`;

    return `
      <li class="task prio-${t.priority} ${t.done ? "is-done" : ""} ${cat === "doing" ? "is-started" : ""}" data-id="${t.id}">
        <button class="check" data-action="toggle" aria-label="${t.done ? "Đánh dấu chưa xong" : "Đánh dấu đã xong"}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </button>
        <div class="task-body" data-action="edit">
          <div class="task-head">
            <div class="task-title">${escapeHtml(t.title)}</div>
            ${statusHtml}
          </div>
          ${t.note ? `<div class="task-note">${escapeHtml(t.note)}</div>` : ""}
          ${metaHtml}
          ${startBtn}
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
    const tasks = live();
    for (const t of tasks) for (const f of Object.keys(counts)) if (matchesFilter(t, f)) counts[f]++;
    document.querySelectorAll("[data-count]").forEach((el) => {
      el.textContent = counts[el.dataset.count] || ""; // số 0 không hiện cho đỡ rối
      el.classList.toggle("has-alert", el.dataset.count === "overdue" && counts.overdue > 0);
    });
    $("#nav-overdue").textContent = counts.overdue || ""; // số việc quá hạn cạnh mục "Công việc" ở sidebar

    const total = tasks.length;
    const done = counts.done;
    $("#progress").hidden = total === 0;
    $("#progress-fill").style.width = total ? `${(done / total) * 100}%` : "0";
    $("#progress-text").textContent = `Đã xong ${done}/${total}`;
  }

  function render() {
    const q = state.query.trim().toLowerCase();
    const visible = live()
      .filter((t) => matchesFilter(t, state.filter))
      .filter((t) => !q || [t.title, t.note].some((x) => (x || "").toLowerCase().includes(q)))
      .sort(compare);

    let html = "";
    if (state.filter === "all") {
      const by = (c) => visible.filter((t) => category(t) === c);
      html =
        groupHtml("Quá hạn", by("overdue"), "group-overdue") +
        groupHtml("Đang xử lý", by("doing"), "group-doing") +
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
    Notes.renderHead(); // trang ghi chú đang mở: cập nhật trạng thái việc
    if (currentView() === "notes") Notes.renderPage();
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
    const task = {
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
    };
    state.tasks.push(task);
    save(task);
    render();
  }

  function toggleTask(id) {
    const t = findTask(id);
    if (!t) return;
    t.done = !t.done;
    t.completedAt = t.done ? Date.now() : null;
    t.snoozeUntil = null;
    save(t);
    render();
    if (t.done) toast(`Đã xong: <b>${escapeHtml(t.title)}</b> 🎉`, { actions: [{ label: "Hoàn tác", onClick: () => toggleTask(id) }] });
  }

  // Xoá = gắn dấu xoá (để thiết bị khác cũng xoá theo khi đồng bộ)
  function setDeleted(id, deleted) {
    const t = findTask(id);
    if (!t) return null;
    t.deleted = deleted;
    save(t);
    render();
    return t;
  }

  function deleteTask(id) {
    const t = setDeleted(id, true);
    if (!t) return;
    toast(`Đã xoá <b>${escapeHtml(t.title)}</b>`, {
      timeout: 6000,
      actions: [{ label: "Hoàn tác", primary: true, onClick: () => setDeleted(id, false) }],
    });
  }

  function snooze(id, minutes = 5, kind = null) {
    const t = findTask(id);
    if (!t) return;
    t.snoozeUntil = Date.now() + minutes * TimeUtils.MIN;
    t.snoozeKind = kind; // khi hết báo lại sẽ nhắc lại đúng loại này (vd: "đến giờ bắt đầu")
    save(t);
    render();
  }

  // Bấm "Bắt đầu": chuyển sang đang xử lý; giờ kết thúc dự kiến tính lại từ lúc bắt đầu thật
  function startTask(id) {
    const t = findTask(id);
    if (!t || t.done || t.startedAt) return;
    const now = Date.now();
    t.startedAt = now;
    t.snoozeUntil = null;
    if (t.duration > 0) {
      t.due = TimeUtils.addMinutes(TimeUtils.toLocalInput(new Date(now)), t.duration);
      t.notifiedDue = false;
    }
    save(t);
    render();
    const end = t.duration > 0 ? ` — dự kiến xong ${TimeUtils.formatDue(TimeUtils.parse(t.due))}` : "";
    toast(`▶ Đã bắt đầu: <b>${escapeHtml(t.title)}</b>${end}`);
  }

  // Gia hạn thời gian dự kiến của việc đang làm
  function extendTask(id, minutes) {
    const t = findTask(id);
    if (!t || t.done || !t.due) return;
    t.duration = (t.duration || 0) + minutes;
    t.due = TimeUtils.addMinutes(t.due, minutes);
    t.notifiedDue = false;
    t.snoozeUntil = null;
    save(t);
    render();
    toast(`Đã gia hạn ${minutes} phút — dự kiến xong ${TimeUtils.formatDue(TimeUtils.parse(t.due))}`);
  }

  function completeTask(id) {
    const t = findTask(id);
    if (t && !t.done) toggleTask(id);
  }

  // ---------- Nhắc việc ----------
  const ALERT_INFO = {
    before: { icon: "⏰", heading: "Sắp bắt đầu", variant: "toast-warn" },
    start: { icon: "▶️", heading: "Đến giờ bắt đầu", variant: "toast-alert" },
    due: { icon: "⌛", heading: "Hết thời gian dự kiến", variant: "toast-alert" },
    late: { icon: "⚠️", heading: "Quá giờ, chưa bắt đầu", variant: "toast-alert" },
  };

  // Loại nhắc thực tế theo trạng thái việc: báo lại → lặp lại loại cũ; hết giờ mà chưa bắt đầu → "late"
  function resolveKind(t, kind) {
    if (kind === "snooze") kind = t.snoozeKind || (t.startedAt ? "due" : "start");
    if (kind === "due" && !t.startedAt) return "late";
    return kind;
  }

  // Nội dung lời nhắc tại thời điểm `at` (mặc định là bây giờ)
  function alertText(t, rawKind, at = Date.now()) {
    const kind = resolveKind(t, rawKind);
    const start = Reminder.startOf(t);
    const end = TimeUtils.parse(t.due);
    const planned = t.duration > 0 ? ` · dự kiến ${TimeUtils.duration(t.duration * TimeUtils.MIN)}` : "";
    const detail = {
      before: `Bắt đầu ${TimeUtils.formatDue(start)} (còn ${TimeUtils.duration(start - at)})${planned}`,
      start: `${TimeUtils.formatRange(start, end)}${planned}`,
      due: t.startedAt ? `Đã làm ${TimeUtils.duration(at - t.startedAt)} — xong chưa?` : "",
      late: `Khung giờ ${TimeUtils.formatRange(start, end)} đã qua`,
    }[kind];
    const info = ALERT_INFO[kind];
    const heading = (rawKind === "snooze" ? "Nhắc lại · " : "") + info.heading;
    return { kind, heading, detail, icon: info.icon, variant: info.variant };
  }

  // Lịch các mốc nhắc trong tương lai, gửi lên server để đẩy thông báo kể cả khi app đã tắt
  function pushEvents() {
    const now = Date.now();
    const events = [];
    const add = (t, rawKind, at) => {
      if (at <= now) return;
      const { kind, heading, detail, icon } = alertText(t, rawKind, at);
      events.push({ key: `${t.id}:${rawKind}`, at, title: `${icon} ${heading}: ${t.title}`, body: detail, taskId: t.id, kind });
    };
    for (const t of live()) {
      if (t.done || !t.due || t.remindBefore < 0) continue;
      const start = Reminder.startOf(t);
      const end = TimeUtils.parse(t.due);
      if (t.snoozeUntil) { add(t, "snooze", t.snoozeUntil); continue; }
      if (!t.startedAt) {
        if (t.remindBefore > 0) add(t, "before", start - t.remindBefore * TimeUtils.MIN);
        add(t, "start", start);
      }
      if (end > start || (t.startedAt && t.duration > 0)) add(t, "due", end);
    }
    return events;
  }

  // Thực hiện thao tác từ nút bấm (trong app hoặc trên thông báo hệ thống)
  function runAlertAction(act, id, kind) {
    if (act === "start") startTask(id);
    else if (act === "done") completeTask(id);
    else if (act === "snooze") snooze(id, 5, kind);
    else if (act === "extend") extendTask(id, 15);
  }

  // Ô nhắc trong app, nút bấm theo loại nhắc
  function showAlertToast(t, rawKind) {
    const { kind, heading, detail, icon, variant } = alertText(t, rawKind);
    const actions = ALERT_ACTIONS[kind].map((a) => ({
      label: a.label,
      primary: a.primary,
      onClick: () => runAlertAction(a.action, t.id, kind),
    }));
    toast(`<div class="toast-heading">${icon} ${heading}</div><b>${escapeHtml(t.title)}</b>${detail ? `<div class="toast-sub">${detail}</div>` : ""}`, {
      variant,
      timeout: 0, // giữ đến khi người dùng xử lý
      actions,
    });
  }

  function onAlert(t, rawKind) {
    const { kind, heading, detail, icon } = alertText(t, rawKind);
    Reminder.beep();
    Reminder.flashTitle(t.title);
    // Đã bật thông báo đẩy thì server gửi thông báo hệ thống, tránh hiện 2 lần
    if (!PushSync.isActive()) {
      Reminder.systemNotify(`${icon} ${heading}: ${t.title}`, detail, {
        tag: `${t.id}:${rawKind}`,
        data: { taskId: t.id, kind },
        actions: ALERT_ACTIONS[kind].map((a) => ({ action: a.action, title: a.label })),
      });
    }
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    showAlertToast(t, rawKind);
  }

  // Thao tác đến từ thông báo hệ thống (service worker chuyển sang, hoặc qua địa chỉ khi app vừa mở)
  function handleNotificationAction(act, id, kind) {
    const t = findTask(id);
    if (!t || t.deleted || t.done) return;
    if (act !== "open") return runAlertAction(act, id, kind);
    // Bấm vào thông báo (iPhone không có nút trên thông báo) → hiện ô nhắc kèm nút trong app
    if (kind && ALERT_ACTIONS[kind] && !(t.startedAt && (kind === "before" || kind === "start"))) showAlertToast(t, kind);
  }

  function initNotificationActions() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", (e) => {
        if (e.data?.type === "alert-action") handleNotificationAction(e.data.act, e.data.taskId, e.data.kind);
      });
    }
    const q = new URLSearchParams(location.search);
    if (q.get("task")) {
      history.replaceState(null, "", location.pathname);
      handleNotificationAction(q.get("act") || "open", q.get("task"), q.get("kind") || null);
    }
  }

  function tick() {
    // Cờ "đã nhắc" chỉ lưu trên máy, không cần đồng bộ
    if (Reminder.check(live(), onAlert)) save();
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
      autosize($("#new-note"));
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
    const prio = document.querySelector(`input[name="edit-priority"][value="${t.priority}"]`);
    if (prio) prio.checked = true;
    PageDialog.open($("#edit-dialog")); // điện thoại: mở thành trang riêng
    autosize($("#edit-note")); // đo sau khi hộp thoại đã hiện
    $("#edit-title").focus();
  }

  function initEditDialog() {
    $("#edit-cancel").onclick = () => PageDialog.close($("#edit-dialog"));
    $("#edit-cancel-top").onclick = () => PageDialog.close($("#edit-dialog"));
    const preview = () => updateEndPreview($("#edit-start"), $("#edit-duration"), $("#edit-end"));
    $("#edit-start").oninput = preview;
    $("#edit-duration").onchange = preview;
    $("#edit-form").onsubmit = (e) => {
      e.preventDefault();
      const t = findTask(editingId);
      if (!t) return PageDialog.close($("#edit-dialog"));
      const start = $("#edit-start").value || null;
      const duration = start ? Number($("#edit-duration").value) || 0 : 0;
      // Việc đang xử lý: giờ kết thúc tính từ lúc bấm Bắt đầu
      const base = t.startedAt && duration > 0 ? TimeUtils.toLocalInput(new Date(t.startedAt)) : start;
      const due = TimeUtils.addMinutes(base, duration);
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
        priority: document.querySelector('input[name="edit-priority"]:checked')?.value || t.priority,
      });
      save(t);
      PageDialog.close($("#edit-dialog"));
      render();
    };
    // Bấm ra ngoài hộp thoại để đóng
    $("#edit-dialog").addEventListener("click", (e) => {
      if (e.target === e.currentTarget && !PageDialog.isPage(e.currentTarget)) PageDialog.close(e.currentTarget);
    });
    PageDialog.attach($("#edit-dialog"));
  }

  // ---------- Quyền thông báo ----------
  function updateNotifyCard() {
    $("#notify-card").hidden = !Reminder.needsPermission();
  }

  let askedThisSession = false;
  function maybeAskPermission() {
    const hasDue = live().some((t) => t.due && !t.done);
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
      // Sau khi bật, gửi ngay lịch nhắc hiện tại
      if (pushed) PushSync.sync(pushEvents());
      toast(pushed ? "Đã bật thông báo ✅ — vẫn được nhắc kể cả khi tắt app." : "Đã bật thông báo ✅ (chỉ nhắc khi app đang mở).");
    }
    else if (res === "denied") toast("Thông báo bị chặn. Bạn có thể bật lại trong cài đặt trình duyệt.", { variant: "toast-warn" });
    else if (res === "unsupported") toast("Trình duyệt này không hỗ trợ thông báo. Trên iPhone, hãy thêm app vào Màn hình chính trước.", { variant: "toast-warn", timeout: 7000 });
  }

  // ---------- Tài khoản & đồng bộ ----------
  let authMode = "login";

  function setAuthMode(mode) {
    authMode = mode;
    const reg = mode === "register";
    $("#auth-title").textContent = reg ? "Tạo tài khoản" : "Đăng nhập";
    $("#auth-submit").textContent = reg ? "Đăng ký" : "Đăng nhập";
    $("#auth-switch-text").textContent = reg ? "Đã có tài khoản?" : "Chưa có tài khoản?";
    $("#auth-switch").textContent = reg ? "Đăng nhập" : "Đăng ký";
    $("#auth-password").autocomplete = reg ? "new-password" : "current-password";
    $("#auth-hint").hidden = !reg;
    $("#auth-error").hidden = true;
  }

  function showAuth(show) {
    $("#auth").hidden = !show;
    if (show) $("#auth-email").focus();
  }

  // Thẻ người dùng, ảnh đại diện, mục Trang cá nhân / Đăng xuất chỉ hiện khi đã đăng nhập
  function renderAccount() {
    const on = Api.available() && Api.isLoggedIn();
    for (const id of ["#nav-profile", "#logout", "#mobile-avatar"]) $(id).hidden = !on;
    Profile.render();
    if (!on && currentView() === "profile") navigate("tasks");
  }

  // ---------- Điều hướng: trang công việc / trang cá nhân (theo #hash để nút Quay lại hoạt động) ----------
  // #note/<id> là trang soạn phủ lên trang đang xem → giữ trang bên dưới (công việc hoặc danh sách ghi chú)
  function currentView() {
    if (location.hash === "#profile" && Api.isLoggedIn()) return "profile";
    if (location.hash === "#notes") return "notes";
    if (Notes.hasHash() && lastView === "notes") return "notes";
    return "tasks";
  }
  const VIEW_HASH = { profile: "#profile", notes: "#notes", tasks: "" };

  function navigate(view) {
    const hash = VIEW_HASH[view] ?? "";
    if (location.hash !== hash) history.pushState(null, "", hash || location.pathname);
    renderView();
  }

  let lastView = null;
  function renderView() {
    const view = currentView();
    document.body.dataset.view = view;
    $("#tasks-view").hidden = view !== "tasks";
    $("#profile-view").hidden = view !== "profile";
    $("#notes-view").hidden = view !== "notes";
    $("#nav-tasks").classList.toggle("active", view === "tasks");
    $("#nav-notes").classList.toggle("active", view === "notes");
    $("#nav-profile").classList.toggle("active", view === "profile");
    if (view === "profile") Profile.show();
    if (view === "notes") Notes.renderPage();
    Notes.syncWithHash();
    setDrawer(false);
    if (view !== lastView) window.scrollTo(0, 0); // đóng/mở trang ghi chú thì giữ nguyên vị trí cuộn danh sách
    lastView = view;
  }

  // Điện thoại: sidebar thành ngăn kéo trượt, mở bằng nút ☰
  function setDrawer(open) {
    document.body.classList.toggle("drawer-open", open);
    $("#backdrop").hidden = !open;
    $("#menu-btn").setAttribute("aria-expanded", String(open));
  }


  function initNavigation() {
    document.addEventListener("click", (e) => {
      const el = e.target.closest("[data-nav]");
      if (el) navigate(el.dataset.nav);
    });
    window.addEventListener("popstate", renderView);
    window.addEventListener("hashchange", renderView);
    $("#menu-btn").onclick = () => setDrawer(!document.body.classList.contains("drawer-open"));
    $("#backdrop").onclick = () => setDrawer(false);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") setDrawer(false); });
  }

  const SYNC_LABEL = {
    syncing: "🔄 Đang đồng bộ…",
    ok: "☁️ Đã đồng bộ",
    offline: "📴 Mất mạng — sẽ đồng bộ khi có mạng",
    error: "⚠️ Lỗi đồng bộ, sẽ thử lại",
    idle: "",
  };

  function renderSyncStatus(status) {
    $("#sync-status").textContent = SYNC_LABEL[status] ?? "";
    $("#sync-status").dataset.state = status;
  }

  async function onLoggedIn(email) {
    const owner = Storage.loadValue(OWNER_KEY);
    if (owner && owner !== email) {
      // Dữ liệu trên máy thuộc tài khoản khác → bỏ, tải dữ liệu của tài khoản này về
      state.tasks = [];
      Notes.clear();
      TaskSync.clear();
    } else {
      // Việc đang có trên máy (tạo trước khi có tài khoản, hoặc server đã mất) → gửi lên; server chỉ nhận bản mới hơn nên không ghi đè
      TaskSync.markAll(state.tasks, Notes.all());
    }
    Storage.saveValue(OWNER_KEY, email);
    Storage.saveTasks(state.tasks);
    showAuth(false);
    renderAccount();
    Profile.refresh();
    render();
    Notes.syncWithHash(); // mở bằng đường dẫn #note/... trước khi đăng nhập
    await PushSync.init();
    await TaskSync.syncNow();
  }

  async function submitAuth(e) {
    e.preventDefault();
    const btn = $("#auth-submit");
    btn.disabled = true;
    $("#auth-error").hidden = true;
    try {
      const register = authMode === "register";
      const session = await Api.login($("#auth-email").value, $("#auth-password").value, register);
      $("#auth-password").value = "";
      await onLoggedIn(session.email);
      toast(register ? "Đã tạo tài khoản ✅" : "Đã đăng nhập ✅");
    } catch (err) {
      $("#auth-error").textContent = err.status ? err.message : "Không kết nối được server. Kiểm tra mạng rồi thử lại.";
      $("#auth-error").hidden = false;
    } finally {
      btn.disabled = false;
    }
  }

  async function logout() {
    await TaskSync.syncNow();
    if (TaskSync.hasPending() && !confirm("Còn thay đổi chưa đồng bộ lên server (có thể do mất mạng). Đăng xuất sẽ mất các thay đổi này. Vẫn đăng xuất?")) return;
    await PushSync.disable();
    await Api.logout();
    // Xoá dữ liệu trên máy để người khác dùng máy này không thấy
    state.tasks = [];
    Notes.clear();
    TaskSync.clear();
    Storage.saveTasks([]);
    Storage.saveValue(OWNER_KEY, null);
    Profile.clear();
    renderSyncStatus("idle");
    navigate("tasks");
    renderAccount();
    render();
    showAuth(true);
  }

  function initAccount() {
    TaskSync.init({
      getTasks: () => state.tasks,
      setTasks: (list) => { state.tasks = list; Storage.saveTasks(list); render(); },
      getNotes: () => Notes.all(),
      setNotes: (list) => { Notes.replaceAll(list); render(); },
      onStatus: renderSyncStatus,
      // Danh sách việc vừa cập nhật → gửi lịch nhắc mới lên server cho mọi thiết bị
      onSynced: () => PushSync.sync(pushEvents()),
    });
    Api.onUnauthorized(() => { renderAccount(); setAuthMode("login"); showAuth(true); });
    $("#auth-form").onsubmit = submitAuth;
    $("#auth-switch").onclick = () => setAuthMode(authMode === "login" ? "register" : "login");
    $("#logout").onclick = () => { setDrawer(false); logout(); };
    Profile.init({
      toast,
      // Đổi email: cập nhật email phiên đăng nhập và chủ dữ liệu trên máy (tránh bị coi là tài khoản khác)
      onEmailChanged: (email) => { Api.setEmail(email); Storage.saveValue(OWNER_KEY, email); },
    });
    setAuthMode("login");
  }

  // ---------- Giao diện sáng/tối ----------
  const isDark = () => (document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark";

  function applyTheme(theme) {
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    $("#theme-toggle").setAttribute("aria-checked", String(isDark()));
  }

  function toggleTheme() {
    const next = isDark() ? "light" : "dark";
    applyTheme(next);
    Storage.saveTheme(next);
  }

  // ---------- Sự kiện chung ----------
  function initEvents() {
    $("#filters").onclick = (e) => {
      const btn = e.target.closest("[data-filter]");
      if (!btn) return;
      state.filter = btn.dataset.filter;
      navigate("tasks"); // đang ở trang cá nhân mà bấm bộ lọc → về danh sách việc
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
      if (action === "start") startTask(id);
      if (action === "edit") openEdit(id);
      if (action === "note") Notes.openForTask(id);
      if (action === "delete") deleteTask(id);
    };

    $("#enable-notify").onclick = enableNotify;
    $("#theme-toggle").onclick = toggleTheme;

    // Phím tắt: N = thêm việc, / = tìm kiếm
    document.addEventListener("keydown", (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      if (typing || e.metaKey || e.ctrlKey || e.altKey || $("#edit-dialog").open || $("#note-dialog").open || currentView() !== "tasks") return;
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
  Notes.init({
    findTask,
    liveTasks: live,
    toast,
    escapeHtml,
    uid,
    allowed: () => Api.isLoggedIn() || !Api.available(), // chưa đăng nhập thì không che màn đăng nhập
    baseHash: () => VIEW_HASH[lastView] || "",
    onChange: render,
  });
  initEvents();
  updateNotifyCard();
  initAccount();
  initNavigation();
  initNotificationActions();
  registerServiceWorker();
  Reminder.start(tick);
  renderAccount();
  renderView();
  if (Api.isLoggedIn()) Profile.refresh();
  if (Api.available() && !Api.isLoggedIn()) {
    showAuth(true); // có server → bắt buộc đăng nhập để đồng bộ
  } else if (Api.isLoggedIn()) {
    // Mở app: đăng ký lại thông báo đẩy (nếu đã bật) rồi đồng bộ; xong đồng bộ sẽ gửi lịch nhắc
    PushSync.init().then(() => TaskSync.syncNow());
  }
})();
