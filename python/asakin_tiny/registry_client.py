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

        if not (200 <= response.status_code < 300):
            body_snippet = response.text[:200] if response.text else ""
            raise IntegrationNetworkError(
                f"Registry error {response.status_code} for app_code={code} "
                f"url={url} body={body_snippet}"
            )

        return AppInfo.model_validate(response.json())
