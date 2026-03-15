import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { IntegrationClient } from "../src/integrationClient.js";
import {
  AppNotFoundError,
  AppInactiveError,
  IntegrationError,
  IntegrationNetworkError,
} from "../src/errors.js";
import type { FetchLike } from "../src/types.js";

const REGISTRY_URL = "https://registry.example.com";
const APP_CODE = "CALLER_APP";
const APP_KEY = "test-key";
const APP_SECRET = "test-secret";
const TARGET_CODE = "BILLING";
const TARGET_BASE = "https://billing.example.com";

const ACTIVE_PAYLOAD = {
  code: TARGET_CODE,
  name: "Billing Service",
  base_url: TARGET_BASE,
  status: "ACTIVE",
};

const INACTIVE_PAYLOAD = {
  code: TARGET_CODE,
  name: "Billing Service",
  base_url: TARGET_BASE,
  status: "INACTIVE",
};

const TOKEN_PAYLOAD = {
  access_token: "jwt-token-for-billing",
  token_type: "Bearer",
  expires_in: 600,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeClient(
  fetchStub: FetchLike,
  overrides?: { cacheTtlSeconds?: number; now?: () => number },
): IntegrationClient {
  return new IntegrationClient({
    appCode: APP_CODE,
    registryUrl: REGISTRY_URL,
    appKey: APP_KEY,
    appSecret: APP_SECRET,
    cacheTtlSeconds: overrides?.cacheTtlSeconds ?? 300,
    defaultTimeoutMs: 5000,
    fetcher: fetchStub,
    now: overrides?.now,
  });
}

function registryAndTokenFetcher(
  targetHandler: (url: string, init?: RequestInit) => Response,
): FetchLike {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/registry/apps/")) {
      return jsonResponse(ACTIVE_PAYLOAD);
    }
    if (url.includes("/api/auth/token")) {
      return jsonResponse(TOKEN_PAYLOAD);
    }
    return targetHandler(url, init);
  };
}

