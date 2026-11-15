# Việc cần làm (take-it)

Ứng dụng ghi chú việc cần làm, có **nhắc việc trước giờ bắt đầu**, cài được lên iPhone như một app thật và nhận thông báo **kể cả khi đã tắt app**.

## Tính năng

- **Giờ bắt đầu + thời lượng dự kiến** → app tự tính giờ kết thúc.
- **Nhắc 3 mốc:** sắp bắt đầu (trước 5 phút → 1 ngày, tuỳ chọn), đến giờ bắt đầu, hết thời gian dự kiến. Có nút "Hoàn thành" và "Báo lại 5 phút".
- **Thông báo đẩy từ server:** vẫn nhận nhắc khi app đã đóng hoàn toàn.
- Danh sách tự chia nhóm: Quá hạn / Đang làm / Hôm nay / Sắp tới / Không có hạn.
- Mức ưu tiên, tìm kiếm, xoá có hoàn tác, thanh tiến độ.
- Giao diện xanh dương pastel, có chế độ tối dịu mắt, dùng tốt trên điện thoại.
- Cài lên màn hình chính dạng Progressive Web App (PWA — web app cài được như app), chạy được khi mất mạng.
- Phím tắt: `N` thêm việc, `/` tìm kiếm.

## Công nghệ

| Phần | Công nghệ |
|---|---|
| Giao diện | HTML, CSS, JavaScript thuần (không framework, không bước build) |
| Server | Python 3.13, FastAPI, Uvicorn |
| Thông báo đẩy | Chuẩn Web Push, thư viện `pywebpush` |
| Lưu trữ | File JSON (chạy trên máy) hoặc Postgres (khi deploy) |

## Cấu trúc thư mục

```
public/                 Giao diện app (server phục vụ thư mục này)
  index.html
  css/styles.css
  js/app.js             Giao diện, thêm/sửa/xoá, lọc, tìm kiếm
  js/reminder.js        Tính mốc nhắc, chuông, thông báo trong app
  js/push-sync.js       Đăng ký nhận thông báo đẩy, đồng bộ lịch nhắc lên server
  js/time-utils.js      Định dạng thời gian tiếng Việt
  js/storage.js         Lưu việc cần làm trong trình duyệt
  sw.js                 Service worker: chạy offline, nhận thông báo đẩy
  manifest.webmanifest  Thông tin để cài app lên màn hình chính
server/
  main.py               API và bộ hẹn giờ gửi nhắc (kiểm tra mỗi 10 giây)
  push.py               Gửi thông báo đẩy, quản lý khoá ký
  store.py              Lưu thiết bị và lịch nhắc (file JSON hoặc Postgres)
docs/deploy-render.md   Hướng dẫn deploy miễn phí từng bước
render.yaml             Cấu hình deploy trên Render
```

## Chạy trên máy

Yêu cầu: Python 3.11 trở lên.

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn server.main:app --host 0.0.0.0 --port 8000
```

Mở <http://localhost:8000>, bấm **Bật thông báo**. Dữ liệu server lưu ở `data/`.

## Cách hoạt động

1. Việc cần làm lưu trong trình duyệt của từng thiết bị (`localStorage`).
2. Mỗi khi thêm/sửa/xoá việc, app gửi danh sách các mốc nhắc sắp tới lên server.
3. Server kiểm tra lịch mỗi 10 giây và gửi thông báo qua dịch vụ đẩy của Apple/Google/Mozilla.
4. Service worker trên thiết bị nhận và hiển thị thông báo, kể cả khi app đã tắt.

Nếu không có server (mở thẳng file `index.html`), app vẫn nhắc được nhưng chỉ khi đang mở.

## Biến môi trường

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `DATABASE_URL` | Khi deploy | Chuỗi kết nối Postgres. Không đặt → lưu file `data/db.json` |
| `VAPID_SUBJECT` | Nên có | Địa chỉ liên hệ của chủ server cho dịch vụ đẩy, dạng `mailto:email@example.com` |
| `VAPID_PRIVATE_KEY_PEM` | Không | Khoá ký thông báo đẩy. Không đặt → server tự sinh và tự lưu |
| `PORT` | Không | Cổng server (Render tự đặt) |

Voluntary Application Server Identification (VAPID) là cặp khoá server dùng để định danh với dịch vụ đẩy. **Không đưa thư mục `data/` lên git** — nó chứa khoá bí mật (đã có trong `.gitignore`).

## Deploy miễn phí

Dùng Render (chạy server) + Neon (Postgres) + cron-job.org (giữ server không ngủ). Xem hướng dẫn chi tiết tại [docs/deploy-render.md](docs/deploy-render.md).

## Cài lên iPhone

Yêu cầu iOS 16.4 trở lên và app đã deploy lên địa chỉ HTTPS.

1. Mở địa chỉ app bằng **Safari** → nút **Chia sẻ** → **Thêm vào Màn hình chính**.
2. Mở app **từ icon trên màn hình chính** → **Bật thông báo** → **Cho phép**.

## Giới hạn hiện tại

- Danh sách việc không đồng bộ giữa các thiết bị (chưa có đăng nhập).
- Gói free của Render có thể ngủ nếu cron ping lỗi → nhắc bị trễ; nhắc trễ quá 1 giờ sẽ bị bỏ qua.

## Hướng phát triển

- Tích hợp AI (gợi ý thời lượng, tách việc lớn thành việc nhỏ…): thêm router mới trong `server/` và gắn vào `server/main.py`.
- Đăng nhập và đồng bộ việc cần làm giữa các thiết bị.
