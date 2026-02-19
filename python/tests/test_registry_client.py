import httpx
import pytest
import respx

from asakin_tiny.errors import AppNotFoundError, IntegrationNetworkError
from asakin_tiny.models import AppInfo, AppStatus
from asakin_tiny.registry_client import RegistryClient

REGISTRY_URL = "https://registry.example.com"


class TestRegistryClient:
    def setup_method(self):
        self.client = RegistryClient(registry_url=REGISTRY_URL, timeout_seconds=5)

    @respx.mock
    def test_successful_response_parsed(self):
        payload = {
            "code": "BILLING",
            "name": "Billing Service",
            "base_url": "https://billing.example.com",
            "status": "ACTIVE",
            "description": "Handles billing",
        }
        respx.get(f"{REGISTRY_URL}/api/registry/apps/BILLING").mock(
            return_value=httpx.Response(200, json=payload)
        )
        info = self.client.get_app_info("BILLING")
        assert isinstance(info, AppInfo)
        assert info.code == "BILLING"
        assert info.base_url == "https://billing.example.com"
        assert info.status == AppStatus.ACTIVE
        assert info.description == "Handles billing"

    @respx.mock
    def test_404_raises_app_not_found(self):
        respx.get(f"{REGISTRY_URL}/api/registry/apps/UNKNOWN").mock(
            return_value=httpx.Response(404)
        )
        with pytest.raises(AppNotFoundError, match="UNKNOWN"):
            self.client.get_app_info("UNKNOWN")

    @respx.mock
    def test_network_error_raises_integration_network_error(self):
        respx.get(f"{REGISTRY_URL}/api/registry/apps/BILLING").mock(
            side_effect=httpx.ConnectError("connection refused")
        )
        with pytest.raises(IntegrationNetworkError, match="Network error"):
            self.client.get_app_info("BILLING")

    @respx.mock
    def test_registry_500_raises_integration_network_error(self):
        respx.get(f"{REGISTRY_URL}/api/registry/apps/BILLING").mock(
            return_value=httpx.Response(500, text="Internal Server Error")
        )
        with pytest.raises(IntegrationNetworkError, match="Registry error 500"):
            self.client.get_app_info("BILLING")

    @respx.mock
    def test_registry_429_raises_integration_network_error(self):
        respx.get(f"{REGISTRY_URL}/api/registry/apps/BILLING").mock(
            return_value=httpx.Response(429, text="Too Many Requests")
        )
        with pytest.raises(IntegrationNetworkError, match="Registry error 429"):
            self.client.get_app_info("BILLING")
