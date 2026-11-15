// Trang cá nhân: xem/sửa tên, ghi chú, ảnh đại diện, email, mật khẩu; thẻ người dùng ở sidebar.
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
  let deps = { toast: () => {}, onEmailChanged: () => {} };

  function readCache() {
    try { return JSON.parse(Storage.loadValue(CACHE_KEY)) || null; } catch { return null; }
  }

  function setData(p) {
    data = p;
    Storage.saveValue(CACHE_KEY, p ? JSON.stringify(p) : null);
    renderCard();
    fillForm();
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

  // ---------- Trang cá nhân ----------
  function renderAvatarGrid() {
    const grid = $("#pf-avatars");
    grid.replaceChildren();
    // "" = ô chữ cái đầu của tên (mặc định khi chưa chọn ảnh), sau đó là ảnh trong public/avatars/
    for (const url of ["", ...localAvatars]) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "avatar-option";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(url === selectedAvatar));
      b.setAttribute("aria-label", url ? "Chọn ảnh này" : "Không dùng ảnh (chữ cái đầu)");
      paintAvatar(b, url);
      b.onclick = () => { selectedAvatar = url; renderAvatarGrid(); paintAvatar($("#profile-avatar"), url); };
      grid.append(b);
    }
  }

  function fillForm() {
    if (!$("#profile-view") || $("#profile-view").hidden) return;
    $("#pf-name").value = data?.name || "";
    $("#pf-note").value = data?.note || "";
    $("#pf-email").value = "";
    $("#pf-email").placeholder = email();
    selectedAvatar = data?.avatar || "";
    paintAvatar($("#profile-avatar"));
    $("#profile-title").textContent = displayName();
    $("#profile-sub").textContent = email();
    renderAvatarGrid();
  }

  // Gửi form: khoá nút trong lúc chờ, báo lỗi ngay trong form
  async function submit(form, run) {
    const btn = form.querySelector("button[type=submit]");
    const err = form.querySelector(".form-error");
    btn.disabled = true;
    err.hidden = true;
    try {
      await run();
    } catch (e) {
      err.textContent = e.status ? e.message : "Không kết nối được server. Kiểm tra mạng rồi thử lại.";
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  }

  function initForms() {
    $("#profile-form").onsubmit = (e) => {
      e.preventDefault();
      submit(e.target, async () => {
        setData(await Api.request("PATCH", "/api/me", {
          name: $("#pf-name").value, note: $("#pf-note").value, avatar: selectedAvatar,
        }));
        deps.toast("Đã lưu thông tin ✅");
      });
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
    init(d) { deps = { ...deps, ...d }; initForms(); renderCard(); },
    /** Tải hồ sơ mới nhất từ server (vd: sau khi đăng nhập, hoặc sửa ở máy khác). */
    async refresh() {
      if (!Api.isLoggedIn()) return;
      try { setData(await Api.request("GET", "/api/me")); } catch { /* mất mạng: dùng bản lưu tạm */ }
    },
    clear() { setData(null); },
    render: renderCard,
    /** Gọi khi mở trang cá nhân: tải danh sách ảnh tự thêm (nếu có) rồi điền form. */
    async show() {
      fillForm();
      try {
        const { avatars } = await Api.request("GET", "/api/me/avatars");
        if (avatars.join() !== localAvatars.join()) { localAvatars = avatars; renderAvatarGrid(); }
      } catch { /* mất mạng: chỉ dùng bộ có sẵn */ }
    },
  };
})();
