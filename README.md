# Việc cần làm (take-it)

Ứng dụng ghi chú việc cần làm, có **nhắc việc trước giờ bắt đầu**, cài được lên iPhone như một app thật và nhận thông báo **kể cả khi đã tắt app**.

## Tính năng

- **Giờ bắt đầu + thời lượng dự kiến** → app tự tính giờ kết thúc.
- **Nhắc 3 mốc:** sắp bắt đầu (trước 5 phút → 1 ngày, tuỳ chọn), đến giờ bắt đầu, hết thời gian dự kiến. Có nút "Hoàn thành" và "Báo lại 5 phút".
- **Tài khoản email + mật khẩu, đồng bộ giữa các thiết bị:** thêm việc trên máy tính là điện thoại thấy ngay. Mất mạng vẫn dùng được, có mạng lại tự đồng bộ.
- **Thông báo đẩy từ server:** vẫn nhận nhắc khi app đã đóng hoàn toàn, gửi tới mọi thiết bị đã đăng nhập.
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
  js/api.js             Gọi API kèm token đăng nhập
  js/task-sync.js       Đồng bộ danh sách việc giữa các thiết bị
  js/push-sync.js       Đăng ký nhận thông báo đẩy, gửi lịch nhắc lên server
  js/time-utils.js      Định dạng thời gian tiếng Việt
  js/storage.js         Lưu việc cần làm trong trình duyệt
  sw.js                 Service worker: chạy offline, nhận thông báo đẩy
  manifest.webmanifest  Thông tin để cài app lên màn hình chính
server/
  main.py               Khởi tạo app, bộ hẹn giờ gửi nhắc (kiểm tra mỗi 10 giây)
  auth.py               Đăng ký, đăng nhập, đăng xuất, kiểm tra token
  api_tasks.py          API đồng bộ danh sách việc
  api_push.py           API thông báo đẩy
  push.py               Gửi thông báo đẩy, quản lý khoá ký
  store.py              Lưu tài khoản, việc, thiết bị, lịch nhắc (file JSON hoặc Postgres)
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

1. Người dùng đăng nhập; server cấp token, app gửi kèm mỗi lần gọi API.
2. Việc lưu trên máy (`localStorage`) để dùng được khi mất mạng. Mỗi thay đổi được đưa vào hàng chờ và gửi lên server; server trả về danh sách đã gộp.
3. Gộp dữ liệu: với mỗi việc, bản sửa sau cùng thắng. Việc bị xoá được giữ "dấu xoá" 30 ngày để các máy khác xoá theo.
4. Sau mỗi lần đồng bộ, app gửi lịch nhắc sắp tới lên server. Server kiểm tra lịch mỗi 10 giây và gửi thông báo tới mọi thiết bị của tài khoản qua dịch vụ đẩy của Apple/Google/Mozilla.
5. Service worker trên thiết bị nhận và hiển thị thông báo, kể cả khi app đã tắt.

Nếu không có server (mở thẳng file `index.html`), app chạy cục bộ không cần đăng nhập, chỉ nhắc khi đang mở.

Bảo mật: mật khẩu băm bằng scrypt kèm muối ngẫu nhiên; server chỉ lưu mã băm SHA-256 của token; đăng nhập sai 10 lần trong 15 phút thì tạm khoá.

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
2. Mở app **từ icon trên màn hình chính** → **Đăng nhập** (cùng tài khoản với máy tính) → **Bật thông báo** → **Cho phép**.

## Giới hạn hiện tại

- Chưa có chức năng quên mật khẩu (cần gửi email).
- Thiết bị khác thấy thay đổi khi mở/quay lại app hoặc sau tối đa 1 phút nếu đang mở (chưa đẩy tức thời).
- Lưu toàn bộ dữ liệu thành một khối JSON — phù hợp dùng cá nhân/nhóm nhỏ; nhiều người dùng cần chuyển sang bảng riêng.
- Gói free của Render có thể ngủ nếu cron ping lỗi → nhắc bị trễ; nhắc trễ quá 1 giờ sẽ bị bỏ qua.

## Hướng phát triển

- Tích hợp AI (gợi ý thời lượng, tách việc lớn thành việc nhỏ…): thêm router mới trong `server/` và gắn vào `server/main.py`.
- Quên mật khẩu qua email, đổi mật khẩu.
