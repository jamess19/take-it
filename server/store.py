"""Lưu trữ thiết bị, subscription đẩy và lịch nhắc.

Hai chế độ, chọn tự động:
- Có biến môi trường DATABASE_URL → lưu vào Postgres (dùng khi deploy, vì ổ đĩa gói free bị xoá khi khởi động lại).
- Không có → lưu file data/db.json (chạy trên máy cá nhân).

Dữ liệu nhỏ (dùng cá nhân) nên giữ toàn bộ trong bộ nhớ, mỗi lần thay đổi ghi nguyên khối JSON xuống.
Cấu trúc:
{ "devices": { "<device_id>": { "subscription": {...}, "reminders": [{key, at, title, body}],
                                "sent": {"<key>": at}, "updated_at": ms } },
  "meta": { ... cấu hình server, vd khoá VAPID ... } }
"""
import json
import logging
import os
import threading
import time
from pathlib import Path

log = logging.getLogger("store")

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()


class _FileBackend:
    def __init__(self, path: Path):
        self.path = path

    def load(self) -> dict | None:
        try:
            return json.loads(self.path.read_text("utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            return None

    def write(self, data: dict) -> None:
        # Ghi ra file tạm rồi đổi tên, để file không hỏng nếu server tắt giữa chừng
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False), "utf-8")
        tmp.replace(self.path)


class _PostgresBackend:
    """Một bảng, một dòng chứa toàn bộ dữ liệu dạng JSONB. Mở kết nối mới mỗi lần ghi vì Postgres
    gói free (Neon/Supabase) hay tự đóng kết nối rảnh; số lần ghi ít nên không đáng kể."""

    def __init__(self, url: str):
        import psycopg  # chỉ cần khi dùng Postgres

        self.psycopg = psycopg
        self.url = url
        with self._connect() as conn:
            conn.execute(
                """CREATE TABLE IF NOT EXISTS app_state (
                       id SMALLINT PRIMARY KEY,
                       data JSONB NOT NULL,
                       updated_at TIMESTAMPTZ NOT NULL DEFAULT now())"""
            )

    def _connect(self):
        return self.psycopg.connect(self.url, connect_timeout=10, autocommit=True)

    def load(self) -> dict | None:
        with self._connect() as conn:
            row = conn.execute("SELECT data FROM app_state WHERE id = 1").fetchone()
            return row[0] if row else None

    def write(self, data: dict) -> None:
        with self._connect() as conn:
            conn.execute(
                """INSERT INTO app_state (id, data) VALUES (1, %s)
                   ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()""",
                (self.psycopg.types.json.Jsonb(data),),
            )


_backend = _PostgresBackend(DATABASE_URL) if DATABASE_URL else _FileBackend(DATA_DIR / "db.json")
log.info("Lưu trữ: %s", "Postgres" if DATABASE_URL else _backend.path)

_lock = threading.RLock()
_db = _backend.load() or {}
_db.setdefault("devices", {})
_db.setdefault("meta", {})


def save() -> None:
    with _lock:
        try:
            _backend.write(_db)
        except Exception:
            # Lỗi mạng tới cơ sở dữ liệu: dữ liệu vẫn còn trong bộ nhớ, lần lưu sau sẽ ghi lại
            log.exception("Không lưu được dữ liệu")


def now_ms() -> int:
    return int(time.time() * 1000)


def get_meta(key: str):
    with _lock:
        return _db["meta"].get(key)


def set_meta(key: str, value) -> None:
    with _lock:
        _db["meta"][key] = value
        save()


def get_device(device_id: str) -> dict | None:
    with _lock:
        return _db["devices"].get(device_id)


def upsert_subscription(device_id: str, subscription: dict) -> None:
    with _lock:
        device = _db["devices"].setdefault(device_id, {"reminders": [], "sent": {}})
        device["subscription"] = subscription
        device["updated_at"] = now_ms()
        save()


def set_reminders(device_id: str, reminders: list[dict]) -> bool:
    """Thay toàn bộ lịch nhắc của thiết bị. Trả về False nếu thiết bị chưa đăng ký."""
    with _lock:
        device = _db["devices"].get(device_id)
        if device is None:
            return False
        device["reminders"] = reminders
        device["updated_at"] = now_ms()
        save()
        return True


def remove_device(device_id: str) -> None:
    with _lock:
        _db["devices"].pop(device_id, None)
        save()


def take_due(now: int, stale_ms: int, sent_ttl_ms: int) -> list[tuple[str, dict, dict]]:
    """Lấy ra các lời nhắc đã tới giờ (xoá khỏi lịch), bỏ qua mốc đã gửi hoặc trễ quá `stale_ms`.

    Trả về danh sách (device_id, subscription, reminder) cần gửi; đánh dấu đã gửi ngay để không gửi trùng.
    """
    out = []
    changed = False
    with _lock:
        for device_id, device in _db["devices"].items():
            due = [r for r in device["reminders"] if r["at"] <= now]
            sent = device.setdefault("sent", {})
            if due:
                changed = True
                device["reminders"] = [r for r in device["reminders"] if r["at"] > now]
                for r in due:
                    if sent.get(r["key"]) == r["at"] or now - r["at"] > stale_ms:
                        continue
                    sent[r["key"]] = r["at"]
                    out.append((device_id, device["subscription"], r))
            for key, at in list(sent.items()):
                if now - at > sent_ttl_ms:
                    del sent[key]
        if changed:
            save()
    return out
