# Hướng dẫn deploy miễn phí: Render + Neon + cron-job.org

Mục tiêu: đưa app "Việc cần làm" lên internet với địa chỉ HTTPS (HyperText Transfer Protocol Secure — web có mã hoá), cài lên iPhone và nhận nhắc việc kể cả khi đã tắt app. Tổng chi phí: 0 đồng, không cần thẻ tín dụng.

## Tổng quan

| Dịch vụ | Vai trò | Gói |
|---|---|---|
| GitHub | Chứa mã nguồn; Render lấy code từ đây | Free |
| Render | Chạy server Python (giao diện app + gửi thông báo đẩy) | Free |
| Neon | Cơ sở dữ liệu Postgres lưu thiết bị và lịch nhắc | Free |
| cron-job.org | Gọi vào server mỗi 10 phút để server không "ngủ" | Free |

Vì sao cần Neon và cron-job.org:
- Gói free của Render **tự ngủ sau 15 phút không có request** → bộ hẹn giờ dừng, không gửi nhắc. cron-job.org gọi `/healthz` mỗi 10 phút để giữ server thức.
- Ổ đĩa gói free của Render **bị xoá mỗi lần khởi động lại** → dữ liệu phải lưu ở Postgres bên ngoài (Neon).

Thời gian làm: khoảng 20–30 phút.

---

## Bước 1. Đưa code lên GitHub

1. Tạo tài khoản tại <https://github.com> (nếu chưa có).
2. Tạo repository mới: bấm **New repository** → đặt tên, ví dụ `viec-can-lam` → chọn **Private** → **không** tick "Add a README" → **Create repository**.
3. Trên máy, mở Terminal và chạy (thay `<ten-github>` bằng tên tài khoản GitHub của bạn):

   ```bash
   cd /Users/psa/Documents/learning/take-it
   git init -b main
   git add .
   git status        # kiểm tra: KHÔNG được có thư mục data/ và .venv/
   git commit -m "App việc cần làm + server nhắc việc"
   git remote add origin https://github.com/<ten-github>/viec-can-lam.git
   git push -u origin main
   ```

   > ⚠️ Thư mục `data/` chứa khoá bí mật dùng để gửi thông báo. File `.gitignore` đã loại nó ra; nếu `git status` vẫn thấy `data/` thì dừng lại, đừng commit.

## Bước 2. Tạo cơ sở dữ liệu Postgres trên Neon

1. Đăng ký tại <https://neon.tech> (đăng nhập bằng GitHub cho nhanh).
2. Tạo project mới:
   - Tên: `viec-can-lam`
   - Region: chọn **Singapore** (AWS ap-southeast-1) — gần Việt Nam và gần server Render ở bước 3.
3. Sau khi tạo xong, mở mục **Connection string** (hoặc nút **Connect**) và copy chuỗi có dạng:

   ```
   postgresql://<user>:<mat-khau>@<host>.neon.tech/<ten-db>?sslmode=require
   ```

4. Lưu tạm chuỗi này (dùng ở bước 3). **Không dán vào code hay gửi cho người khác** — nó chứa mật khẩu.

Không cần tự tạo bảng: server tự tạo bảng `app_state` khi chạy lần đầu.

## Bước 3. Deploy server lên Render

1. Đăng ký tại <https://render.com> bằng tài khoản GitHub.
2. Trên Dashboard bấm **New +** → **Blueprint**.
3. Kết nối GitHub, chọn repository `viec-can-lam`. Render tự đọc file `render.yaml` trong repo.
4. Render hỏi giá trị cho 2 biến môi trường:

   | Biến | Giá trị |
   |---|---|
   | `DATABASE_URL` | Chuỗi kết nối Neon ở bước 2 |
   | `VAPID_SUBJECT` | `mailto:` + email của bạn, ví dụ `mailto:ban@example.com` — dịch vụ đẩy của Apple/Google dùng để liên hệ chủ server khi có sự cố |

5. Bấm **Apply** / **Deploy**. Đợi 2–5 phút đến khi trạng thái là **Live**.
6. Lấy địa chỉ app ở đầu trang service, dạng `https://viec-can-lam.onrender.com` (nếu tên đã có người dùng, Render thêm hậu tố ngẫu nhiên).
7. Kiểm tra: mở `https://<dia-chi-app>/healthz` → phải thấy `{"ok":true}`.

Khoá Voluntary Application Server Identification (VAPID) — khoá server dùng để ký thông báo đẩy — được tự sinh ở lần chạy đầu và lưu trong Neon, không cần làm gì thêm.

