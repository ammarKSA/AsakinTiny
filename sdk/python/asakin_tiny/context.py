import uuid
from contextvars import ContextVar
from typing import Optional

_correlation_id_var: ContextVar[Optional[str]] = ContextVar(
    "correlation_id", default=None
)


def get_correlation_id() -> Optional[str]:
    return _correlation_id_var.get()


def set_correlation_id(cid: str) -> None:
    _correlation_id_var.set(cid)


def ensure_correlation_id() -> str:
    cid = _correlation_id_var.get()
    if cid is None:
        cid = str(uuid.uuid4())
        _correlation_id_var.set(cid)
    return cid
