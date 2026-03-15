import { loadConfigFromEnv, type ConfigOverrides } from "./config.js";
import { getOrCreateCorrelationId } from "./correlation.js";
import {
  AppInactiveError,
  IntegrationError,
  IntegrationNetworkError,
} from "./errors.js";
import { fetchWithTimeout } from "./http.js";
import { RegistryClient } from "./registryClient.js";
import { TokenClient } from "./tokenClient.js";
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
  private readonly tokenClient: TokenClient;
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
    this.tokenClient = new TokenClient({
      registryUrl: cfg.registryUrl,
      appKey: cfg.appKey,
      appSecret: cfg.appSecret,
      fetcher: this.fetcher,
      now: this.nowFn,
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

    if (args.jsonBody !== undefined && args.body !== undefined) {
      throw new IntegrationError(
        "Cannot provide both jsonBody and body in the same call.",
      );
    }

    let bodyContent: BodyInit | null | undefined = args.body;
    const extraHeaders: Record<string, string> = {};
    if (args.jsonBody !== undefined) {
      bodyContent = JSON.stringify(args.jsonBody);
      if (
        !args.headers?.["Content-Type"] &&
        !args.headers?.["content-type"]
      ) {
        extraHeaders["Content-Type"] = "application/json";
      }
    }

    const timeoutMs = args.timeoutMs ?? this.defaultTimeoutMs;
    const targetAppCode = args.targetAppCode;

    const token = await this.tokenClient.getToken(targetAppCode, timeoutMs);

    const buildHeaders = (tok: string): Record<string, string> => ({
      ...args.headers,
      ...extraHeaders,
      "X-ASAKIN-CALLER": this.appCode,
      "X-CORRELATION-ID": correlationId,
      "Authorization": `Bearer ${tok}`,
    });

    const doFetch = async (tok: string): Promise<Response> => {
      return fetchWithTimeout(
        this.fetcher,
        fullUrl,
        {
          method: args.method ?? "GET",
          headers: buildHeaders(tok),
          body: bodyContent ?? null,
        },
        timeoutMs,
      );
    };

    try {
      let response = await doFetch(token);

      if (response.status === 401) {
        this.tokenClient.invalidate(targetAppCode);
        const freshToken = await this.tokenClient.getToken(targetAppCode, timeoutMs);
        response = await doFetch(freshToken);
      }

      return response;
    } catch (err) {
      if (err instanceof IntegrationError) {
        throw err;
      }
      throw new IntegrationNetworkError(
        `Network error calling app '${targetAppCode}' at ${fullUrl}`,
        { cause: err },
      );
    }
  }
}
