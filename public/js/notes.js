// Ghi chú thực hiện: mỗi việc có thể có nhiều ghi chú có tên (kiểu báo cáo).
// - Trang "Ghi chú" (sidebar, #notes): danh sách mọi ghi chú của mọi việc.
// - Trang soạn lớn (#note/<id>): tab các ghi chú của cùng việc, nút Lưu / Tạo mới,
//   đóng khi còn thay đổi chưa lưu thì hỏi Lưu / Không lưu / Huỷ.
const Notes = (() => {
  const $ = (sel) => document.querySelector(sel);
  const NOTE_HASH = /^#note\/([A-Za-z0-9_-]+)$/;
  // Khung báo cáo, dòng đầu ghi sẵn thời điểm chèn
  const template = (at) =>
    `🕒 ${fmtTime(at)} · ${new Date(at).toLocaleDateString("vi-VN")}\n\n## Mục tiêu\n\n\n## Đã làm\n- \n\n## Vướng mắc\n- \n\n## Bước tiếp theo\n- \n`;

  let notes = Storage.loadNotes();
  let deps = {};            // hàm lấy từ app.js: findTask, liveTasks, toast, escapeHtml, uid, allowed, baseHash
  let current = null;       // ghi chú đang mở: { id, taskId, title, body, createdAt, isNew }
  let openedInApp = false;  // mở bằng nút trong app (có mục lịch sử để Back) hay mở thẳng từ đường dẫn
  let query = "";

  // ---------- Dữ liệu ----------
  const live = () => notes.filter((n) => !n.deleted);
  const find = (id) => notes.find((n) => n.id === id);
  const ofTask = (taskId) => live().filter((n) => n.taskId === taskId).sort((a, b) => a.createdAt - b.createdAt);
  const idFromHash = () => (location.hash.match(NOTE_HASH) || [])[1] || null;
  const pad = (n) => String(n).padStart(2, "0");
  const fmtDate = (at) => { const d = new Date(at); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };
  const fmtTime = (at) => { const d = new Date(at); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fmtWhen = (at) => (new Date(at).toDateString() === new Date().toDateString() ? `hôm nay ${fmtTime(at)}` : `${fmtTime(at)} ${fmtDate(at)}`);
  const defaultTitle = (at) => `Ghi chú ${fmtDate(at)}`;
  const words = (text) => (text.match(/\S+/g) || []).length;

  // Lưu xuống máy; các ghi chú truyền vào là ghi chú vừa đổi → cập nhật mốc thời gian và đánh dấu để đồng bộ
  function persist(...changed) {
    for (const n of changed) {
      n.updatedAt = Date.now();
      TaskSync.markNoteDirty(n.id);
    }
    Storage.saveNotes(notes);
  }

  // ---------- Trang soạn ----------
  const dlg = () => $("#note-dialog");
  const titleInput = () => $("#note-name");
  const editor = () => $("#note-editor");

  // Có thay đổi chưa lưu? (ghi chú mới: có gõ gì là tính)
  function edited() {
    if (!current) return false;
    return titleInput().value.trim() !== current.title || editor().value !== current.body;
  }

  function setState(text, kind = "") {
    const el = $("#note-state");
    el.textContent = text;
    el.dataset.state = kind;
  }

  function refreshState() {
    if (!current) return;
    if (edited()) setState("Chưa lưu", "dirty");
    else if (current.isNew) setState("Ghi chú mới", "");
    else setState(`Đã lưu ${fmtWhen(find(current.id)?.updatedAt || Date.now())}`, "saved");
    $("#note-save").disabled = !edited();
    $("#note-tpl-hint").hidden = editor().value.trim() !== "";
    autosize();
  }

  /** Lưu ghi chú đang mở. Trả về true nếu vừa ghi thay đổi, false nếu không có gì để lưu. */
  function saveCurrent() {
    if (!current || !edited()) return false;
    const title = titleInput().value.trim().slice(0, 200) || defaultTitle(current.createdAt);
    const body = editor().value.slice(0, 50000);
    let n = find(current.id);
    if (!n) {
      n = { id: current.id, taskId: current.taskId, title, body, createdAt: current.createdAt, deleted: false };
      notes.push(n);
    } else {
      Object.assign(n, { title, body, deleted: false });
    }
    persist(n);
    current = { ...current, title, body, isNew: false };
    titleInput().value = title;
    renderTabs();
    refreshState();
    deps.onChange();
    return true;
  }

  function discardCurrent() {
    if (!current) return;
    titleInput().value = current.title;
    editor().value = current.body;
    refreshState();
  }

  // Hỏi khi còn thay đổi chưa lưu. Kết quả: "save" | "discard" | "cancel"
  function askUnsaved() {
    if (!edited()) return Promise.resolve("discard");
    const ask = $("#unsaved-dialog");
    const name = titleInput().value.trim() || current.title || "ghi chú mới";
    $("#unsaved-name").textContent = name;
    return new Promise((resolve) => {
      const done = (v) => { ask.onclose = null; ask.close(); resolve(v); };
      $("#unsaved-save").onclick = () => done("save");
      $("#unsaved-discard").onclick = () => done("discard");
      $("#unsaved-cancel").onclick = () => done("cancel");
      ask.oncancel = (e) => { e.preventDefault(); done("cancel"); };
      ask.onclick = (e) => { if (e.target === ask) done("cancel"); }; // bấm ra ngoài = Huỷ
      ask.showModal();
      $("#unsaved-save").focus();
    });
  }

  /** Trước khi rời ghi chú đang mở: hỏi nếu cần. Trả về false nếu người dùng chọn Huỷ (ở lại). */
  async function leaveCurrent() {
    const choice = await askUnsaved();
    if (choice === "cancel") return false;
    if (choice === "save") { if (saveCurrent()) savedJustNow = true; }
    else discardCurrent();
    return true;
  }
  let savedJustNow = false; // vừa chọn "Lưu" ở hộp thoại hỏi → báo sau khi trang đóng

  // Báo "đã lưu" ngay trong trang soạn (toast chung của app bị lớp phủ của trang soạn che mất)
  let flashTimer = null;
  function flashSaved() {
    const el = $("#note-saved-toast");
    const btn = $("#note-save");
    el.hidden = false;
    el.classList.remove("show");
    void el.offsetWidth; // chạy lại hiệu ứng khi bấm lưu liên tiếp
    el.classList.add("show");
    btn.classList.add("is-saved");
    btn.textContent = "✓ Đã lưu";
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      el.classList.remove("show");
      btn.classList.remove("is-saved");
      btn.textContent = "Lưu";
    }, 1600);
  }

  function saveWithFeedback() {
    if (saveCurrent()) flashSaved();
  }

  // Đổi đường dẫn sang ghi chú khác (giữ 1 mục lịch sử cho cả phiên soạn)
  function goTo(id) {
    const hash = `#note/${id}`;
    if (location.hash === hash) return syncWithHash();
    if (dlg().open) history.replaceState(null, "", hash);
    else history.pushState(null, "", hash);
    syncWithHash();
  }

  let draft = null; // ghi chú mới chưa lưu (chỉ nằm trong bộ nhớ)

  function makeDraft(taskId) {
    draft = { id: deps.uid(), taskId, title: "", body: "", createdAt: Date.now(), isNew: true };
    return draft;
  }

  /** Mở ghi chú của 1 việc từ thẻ việc: ghi chú sửa gần nhất, chưa có thì tạo mới. */
  function openForTask(taskId) {
    const list = ofTask(taskId);
    openedInApp = true;
    if (list.length) goTo(list.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a)).id);
    else goTo(makeDraft(taskId).id);
  }

  function openNote(id) {
    openedInApp = true;
    goTo(id);
  }

  async function createNew(taskId) {
    if (dlg().open && !(await leaveCurrent())) return;
    if (!dlg().open) openedInApp = true;
    goTo(makeDraft(taskId).id);
  }

  async function switchTo(id) {
    if (current?.id === id) return;
    if (!(await leaveCurrent())) return;
    goTo(id);
  }

  async function close() {
    savedJustNow = false;
    if (!(await leaveCurrent())) return;
    if (savedJustNow) deps.toast("✓ Đã lưu ghi chú", { timeout: 2500 });
    draft = null;
    current = null;
    if (idFromHash()) {
      if (openedInApp) history.back(); // popstate sẽ đóng trang
      else { history.replaceState(null, "", deps.baseHash() || location.pathname); syncWithHash(); }
    } else syncWithHash();
    openedInApp = false;
  }

  /** Đồng bộ trang soạn theo đường dẫn (#note/<id>): mở / đổi ghi chú / đóng. */
  function syncWithHash() {
    const id = idFromHash();
    const saved = id && find(id);
    const note = !id || !deps.allowed() ? null
      : saved && !saved.deleted ? { ...saved, isNew: false }
      : draft && draft.id === id ? draft : null;
    // Rời ghi chú bằng nút Back của trình duyệt (không qua nút đóng): tự lưu để không mất chữ
    if (current && current.id !== note?.id && edited()) saveCurrent();
    if (!note) {
      if (dlg().open) dlg().close();
      current = null;
      return;
    }
    if (current?.id !== note.id) {
      current = { id: note.id, taskId: note.taskId, title: note.title, body: note.body, createdAt: note.createdAt, isNew: note.isNew };
      titleInput().value = note.title;
      editor().value = note.body;
      $("#note-scroll").scrollTop = 0;
    }
    renderHead();
    renderTabs();
    refreshState();
    if (!dlg().open) dlg().showModal();
    autosize(); // đo chiều cao sau khi trang đã hiện
    // Mở ghi chú: hiện từ đầu trang (tên ở trên), con trỏ chờ ở cuối nội dung
    if (note.isNew || !note.title) titleInput().focus({ preventScroll: true });
    else { const ed = editor(); ed.focus({ preventScroll: true }); ed.setSelectionRange(ed.value.length, ed.value.length); }
    $("#note-scroll").scrollTop = 0;
  }

  // Thanh trên: tên việc mà ghi chú gắn vào
  function renderHead() {
    if (!current) return;
    const t = deps.findTask(current.taskId);
    const alive = t && !t.deleted;
    $("#note-task-title").textContent = alive ? t.title : "Việc đã xoá";
  }

  // Hàng tab: các ghi chú của cùng việc + nút tạo mới
  function renderTabs() {
    if (!current) return;
    const list = ofTask(current.taskId);
    if (current.isNew) list.push(current);
    $("#note-tabs").innerHTML = list.map((n) => `
      <button type="button" class="note-tab ${n.id === current.id ? "active" : ""}" data-note-tab="${n.id}" role="tab"
        aria-selected="${n.id === current.id}">${deps.escapeHtml(n.title || "Ghi chú mới")}</button>`).join("")
      + `<button type="button" class="note-tab note-tab-new" id="note-new" title="Tạo ghi chú mới" aria-label="Tạo ghi chú mới">＋</button>`;
  }

  // Ô nội dung cao theo chữ → tên và nội dung cuộn chung trong vùng viết
  function autosize() {
    const ed = editor();
    ed.style.height = "auto";
    ed.style.height = `${ed.scrollHeight}px`;
  }

  // Chèn chữ tại con trỏ (giữ được Undo của trình duyệt)
  function insertAtCursor(text) {
    const ed = editor();
    ed.focus();
    if (!document.execCommand || !document.execCommand("insertText", false, text)) {
      ed.setRangeText(text, ed.selectionStart, ed.selectionEnd, "end");
    }
    refreshState();
  }

  // Chèn khung báo cáo (có sẵn thời gian), rồi đặt con trỏ vào dòng "Mục tiêu" để gõ luôn
  function insertTemplate() {
    const ed = editor();
    const lead = ed.value && !ed.value.endsWith("\n") ? "\n\n" : ed.value ? "\n" : "";
    const start = ed.selectionStart;
    const text = template(Date.now());
    insertAtCursor(lead + text);
    const caret = start + lead.length + text.indexOf("## Mục tiêu\n") + "## Mục tiêu\n".length;
    ed.setSelectionRange(caret, caret);
  }

  function deleteCurrent() {
    if (!current) return;
    const name = titleInput().value.trim() || current.title || "ghi chú mới";
    if (!confirm(`Xoá ghi chú “${name}”?`)) return;
    const taskId = current.taskId;
    const n = find(current.id);
    if (n) {
      n.deleted = true;
      persist(n);
      deps.toast(`Đã xoá ghi chú <b>${deps.escapeHtml(n.title)}</b>`, {
        timeout: 6000,
        actions: [{ label: "Hoàn tác", primary: true, onClick: () => { n.deleted = false; persist(n); deps.onChange(); renderTabs(); } }],
      });
    }
    draft = null;
    const rest = ofTask(taskId);
    current = null;
    deps.onChange();
    if (rest.length) goTo(rest[rest.length - 1].id);
    else { openedInApp ? history.back() : history.replaceState(null, "", deps.baseHash() || location.pathname); syncWithHash(); openedInApp = false; }
  }

  // ---------- Trang danh sách "Ghi chú" ----------
  function renderPage() {
    const q = query.trim().toLowerCase();
    const all = live();
    const list = all
      .filter((n) => !q || [n.title, n.body, deps.findTask(n.taskId)?.title].some((x) => (x || "").toLowerCase().includes(q)))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    $("#notes-total").textContent = q ? `${list.length}/${all.length}` : all.length || "";
    $("#notes-list").innerHTML = list.map((n) => {
      const t = deps.findTask(n.taskId);
      const alive = t && !t.deleted;
      const excerpt = n.body.replace(/^#+\s*/gm, "").replace(/\s+/g, " ").trim().slice(0, 220);
      return `
        <li class="note-card" data-note="${n.id}" tabindex="0" role="button" aria-label="Mở ghi chú ${deps.escapeHtml(n.title)}">
          <div class="note-card-head">
            <span class="note-card-task ${alive ? (t.done ? "is-done" : "") : "is-gone"}">📌 ${alive ? deps.escapeHtml(t.title) : "Việc đã xoá"}</span>
            <time>${fmtWhen(n.updatedAt)}</time>
          </div>
          <h3 title="${deps.escapeHtml(n.title)}">${deps.escapeHtml(n.title)}</h3>
          ${excerpt ? `<p>${deps.escapeHtml(excerpt)}</p>` : `<p class="muted">Chưa có nội dung</p>`}
          <small>${words(n.body)} từ</small>
        </li>`;
    }).join("");
    const empty = list.length === 0;
    $("#notes-empty").hidden = !empty;
    if (empty) {
      $("#notes-empty-title").textContent = q ? "Không tìm thấy" : "Chưa có ghi chú nào";
      $("#notes-empty-text").textContent = q ? `Không có ghi chú nào khớp "${query}".`
        : "Tạo ghi chú ở khung phía trên, hoặc bấm 📝 Ghi chú trên thẻ việc.";
    }
    // Ô chọn việc để tạo ghi chú mới: việc chưa xong lên trước
    const sel = $("#notes-task");
    const keep = sel.value;
    const tasks = deps.liveTasks().sort((a, b) => Number(a.done) - Number(b.done) || b.createdAt - a.createdAt);
    sel.innerHTML = `<option value="">Chọn việc…</option>` + tasks.map((t) =>
      `<option value="${t.id}">${t.done ? "✓ " : ""}${deps.escapeHtml(t.title)}</option>`).join("");
    if (tasks.some((t) => t.id === keep)) sel.value = keep;
    $("#notes-create").disabled = !sel.value;
  }

  // ---------- Khởi tạo ----------
  function init(d) {
    deps = d;
    $("#note-close").onclick = close;
    $("#note-save").onclick = saveWithFeedback;
    $("#note-delete").onclick = deleteCurrent;
    $("#note-template").onclick = insertTemplate;
    $("#note-tpl-hint").onclick = insertTemplate;
    // Bấm vào khoảng trống vùng viết thì đưa con trỏ vào nội dung
    // Bấm ra ngoài trang soạn (vùng nền mờ) thì đóng — vẫn hỏi lưu nếu còn thay đổi
    // (chỉ khi nhấn chuột cũng ở ngoài: bôi đen chữ rồi kéo ra ngoài thì không đóng)
    let downOutside = false;
    dlg().addEventListener("pointerdown", (e) => { downOutside = e.target === dlg(); });
    dlg().addEventListener("click", (e) => {
      if (e.target === dlg() && downOutside) return close();
      if (e.target === $("#note-scroll") || e.target.classList.contains("note-sheet")) editor().focus();
    });
    titleInput().addEventListener("input", () => { refreshState(); });
    titleInput().addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); editor().focus(); } });
    editor().addEventListener("input", refreshState);
    $("#note-tabs").onclick = (e) => {
      if (e.target.closest("#note-new")) return createNew(current.taskId);
      const tab = e.target.closest("[data-note-tab]");
      if (tab) switchTo(tab.dataset.noteTab);
    };
    // Esc / nút Back của Android: hỏi lưu như nút đóng
    dlg().addEventListener("cancel", (e) => { e.preventDefault(); close(); });
    window.addEventListener("resize", () => { if (dlg().open) autosize(); });
    dlg().addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveWithFeedback(); }
    });
    // Đóng tab / tải lại trang khi còn thay đổi chưa lưu → trình duyệt hỏi
    window.addEventListener("beforeunload", (e) => { if (edited()) { e.preventDefault(); e.returnValue = ""; } });

    // Trang danh sách
    $("#notes-search").oninput = (e) => { query = e.target.value; renderPage(); };
    $("#notes-task").onchange = () => { $("#notes-create").disabled = !$("#notes-task").value; };
    $("#notes-create").onclick = () => { const id = $("#notes-task").value; if (id) createNew(id); };
    const openCard = (e) => {
      const card = e.target.closest("[data-note]");
      if (card) openNote(card.dataset.note);
    };
    $("#notes-list").onclick = openCard;
    $("#notes-list").onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openCard(e); } };
  }

  return {
    init,
    renderPage,
    syncWithHash,
    openForTask,
    renderHead: () => { if (dlg().open) renderHead(); },
    isOpen: () => dlg().open,
    hasHash: () => !!idFromHash(),
    countFor: (taskId) => ofTask(taskId).length,
    all: () => notes,
    live,
    /** Thay toàn bộ (sau khi đồng bộ). Ghi chú đang mở mà không sửa dở thì cập nhật theo bản mới. */
    replaceAll(list) {
      notes = list;
      Storage.saveNotes(notes);
      // Mở bằng đường dẫn trên máy chưa có ghi chú này → vừa đồng bộ về thì mở
      if (!dlg().open) return idFromHash() ? syncWithHash() : undefined;
      const n = current && !current.isNew ? find(current.id) : null;
      if (current && !current.isNew && (!n || n.deleted)) return syncWithHash();
      if (n && !edited() && (n.title !== current.title || n.body !== current.body)) {
        current = { ...current, title: n.title, body: n.body };
        titleInput().value = n.title;
        editor().value = n.body;
      }
      renderTabs();
      refreshState();
    },
    clear() { notes = []; draft = null; Storage.saveNotes([]); },
  };
})();
