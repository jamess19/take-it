"""Truy cập dữ liệu: tài khoản, phiên đăng nhập, việc, thiết bị nhận thông báo, lịch nhắc.

Mọi thao tác đọc/ghi thẳng vào cơ sở dữ liệu (xem db.py), không giữ bản sao trong bộ nhớ,
nên nhiều tiến trình server chạy song song (vd lúc Render deploy) không ghi đè dữ liệu của nhau.
"""
import secrets
import time

from . import db
from .db import DATA_DIR  # noqa: F401  (push.py dùng)

MAX_TASKS_PER_USER = 5000
TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000  # việc đã xoá giữ dấu 30 ngày để thiết bị khác kịp nhận

# Cột trong bảng tasks ↔ tên trường app dùng (JSON)
TASK_FIELDS = [
    ("id", "id"), ("title", "title"), ("note", "note"), ("start_at", "start"), ("duration_min", "duration"),
    ("due_at", "due"), ("remind_before", "remindBefore"), ("priority", "priority"), ("done", "done"),
    ("created_at", "createdAt"), ("completed_at", "completedAt"), ("started_at", "startedAt"),
    ("snooze_until", "snoozeUntil"), ("snooze_kind", "snoozeKind"), ("notified_before", "notifiedBefore"),
    ("notified_start", "notifiedStart"), ("notified_due", "notifiedDue"), ("updated_at", "updatedAt"),
    ("deleted", "deleted"),
]
BOOL_COLS = {"done", "notified_before", "notified_start", "notified_due", "deleted"}


def now_ms() -> int:
    return int(time.time() * 1000)


# ---------- Cấu hình server ----------
def get_meta(key: str):
    with db.tx() as t:
        row = t.one("SELECT value FROM meta WHERE key = ?", (key,))
    return row["value"] if row else None


def set_meta(key: str, value: str) -> None:
    with db.tx() as t:
        t.run("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
              (key, value))


def set_meta_if_absent(key: str, value: str) -> str:
    """Ghi nếu chưa có; trả về giá trị đang lưu (tránh 2 tiến trình cùng sinh 2 khoá khác nhau)."""
    with db.tx() as t:
        t.run("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING", (key, value))
        return t.one("SELECT value FROM meta WHERE key = ?", (key,))["value"]


# ---------- Tài khoản ----------
def create_user(email: str, pw_hash: str) -> str | None:
    """Tạo tài khoản. Trả về uid, hoặc None nếu email đã được dùng."""
    uid = secrets.token_hex(8)
    with db.tx() as t:
        row = t.one(
            "INSERT INTO users (id, email, pw_hash, created_at) VALUES (?, ?, ?, ?) "
            "ON CONFLICT (email) DO NOTHING RETURNING id",
            (uid, email, pw_hash, now_ms()),
        )
    return row["id"] if row else None


def find_user(email: str) -> tuple[str, dict] | None:
    with db.tx() as t:
        row = t.one("SELECT id, pw_hash FROM users WHERE email = ?", (email,))
    return (row["id"], {"pw": row["pw_hash"]}) if row else None


def user_email(uid: str) -> str | None:
    with db.tx() as t:
        row = t.one("SELECT email FROM users WHERE id = ?", (uid,))
    return row["email"] if row else None


# ---------- Hồ sơ cá nhân ----------
def get_profile(uid: str) -> dict | None:
    with db.tx() as t:
        return t.one("SELECT email, name, note, avatar FROM users WHERE id = ?", (uid,))


def update_profile(uid: str, fields: dict) -> None:
    """Cập nhật các trường hồ sơ được phép: name, note, avatar."""
    cols = [k for k in ("name", "note", "avatar") if k in fields]
    if not cols:
        return
    with db.tx() as t:
        t.run(f"UPDATE users SET {', '.join(c + ' = ?' for c in cols)} WHERE id = ?",
              (*[fields[c] for c in cols], uid))


