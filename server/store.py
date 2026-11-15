"""Lưu trữ tài khoản, phiên đăng nhập, danh sách việc, thiết bị nhận thông báo và lịch nhắc.

Hai chế độ, chọn tự động:
- Có biến môi trường DATABASE_URL → lưu vào Postgres (dùng khi deploy, vì ổ đĩa gói free bị xoá khi khởi động lại).
- Không có → lưu file data/db.json (chạy trên máy cá nhân).

Quy mô dùng cá nhân nên giữ toàn bộ trong bộ nhớ, mỗi lần thay đổi ghi nguyên khối JSON xuống.
Cấu trúc:
{
  "meta":     { ... cấu hình server, vd khoá VAPID ... },
  "users":    { uid: { email, pw, created_at, reminders: [{key, at, title, body}], sent: {key: at} } },
  "emails":   { email: uid },
  "sessions": { sha256(token): { uid, exp } },
  "tasks":    { uid: { task_id: {...việc, updatedAt, deleted} } },
  "devices":  { device_id: { uid, subscription, updated_at } }
}
"""
import json
import logging
import os
import secrets
import threading
import time
from pathlib import Path

log = logging.getLogger("store")

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()

MAX_TASKS_PER_USER = 5000
TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000  # việc đã xoá giữ dấu 30 ngày để thiết bị khác kịp nhận


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
    gói free (Neon) hay tự đóng kết nối rảnh; số lần ghi ít nên không đáng kể."""

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
        # prepare_threshold=None: không dùng prepared statement, an toàn với connection pooler của Neon
        return self.psycopg.connect(self.url, connect_timeout=10, autocommit=True, prepare_threshold=None)

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
for _key in ("meta", "users", "emails", "sessions", "tasks", "devices"):
    _db.setdefault(_key, {})
# Bản trước chưa có tài khoản: thiết bị không gắn người dùng thì bỏ (sẽ tự đăng ký lại sau khi đăng nhập)
_db["devices"] = {k: v for k, v in _db["devices"].items() if v.get("uid")}


def save() -> None:
    with _lock:
        try:
            _backend.write(_db)
        except Exception:
            # Lỗi mạng tới cơ sở dữ liệu: dữ liệu vẫn còn trong bộ nhớ, lần lưu sau sẽ ghi lại
            log.exception("Không lưu được dữ liệu")


def now_ms() -> int:
    return int(time.time() * 1000)


# ---------- Cấu hình server ----------
def get_meta(key: str):
    with _lock:
        return _db["meta"].get(key)


def set_meta(key: str, value) -> None:
    with _lock:
        _db["meta"][key] = value
        save()


# ---------- Tài khoản ----------
def create_user(email: str, pw_hash: str) -> str | None:
    """Tạo tài khoản. Trả về uid, hoặc None nếu email đã được dùng."""
    with _lock:
        if email in _db["emails"]:
            return None
        uid = secrets.token_hex(8)
        _db["users"][uid] = {"email": email, "pw": pw_hash, "created_at": now_ms(), "reminders": [], "sent": {}}
        _db["emails"][email] = uid
        save()
        return uid


def find_user(email: str) -> tuple[str, dict] | None:
    with _lock:
        uid = _db["emails"].get(email)
        return (uid, _db["users"][uid]) if uid else None


def user_email(uid: str) -> str | None:
    with _lock:
        user = _db["users"].get(uid)
        return user["email"] if user else None


# ---------- Phiên đăng nhập ----------
def create_session(token_hash: str, uid: str, exp: int) -> None:
    with _lock:
        now = now_ms()
        # Dọn các phiên đã hết hạn
        _db["sessions"] = {k: s for k, s in _db["sessions"].items() if s["exp"] > now}
        _db["sessions"][token_hash] = {"uid": uid, "exp": exp}
        save()


def session_user(token_hash: str) -> str | None:
    with _lock:
        s = _db["sessions"].get(token_hash)
        if not s or s["exp"] <= now_ms() or s["uid"] not in _db["users"]:
            return None
        return s["uid"]


def delete_session(token_hash: str) -> None:
    with _lock:
        if _db["sessions"].pop(token_hash, None):
            save()


# ---------- Danh sách việc ----------
def merge_tasks(uid: str, incoming: list[dict]) -> list[dict] | None:
    """Gộp các việc thiết bị gửi lên: với mỗi việc, bản có updatedAt mới hơn thắng.
    Trả về toàn bộ danh sách sau khi gộp (kể cả dấu đã xoá), hoặc None nếu vượt giới hạn số việc."""
    with _lock:
        tasks = _db["tasks"].setdefault(uid, {})
        new_ids = {t["id"] for t in incoming} - tasks.keys()
        if len(tasks) + len(new_ids) > MAX_TASKS_PER_USER:
            return None
        changed = False
        for t in incoming:
            cur = tasks.get(t["id"])
            if cur is None or t["updatedAt"] > cur["updatedAt"]:
                # Việc đã xoá chỉ giữ lại dấu xoá, bỏ nội dung
                tasks[t["id"]] = {"id": t["id"], "updatedAt": t["updatedAt"], "deleted": True} if t["deleted"] else t
                changed = True
        cutoff = now_ms() - TOMBSTONE_TTL_MS
        for tid in [k for k, t in tasks.items() if t.get("deleted") and t["updatedAt"] < cutoff]:
            del tasks[tid]
            changed = True
        if changed:
            save()
        return list(tasks.values())


# ---------- Thiết bị nhận thông báo đẩy ----------
def upsert_device(device_id: str, uid: str, subscription: dict) -> None:
    with _lock:
        _db["devices"][device_id] = {"uid": uid, "subscription": subscription, "updated_at": now_ms()}
        save()


def remove_device(device_id: str, uid: str | None = None) -> None:
    """Xoá thiết bị; nếu truyền uid thì chỉ xoá khi thiết bị thuộc người đó."""
    with _lock:
        device = _db["devices"].get(device_id)
        if device and (uid is None or device["uid"] == uid):
            del _db["devices"][device_id]
            save()


def user_devices(uid: str) -> list[tuple[str, dict]]:
    with _lock:
        return [(did, d["subscription"]) for did, d in _db["devices"].items() if d["uid"] == uid]


# ---------- Lịch nhắc (theo người dùng, gửi tới mọi thiết bị của người đó) ----------
def set_reminders(uid: str, reminders: list[dict]) -> None:
    with _lock:
        _db["users"][uid]["reminders"] = reminders
        save()


def take_due(now: int, stale_ms: int, sent_ttl_ms: int) -> list[tuple[str, dict]]:
    """Lấy ra các lời nhắc đã tới giờ (xoá khỏi lịch), bỏ qua mốc đã gửi hoặc trễ quá `stale_ms`.

    Trả về danh sách (uid, reminder) cần gửi; đánh dấu đã gửi ngay để không gửi trùng.
    """
    out = []
    changed = False
    with _lock:
        for uid, user in _db["users"].items():
            due = [r for r in user["reminders"] if r["at"] <= now]
            sent = user["sent"]
            if due:
                changed = True
                user["reminders"] = [r for r in user["reminders"] if r["at"] > now]
                for r in due:
                    if sent.get(r["key"]) == r["at"] or now - r["at"] > stale_ms:
                        continue
                    sent[r["key"]] = r["at"]
                    out.append((uid, r))
            for key, at in list(sent.items()):
                if now - at > sent_ttl_ms:
                    del sent[key]
                    changed = True
        if changed:
            save()
    return out
