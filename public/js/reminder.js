// Bộ nhắc việc: định kỳ kiểm tra hạn chót, phát chuông, thông báo hệ thống và nhấp nháy tiêu đề tab.
const Reminder = (() => {
  const CHECK_INTERVAL = 15 * 1000; // kiểm tra mỗi 15 giây
  const STALE_LIMIT = TimeUtils.DAY; // việc quá hạn > 1 ngày khi mở app thì không nhắc dồn

  // Các mốc "nhắc trước" cho người dùng chọn (đơn vị phút, 0 = chỉ nhắc đúng giờ, -1 = không nhắc)
  const OPTIONS = [
    { value: -1, label: "Không nhắc" },
    { value: 0, label: "Đúng giờ" },
    { value: 5, label: "5 phút" },
    { value: 10, label: "10 phút" },
    { value: 15, label: "15 phút" },
    { value: 30, label: "30 phút" },
    { value: 60, label: "1 giờ" },
    { value: 120, label: "2 giờ" },
    { value: 1440, label: "1 ngày" },
  ];

  // Thời lượng dự kiến (phút) để tự tính giờ kết thúc
  const DURATIONS = [
    { value: 0, label: "Không ước lượng" },
    { value: 15, label: "15 phút" },
    { value: 30, label: "30 phút" },
    { value: 45, label: "45 phút" },
    { value: 60, label: "1 giờ" },
    { value: 90, label: "1 giờ 30 phút" },
    { value: 120, label: "2 giờ" },
    { value: 180, label: "3 giờ" },
    { value: 240, label: "4 giờ" },
    { value: 480, label: "8 giờ" },
  ];

  // Giờ bắt đầu; việc tạo trước khi có tính năng này chỉ có `due` → coi như bắt đầu tại `due`
  const startOf = (t) => TimeUtils.parse(t.start || t.due);

  let audioCtx = null;
  let titleTimer = null;
  const originalTitle = document.title;

  // Chuông ngắn 3 nốt bằng Web Audio, không cần file âm thanh
  function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const now = audioCtx.currentTime;
      [880, 1175, 1568].forEach((freq, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const t = now + i * 0.16;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.32);
      });
    } catch { /* trình duyệt chặn âm thanh khi chưa có tương tác */ }
  }

  // Nhấp nháy tiêu đề tab khi người dùng đang ở tab khác
  function flashTitle(text) {
    if (!document.hidden) return;
    clearInterval(titleTimer);
    let on = false;
    titleTimer = setInterval(() => {
      document.title = (on = !on) ? `🔔 ${text}` : originalTitle;
    }, 1000);
  }

  function stopFlash() {
    clearInterval(titleTimer);
    document.title = originalTitle;
  }

  function canNotify() {
    return "Notification" in window && Notification.permission === "granted";
  }

  function needsPermission() {
    return "Notification" in window && Notification.permission === "default";
  }

  async function requestPermission() {
    if (!("Notification" in window)) return "unsupported";
    return Notification.requestPermission();
  }

  // Ưu tiên gửi qua service worker (bắt buộc trên iPhone/Android), nếu không có thì dùng Notification thường
  async function systemNotify(title, body, onClick) {
    if (!canNotify()) return;
    const options = { body, tag: title + body, icon: "icons/icon-192.png", badge: "icons/icon-192.png", requireInteraction: true };
    try {
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) { await reg.showNotification(title, options); return; }
      }
      const n = new Notification(title, options);
      n.onclick = () => { window.focus(); onClick && onClick(); n.close(); };
    } catch { /* trình duyệt không hỗ trợ: vẫn còn toast + chuông trong app */ }
  }

  /**
   * Kiểm tra toàn bộ công việc, gọi onAlert(task, kind) cho từng lời nhắc tới lượt.
   * kind: "before" (sắp bắt đầu) | "start" (đến giờ bắt đầu) | "due" (hết thời gian dự kiến)
   *       | "snooze" (hết thời gian báo lại).
   * Mỗi mốc chỉ nhắc 1 lần; mốc muộn hơn đã qua thì bỏ qua các mốc sớm hơn.
   * Trả về true nếu có thay đổi trạng thái cần lưu.
   */
  function check(tasks, onAlert) {
    const now = Date.now();
    let changed = false;

    for (const t of tasks) {
      if (t.done || !t.due || t.remindBefore < 0) continue;
      const start = startOf(t);
      const end = TimeUtils.parse(t.due);

      if (t.snoozeUntil) {
        if (now >= t.snoozeUntil) {
          t.snoozeUntil = null;
          changed = true;
          onAlert(t, "snooze");
        }
        continue;
      }

      if (!t.notifiedDue && now >= end) {
        t.notifiedDue = t.notifiedStart = t.notifiedBefore = true;
        changed = true;
        // Không có thời lượng thì giờ bắt đầu = giờ kết thúc → chỉ báo "đến giờ bắt đầu"
        if (now - end < STALE_LIMIT) onAlert(t, end > start ? "due" : "start");
        continue;
      }

      if (!t.notifiedStart && now >= start) {
        t.notifiedStart = t.notifiedBefore = true;
        changed = true;
        if (now - start < STALE_LIMIT) onAlert(t, "start");
        continue;
      }

      const remindAt = start - t.remindBefore * TimeUtils.MIN;
      if (t.remindBefore > 0 && !t.notifiedBefore && !t.notifiedStart && now >= remindAt) {
        t.notifiedBefore = true;
        changed = true;
        onAlert(t, "before");
      }
    }
    return changed;
  }

  function start(tick) {
    tick();
    setInterval(tick, CHECK_INTERVAL);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) { stopFlash(); tick(); }
    });
  }

  return { OPTIONS, DURATIONS, startOf, beep, flashTitle, stopFlash, canNotify, needsPermission, requestPermission, systemNotify, check, start };
})();
