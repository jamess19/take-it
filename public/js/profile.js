// Trang cá nhân: xem thông tin (tên, giới thiệu — trường `note`, ảnh, email, mật khẩu); bấm từng mục để mở popup đổi
// (điện thoại: trang riêng, xem page-dialog.js). Kèm thẻ người dùng ở sidebar.
// Dựng DOM bằng textContent/thuộc tính (không ghép chuỗi HTML) nên không cần escape dữ liệu người dùng.
const Profile = (() => {
  const CACHE_KEY = "todo.profile"; // lưu tạm hồ sơ để mở app khi mất mạng vẫn thấy tên/ảnh
  // Ảnh đại diện chỉ lấy từ public/avatars/ (server liệt kê). Bộ ảnh cũ (Fluent, Simple Icons) không còn để chọn
  // nhưng vẫn hiển thị đúng cho người đã chọn trước đây.
  const FLUENT = "https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji@main/assets/";
  let localAvatars = []; // ảnh trong public/avatars/ (server trả về)
  const isIcon = (url) => url.startsWith(FLUENT) || url.startsWith("https://cdn.simpleicons.org/");

  const $ = (sel) => document.querySelector(sel);
  let data = readCache();
  let selectedAvatar = "";
  let deps = { toast: () => {}, onEmailChanged: () => {}, stats: () => ({ doing: 0, today: 0, done: 0, total: 0, notes: 0 }), insights: () => ({ completed: [], upcoming: [] }), openTask: () => {} };

  function readCache() {
    try { return JSON.parse(Storage.loadValue(CACHE_KEY)) || null; } catch { return null; }
  }

  function setData(p) {
    data = p;
    Storage.saveValue(CACHE_KEY, p ? JSON.stringify(p) : null);
    renderCard();
    fillView();
  }

  const email = () => data?.email || Api.email() || "";
  const displayName = () => data?.name || email().split("@")[0] || "Bạn";

  /** Ảnh đại diện vào phần tử `el`: ảnh nếu có, không thì chữ cái đầu của tên. */
  function paintAvatar(el, url = data?.avatar) {
    el.replaceChildren();
    el.classList.toggle("avatar-initial", !url);
    if (url) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      if (isIcon(url)) img.className = url.startsWith(FLUENT) ? "icon3d" : "logo";
      el.append(img);
    } else {
      el.textContent = displayName().charAt(0).toUpperCase();
    }
  }

  // Đầu sidebar (ảnh, tên, email) và ảnh đại diện trên thanh điện thoại
  function renderCard() {
    const on = Api.isLoggedIn();
    for (const sel of ["#user-avatar", "#mobile-avatar"]) paintAvatar($(sel));
    $("#user-name").textContent = on ? displayName() : "Khách";
    $("#user-email").textContent = on ? email() : "Chưa đăng nhập";
  }

  // ---------- Trang cá nhân (chỉ xem) ----------
  function fillView() {
    if (!$("#profile-view") || $("#profile-view").hidden) return;
    paintAvatar($("#profile-avatar"));
    $("#profile-title").textContent = displayName();
    $("#profile-sub").textContent = email();
    $("#profile-bio").textContent = data?.note || "";
    $("#profile-bio").hidden = !data?.note; // phần giới thiệu dưới tên, như bio trên GitHub
    $("#pf-email-view").textContent = email();
    const joined = data?.createdAt ? new Date(data.createdAt).toLocaleDateString("vi-VN", { month: "long", year: "numeric" }) : "";
    $("#pf-joined").textContent = joined ? `Tham gia từ ${joined}` : "";
    $("#pf-joined").parentElement.hidden = !joined;
    // Thống kê lấy từ dữ liệu trên máy (app.js truyền vào)
    const st = deps.stats();
    for (const k of ["doing", "today", "overdue", "done"]) $(`#pf-stat-${k}`).textContent = st[k];
    $("#pf-stat-overdue-card").classList.toggle("is-alert", st.overdue > 0);
    $("#pf-done-meta").textContent = `${st.done}/${st.total} việc đã xong`;
    $("#pf-notes-meta").textContent = `${st.notes} ghi chú`;
    renderInsights(deps.insights());
  }

  // ---------- Thống kê hoàn thành 7 ngày + việc sắp tới ----------
  const DAY = 24 * 60 * 60 * 1000;
  const WEEKDAY = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  function renderInsights({ completed, upcoming }) {
    // Biểu đồ cột: số việc xong mỗi ngày, 7 ngày gần nhất (cột cuối = hôm nay)
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = [];
    for (let i = 6; i >= 0; i--) days.push({ start: today.getTime() - i * DAY, n: 0 });
    let onTime = 0, withDue = 0;
    for (const c of completed) {
      const d = days.find((x) => c.at >= x.start && c.at < x.start + DAY);
      if (!d) continue;
      d.n++;
      if (c.onTime != null) { withDue++; if (c.onTime) onTime++; }
    }
    const total = days.reduce((a, d) => a + d.n, 0);
    const max = Math.max(1, ...days.map((d) => d.n));
    const chart = $("#pf-chart");
    chart.replaceChildren();
    days.forEach((d, i) => {
      const col = el("div", `pf-bar${i === 6 ? " is-today" : ""}`);
      col.title = `${d.n} việc · ${new Date(d.start).toLocaleDateString("vi-VN")}`;
      const track = el("div", "pf-bar-track");
      const fill = el("div", "pf-bar-fill");
      fill.style.height = `${(d.n / max) * 100}%`;
      track.append(el("span", "pf-bar-num", d.n || ""), fill);
      col.append(track, el("span", "pf-bar-day", i === 6 ? "Hôm nay" : WEEKDAY[new Date(d.start).getDay()]));
      chart.append(col);
    });
    $("#pf-week-sum").textContent = total
      ? `· ${total} việc${withDue ? ` · ${Math.round((onTime / withDue) * 100)}% đúng hạn` : ""}`
      : "· chưa có việc nào xong";

    // Sắp tới: việc chưa xong có giờ, quá hạn lên đầu
    const list = $("#pf-upcoming");
    list.replaceChildren();
    for (const t of upcoming) {
      const li = el("li");
      li.dataset.task = t.id;
      li.tabIndex = 0;
      const when = el("span", "pf-up-when", t.when);
      const title = el("span", "pf-up-title", t.title);
      li.append(when, title);
      if (t.badge) li.append(el("span", `pf-up-badge ${t.badgeCls || ""}`, t.badge));
      list.append(li);
    }
    if (!upcoming.length) list.append(el("li", "pf-up-empty", "Không có việc nào sắp tới 🎉"));
  }

  // ---------- Popup đổi thông tin ----------
  // Chọn ảnh: chỉ đổi trạng thái ô đã chọn, không vẽ lại cả lưới (tránh nhảy trang)
  function renderAvatarGrid() {
    const grid = $("#pf-avatars");
    grid.replaceChildren();
    // "" = ô chữ cái đầu của tên (mặc định khi chưa chọn ảnh), sau đó là ảnh trong public/avatars/
    for (const url of ["", ...localAvatars]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "avatar-option";
      b.dataset.url = url;
      b.setAttribute("role", "radio");
      b.setAttribute("aria-label", url ? "Chọn ảnh này" : "Không dùng ảnh (chữ cái đầu)");
      paintAvatar(b, url);
      grid.append(b);
    }
    markAvatar();
  }

  function markAvatar() {
    for (const b of $("#pf-avatars").children) b.setAttribute("aria-checked", String(b.dataset.url === selectedAvatar));
  }

  const DIALOGS = {
    avatar: { dlg: "#pf-avatar-dialog", fill() { selectedAvatar = data?.avatar || ""; renderAvatarGrid(); } },
    profile: { dlg: "#pf-profile-dialog", fill() { $("#pf-name").value = data?.name || ""; $("#pf-note").value = data?.note || ""; }, focus: "#pf-name" },
    email: { dlg: "#pf-email-dialog", fill() { $("#pf-email").value = ""; $("#pf-email").placeholder = email(); $("#pf-email-pw").value = ""; }, focus: "#pf-email" },
    password: { dlg: "#pf-password-dialog", fill() { $("#password-form").reset(); }, focus: "#pf-cur-pw" },
  };

  function openDialog(key) {
    const d = DIALOGS[key];
    if (!d) return;
    const dlg = $(d.dlg);
    d.fill();
    dlg.querySelector(".form-error").hidden = true;
    PageDialog.open(dlg);
    // Máy tính: focus ô nhập đầu; điện thoại (dạng trang) không tự bật bàn phím
    if (d.focus && !PageDialog.isPage(dlg)) $(d.focus).focus();
    else if (dlg.contains(document.activeElement)) document.activeElement.blur(); // popup chọn ảnh: không viền focus ô đầu
    const ta = dlg.querySelector("textarea[data-autosize]");
    if (ta) ta.dispatchEvent(new Event("input", { bubbles: true })); // đo lại chiều cao ô ghi chú
  }

  // Gửi form: khoá nút trong lúc chờ, báo lỗi ngay trong form; thành công thì đóng popup
  async function submit(form, run) {
    const btn = form.querySelector("button[type=submit]");
    const err = form.querySelector(".form-error");
    btn.disabled = true;
    err.hidden = true;
    try {
      await run();
      PageDialog.close(form.closest("dialog"));
    } catch (e) {
      err.textContent = e.status ? e.message : "Không kết nối được server. Kiểm tra mạng rồi thử lại.";
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  }

  const saveProfile = async (fields, msg) => {
    setData(await Api.request("PATCH", "/api/me", fields));
    deps.toast(msg);
  };

  function initForms() {
    // Mở popup từ các dòng trên trang cá nhân / ảnh đại diện lớn
    $("#profile-view").addEventListener("click", (e) => {
      const row = e.target.closest("[data-pf]");
      if (row) openDialog(row.dataset.pf);
      const task = e.target.closest("[data-task]");
      if (task) deps.openTask(task.dataset.task); // bấm việc sắp tới → mở sửa việc
    });
    $("#pf-upcoming").addEventListener("keydown", (e) => {
      const task = e.target.closest("[data-task]");
      if (task && e.key === "Enter") deps.openTask(task.dataset.task);
    });
    // Nút Huỷ, bấm ra ngoài popup (máy tính), Esc ở dạng trang
    for (const dlg of document.querySelectorAll(".pf-dialog")) {
      PageDialog.attach(dlg);
      dlg.querySelector("[data-close]").onclick = () => PageDialog.close(dlg);
      dlg.addEventListener("click", (e) => { if (e.target === dlg && !PageDialog.isPage(dlg)) PageDialog.close(dlg); });
    }
    $("#pf-avatars").onclick = (e) => {
      const b = e.target.closest(".avatar-option");
      if (!b) return;
      selectedAvatar = b.dataset.url;
      markAvatar();
    };

    $("#profile-avatar-form").onsubmit = (e) => {
      e.preventDefault();
      submit(e.target, () => saveProfile({ avatar: selectedAvatar }, "Đã đổi ảnh đại diện ✅"));
    };
    $("#profile-edit-form").onsubmit = (e) => {
      e.preventDefault();
      submit(e.target, () => saveProfile({ name: $("#pf-name").value, note: $("#pf-note").value }, "Đã lưu hồ sơ ✅"));
    };

    $("#email-form").onsubmit = (e) => {
      e.preventDefault();
      submit(e.target, async () => {
        const p = await Api.request("POST", "/api/me/email", { email: $("#pf-email").value, password: $("#pf-email-pw").value });
        $("#pf-email-pw").value = "";
        setData(p);
        deps.onEmailChanged(p.email);
        deps.toast("Đã đổi email đăng nhập ✅");
      });
    };

    $("#password-form").onsubmit = (e) => {
      e.preventDefault();
      submit(e.target, async () => {
        if ($("#pf-new-pw").value !== $("#pf-new-pw2").value) {
          throw Object.assign(new Error("Mật khẩu nhập lại không khớp"), { status: 400 });
        }
        await Api.request("POST", "/api/me/password", { currentPassword: $("#pf-cur-pw").value, newPassword: $("#pf-new-pw").value });
        e.target.reset();
        deps.toast("Đã đổi mật khẩu ✅ Các thiết bị khác cần đăng nhập lại.");
      });
    };
  }

  return {
    init(d) {
      deps = { ...deps, ...d };
      initForms();
      renderCard();
      // Đổi bề rộng cửa sổ → vẽ lại lưới hoạt động cho vừa số tuần
      let t = null;
      window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(fillView, 150); });
    },
    /** Tải hồ sơ mới nhất từ server (vd: sau khi đăng nhập, hoặc sửa ở máy khác). */
    async refresh() {
      if (!Api.isLoggedIn()) return;
      try { setData(await Api.request("GET", "/api/me")); } catch { /* mất mạng: dùng bản lưu tạm */ }
    },
    clear() { setData(null); },
    render: renderCard,
    /** Cập nhật thống kê khi danh sách việc / ghi chú đổi (trang cá nhân đang mở). */
    refreshView: fillView,
    /** Gọi khi mở trang cá nhân: hiện thông tin, tải danh sách ảnh trong public/avatars/. */
    async show() {
      fillView();
      try {
        const { avatars } = await Api.request("GET", "/api/me/avatars");
        if (avatars.join() !== localAvatars.join()) {
          localAvatars = avatars;
          if ($("#pf-avatar-dialog").open) renderAvatarGrid();
        }
      } catch { /* mất mạng: chỉ dùng bộ có sẵn */ }
    },
  };
})();
