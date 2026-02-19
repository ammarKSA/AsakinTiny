import { describe, it, beforeEach } from "node:test";
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
    cacheTtlSeconds: overrides?.cacheTtlSeconds ?? 300,
    defaultTimeoutMs: 5000,
    fetcher: fetchStub,
    now: overrides?.now,
  });
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
    it("sets X-ASAKIN-CALLER and reuses provided X-CORRELATION-ID", async () => {
      let capturedHeaders: Record<string, string> = {};
      let capturedUrl = "";

      const fetcher: FetchLike = async (input, init) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/registry/apps/")) {
          return jsonResponse(ACTIVE_PAYLOAD);
        }
        capturedUrl = url;
        const h = init?.headers as Record<string, string> | undefined;
        if (h) {
          capturedHeaders = { ...h };
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      };

      const client = makeClient(fetcher);
      await client.call({
        targetAppCode: TARGET_CODE,
        path: "/api/invoices",
        correlationId: "test-cid-123",
      });

      assert.equal(capturedUrl, `${TARGET_BASE}/api/invoices`);
      assert.equal(capturedHeaders["X-ASAKIN-CALLER"], APP_CODE);
      assert.equal(capturedHeaders["X-CORRELATION-ID"], "test-cid-123");
    });
  });

  describe("call() target 500 returned as-is", () => {
    it("returns raw Response even if target returns 500", async () => {
      const fetcher: FetchLike = async (input) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/registry/apps/")) {
          return jsonResponse(ACTIVE_PAYLOAD);
        }
        return new Response(JSON.stringify({ error: "internal" }), { status: 500 });
      };

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
});
