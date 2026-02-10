import os

import pytest

from asakin_tiny.config import load_config
from asakin_tiny.errors import IntegrationError


class TestConfigValidation:
    def test_missing_app_code_raises(self, monkeypatch):
        monkeypatch.delenv("ASAKIN_APP_CODE", raising=False)
        monkeypatch.delenv("ASAKIN_REGISTRY_URL", raising=False)
        with pytest.raises(IntegrationError, match="ASAKIN_APP_CODE is required"):
            load_config()

    def test_missing_registry_url_raises(self, monkeypatch):
        monkeypatch.delenv("ASAKIN_REGISTRY_URL", raising=False)
        with pytest.raises(IntegrationError, match="ASAKIN_REGISTRY_URL is required"):
            load_config(app_code="MY_APP")

    def test_invalid_app_code_format(self):
        with pytest.raises(IntegrationError, match="invalid"):
            load_config(app_code="bad-code!", registry_url="https://registry.example.com")

    def test_app_code_too_short(self):
        with pytest.raises(IntegrationError, match="invalid"):
            load_config(app_code="AB", registry_url="https://registry.example.com")

    def test_invalid_registry_url_scheme(self):
        with pytest.raises(IntegrationError, match="must start with http"):
            load_config(app_code="MY_APP", registry_url="ftp://registry.example.com")

    def test_valid_config(self):
        cfg = load_config(
            app_code="MY_APP",
            registry_url="https://registry.example.com",
        )
        assert cfg.app_code == "MY_APP"
        assert cfg.registry_url == "https://registry.example.com"
        assert cfg.cache_ttl_seconds == 60
        assert cfg.default_timeout_seconds == 10

    def test_config_from_env(self, monkeypatch):
        monkeypatch.setenv("ASAKIN_APP_CODE", "ENV_APP")
        monkeypatch.setenv("ASAKIN_REGISTRY_URL", "https://reg.test")
        monkeypatch.setenv("ASAKIN_TINY_CACHE_TTL_SECONDS", "120")
        monkeypatch.setenv("ASAKIN_TINY_DEFAULT_TIMEOUT_SECONDS", "30")
        cfg = load_config()
        assert cfg.app_code == "ENV_APP"
        assert cfg.registry_url == "https://reg.test"
        assert cfg.cache_ttl_seconds == 120
        assert cfg.default_timeout_seconds == 30
