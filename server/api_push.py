"""API thông báo đẩy: đăng ký thiết bị, nhận lịch nhắc, gửi thử. Tất cả gắn với tài khoản đang đăng nhập."""
import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from . import push, store
from .auth import current_user

router = APIRouter(prefix="/api/push")

# device_id: chuỗi ngẫu nhiên app tự sinh cho mỗi trình duyệt/thiết bị
DEVICE_ID = Field(pattern=r"^[A-Za-z0-9-]{16,64}$")


class SubscriptionKeys(BaseModel):
    p256dh: str = Field(max_length=200)
    auth: str = Field(max_length=100)


class Subscription(BaseModel):
    endpoint: str = Field(max_length=1000)
    keys: SubscriptionKeys

    @field_validator("endpoint")
    @classmethod
    def must_be_https(cls, v: str) -> str:
        if not v.startswith("https://"):
            raise ValueError("endpoint phải là https")
        return v


class SubscribeIn(BaseModel):
    deviceId: str = DEVICE_ID
    subscription: Subscription


class DeviceIn(BaseModel):
    deviceId: str = DEVICE_ID


class ReminderIn(BaseModel):
    key: str = Field(max_length=100)
    at: int                               # mốc nhắc, mili giây từ 1970 (Date.now() phía app)
    title: str = Field(default="Nhắc việc", max_length=200)
    body: str = Field(default="", max_length=300)
    taskId: str | None = Field(default=None, max_length=64)   # để nút trên thông báo biết thao tác việc nào
    kind: str | None = Field(default=None, max_length=10)     # before | start | due | late → chọn bộ nút


class RemindersIn(BaseModel):
    reminders: list[ReminderIn] = Field(max_length=1000)


async def send_to_user(uid: str, payload: dict) -> int:
    """Gửi tới mọi thiết bị của người dùng. Trả về số thiết bị gửi thành công."""
    ok = 0
    for device_id, subscription in store.user_devices(uid):
        result = await asyncio.to_thread(push.send, subscription, payload)
        if result == "gone":
            store.remove_device(device_id)
        ok += result == "ok"
    return ok


@router.get("/public-key")
def public_key():
    return {"publicKey": push.PUBLIC_KEY}


@router.post("/subscribe")
def subscribe(body: SubscribeIn, uid: str = Depends(current_user)):
    store.upsert_device(body.deviceId, uid, body.subscription.model_dump())
    return {"ok": True}


@router.delete("/subscribe")
def unsubscribe(body: DeviceIn, uid: str = Depends(current_user)):
    store.remove_device(body.deviceId, uid)
    return {"ok": True}


@router.put("/reminders")
def set_reminders(body: RemindersIn, uid: str = Depends(current_user)):
    """App gửi TOÀN BỘ lịch nhắc sắp tới của tài khoản; server thay thế lịch cũ."""
    store.set_reminders(uid, [r.model_dump() for r in body.reminders])
    return {"ok": True, "count": len(body.reminders)}
