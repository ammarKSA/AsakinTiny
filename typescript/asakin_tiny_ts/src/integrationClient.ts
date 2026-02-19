import { loadConfigFromEnv, type ConfigOverrides } from "./config.js";
import { getOrCreateCorrelationId } from "./correlation.js";
import {
  AppInactiveError,
  IntegrationError,
  IntegrationNetworkError,
} from "./errors.js";
import { fetchWithTimeout } from "./http.js";
import { RegistryClient } from "./registryClient.js";
import type { AppInfo, CallArgs, FetchLike } from "./types.js";

interface CacheEntry {
  appInfo: AppInfo;
  fetchedAt: number;
}

export interface IntegrationClientOptions extends ConfigOverrides {
  fetcher?: FetchLike;
  now?: () => number;
}

export class IntegrationClient {
  private readonly appCode: string;
  private readonly cacheTtlMs: number;
  private readonly defaultTimeoutMs: number;
  private readonly fetcher: FetchLike;
  private readonly registry: RegistryClient;
  private readonly nowFn: () => number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(options?: IntegrationClientOptions) {
    const cfg = loadConfigFromEnv(options);
    this.appCode = cfg.appCode;
    this.cacheTtlMs = cfg.cacheTtlSeconds * 1000;
    this.defaultTimeoutMs = cfg.defaultTimeoutMs;
    this.fetcher = options?.fetcher ?? globalThis.fetch.bind(globalThis);
    this.nowFn = options?.now ?? (() => Date.now());
    this.registry = new RegistryClient({
      registryUrl: cfg.registryUrl,
      fetcher: this.fetcher,
    });
  }

  clearCache(): void {
    this.cache.clear();
  }

  async getApp(appCode: string, timeoutMs?: number): Promise<AppInfo> {
    const now = this.nowFn();
    const entry = this.cache.get(appCode);
    if (entry && now - entry.fetchedAt < this.cacheTtlMs) {
      return entry.appInfo;
    }

    const appInfo = await this.registry.getAppByCode(
      appCode,
      timeoutMs ?? this.defaultTimeoutMs,
    );

    if (appInfo.status !== "ACTIVE") {
      throw new AppInactiveError(appCode);
    }

    this.cache.set(appCode, { appInfo, fetchedAt: now });
    return appInfo;
  }

  async call(args: CallArgs): Promise<Response> {
    if (!args.path.startsWith("/")) {
      throw new IntegrationError(
        `path must start with '/', got: '${args.path}'`,
      );
    }

    const appInfo = await this.getApp(args.targetAppCode, args.timeoutMs);
    const baseUrl = appInfo.base_url.replace(/\/+$/, "");

    let fullUrl = baseUrl + args.path;
    if (args.query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(args.query)) {
        if (v != null) {
          params.set(k, String(v));
        }
      }
      const qs = params.toString();
      if (qs) {
        fullUrl += `?${qs}`;
      }
    }

    const correlationId = getOrCreateCorrelationId(
      args.correlationId ??
        args.headers?.["X-CORRELATION-ID"] ??
        args.headers?.["x-correlation-id"],
    );

    const headers: Record<string, string> = { ...args.headers };
    headers["X-ASAKIN-CALLER"] = this.appCode;
    headers["X-CORRELATION-ID"] = correlationId;

    if (args.jsonBody !== undefined && args.body !== undefined) {
      throw new IntegrationError(
        "Cannot provide both jsonBody and body in the same call.",
      );
    }

    let body: BodyInit | null | undefined = args.body;
    if (args.jsonBody !== undefined) {
      body = JSON.stringify(args.jsonBody);
      if (!headers["Content-Type"] && !headers["content-type"]) {
        headers["Content-Type"] = "application/json";
      }
    }

    const timeoutMs = args.timeoutMs ?? this.defaultTimeoutMs;

    try {
      return await fetchWithTimeout(
        this.fetcher,
        fullUrl,
        {
          method: args.method ?? "GET",
          headers,
          body: body ?? null,
        },
        timeoutMs,
      );
    } catch (err) {
      if (err instanceof IntegrationError) {
        throw err;
      }
      throw new IntegrationNetworkError(
        `Network error calling app '${args.targetAppCode}' at ${fullUrl}`,
        { cause: err },
      );
    }
  }
}
