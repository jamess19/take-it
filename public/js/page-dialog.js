// Mở hộp thoại theo màn hình:
// - Máy tính: popup (modal) như bình thường.
// - Điện thoại: thành trang riêng cuộn theo trang (ẩn phần app phía sau), không phủ cố định —
//   tránh iOS kéo tụt / nhảy trang khi bàn phím bật lên.
const PageDialog = (() => {
  const QUERY = "(max-width: 760px)";
  let listScroll = 0; // vị trí cuộn trước khi mở dạng trang, để đóng xong quay lại đúng chỗ

  const isPage = (dlg) => dlg.classList.contains("as-page");

  function open(dlg) {
    if (!matchMedia(QUERY).matches) return dlg.showModal();
    if (!document.body.classList.contains("dialog-page")) listScroll = window.scrollY;
    dlg.classList.add("as-page");
    document.body.classList.add("dialog-page");
    dlg.show();
    window.scrollTo(0, 0);
  }

  /** Dọn sau khi đóng (gọi được nhiều lần). Không còn trang nào mở → hiện lại app, cuộn về chỗ cũ. */
  function cleanup(dlg) {
    if (!isPage(dlg)) return;
    dlg.classList.remove("as-page");
    if (document.querySelector("dialog.as-page[open]")) return;
    document.body.classList.remove("dialog-page");
    window.scrollTo(0, listScroll); // cuộn ngay (trình duyệt tự tính lại bố cục), không chờ khung hình sau
  }

  function close(dlg) {
    if (dlg.open) dlg.close();
    cleanup(dlg);
  }

  /** Gắn cho 1 hộp thoại: tự dọn khi đóng; dạng trang không có sự kiện cancel → tự bắt phím Esc. */
  function attach(dlg, onEscape = () => close(dlg)) {
    dlg.addEventListener("close", () => cleanup(dlg));
    dlg.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isPage(dlg)) { e.preventDefault(); onEscape(); }
    });
  }

  return { open, close, attach, isPage };
})();
