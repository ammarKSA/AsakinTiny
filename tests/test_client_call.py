from datetime import datetime, timezone, timedelta
from unittest.mock import patch

import httpx
import pytest
import respx

from asakin_tiny.client import IntegrationClient, _CacheEntry
from asakin_tiny.context import set_correlation_id
from asakin_tiny.errors import AppInactiveError, IntegrationError, IntegrationNetworkError
from asakin_tiny.models import AppInfo, AppStatus

REGISTRY_URL = "https://registry.example.com"
APP_CODE = "CALLER_APP"
TARGET_CODE = "BILLING"
TARGET_BASE = "https://billing.example.com"

ACTIVE_PAYLOAD = {
    "code": TARGET_CODE,
    "name": "Billing Service",
    "base_url": TARGET_BASE,
    "status": "ACTIVE",
}

INACTIVE_PAYLOAD = {
    "code": TARGET_CODE,
    "name": "Billing Service",
    "base_url": TARGET_BASE,
    "status": "INACTIVE",
}


def _make_client(**kwargs) -> IntegrationClient:
    defaults = dict(
        app_code=APP_CODE,
        registry_url=REGISTRY_URL,
        cache_ttl_seconds=60,
        default_timeout_seconds=5,
    )
    defaults.update(kwargs)
    return IntegrationClient(**defaults)


class TestGetAppCaching:
    @respx.mock
    def test_two_calls_within_ttl_hit_registry_once(self):
        route = respx.get(f"{REGISTRY_URL}/api/registry/apps/{TARGET_CODE}").mock(
            return_value=httpx.Response(200, json=ACTIVE_PAYLOAD)
        )
        client = _make_client(cache_ttl_seconds=300)
        client.get_app(TARGET_CODE)
        client.get_app(TARGET_CODE)
        assert route.call_count == 1

    @respx.mock
    def test_expired_cache_fetches_again(self):
        route = respx.get(f"{REGISTRY_URL}/api/registry/apps/{TARGET_CODE}").mock(
            return_value=httpx.Response(200, json=ACTIVE_PAYLOAD)
        )
        client = _make_client(cache_ttl_seconds=60)
        client.get_app(TARGET_CODE)

        expired_time = datetime.now(timezone.utc) - timedelta(seconds=120)
        client._cache[TARGET_CODE] = _CacheEntry(
            app_info=AppInfo(**ACTIVE_PAYLOAD),
            fetched_at=expired_time,
        )
        client.get_app(TARGET_CODE)
        assert route.call_count == 2


class TestInactiveApp:
    @respx.mock
    def test_inactive_app_raises(self):
        respx.get(f"{REGISTRY_URL}/api/registry/apps/{TARGET_CODE}").mock(
            return_value=httpx.Response(200, json=INACTIVE_PAYLOAD)
        )
        client = _make_client()
        with pytest.raises(AppInactiveError, match="not active"):
            client.get_app(TARGET_CODE)


class TestCall:
    @respx.mock
    def test_builds_correct_url_and_headers(self):
        respx.get(f"{REGISTRY_URL}/api/registry/apps/{TARGET_CODE}").mock(
            return_value=httpx.Response(200, json=ACTIVE_PAYLOAD)
        )
        target_route = respx.get(f"{TARGET_BASE}/api/invoices").mock(
            return_value=httpx.Response(200, json={"ok": True})
        )

        set_correlation_id("test-cid-123")
        client = _make_client()
        resp = client.call(TARGET_CODE, "/api/invoices")

        assert resp.status_code == 200
        req = target_route.calls[0].request
        assert req.headers["x-asakin-caller"] == APP_CODE
        assert req.headers["x-correlation-id"] == "test-cid-123"

    @respx.mock
    def test_target_500_returned_not_raised(self):
        respx.get(f"{REGISTRY_URL}/api/registry/apps/{TARGET_CODE}").mock(
            return_value=httpx.Response(200, json=ACTIVE_PAYLOAD)
        )
        respx.post(f"{TARGET_BASE}/api/charge").mock(
            return_value=httpx.Response(500, json={"error": "internal"})
        )

        client = _make_client()
        resp = client.call(TARGET_CODE, "/api/charge", method="POST", json={"amount": 100})
        assert resp.status_code == 500

    @respx.mock
    def test_target_network_error_raises(self):
        respx.get(f"{REGISTRY_URL}/api/registry/apps/{TARGET_CODE}").mock(
            return_value=httpx.Response(200, json=ACTIVE_PAYLOAD)
        )
        respx.get(f"{TARGET_BASE}/api/health").mock(
            side_effect=httpx.ConnectTimeout("timed out")
        )

        client = _make_client()
        with pytest.raises(IntegrationNetworkError, match="Network error"):
            client.call(TARGET_CODE, "/api/health")

    def test_path_validation(self):
        client = _make_client()
        with pytest.raises(IntegrationError, match="must start with '/'"):
            client.call(TARGET_CODE, "no-slash")
