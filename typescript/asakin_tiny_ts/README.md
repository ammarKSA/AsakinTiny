# @asakin/tiny (Tiny-TS v1)

A lightweight, reusable TypeScript client library that lets any Asakin host app call another Asakin app by its `app_code`. Tiny-TS resolves `app_code -> base_url + status` using the **Asakin Registry** API, then forwards the HTTP call.

## What Tiny-TS does

- Resolves app codes to base URLs via the Asakin Registry
- Caches registry lookups with a configurable TTL
- Propagates correlation IDs across service calls
- Identifies the caller via the `X-ASAKIN-CALLER` header

## What Tiny-TS does NOT do

- Retries, circuit breaking, or rate limiting
- Logging or metrics collection
- Business logic or schema transformation
- Orchestration or workflow management
- Authentication or authorization

## Installation

```bash
npm install @asakin/tiny
```

## Required Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ASAKIN_APP_CODE` | Yes | This app's code (e.g. `BILLING`). Must match `/^[A-Z0-9_]{3,40}$/` |
| `ASAKIN_REGISTRY_URL` | Yes | Base URL of the Asakin Registry |
| `ASAKIN_TINY_CACHE_TTL_SECONDS` | No | Cache TTL in seconds (default: `60`) |
| `ASAKIN_TINY_DEFAULT_TIMEOUT_MS` | No | Default HTTP timeout in ms (default: `10000`) |

## Usage

### Basic usage

```typescript
import { IntegrationClient } from "@asakin/tiny";

const client = new IntegrationClient();

const response = await client.call({
  targetAppCode: "BILLING",
  path: "/api/invoices",
  method: "GET",
});

console.log(response.status, await response.json());
```

### Correlation ID propagation (Express/Fastify middleware)

```typescript
import { IntegrationClient, getOrCreateCorrelationId } from "@asakin/tiny";

const client = new IntegrationClient();

app.use((req, res, next) => {
  const correlationId = getOrCreateCorrelationId(
    req.headers["x-correlation-id"] as string
  );
  req.correlationId = correlationId;
  res.setHeader("X-CORRELATION-ID", correlationId);
  next();
});

app.get("/fetch-billing", async (req, res) => {
  const resp = await client.call({
    targetAppCode: "BILLING",
    path: "/api/invoices",
    correlationId: req.correlationId,
  });
  const data = await resp.json();
  res.json(data);
});
```

### Error handling

```typescript
import {
  IntegrationClient,
  AppNotFoundError,
  AppInactiveError,
  IntegrationNetworkError,
} from "@asakin/tiny";

const client = new IntegrationClient();

try {
  const response = await client.call({
    targetAppCode: "BILLING",
    path: "/api/invoices",
  });
} catch (err) {
  if (err instanceof AppNotFoundError) {
    console.error("BILLING app not registered");
  } else if (err instanceof AppInactiveError) {
    console.error("BILLING app is not active");
  } else if (err instanceof IntegrationNetworkError) {
    console.error("Could not reach BILLING app or registry");
  }
}
```

Note: HTTP 4xx/5xx responses from target apps are returned as normal `Response` objects and are **not** converted to exceptions.

## Building & Testing

```bash
npm run build
npm test
```

## License

Internal Asakin library.
