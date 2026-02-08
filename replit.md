# asakin-tiny

## Overview
A standalone, reusable Python client library (Tiny v1) for inter-app communication within the Asakin platform. It resolves `app_code → base_url + status` via the Asakin Registry service API. This is NOT a web service — it's a library meant to be embedded/installed into Asakin host apps.

## Project Architecture

### Package Structure
```
asakin_tiny/
  __init__.py          - Public exports
  config.py            - Environment-based configuration with validation
  errors.py            - Exception hierarchy
  models.py            - Pydantic data models (AppInfo, AppStatus)
  context.py           - Correlation ID management via contextvars
  registry_client.py   - HTTP client for Asakin Registry API
  client.py            - Main IntegrationClient with caching and call()
tests/
  test_config.py       - Config validation tests
  test_registry_client.py - Registry client tests with respx mocks
  test_client_call.py  - Integration client caching and call tests
```

### Tech Stack
- Python 3.11
- httpx (HTTP client)
- pydantic (data models/validation)
- pytest + respx (testing)

### Key Design Decisions
- Synchronous API (v1 simplicity)
- In-memory TTL cache for registry lookups
- HTTP 4xx/5xx from target apps returned as-is (not converted to exceptions)
- Correlation ID propagation via contextvars

## Running Tests
```bash
python -m pytest -q
```
Workflow "Run Tests" is configured to run `python -m pytest -q`.
