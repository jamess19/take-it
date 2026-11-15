"""Gửi thông báo đẩy theo chuẩn Web Push.

Voluntary Application Server Identification (VAPID) là cặp khoá để server tự định danh với dịch vụ đẩy
của Apple/Google/Mozilla. Lấy từ biến môi trường, nếu không có thì tự sinh một lần và lưu vào data/.
"""
import base64
import json
import logging
import os

from cryptography.hazmat.primitives import serialization
from py_vapid import Vapid02
from pywebpush import WebPushException, webpush

from . import store

log = logging.getLogger("push")

PRIVATE_PEM = store.DATA_DIR / "vapid_private.pem"
# Dịch vụ đẩy yêu cầu địa chỉ liên hệ của chủ server; đặt qua biến môi trường VAPID_SUBJECT
SUBJECT = os.environ.get("VAPID_SUBJECT", "mailto:admin@example.com")


def _b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _load_vapid() -> Vapid02:
    """Thứ tự tìm khoá: biến môi trường → file data/vapid_private.pem (bản cũ) → kho lưu trữ → sinh mới.
    Khoá sinh mới được cất vào kho lưu trữ (Postgres khi deploy), nên không mất khi server khởi động lại."""
    env_key = os.environ.get("VAPID_PRIVATE_KEY_PEM")
    if env_key:
        return Vapid02.from_pem(env_key.replace("\\n", "\n").encode())
    if PRIVATE_PEM.exists():
        return Vapid02.from_file(str(PRIVATE_PEM))
    stored = store.get_meta("vapid_private_pem")
    if stored:
        return Vapid02.from_pem(stored.encode())
    vapid = Vapid02()
    vapid.generate_keys()
    pem = vapid.private_key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ).decode()
    # Nhiều tiến trình cùng khởi động: chỉ khoá ghi đầu tiên được giữ, các tiến trình khác dùng chung khoá đó
    saved = store.set_meta_if_absent("vapid_private_pem", pem)
    if saved == pem:
        log.info("Đã sinh khoá VAPID mới và lưu vào cơ sở dữ liệu")
    return Vapid02.from_pem(saved.encode())


_vapid = _load_vapid()

# Khoá công khai dạng base64url (điểm EC không nén) để trình duyệt dùng khi đăng ký nhận đẩy
PUBLIC_KEY = _b64url(
    _vapid.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
)


def send(subscription: dict, payload: dict) -> str:
    """Gửi 1 thông báo (hàm chặn, gọi qua thread). Trả về "ok" | "gone" (subscription hết hiệu lực) | "error"."""
    try:
        webpush(
            subscription_info=subscription,
            data=json.dumps(payload, ensure_ascii=False),
            vapid_private_key=_vapid,
            vapid_claims={"sub": SUBJECT},
            ttl=3600,
            headers={"Urgency": "high"},
            timeout=10,
        )
        return "ok"
    except WebPushException as err:
        status = err.response.status_code if err.response is not None else None
        if status in (404, 410):
            return "gone"
        log.error("Gửi thông báo lỗi: %s %s", status, err)
        return "error"
    except Exception as err:  # lỗi mạng...
        log.error("Gửi thông báo lỗi: %s", err)
        return "error"
