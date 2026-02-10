# asakin-tiny (Tiny v1)

A lightweight, reusable Python client library that lets any Asakin host app call another Asakin app by its `app_code`. Tiny resolves `app_code → base_url + status` using the **Asakin Registry** service API, then forwards the HTTP call.

## What Tiny does

- Resolves app codes to base URLs via the Asakin Registry
- Caches registry lookups with a configurable TTL
- Propagates correlation IDs across service calls
- Identifies the caller via the `X-ASAKIN-CALLER` header

## What Tiny does NOT do

- Retries, circuit breaking, or rate limiting
- Logging or metrics collection
- Business logic or schema transformation
- Orchestration or workflow management

## Installation

Install directly from the project directory:

```bash
pip install .
```

Or reference it as a path dependency in another project's `pyproject.toml`:

```toml
[project]
dependencies = ["asakin-tiny @ file:///path/to/asakin-tiny"]
```

## Required Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ASAKIN_APP_CODE` | Yes | This app's code (e.g. `BILLING`). Must match `^[A-Z0-9_]{3,40}$` |
| `ASAKIN_REGISTRY_URL` | Yes | Base URL of the Asakin Registry (e.g. `https://registry.asakin.example.com`) |
| `ASAKIN_TINY_CACHE_TTL_SECONDS` | No | Cache TTL in seconds (default: `60`) |
| `ASAKIN_TINY_DEFAULT_TIMEOUT_SECONDS` | No | Default HTTP timeout in seconds (default: `10`) |

## Usage

### Basic usage

```python
from asakin_tiny import IntegrationClient

client = IntegrationClient()

# Call another Asakin app
response = client.call("BILLING", "/api/invoices", method="GET")
print(response.status_code, response.json())
```

### Passing parameters explicitly

```python
client = IntegrationClient(
    app_code="MY_APP",
    registry_url="https://registry.asakin.example.com",
    cache_ttl_seconds=120,
    default_timeout_seconds=15,
)
```

### FastAPI integration with correlation ID propagation

```python
from fastapi import FastAPI, Request
from asakin_tiny import IntegrationClient
from asakin_tiny.context import set_correlation_id, ensure_correlation_id

app = FastAPI()
client = IntegrationClient()

@app.middleware("http")
async def correlation_id_middleware(request: Request, call_next):
    cid = request.headers.get("X-CORRELATION-ID") or ensure_correlation_id()
    set_correlation_id(cid)
    response = await call_next(request)
    response.headers["X-CORRELATION-ID"] = cid
    return response

@app.get("/fetch-billing")
def fetch_billing():
    resp = client.call("BILLING", "/api/invoices")
    return resp.json()
```

### Error handling

```python
from asakin_tiny import (
    IntegrationClient,
    AppNotFoundError,
    AppInactiveError,
    IntegrationNetworkError,
)

client = IntegrationClient()

try:
    response = client.call("BILLING", "/api/invoices")
except AppNotFoundError:
    print("BILLING app not registered")
except AppInactiveError:
    print("BILLING app is not active")
except IntegrationNetworkError:
    print("Could not reach BILLING app or registry")
```

Note: HTTP 4xx/5xx responses from target apps are returned as normal `httpx.Response` objects and are **not** converted to exceptions.

## Running Tests

```bash
pytest -q
```

## License

Internal Asakin library.
