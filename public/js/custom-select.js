// Danh sách sổ xuống tự vẽ cho mọi ô <select> trên máy tính (chuột).
// Giữ nguyên ô <select> gốc (hiển thị, giá trị, sự kiện change) — chỉ thay cái menu bật ra,
// vì menu gốc của hệ điều hành (macOS, iOS) không chỉnh được giao diện.
const CustomSelect = (() => {
  const enabled = () => true;
  let menu = null;     // phần tử menu đang mở
  let select = null;   // ô select đang mở menu
  let active = -1;     // dòng đang được tô (di chuột / phím mũi tên)

  function close() {
    if (!menu) return;
    menu.remove();
    menu = null;
    select = null;
    window.removeEventListener("resize", close);
    document.removeEventListener("scroll", onScroll, true);
  }

  // Cuộn trang thì đóng (menu đặt cố định theo vị trí ô); cuộn trong chính menu thì bỏ qua
  function onScroll(e) {
    if (menu && !menu.contains(e.target)) close();
  }

  function items() {
    return [...menu.querySelectorAll(".cs-item")];
  }

  function setActive(i) {
    const list = items();
    if (!list.length) return;
    active = (i + list.length) % list.length;
    list.forEach((el, k) => el.classList.toggle("is-active", k === active));
    list[active].scrollIntoView({ block: "nearest" });
  }

  function choose(i) {
    const s = select;
    const opt = s.options[i];
    close();
    s.focus();
    if (!opt || opt.disabled || s.selectedIndex === i) return;
    s.selectedIndex = i;
    s.dispatchEvent(new Event("input", { bubbles: true }));
    s.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function open(s) {
    close();
    select = s;
    // Trong popup (dialog) thì đặt menu bên trong popup, không thì bị lớp phủ của popup che
    const host = s.closest("dialog[open]") || document.body;
    menu = document.createElement("div");
    menu.className = "cs-menu";
    menu.setAttribute("role", "listbox");
    menu.innerHTML = [...s.options].map((o, i) => `
      <div class="cs-item ${o.selected ? "is-selected" : ""} ${o.disabled ? "is-disabled" : ""}" role="option"
        data-i="${i}" aria-selected="${o.selected}">${o.textContent.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))}</div>`).join("");
    host.appendChild(menu);

    // Đặt ngay dưới ô (hết chỗ thì bật lên trên), rộng bằng ô
    const r = s.getBoundingClientRect();
    menu.style.minWidth = `${r.width}px`;
    menu.style.left = `${Math.min(r.left, innerWidth - menu.offsetWidth - 8)}px`;
    const below = innerHeight - r.bottom - 8;
    const h = Math.min(menu.scrollHeight, 300);
    if (below < h && r.top > below) menu.style.bottom = `${innerHeight - r.top + 6}px`;
    else menu.style.top = `${r.bottom + 6}px`;
    menu.style.maxHeight = `${Math.max(Math.min(300, below < h && r.top > below ? r.top - 14 : below), 120)}px`;

    setActive(Math.max(s.selectedIndex, 0));
    menu.addEventListener("mousedown", (e) => e.preventDefault()); // giữ focus ở ô select
    menu.addEventListener("click", (e) => {
      const it = e.target.closest(".cs-item");
      if (it && !it.classList.contains("is-disabled")) choose(Number(it.dataset.i));
    });
    menu.addEventListener("mousemove", (e) => {
      const it = e.target.closest(".cs-item");
      if (it && Number(it.dataset.i) !== active) setActive(items().indexOf(it));
    });
    window.addEventListener("resize", close);
    document.addEventListener("scroll", onScroll, true);
  }

  function init() {
    // Cảm ứng: chạm (không vuốt) vào ô select → chặn bảng chọn của iOS, mở menu tự vẽ.
    // Xử lý ở touchend để vẫn vuốt cuộn trang được khi ngón tay bắt đầu trên ô select.
    let touch = null;
    document.addEventListener("touchstart", (e) => {
      const s = e.target.closest?.("select");
      touch = s && !s.disabled ? { s, x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
      if (menu && !menu.contains(e.target) && s !== select) close();
    }, { passive: true, capture: true });
    document.addEventListener("touchend", (e) => {
      if (!touch) return;
      const t = e.changedTouches[0];
      const moved = Math.abs(t.clientX - touch.x) > 10 || Math.abs(t.clientY - touch.y) > 10;
      const s = touch.s;
      touch = null;
      if (moved || e.target.closest?.("select") !== s) return;
      e.preventDefault(); // chặn click/focus giả lập → iOS không bật bảng chọn gốc
      if (select === s) close();
      else open(s);
    }, { passive: false, capture: true });

    // Nhấn chuột vào ô select: chặn menu gốc, mở menu tự vẽ
    document.addEventListener("mousedown", (e) => {
      const s = e.target.closest?.("select");
      if (menu && !menu.contains(e.target) && s !== select) close();
      if (!s || !enabled() || s.disabled || e.button !== 0) return;
      e.preventDefault();
      s.focus();
      if (select === s) close();
      else open(s);
    }, true);

    // Bàn phím: mở bằng Enter / Space / mũi tên; trong menu dùng ↑ ↓ Enter Esc Tab
    document.addEventListener("keydown", (e) => {
      if (menu) {
        const keys = { ArrowDown: () => setActive(active + 1), ArrowUp: () => setActive(active - 1),
          Home: () => setActive(0), End: () => setActive(items().length - 1),
          Enter: () => choose(active), " ": () => choose(active), Escape: () => { const s = select; close(); s.focus(); } };
        if (e.key === "Tab") return close();
        if (keys[e.key]) { e.preventDefault(); e.stopPropagation(); keys[e.key](); }
        return;
      }
      const s = e.target;
      if (s?.tagName !== "SELECT" || !enabled() || e.metaKey || e.ctrlKey) return;
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) { e.preventDefault(); open(s); }
    }, true);
  }

  return { init, close };
})();
CustomSelect.init();
