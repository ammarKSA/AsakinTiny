from enum import Enum
from typing import Optional

from pydantic import BaseModel


class AppStatus(str, Enum):
    ACTIVE = "ACTIVE"
    INACTIVE = "INACTIVE"


class AppInfo(BaseModel):
    code: str
    name: str
    base_url: str
    status: AppStatus
    description: Optional[str] = None
