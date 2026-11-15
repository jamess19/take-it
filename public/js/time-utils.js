// Tiện ích xử lý thời gian: chuyển đổi giá trị datetime-local và hiển thị thân thiện bằng tiếng Việt.
const TimeUtils = (() => {
  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  const pad = (n) => String(n).padStart(2, "0");

  // Date -> "YYYY-MM-DDTHH:mm" (giờ địa phương) cho input datetime-local
  function toLocalInput(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  // Chuỗi datetime-local được trình duyệt hiểu là giờ địa phương
  function parse(value) {
    return value ? new Date(value).getTime() : null;
  }

  function startOfDay(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function isSameDay(a, b) {
    return startOfDay(a) === startOfDay(b);
  }

  function hhmm(ts) {
    const d = new Date(ts);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // "Hôm nay 15:30", "Ngày mai 09:00", "Hôm qua 08:00", "T2, 17/11 09:00"
  function formatDue(ts) {
    const now = Date.now();
    const dayDiff = Math.round((startOfDay(ts) - startOfDay(now)) / DAY);
    if (dayDiff === 0) return `Hôm nay ${hhmm(ts)}`;
    if (dayDiff === 1) return `Ngày mai ${hhmm(ts)}`;
    if (dayDiff === -1) return `Hôm qua ${hhmm(ts)}`;
    const date = new Date(ts).toLocaleDateString("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit" });
    return `${date} ${hhmm(ts)}`;
  }

  // Khoảng thời gian dạng "20 phút", "2 giờ 15 phút", "3 ngày"
  function duration(ms) {
    ms = Math.abs(ms);
    if (ms < MIN) return "dưới 1 phút";
    if (ms < HOUR) return `${Math.floor(ms / MIN)} phút`;
    if (ms < DAY) {
      const h = Math.floor(ms / HOUR);
      const m = Math.floor((ms % HOUR) / MIN);
      return m ? `${h} giờ ${m} phút` : `${h} giờ`;
    }
    return `${Math.floor(ms / DAY)} ngày`;
  }

  // "còn 20 phút" hoặc "quá hạn 2 giờ"
  function relative(ts) {
    const diff = ts - Date.now();
    return diff >= 0 ? `còn ${duration(diff)}` : `quá hạn ${duration(diff)}`;
  }

  // Giờ kết thúc = giờ bắt đầu + thời lượng (phút), trả về chuỗi datetime-local
  function addMinutes(value, minutes) {
    return value ? toLocalInput(new Date(parse(value) + (Number(minutes) || 0) * MIN)) : null;
  }

  // "Hôm nay 15:00–16:30" (cùng ngày) hoặc "Hôm nay 22:00 → Ngày mai 01:00"
  function formatRange(start, end) {
    if (start === end) return formatDue(start);
    return isSameDay(start, end) ? `${formatDue(start)}–${hhmm(end)}` : `${formatDue(start)} → ${formatDue(end)}`;
  }

  return { MIN, HOUR, DAY, toLocalInput, parse, startOfDay, isSameDay, formatDue, formatRange, duration, relative, addMinutes };
})();
