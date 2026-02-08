import httpx

from .errors import AppNotFoundError, IntegrationNetworkError
from .models import AppInfo


class RegistryClient:
    def __init__(self, registry_url: str, timeout_seconds: int) -> None:
        self._registry_url = registry_url.rstrip("/")
        self._timeout_seconds = timeout_seconds

    def get_app_info(self, code: str) -> AppInfo:
        url = f"{self._registry_url}/api/registry/apps/{code}"
        try:
            response = httpx.get(url, timeout=self._timeout_seconds)
        except httpx.TransportError as exc:
            raise IntegrationNetworkError(
                f"Network error while contacting registry for app '{code}': {exc}"
            ) from exc

        if response.status_code == 404:
            raise AppNotFoundError(
                f"App '{code}' not found in the Asakin Registry."
            )

        response.raise_for_status()
        return AppInfo.model_validate(response.json())
