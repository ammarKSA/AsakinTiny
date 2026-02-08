from datetime import datetime, timezone
from typing import Any, Dict, Optional

import httpx

from .config import load_config
from .context import ensure_correlation_id
from .errors import AppInactiveError, IntegrationNetworkError
from .models import AppInfo, AppStatus
from .registry_client import RegistryClient


class _CacheEntry:
    __slots__ = ("app_info", "fetched_at")

    def __init__(self, app_info: AppInfo, fetched_at: datetime) -> None:
        self.app_info = app_info
        self.fetched_at = fetched_at


class IntegrationClient:
    def __init__(
        self,
        app_code: Optional[str] = None,
        registry_url: Optional[str] = None,
        cache_ttl_seconds: int = 60,
        default_timeout_seconds: int = 10,
    ) -> None:
        cfg = load_config(
            app_code=app_code,
            registry_url=registry_url,
            cache_ttl_seconds=cache_ttl_seconds,
            default_timeout_seconds=default_timeout_seconds,
        )
        self._app_code = cfg.app_code
        self._cache_ttl_seconds = cfg.cache_ttl_seconds
        self._default_timeout_seconds = cfg.default_timeout_seconds
        self._registry = RegistryClient(cfg.registry_url, cfg.default_timeout_seconds)
        self._cache: Dict[str, _CacheEntry] = {}

    def get_app(self, code: str) -> AppInfo:
        now = datetime.now(timezone.utc)
        entry = self._cache.get(code)
        if entry is not None:
            age = (now - entry.fetched_at).total_seconds()
            if age < self._cache_ttl_seconds:
                return entry.app_info

        app_info = self._registry.get_app_info(code)

        if app_info.status != AppStatus.ACTIVE:
            raise AppInactiveError(
                f"App '{code}' is registered but not active "
                f"(status={app_info.status.value})."
            )

        self._cache[code] = _CacheEntry(app_info=app_info, fetched_at=now)
        return app_info

    def call(
        self,
        target_app_code: str,
        path: str,
        method: str = "GET",
        headers: Optional[dict] = None,
        params: Optional[dict] = None,
        json: Any = None,
        data: Any = None,
        timeout_seconds: Optional[int] = None,
    ) -> httpx.Response:
        if not path.startswith("/"):
            raise ValueError(f"path must start with '/', got: '{path}'")

        app_info = self.get_app(target_app_code)
        url = app_info.base_url.rstrip("/") + path

        merged_headers = dict(headers) if headers else {}
        merged_headers["X-ASAKIN-CALLER"] = self._app_code
        merged_headers["X-CORRELATION-ID"] = ensure_correlation_id()

        timeout = timeout_seconds if timeout_seconds is not None else self._default_timeout_seconds

        try:
            response = httpx.request(
                method=method,
                url=url,
                headers=merged_headers,
                params=params,
                json=json,
                data=data,
                timeout=timeout,
            )
        except httpx.TransportError as exc:
            raise IntegrationNetworkError(
                f"Network error calling app '{target_app_code}' at {url}: {exc}"
            ) from exc

        return response