describe("IntegrationClient", () => {
  describe("Registry 404 => AppNotFoundError", () => {
    it("throws AppNotFoundError when registry returns 404", async () => {
      const fetcher: FetchLike = async () => new Response("Not Found", { status: 404 });
      const client = makeClient(fetcher);
      await assert.rejects(() => client.getApp(TARGET_CODE), AppNotFoundError);
    });
  });

  describe("Registry INACTIVE => AppInactiveError", () => {
    it("throws AppInactiveError when app status is INACTIVE", async () => {
      const fetcher: FetchLike = async () => jsonResponse(INACTIVE_PAYLOAD);
      const client = makeClient(fetcher);
      await assert.rejects(() => client.getApp(TARGET_CODE), AppInactiveError);
    });
  });

  describe("Cache behavior", () => {
    it("uses cache within TTL and refreshes after TTL", async () => {
      let fetchCount = 0;
      let currentTime = 1000000;
      const fetcher: FetchLike = async () => {
        fetchCount++;
        return jsonResponse(ACTIVE_PAYLOAD);
      };
      const client = makeClient(fetcher, {
        cacheTtlSeconds: 60,
        now: () => currentTime,
      });

      await client.getApp(TARGET_CODE);
      assert.equal(fetchCount, 1);

      await client.getApp(TARGET_CODE);
      assert.equal(fetchCount, 1, "Should use cache within TTL");

      currentTime += 61_000;
      await client.getApp(TARGET_CODE);
      assert.equal(fetchCount, 2, "Should refresh after TTL expires");
    });
  });

  describe("call() path validation", () => {
    it("throws IntegrationError when path does not start with /", async () => {
      const fetcher: FetchLike = async () => jsonResponse(ACTIVE_PAYLOAD);
      const client = makeClient(fetcher);
      await assert.rejects(
        () =>
          client.call({
            targetAppCode: TARGET_CODE,
            path: "no-slash",
          }),
        IntegrationError,
      );
    });
  });

  describe("call() headers", () => {
    it("sets X-ASAKIN-CALLER, X-CORRELATION-ID, and Authorization", async () => {
      let capturedHeaders: Record<string, string> = {};
      let capturedUrl = "";

      const fetcher = registryAndTokenFetcher((url, init) => {
        capturedUrl = url;
        const h = init?.headers as Record<string, string> | undefined;
        if (h) capturedHeaders = { ...h };
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      });

      const client = makeClient(fetcher);
      await client.call({
        targetAppCode: TARGET_CODE,
        path: "/api/invoices",
        correlationId: "test-cid-123",
      });

      assert.equal(capturedUrl, `${TARGET_BASE}/api/invoices`);
      assert.equal(capturedHeaders["X-ASAKIN-CALLER"], APP_CODE);
      assert.equal(capturedHeaders["X-CORRELATION-ID"], "test-cid-123");
      assert.equal(capturedHeaders["Authorization"], "Bearer jwt-token-for-billing");
    });
  });

  describe("call() target 500 returned as-is", () => {
    it("returns raw Response even if target returns 500", async () => {
      const fetcher = registryAndTokenFetcher(() => {
        return new Response(JSON.stringify({ error: "internal" }), { status: 500 });
      });

      const client = makeClient(fetcher);
      const resp = await client.call({
        targetAppCode: TARGET_CODE,
        path: "/api/charge",
        method: "POST",
        jsonBody: { amount: 100 },
      });
      assert.equal(resp.status, 500);
    });
  });

  describe("Registry non-2xx (not 404) => IntegrationNetworkError", () => {
    it("throws IntegrationNetworkError on registry 500", async () => {
      const fetcher: FetchLike = async () =>
        new Response("Internal Server Error", { status: 500 });
      const client = makeClient(fetcher);
      await assert.rejects(
        () => client.getApp(TARGET_CODE),
        IntegrationNetworkError,
      );
    });
  });

  describe("Network error => IntegrationNetworkError", () => {
    it("throws IntegrationNetworkError when fetch throws", async () => {
      const fetcher: FetchLike = async () => {
        throw new TypeError("fetch failed");
      };
      const client = makeClient(fetcher);
      await assert.rejects(
        () => client.getApp(TARGET_CODE),
        IntegrationNetworkError,
      );
    });
  });

  describe("Token fetch and header attachment", () => {
    it("fetches token and attaches Bearer header", async () => {
      let capturedHeaders: Record<string, string> = {};

      const fetcher = registryAndTokenFetcher((_url, init) => {
        const h = init?.headers as Record<string, string> | undefined;
        if (h) capturedHeaders = { ...h };
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      });

      const client = makeClient(fetcher);
      await client.call({ targetAppCode: TARGET_CODE, path: "/api/test" });

      assert.equal(capturedHeaders["Authorization"], "Bearer jwt-token-for-billing");
    });
  });

  describe("Per-provider token cache reuse", () => {
    it("reuses cached token within TTL", async () => {
      let tokenFetchCount = 0;

      const fetcher: FetchLike = async (input) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/registry/apps/")) return jsonResponse(ACTIVE_PAYLOAD);
        if (url.includes("/api/auth/token")) {
          tokenFetchCount++;
          return jsonResponse(TOKEN_PAYLOAD);
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      };

      const client = makeClient(fetcher);
      await client.call({ targetAppCode: TARGET_CODE, path: "/api/a" });
      await client.call({ targetAppCode: TARGET_CODE, path: "/api/b" });

      assert.equal(tokenFetchCount, 1, "Token should be fetched only once");
    });
  });

  describe("Different providers get different cached tokens", () => {
    it("caches tokens per provider app code", async () => {
      const OTHER_CODE = "PAYMENTS";
      const OTHER_BASE = "https://payments.example.com";
      const tokensByProvider: Record<string, string> = {};
      let lastTokenProvider = "";

      const fetcher: FetchLike = async (input, init) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/registry/apps/BILLING")) {
          return jsonResponse(ACTIVE_PAYLOAD);
        }
        if (url.includes("/api/registry/apps/PAYMENTS")) {
          return jsonResponse({
            code: OTHER_CODE,
            name: "Payments Service",
            base_url: OTHER_BASE,
            status: "ACTIVE",
          });
        }
        if (url.includes("/api/auth/token")) {
          const body = JSON.parse(
            typeof init?.body === "string" ? init.body : "",
          );
          const provider = body.provider_app_code as string;
          lastTokenProvider = provider;
          const token = `token-for-${provider}`;
          tokensByProvider[provider] = token;
          return jsonResponse({
            access_token: token,
            token_type: "Bearer",
            expires_in: 600,
          });
        }
        const h = init?.headers as Record<string, string> | undefined;
        return new Response(
          JSON.stringify({ auth: h?.["Authorization"] }),
          { status: 200 },
        );
      };

      const client = makeClient(fetcher);

      const resp1 = await client.call({ targetAppCode: TARGET_CODE, path: "/api/x" });
      const body1 = (await resp1.json()) as { auth: string };
      assert.equal(body1.auth, "Bearer token-for-BILLING");

      const resp2 = await client.call({ targetAppCode: OTHER_CODE, path: "/api/y" });
      const body2 = (await resp2.json()) as { auth: string };
      assert.equal(body2.auth, "Bearer token-for-PAYMENTS");
    });
  });

  describe("Expired/nearly-expired token triggers refresh", () => {
    it("refreshes token when close to expiry", async () => {
      let tokenFetchCount = 0;
      let currentTime = 1_000_000;

      const fetcher: FetchLike = async (input) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/registry/apps/")) return jsonResponse(ACTIVE_PAYLOAD);
        if (url.includes("/api/auth/token")) {
          tokenFetchCount++;
          return jsonResponse({
            access_token: `token-v${tokenFetchCount}`,
            token_type: "Bearer",
            expires_in: 600,
          });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      };

      const client = makeClient(fetcher, { now: () => currentTime });

      await client.call({ targetAppCode: TARGET_CODE, path: "/api/a" });
      assert.equal(tokenFetchCount, 1);

      await client.call({ targetAppCode: TARGET_CODE, path: "/api/b" });
      assert.equal(tokenFetchCount, 1, "Still cached");

      currentTime += 550_000;
      await client.call({ targetAppCode: TARGET_CODE, path: "/api/c" });
      assert.equal(tokenFetchCount, 2, "Should refresh near expiry");
    });
  });

  describe("401 triggers one refresh and one retry", () => {
    it("retries once with fresh token on 401", async () => {
      let tokenFetchCount = 0;
      let callCount = 0;

      const fetcher: FetchLike = async (input, init) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/registry/apps/")) return jsonResponse(ACTIVE_PAYLOAD);
        if (url.includes("/api/auth/token")) {
          tokenFetchCount++;
          return jsonResponse({
            access_token: `token-v${tokenFetchCount}`,
            token_type: "Bearer",
            expires_in: 600,
          });
        }
        callCount++;
        if (callCount === 1) {
          return new Response("Unauthorized", { status: 401 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      };

      const client = makeClient(fetcher);
      const resp = await client.call({ targetAppCode: TARGET_CODE, path: "/api/test" });

      assert.equal(resp.status, 200);
      assert.equal(tokenFetchCount, 2, "Should fetch token twice (initial + refresh)");
      assert.equal(callCount, 2, "Should call target twice (initial + retry)");
    });

    it("returns 401 if retry also fails with 401", async () => {
      let tokenFetchCount = 0;

      const fetcher: FetchLike = async (input) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/registry/apps/")) return jsonResponse(ACTIVE_PAYLOAD);
        if (url.includes("/api/auth/token")) {
          tokenFetchCount++;
          return jsonResponse({
            access_token: `token-v${tokenFetchCount}`,
            token_type: "Bearer",
            expires_in: 600,
          });
        }
        return new Response("Unauthorized", { status: 401 });
      };

      const client = makeClient(fetcher);
      const resp = await client.call({ targetAppCode: TARGET_CODE, path: "/api/test" });

      assert.equal(resp.status, 401, "Should return 401 after retry exhausted");
      assert.equal(tokenFetchCount, 2, "Should have attempted token refresh");
    });
  });

  describe("403 does not retry", () => {
    it("returns 403 response without retrying", async () => {
      let tokenFetchCount = 0;
      let callCount = 0;

      const fetcher: FetchLike = async (input) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/registry/apps/")) return jsonResponse(ACTIVE_PAYLOAD);
        if (url.includes("/api/auth/token")) {
          tokenFetchCount++;
          return jsonResponse(TOKEN_PAYLOAD);
        }
        callCount++;
        return new Response("Forbidden", { status: 403 });
      };

      const client = makeClient(fetcher);
      const resp = await client.call({ targetAppCode: TARGET_CODE, path: "/api/test" });

      assert.equal(resp.status, 403);
      assert.equal(callCount, 1, "Should NOT retry on 403");
      assert.equal(tokenFetchCount, 1, "Should NOT re-fetch token on 403");
    });
  });

  describe("Missing env vars fail clearly", () => {
    it("throws IntegrationError when appKey is missing", () => {
      assert.throws(
        () =>
          new IntegrationClient({
            appCode: APP_CODE,
            registryUrl: REGISTRY_URL,
            appKey: "",
            appSecret: APP_SECRET,
          }),
        IntegrationError,
      );
    });

    it("throws IntegrationError when appSecret is missing", () => {
      assert.throws(
        () =>
          new IntegrationClient({
            appCode: APP_CODE,
            registryUrl: REGISTRY_URL,
            appKey: APP_KEY,
            appSecret: "",
          }),
        IntegrationError,
      );
    });
  });
});
