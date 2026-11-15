"""Đăng ký / đăng nhập bằng email + mật khẩu.

- Mật khẩu băm bằng scrypt (thư viện chuẩn của Python), mỗi tài khoản một muối (salt) ngẫu nhiên.
- Đăng nhập thành công → cấp token ngẫu nhiên; app gửi lại qua header `Authorization: Bearer <token>`.
  Server chỉ lưu mã băm SHA-256 của token, lộ dữ liệu cũng không dùng được token.
- Giới hạn số lần đăng nhập sai để chống dò mật khẩu.
"""
import hashlib
import hmac
import os
import re
import secrets
import threading
import time

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, Field

from . import store

router = APIRouter(prefix="/api/auth")

SESSION_DAYS = 180
MIN_PASSWORD = 8
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
SCRYPT = {"n": 2**14, "r": 8, "p": 1, "dklen": 32}


# ---------- Mật khẩu ----------
def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.scrypt(password.encode(), salt=salt, **SCRYPT)
    return f"scrypt${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, salt_hex, dk_hex = stored.split("$")
        dk = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt_hex), **SCRYPT)
        return hmac.compare_digest(dk.hex(), dk_hex)
    except ValueError:
        return False


# Băm sẵn 1 lần để email không tồn tại vẫn tốn thời gian như thật (không lộ email nào đã đăng ký)
_DUMMY_HASH = hash_password(secrets.token_hex(8))


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# ---------- Giới hạn số lần thử ----------
_attempts: dict[str, list[float]] = {}
_attempts_lock = threading.Lock()
WINDOW_S = 15 * 60


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    return forwarded.split(",")[0].strip() or (request.client.host if request.client else "?")


def _too_many(key: str, limit: int) -> bool:
    now = time.time()
    with _attempts_lock:
        hits = [t for t in _attempts.get(key, []) if now - t < WINDOW_S]
        _attempts[key] = hits
        return len(hits) >= limit


def _hit(key: str) -> None:
    with _attempts_lock:
        _attempts.setdefault(key, []).append(time.time())


# ---------- Phụ thuộc dùng cho các API cần đăng nhập ----------
def current_user(authorization: str | None = Header(default=None)) -> str:
    """Trả về uid của người đang đăng nhập, hoặc báo 401."""
    if authorization and authorization.startswith("Bearer "):
        uid = store.session_user(token_hash(authorization[7:].strip()))
        if uid:
            return uid
    raise HTTPException(401, "Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại")


def _new_session(uid: str, email: str) -> dict:
    token = secrets.token_urlsafe(32)
    store.create_session(token_hash(token), uid, store.now_ms() + SESSION_DAYS * 24 * 3600 * 1000)
    return {"token": token, "email": email}


# ---------- API ----------
class Credentials(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=200)


# Dùng `def` thường (không async) để FastAPI chạy trong thread riêng, vì scrypt tốn CPU
@router.post("/register")
def register(body: Credentials, request: Request):
    email = body.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "Email không hợp lệ")
    if len(body.password) < MIN_PASSWORD:
        raise HTTPException(400, f"Mật khẩu cần ít nhất {MIN_PASSWORD} ký tự")
    ip_key = "register:" + _client_ip(request)
    if _too_many(ip_key, 10):
        raise HTTPException(429, "Thử quá nhiều lần, vui lòng chờ 15 phút")
    _hit(ip_key)
    uid = store.create_user(email, hash_password(body.password))
    if not uid:
        raise HTTPException(409, "Email này đã có tài khoản, hãy đăng nhập")
    return _new_session(uid, email)


@router.post("/login")
def login(body: Credentials, request: Request):
    email = body.email.strip().lower()
    keys = ("login-email:" + email, "login-ip:" + _client_ip(request))
    if _too_many(keys[0], 10) or _too_many(keys[1], 30):
        raise HTTPException(429, "Sai quá nhiều lần, vui lòng chờ 15 phút")
    found = store.find_user(email)
    ok = verify_password(body.password, found[1]["pw"] if found else _DUMMY_HASH)
    if not found or not ok:
        for k in keys:
            _hit(k)
        raise HTTPException(401, "Email hoặc mật khẩu không đúng")
    return _new_session(found[0], email)


@router.post("/logout")
def logout(authorization: str | None = Header(default=None)):
    if authorization and authorization.startswith("Bearer "):
        store.delete_session(token_hash(authorization[7:].strip()))
    return {"ok": True}
