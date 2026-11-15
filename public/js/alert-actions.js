// Nút bấm cho từng loại nhắc — dùng chung cho ô nhắc trong app và thông báo hệ thống (service worker nạp file này).
//   before: sắp đến giờ bắt đầu       start: đến giờ bắt đầu
//   due:    đang làm, hết thời gian dự kiến
//   late:   hết khung giờ mà chưa bắt đầu
const ALERT_ACTIONS = {
  before: [{ action: "start", label: "▶ Bắt đầu ngay", primary: true }, { action: "dismiss", label: "Đã biết" }],
  start: [{ action: "start", label: "▶ Bắt đầu", primary: true }, { action: "snooze", label: "Báo lại 5 phút" }],
  due: [{ action: "done", label: "✓ Hoàn thành", primary: true }, { action: "extend", label: "+15 phút" }],
  late: [{ action: "start", label: "▶ Bắt đầu", primary: true }, { action: "done", label: "✓ Đã xong" }],
};
