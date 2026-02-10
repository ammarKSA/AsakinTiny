import os
import re
from dataclasses import dataclass

from .errors import IntegrationError

_APP_CODE_PATTERN = re.compile(r"^[A-Z0-9_]{3,40}$")


@dataclass(frozen=True)
class TinyConfig:
    app_code: str
    registry_url: str
    cache_ttl_seconds: int
    default_timeout_seconds: int


def load_config(
    app_code: str | None = None,
    registry_url: str | None = None,
    cache_ttl_seconds: int | None = None,
    default_timeout_seconds: int | None = None,
) -> TinyConfig:
    app_code = app_code or os.environ.get("ASAKIN_APP_CODE")
    registry_url = registry_url or os.environ.get("ASAKIN_REGISTRY_URL")

    if cache_ttl_seconds is None:
        cache_ttl_seconds = int(
            os.environ.get("ASAKIN_TINY_CACHE_TTL_SECONDS", "60")
        )
    if default_timeout_seconds is None:
        default_timeout_seconds = int(
            os.environ.get("ASAKIN_TINY_DEFAULT_TIMEOUT_SECONDS", "10")
        )

    if not app_code:
        raise IntegrationError(
            "ASAKIN_APP_CODE is required. Set it as an environment variable "
            "or pass it to IntegrationClient(app_code=...)."
        )

    if not _APP_CODE_PATTERN.match(app_code):
        raise IntegrationError(
            f"ASAKIN_APP_CODE '{app_code}' is invalid. "
            "It must match ^[A-Z0-9_]{{3,40}}$."
        )

    if not registry_url:
        raise IntegrationError(
            "ASAKIN_REGISTRY_URL is required. Set it as an environment variable "
            "or pass it to IntegrationClient(registry_url=...)."
        )

    if not registry_url.startswith(("http://", "https://")):
        raise IntegrationError(
            f"ASAKIN_REGISTRY_URL '{registry_url}' is invalid. "
            "It must start with http:// or https://."
        )

    return TinyConfig(
        app_code=app_code,
        registry_url=registry_url,
        cache_ttl_seconds=cache_ttl_seconds,
        default_timeout_seconds=default_timeout_seconds,
    )
