"""API đồng bộ danh sách việc giữa các thiết bị của cùng một tài khoản."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from . import store
from .auth import current_user

router = APIRouter(prefix="/api/tasks")


class TaskIn(BaseModel):
    """Một việc như app lưu. Trường lạ bị bỏ qua; các trường có giới hạn độ dài để chống dữ liệu rác."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    updatedAt: int                       # mili giây; bản có updatedAt lớn hơn thắng khi gộp
    deleted: bool = False
    title: str = Field(default="", max_length=200)
    note: str = Field(default="", max_length=2000)
    start: str | None = Field(default=None, max_length=25)
    duration: int = 0
    due: str | None = Field(default=None, max_length=25)
    remindBefore: int = -1
    priority: Literal["low", "medium", "high"] = "medium"
    done: bool = False
    createdAt: int = 0
    completedAt: int | None = None
    snoozeUntil: int | None = None
    snoozeKind: str | None = Field(default=None, max_length=10)   # loại nhắc sẽ lặp lại khi hết báo lại
    startedAt: int | None = None                                  # lúc bấm "Bắt đầu" (đang xử lý)
    notifiedBefore: bool = False
    notifiedStart: bool = False
    notifiedDue: bool = False


class NoteIn(BaseModel):
    """Một ghi chú thực hiện (có tên) gắn với một việc."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")
    updatedAt: int
    deleted: bool = False
    taskId: str = Field(default="", pattern=r"^[A-Za-z0-9_-]{0,64}$")
    title: str = Field(default="", max_length=200)
    body: str = Field(default="", max_length=50000)
    createdAt: int = 0


class SyncIn(BaseModel):
    tasks: list[TaskIn] = Field(default_factory=list, max_length=2000)
    # Thiết bị bản cũ không gửi notes → danh sách rỗng, ghi chú trên server giữ nguyên
    notes: list[NoteIn] = Field(default_factory=list, max_length=2000)


@router.post("/sync")
def sync(body: SyncIn, uid: str = Depends(current_user)):
    """Thiết bị gửi các việc / ghi chú đã thay đổi, nhận lại toàn bộ danh sách sau khi gộp."""
    merged = store.merge_tasks(uid, [t.model_dump() for t in body.tasks], [n.model_dump() for n in body.notes])
    if merged is None:
        raise HTTPException(413, f"Vượt quá {store.MAX_TASKS_PER_USER} việc hoặc {store.MAX_NOTES_PER_USER} ghi chú")
    return {**merged, "email": store.user_email(uid)}