def password_hash(uid: str) -> str | None:
    with db.tx() as t:
        row = t.one("SELECT pw_hash FROM users WHERE id = ?", (uid,))
    return row["pw_hash"] if row else None


def change_email(uid: str, new_email: str) -> bool:
    """Đổi email đăng nhập. Trả về False nếu email mới đã thuộc tài khoản khác."""
    try:
        with db.tx() as t:
            other = t.one("SELECT id FROM users WHERE email = ? AND id <> ?", (new_email, uid))
            if other:
                return False
            t.run("UPDATE users SET email = ? WHERE id = ?", (new_email, uid))
        return True
    except db.UNIQUE_ERRORS:  # tài khoản khác vừa đăng ký đúng email này
        return False


def set_password(uid: str, pw_hash: str, keep_token_hash: str) -> None:
    """Đổi mật khẩu và đăng xuất mọi phiên khác của tài khoản (giữ phiên đang dùng)."""
    with db.tx() as t:
        t.run("UPDATE users SET pw_hash = ? WHERE id = ?", (pw_hash, uid))
        t.run("DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?", (uid, keep_token_hash))


# ---------- Phiên đăng nhập ----------
def create_session(token_hash: str, uid: str, exp: int) -> None:
    with db.tx() as t:
        t.run("DELETE FROM sessions WHERE expires_at <= ?", (now_ms(),))  # dọn phiên hết hạn
        t.run("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)", (token_hash, uid, exp))


def session_user(token_hash: str) -> str | None:
    with db.tx() as t:
        row = t.one("SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?", (token_hash, now_ms()))
    return row["user_id"] if row else None


