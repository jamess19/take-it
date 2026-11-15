"""Server FastAPI: phục vụ giao diện app (thư mục public/), API tài khoản, đồng bộ việc, thông báo đẩy
và bộ hẹn giờ gửi nhắc việc.

Chạy: uvicorn server.main:app --host 0.0.0.0 --port 8000
Sau này thêm API AI: tạo router mới trong server/ rồi app.include_router(...) trước dòng mount public/.
"""
import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from . import api_push, api_tasks, auth, store

log = logging.getLogger("server")

PUBLIC_DIR = Path(__file__).resolve().parent.parent / "public"
TICK_SECONDS = 10                       # kiểm tra lịch mỗi 10 giây
STALE_MS = 60 * 60 * 1000               # lời nhắc trễ quá 1 giờ (server tắt) thì bỏ, không gửi dồn
SENT_TTL_MS = 2 * 24 * 60 * 60 * 1000   # nhớ mốc đã gửi trong 2 ngày để chống gửi trùng


# ---------- Bộ hẹn giờ ----------
async def scheduler() -> None:
    while True:
        try:
            # Chạy trong thread vì có thể ghi xuống Postgres (thao tác chặn)
            due = await asyncio.to_thread(store.take_due, store.now_ms(), STALE_MS, SENT_TTL_MS)
            for uid, r in due:
                payload = {"title": r["title"], "body": r["body"], "tag": r["key"], "taskId": r.get("taskId"), "kind": r.get("kind")}
                await api_push.send_to_user(uid, payload)
        except Exception:
            log.exception("Lỗi bộ hẹn giờ")
        await asyncio.sleep(TICK_SECONDS)


@asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(scheduler())
    yield
    task.cancel()


app = FastAPI(title="Việc cần làm", lifespan=lifespan)


# Kiểm tra sống (Render health check + cron-job.org ping để server free không ngủ)
@app.api_route("/healthz", methods=["GET", "HEAD"])
def healthz():
    return {"ok": True}


app.include_router(auth.router)
app.include_router(api_tasks.router)
app.include_router(api_push.router)


@app.middleware("http")
async def no_cache_service_worker(request, call_next):
    response = await call_next(request)
    # sw.js không được cache để trình duyệt luôn nhận bản service worker mới
    if request.url.path.endswith("/sw.js"):
        response.headers["Cache-Control"] = "no-cache"
    return response


# Giao diện app (đặt cuối cùng để không che các route /api)
app.mount("/", StaticFiles(directory=PUBLIC_DIR, html=True), name="public")
