"""Kết nối cơ sở dữ liệu quan hệ: Postgres (khi có DATABASE_URL, dùng khi deploy) hoặc SQLite (chạy trên máy).

Câu SQL viết một lần, dùng dấu `?` làm chỗ giữ tham số; với Postgres tự đổi sang `%s`.
Không dùng cú pháp riêng của từng loại: chỉ TEXT / BIGINT / INTEGER / BOOLEAN, ON CONFLICT, RETURNING
(SQLite >= 3.35 và Postgres đều hỗ trợ).
"""
import logging
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

log = logging.getLogger("db")

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
IS_PG = bool(DATABASE_URL)
SQLITE_PATH = DATA_DIR / "app.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    email      TEXT NOT NULL UNIQUE,
    pw_hash    TEXT NOT NULL,
    name       TEXT NOT NULL DEFAULT '',
    note       TEXT NOT NULL DEFAULT '',
    avatar     TEXT NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS tasks (
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id              TEXT NOT NULL,
    title           TEXT NOT NULL DEFAULT '',
    note            TEXT NOT NULL DEFAULT '',
    start_at        TEXT,
    duration_min    INTEGER NOT NULL DEFAULT 0,
    due_at          TEXT,
    remind_before   INTEGER NOT NULL DEFAULT -1,
    priority        TEXT NOT NULL DEFAULT 'medium',
    done            BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      BIGINT NOT NULL DEFAULT 0,
    completed_at    BIGINT,
    started_at      BIGINT,
    snooze_until    BIGINT,
    snooze_kind     TEXT,
    notified_before BOOLEAN NOT NULL DEFAULT FALSE,
    notified_start  BOOLEAN NOT NULL DEFAULT FALSE,
    notified_due    BOOLEAN NOT NULL DEFAULT FALSE,
    deleted         BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at      BIGINT NOT NULL,
    PRIMARY KEY (user_id, id)
);
-- Ghi chú thực hiện: mỗi việc có thể có nhiều ghi chú có tên (task_id trỏ tới tasks.id của cùng người dùng).
-- Không ràng buộc khoá ngoại với tasks: việc bị xoá thì ghi chú vẫn giữ (là bài viết của người dùng).
CREATE TABLE IF NOT EXISTS notes (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id         TEXT NOT NULL,
    task_id    TEXT NOT NULL DEFAULT '',
    title      TEXT NOT NULL DEFAULT '',
    body       TEXT NOT NULL DEFAULT '',
    created_at BIGINT NOT NULL DEFAULT 0,
    deleted    BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at BIGINT NOT NULL,
    PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_notes_task ON notes(user_id, task_id);
CREATE TABLE IF NOT EXISTS devices (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint   TEXT NOT NULL,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
CREATE TABLE IF NOT EXISTS reminders (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key     TEXT NOT NULL,
    at      BIGINT NOT NULL,
    title   TEXT NOT NULL,
    body    TEXT NOT NULL DEFAULT '',
    task_id TEXT,
    kind    TEXT,
    PRIMARY KEY (user_id, key)
);
CREATE INDEX IF NOT EXISTS idx_reminders_at ON reminders(at);
CREATE TABLE IF NOT EXISTS sent_reminders (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key     TEXT NOT NULL,
    at      BIGINT NOT NULL,
    PRIMARY KEY (user_id, key)
);
"""


class Tx:
    """Một giao dịch: mọi câu lệnh bên trong cùng thành công hoặc cùng huỷ."""

    def __init__(self, cur):
        self.cur = cur

    def _sql(self, sql: str) -> str:
        return sql.replace("?", "%s") if IS_PG else sql

    def run(self, sql: str, params=()) -> int:
        self.cur.execute(self._sql(sql), params)
        return self.cur.rowcount

    def many(self, sql: str, rows) -> None:
        rows = list(rows)
        if rows:
            self.cur.executemany(self._sql(sql), rows)

    def all(self, sql: str, params=()) -> list[dict]:
        self.cur.execute(self._sql(sql), params)
        return [dict(r) for r in self.cur.fetchall()]

    def one(self, sql: str, params=()) -> dict | None:
        rows = self.all(sql, params)
        return rows[0] if rows else None


if IS_PG:
    from psycopg.rows import dict_row
    from psycopg_pool import ConnectionPool

    # prepare_threshold=None: không dùng prepared statement → an toàn với connection pooler của Neon.
    # check: kiểm tra kết nối trước khi dùng vì Neon gói free tự đóng kết nối rảnh.
    _pool = ConnectionPool(
        DATABASE_URL, min_size=1, max_size=5, max_idle=120, open=True,
        kwargs={"prepare_threshold": None, "connect_timeout": 10},
        check=ConnectionPool.check_connection,
    )

    import atexit
    atexit.register(_pool.close)  # đóng gọn kết nối khi tiến trình thoát

    @contextmanager
    def tx():
        with _pool.connection() as conn:
            with conn.transaction():
                yield Tx(conn.cursor(row_factory=dict_row))

    def _init_schema():
        # Nhiều server khởi động cùng lúc (vd lúc deploy): khoá để chỉ 1 tiến trình tạo bảng tại một thời điểm
        with _pool.connection() as conn:
            with conn.transaction():
                conn.execute("SELECT pg_advisory_xact_lock(724001)")
                conn.execute(SCHEMA)

    UNIQUE_ERRORS: tuple = (__import__("psycopg").errors.UniqueViolation,)
else:
    def _connect():
        conn = sqlite3.connect(SQLITE_PATH, timeout=15, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA busy_timeout = 15000")
        return conn

    @contextmanager
    def tx():
        conn = _connect()
        try:
            conn.execute("BEGIN IMMEDIATE")  # khoá ghi ngay từ đầu → nhiều tiến trình không đè nhau
            yield Tx(conn.cursor())
            conn.execute("COMMIT")
        except BaseException:
            conn.execute("ROLLBACK")
            raise
        finally:
            conn.close()

    def _init_schema():
        conn = _connect()
        try:
            conn.execute("PRAGMA journal_mode = WAL")  # cho phép đọc trong lúc đang ghi
            conn.executescript(SCHEMA)
        finally:
            conn.close()

    UNIQUE_ERRORS = (sqlite3.IntegrityError,)


_init_schema()
log.info("Cơ sở dữ liệu: %s", "Postgres" if IS_PG else SQLITE_PATH)