## Bước 4. Giữ server luôn thức bằng cron-job.org

1. Đăng ký tại <https://cron-job.org>.
2. **Create cronjob**:
   - Title: `viec-can-lam keep-alive`
   - URL: `https://<dia-chi-app>/healthz`
   - Schedule: **Every 10 minutes**
3. Lưu lại. Sau 10–20 phút, mở mục **History** của job: các lần gọi phải trả về `200`.

## Bước 5. Cài app lên iPhone

Yêu cầu: iOS (hệ điều hành iPhone) **16.4 trở lên**.

1. Mở **Safari** (bắt buộc Safari), vào `https://<dia-chi-app>`.
2. Bấm nút **Chia sẻ** (ô vuông có mũi tên lên) → **Thêm vào Màn hình chính** → **Thêm**.
3. **Mở app từ icon trên màn hình chính** (không mở trong Safari — iPhone chỉ cho phép thông báo với app đã thêm vào màn hình chính).
4. **Đăng ký** tài khoản (lần đầu) hoặc **Đăng nhập** bằng email + mật khẩu — dùng cùng tài khoản trên máy tính và điện thoại để đồng bộ việc.
5. Bấm **Bật thông báo** → **Cho phép**. App báo "vẫn được nhắc kể cả khi tắt app" là thành công.
6. Thử: mở trên máy tính hoặc thu nhỏ app → bấm **🔔 Thử nhắc** (trên iPhone nút này ẩn ở màn hình nhỏ; cách khác: tạo 1 việc bắt đầu sau 2 phút, nhắc "Đúng giờ", rồi tắt hẳn app và chờ).

Trên máy tính (Chrome/Edge/Safari) cũng làm tương tự: mở địa chỉ app → **Đăng nhập** → **Bật thông báo**.

## Cập nhật app về sau

Sửa code trên máy rồi:

```bash
git add . && git commit -m "Mô tả thay đổi" && git push
```

Render tự build và deploy lại trong vài phút. Dữ liệu trong Neon giữ nguyên.

---

## Xử lý sự cố

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| iPhone không có nút "Bật thông báo" hoặc báo không hỗ trợ | Đang mở trong Safari, chưa mở từ icon màn hình chính; hoặc iOS < 16.4 | Làm lại Bước 5 mục 2–3 |
| Bật rồi nhưng không nhận thông báo | Thông báo bị tắt trong Cài đặt iPhone, hoặc đang bật chế độ Tập trung | Cài đặt → Thông báo → "Việc cần làm" → bật Cho phép thông báo |
| Thông báo đến trễ vài phút / không đến | Server đã ngủ (cron job lỗi) | Xem History trên cron-job.org; xem tab **Logs** trên Render |
| Render log báo lỗi kết nối Postgres | `DATABASE_URL` sai hoặc thiếu `?sslmode=require` | Render → service → **Environment** → sửa lại → **Save** (tự deploy lại) |
| Mở app lần đầu chậm ~1 phút | Server đang thức dậy sau khi ngủ | Bình thường nếu cron job chưa chạy; sau khi cron job chạy đều sẽ hết |

## Giới hạn của gói miễn phí

- Danh sách việc đồng bộ qua tài khoản và lưu trong Neon. Gói free của Neon có giới hạn dung lượng, đủ cho dùng cá nhân.
- Render free có 750 giờ chạy/tháng — đủ cho 1 server chạy cả tháng (31 ngày ≈ 744 giờ). Không nên tạo thêm service free thứ hai trong cùng tài khoản.
- Việc dùng cron ping để giữ server thức là cách phổ biến nhưng nằm ngoài mục đích của gói free; Render có thể thay đổi chính sách. Nếu cần ổn định lâu dài (ví dụ khi tích hợp AI), nâng gói Render trả phí (khoảng 7 USD/tháng) là hết ngủ, không cần cron-job.org.
- Lời nhắc bị lỡ khi server ngừng quá 1 giờ sẽ bị bỏ qua (không gửi dồn).
- Các gói free thay đổi thường xuyên — kiểm tra lại trang giá của từng dịch vụ nếu thấy khác hướng dẫn.

## Chạy trên máy cá nhân (không cần Neon)

```bash
cd /Users/psa/Documents/learning/take-it
.venv/bin/uvicorn server.main:app --host 0.0.0.0 --port 8000
```

Không đặt `DATABASE_URL` → server lưu vào file `data/db.json`. Mở `http://localhost:8000`.
