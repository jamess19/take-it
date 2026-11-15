"""Server FastAPI: phục vụ giao diện app (thư mục public/), API đăng ký nhận thông báo đẩy
và bộ hẹn giờ gửi nhắc việc.

Chạy: uvicorn server.main:app --host 0.0.0.0 --port 8000
Sau này thêm API AI: tạo router mới trong server/ rồi app.include_router(...) trước dòng mount public/.
"""
import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

from . import push, store

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("server")

PUBLIC_DIR = Path(__file__).resolve().parent.parent / "public"
TICK_SECONDS = 10                       # kiểm tra lịch mỗi 10 giây
STALE_MS = 60 * 60 * 1000               # lời nhắc trễ quá 1 giờ (server tắt) thì bỏ, không gửi dồn
SENT_TTL_MS = 2 * 24 * 60 * 60 * 1000   # nhớ mốc đã gửi trong 2 ngày để chống gửi trùng

# device_id là chuỗi ngẫu nhiên do app tự sinh, đóng vai trò "mã bí mật" của thiết bị
DEVICE_ID = Field(pattern=r"^[A-Za-z0-9-]{16,64}$")


# ---------- Dữ liệu vào ----------
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


class RemindersIn(BaseModel):
    deviceId: str = DEVICE_ID
    reminders: list[ReminderIn] = Field(max_length=1000)


# ---------- Bộ hẹn giờ ----------
async def scheduler() -> None:
    while True:
        try:
            # Chạy trong thread vì có thể ghi xuống Postgres (thao tác chặn)
            due = await asyncio.to_thread(store.take_due, store.now_ms(), STALE_MS, SENT_TTL_MS)
            for device_id, subscription, r in due:
                payload = {"title": r["title"], "body": r["body"], "tag": r["key"]}
                result = await asyncio.to_thread(push.send, subscription, payload)
                if result == "gone":
                    store.remove_device(device_id)
        except Exception:
            log.exception("Lỗi bộ hẹn giờ")
        await asyncio.sleep(TICK_SECONDS)


@asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(scheduler())
    yield
    task.cancel()


app = FastAPI(title="Việc cần làm", lifespan=lifespan)


# ---------- Kiểm tra sống (Render health check + cron-job.org ping để server free không ngủ) ----------
@app.api_route("/healthz", methods=["GET", "HEAD"])
def healthz():
    return {"ok": True}


# ---------- API thông báo đẩy ----------
@app.get("/api/push/public-key")
def public_key():
    return {"publicKey": push.PUBLIC_KEY}


@app.post("/api/push/subscribe")
def subscribe(body: SubscribeIn):
    store.upsert_subscription(body.deviceId, body.subscription.model_dump())
    return {"ok": True}


@app.delete("/api/push/subscribe")
def unsubscribe(body: DeviceIn):
    store.remove_device(body.deviceId)
    return {"ok": True}


@app.put("/api/push/reminders")
def set_reminders(body: RemindersIn):
    """App gửi TOÀN BỘ lịch nhắc sắp tới; server thay thế lịch cũ. 404 → app cần đăng ký lại."""
    if not store.set_reminders(body.deviceId, [r.model_dump() for r in body.reminders]):
        raise HTTPException(404, "Thiết bị chưa đăng ký")
    return {"ok": True, "count": len(body.reminders)}


@app.post("/api/push/test")
async def test_push(body: DeviceIn):
    device = store.get_device(body.deviceId)
    if not device:
        raise HTTPException(404, "Thiết bị chưa đăng ký")
    payload = {"title": "Thử thông báo đẩy", "body": "Server gửi thông báo thành công 👍", "tag": "test"}
    result = await asyncio.to_thread(push.send, device["subscription"], payload)
    if result == "gone":
        store.remove_device(body.deviceId)
    if result != "ok":
        raise HTTPException(502, result)
    return {"result": result}


# ---------- Giao diện app (đặt cuối cùng để không che các route /api) ----------
@app.middleware("http")
async def no_cache_service_worker(request, call_next):
    response = await call_next(request)
    # sw.js không được cache để trình duyệt luôn nhận bản service worker mới
    if request.url.path.endswith("/sw.js"):
        response.headers["Cache-Control"] = "no-cache"
    return response


app.mount("/", StaticFiles(directory=PUBLIC_DIR, html=True), name="public")
