"""API trang cá nhân: xem/sửa tên, ghi chú, ảnh đại diện; đổi email; đổi mật khẩu."""
import re
from pathlib import Path

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from . import store
from .auth import EMAIL_RE, MIN_PASSWORD, _hit, _too_many, current_user, hash_password, token_hash, verify_password

router = APIRouter(prefix="/api/me")

# Thư mục ảnh đại diện tự thêm: bỏ file ảnh vào public/avatars/ là tự hiện trong bảng chọn
AVATAR_DIR = Path(__file__).resolve().parent.parent / "public" / "avatars"
AVATAR_EXT = {".png", ".jpg", ".jpeg", ".webp", ".svg"}


def local_avatars() -> list[str]:
    if not AVATAR_DIR.is_dir():
        return []
    return [f"/avatars/{p.name}" for p in sorted(AVATAR_DIR.iterdir())
            if p.suffix.lower() in AVATAR_EXT and AVATAR_RE.match(f"/avatars/{p.name}")]

# Ảnh đại diện chỉ nhận ảnh icon công khai (danh sách chọn sẵn ở app), không nhận link tuỳ ý:
# nhân vật 3D Microsoft Fluent Emoji (giấy phép MIT, qua jsDelivr); Simple Icons / DiceBear giữ lại
# để ảnh đã chọn ở bản trước vẫn hợp lệ
AVATAR_RE = re.compile(
    r"^(/avatars/[A-Za-z0-9._-]{1,80}\.(png|jpg|jpeg|webp|svg)"   # ảnh bạn tự bỏ vào public/avatars/
    r"|https://cdn\.jsdelivr\.net/gh/microsoft/fluentui-emoji@main/assets/[A-Za-z0-9%]{1,40}(/[A-Za-z-]{1,15})?/3D/[a-z0-9_]{1,40}\.png"
    r"|https://cdn\.simpleicons\.org/[a-z0-9]{1,30}"
    r"|https://api\.dicebear\.com/9\.x/[a-z-]{2,30}/svg\?seed=[A-Za-z0-9]{1,30})$"
)


class ProfileIn(BaseModel):
    name: str | None = Field(default=None, max_length=60)
    note: str | None = Field(default=None, max_length=500)
    avatar: str | None = Field(default=None, max_length=200)   # "" = bỏ ảnh, dùng chữ cái đầu


class EmailIn(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=200)


class PasswordIn(BaseModel):
    currentPassword: str = Field(max_length=200)
    newPassword: str = Field(max_length=200)


def _check_password(uid: str, password: str) -> None:
    """Xác nhận mật khẩu hiện tại; sai nhiều lần thì tạm khoá như khi đăng nhập."""
    key = "confirm-pw:" + uid
    if _too_many(key, 10):
        raise HTTPException(429, "Sai quá nhiều lần, vui lòng chờ 15 phút")
    if not verify_password(password, store.password_hash(uid) or ""):
        _hit(key)
        raise HTTPException(400, "Mật khẩu hiện tại không đúng")


@router.get("/avatars")
def list_avatars():
    """Danh sách ảnh đại diện có sẵn trong public/avatars/ (app ghép thêm bộ nhân vật 3D)."""
    return {"avatars": local_avatars()}


@router.get("")
def get_me(uid: str = Depends(current_user)):
    return store.get_profile(uid)


@router.patch("")
def update_me(body: ProfileIn, uid: str = Depends(current_user)):
    fields = {k: v.strip() for k, v in body.model_dump(exclude_none=True).items()}
    av = fields.get("avatar")
    if av and (not AVATAR_RE.match(av) or (av.startswith("/avatars/") and av not in local_avatars())):
        raise HTTPException(400, "Ảnh đại diện không hợp lệ")
    store.update_profile(uid, fields)
    return store.get_profile(uid)


# `def` thường để FastAPI chạy trong thread riêng (băm mật khẩu tốn CPU)
@router.post("/email")
def change_email(body: EmailIn, uid: str = Depends(current_user)):
    email = body.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(400, "Email không hợp lệ")
    _check_password(uid, body.password)
    if not store.change_email(uid, email):
        raise HTTPException(409, "Email này đã thuộc tài khoản khác")
    return store.get_profile(uid)


@router.post("/password")
def change_password(body: PasswordIn, uid: str = Depends(current_user), authorization: str = Header()):
    if len(body.newPassword) < MIN_PASSWORD:
        raise HTTPException(400, f"Mật khẩu mới cần ít nhất {MIN_PASSWORD} ký tự")
    _check_password(uid, body.currentPassword)
    store.set_password(uid, hash_password(body.newPassword), token_hash(authorization[7:].strip()))
    return {"ok": True}