def delete_session(token_hash: str) -> None:
    with db.tx() as t:
        t.run("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))


# ---------- Danh sách việc ----------
def _task_out(row: dict) -> dict:
    if row["deleted"]:
        return {"id": row["id"], "updatedAt": row["updated_at"], "deleted": True}
    return {field: (bool(row[col]) if col in BOOL_COLS else row[col]) for col, field in TASK_FIELDS}


_TASK_COLS = [c for c, _ in TASK_FIELDS]
_UPSERT_TASK = (
    f"INSERT INTO tasks (user_id, {', '.join(_TASK_COLS)}) VALUES (?, {', '.join('?' for _ in _TASK_COLS)}) "
    f"ON CONFLICT (user_id, id) DO UPDATE SET {', '.join(f'{c} = excluded.{c}' for c in _TASK_COLS if c != 'id')} "
    "WHERE tasks.updated_at < excluded.updated_at"  # chỉ nhận bản mới hơn → không ghi đè thay đổi mới hơn
)


def merge_tasks(uid: str, incoming: list[dict]) -> list[dict] | None:
    """Gộp các việc thiết bị gửi lên (mỗi việc 1 dòng, bản có updatedAt mới hơn thắng).
    Trả về toàn bộ danh sách sau khi gộp (kể cả dấu xoá), hoặc None nếu vượt giới hạn số việc."""
    with db.tx() as t:
        if incoming:
            have = {r["id"] for r in t.all("SELECT id FROM tasks WHERE user_id = ?", (uid,))}
            if len(have | {x["id"] for x in incoming}) > MAX_TASKS_PER_USER:
                return None
        rows = []
        for x in incoming:
            if x["deleted"]:  # việc đã xoá chỉ giữ dấu xoá, bỏ nội dung
                x = {"id": x["id"], "updatedAt": x["updatedAt"], "deleted": True}
            rows.append((uid, *[x.get(f, _default(c)) for c, f in TASK_FIELDS]))
        t.many(_UPSERT_TASK, rows)
        t.run("DELETE FROM tasks WHERE user_id = ? AND deleted = ? AND updated_at < ?",
              (uid, True, now_ms() - TOMBSTONE_TTL_MS))
        return [_task_out(r) for r in t.all("SELECT * FROM tasks WHERE user_id = ?", (uid,))]


def _default(col: str):
    return {"title": "", "note": "", "duration_min": 0, "remind_before": -1, "priority": "medium",
            "created_at": 0}.get(col, False if col in BOOL_COLS else None)


# ---------- Thiết bị nhận thông báo đẩy ----------
def upsert_device(device_id: str, uid: str, subscription: dict) -> None:
    keys = subscription["keys"]
    with db.tx() as t:
        t.run(
            "INSERT INTO devices (id, user_id, endpoint, p256dh, auth, updated_at) VALUES (?, ?, ?, ?, ?, ?) "
            "ON CONFLICT (id) DO UPDATE SET user_id = excluded.user_id, endpoint = excluded.endpoint, "
            "p256dh = excluded.p256dh, auth = excluded.auth, updated_at = excluded.updated_at",
            (device_id, uid, subscription["endpoint"], keys["p256dh"], keys["auth"], now_ms()),
        )


def remove_device(device_id: str, uid: str | None = None) -> None:
    """Xoá thiết bị; nếu truyền uid thì chỉ xoá khi thiết bị thuộc người đó."""
    with db.tx() as t:
        if uid is None:
            t.run("DELETE FROM devices WHERE id = ?", (device_id,))
        else:
            t.run("DELETE FROM devices WHERE id = ? AND user_id = ?", (device_id, uid))


def user_devices(uid: str) -> list[tuple[str, dict]]:
    with db.tx() as t:
        rows = t.all("SELECT id, endpoint, p256dh, auth FROM devices WHERE user_id = ?", (uid,))
    return [(r["id"], {"endpoint": r["endpoint"], "keys": {"p256dh": r["p256dh"], "auth": r["auth"]}}) for r in rows]


# ---------- Lịch nhắc (theo người dùng, gửi tới mọi thiết bị của người đó) ----------
def set_reminders(uid: str, reminders: list[dict]) -> None:
    """Thay toàn bộ lịch nhắc sắp tới của tài khoản."""
    with db.tx() as t:
        t.run("DELETE FROM reminders WHERE user_id = ?", (uid,))
        t.many(
            "INSERT INTO reminders (user_id, key, at, title, body, task_id, kind) VALUES (?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT (user_id, key) DO NOTHING",
            [(uid, r["key"], r["at"], r["title"], r["body"], r.get("taskId"), r.get("kind")) for r in reminders],
        )


def take_due(now: int, stale_ms: int, sent_ttl_ms: int) -> list[tuple[str, dict]]:
    """Lấy ra (và xoá) các lời nhắc đã tới giờ trong 1 lệnh nguyên khối → 2 tiến trình không gửi trùng.
    Bỏ qua mốc trễ quá `stale_ms` hoặc đã gửi đúng mốc đó. Trả về danh sách (uid, reminder) cần gửi."""
    out = []
    with db.tx() as t:
        due = t.all("DELETE FROM reminders WHERE at <= ? RETURNING user_id, key, at, title, body, task_id, kind", (now,))
        for r in due:
            if now - r["at"] > stale_ms:
                continue
            # Ghi nhận "đã gửi"; nếu đã gửi đúng mốc này rồi thì RETURNING rỗng → bỏ qua
            fresh = t.one(
                "INSERT INTO sent_reminders (user_id, key, at) VALUES (?, ?, ?) "
                "ON CONFLICT (user_id, key) DO UPDATE SET at = excluded.at WHERE sent_reminders.at <> excluded.at "
                "RETURNING key",
                (r["user_id"], r["key"], r["at"]),
            )
            if fresh:
                out.append((r["user_id"], {"key": r["key"], "at": r["at"], "title": r["title"], "body": r["body"],
                                           "taskId": r["task_id"], "kind": r["kind"]}))
        t.run("DELETE FROM sent_reminders WHERE at < ?", (now - sent_ttl_ms,))
    return out


# ---------- Chuyển dữ liệu từ bản cũ (1 khối JSON) sang các bảng ----------
def _load_old_blob() -> dict | None:
    """Khối JSON của bản cũ: dòng app_state trong Postgres, hoặc file data/db.json khi chạy trên máy."""
    if db.IS_PG:
        with db.tx() as t:
            if not t.one("SELECT to_regclass('app_state') AS r")["r"]:
                return None
            row = t.one("SELECT data FROM app_state WHERE id = 1")
        return row["data"] if row else None
    path = DATA_DIR / "db.json"
    if not path.exists():
        return None
    import json
    return json.loads(path.read_text("utf-8"))


def _migrate_old_blob() -> None:
    """Chạy 1 lần. Khối cũ được giữ nguyên (không xoá) để có thể quay lại bản cũ nếu cần."""
    with db.tx() as t:
        if t.one("SELECT value FROM meta WHERE key = 'blob_migrated'"):
            return
    blob = _load_old_blob() or {}
    users = blob.get("users", {})
    with db.tx() as t:
        if db.IS_PG:  # khoá: 2 server khởi động cùng lúc thì chỉ 1 server chuyển dữ liệu
            t.one("SELECT pg_advisory_xact_lock(724002) AS x")
        if t.one("SELECT value FROM meta WHERE key = 'blob_migrated'"):  # tiến trình khác vừa chuyển xong
            return
        t.many("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING",
               [(k, v) for k, v in blob.get("meta", {}).items() if isinstance(v, str)])
        t.many("INSERT INTO users (id, email, pw_hash, name, note, avatar, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) "
               "ON CONFLICT DO NOTHING",
               [(uid, u["email"], u["pw"], u.get("name", ""), u.get("note", ""), u.get("avatar", ""),
                 u.get("created_at", 0)) for uid, u in users.items()])
        t.many("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
               [(h, s["uid"], s["exp"]) for h, s in blob.get("sessions", {}).items() if s.get("uid") in users])
        task_rows = []
        for uid, tasks in blob.get("tasks", {}).items():
            if uid not in users:
                continue
            for x in tasks.values():
                if x.get("deleted"):
                    x = {"id": x["id"], "updatedAt": x["updatedAt"], "deleted": True}
                task_rows.append((uid, *[x.get(f, _default(c)) for c, f in TASK_FIELDS]))
        t.many(_UPSERT_TASK, task_rows)
        # Thiết bị kiểu rất cũ (chưa gắn tài khoản) thì bỏ: app tự đăng ký lại sau khi đăng nhập
        t.many("INSERT INTO devices (id, user_id, endpoint, p256dh, auth, updated_at) VALUES (?, ?, ?, ?, ?, ?) "
               "ON CONFLICT DO NOTHING",
               [(did, d["uid"], d["subscription"]["endpoint"], d["subscription"]["keys"]["p256dh"],
                 d["subscription"]["keys"]["auth"], d.get("updated_at", 0))
                for did, d in blob.get("devices", {}).items() if d.get("uid") in users])
        t.many("INSERT INTO reminders (user_id, key, at, title, body, task_id, kind) VALUES (?, ?, ?, ?, ?, ?, ?) "
               "ON CONFLICT DO NOTHING",
               [(uid, r["key"], r["at"], r.get("title", "Nhắc việc"), r.get("body", ""), r.get("taskId"), r.get("kind"))
                for uid, u in users.items() for r in u.get("reminders", [])])
        t.many("INSERT INTO sent_reminders (user_id, key, at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
               [(uid, k, at) for uid, u in users.items() for k, at in u.get("sent", {}).items()])
        t.run("INSERT INTO meta (key, value) VALUES ('blob_migrated', ?) ON CONFLICT (key) DO NOTHING", (str(now_ms()),))
    if users:
        import logging
        logging.getLogger("store").info("Đã chuyển dữ liệu cũ sang bảng: %d tài khoản, %d việc", len(users), len(task_rows))


_migrate_old_blob()
