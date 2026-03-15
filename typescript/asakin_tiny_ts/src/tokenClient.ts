import { IntegrationNetworkError } from "./errors.js";
import { fetchWithTimeout } from "./http.js";
import type { FetchLike } from "./types.js";

interface TokenCacheEntry {
  accessToken: string;
  expiresAt: number;
}

const REFRESH_WINDOW_MS = 60_000;

export class TokenClient {
  private readonly registryUrl: string;
  private readonly appKey: string;
  private readonly appSecret: string;
  private readonly fetcher: FetchLike;
  private readonly nowFn: () => number;
  private readonly cache = new Map<string, TokenCacheEntry>();

  constructor(options: {
    registryUrl: string;
    appKey: string;
    appSecret: string;
    fetcher: FetchLike;
    now?: () => number;
  }) {
    this.registryUrl = options.registryUrl.replace(/\/+$/, "");
    this.appKey = options.appKey;
    this.appSecret = options.appSecret;
    this.fetcher = options.fetcher;
    this.nowFn = options.now ?? (() => Date.now());
  }

  invalidate(providerAppCode: string): void {
    this.cache.delete(providerAppCode);
  }

  async getToken(providerAppCode: string, timeoutMs: number): Promise<string> {
    const now = this.nowFn();
    const cached = this.cache.get(providerAppCode);
    if (cached && cached.expiresAt - now > REFRESH_WINDOW_MS) {
      return cached.accessToken;
    }

    const url = `${this.registryUrl}/api/auth/token`;
    const response = await fetchWithTimeout(
      this.fetcher,
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app_key: this.appKey,
          app_secret: this.appSecret,
          provider_app_code: providerAppCode,
        }),
      },
      timeoutMs,
    );

    if (response.status < 200 || response.status >= 300) {
      let bodySnippet = "";
      try {
        const text = await response.text();
        bodySnippet = text.slice(0, 200);
      } catch {
        // ignore
      }
      throw new IntegrationNetworkError(
        `Token request failed with status ${response.status} for provider '${providerAppCode}'`,
        {
          details: {
            url,
            status: response.status,
            body: bodySnippet,
          },
        },
      );
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch (err) {
      throw new IntegrationNetworkError(
        `Invalid JSON in token response for provider '${providerAppCode}'`,
        { cause: err, details: { url } },
      );
    }

    const body = data as Record<string, unknown>;
    if (
      typeof body.access_token !== "string" ||
      typeof body.token_type !== "string" ||
      typeof body.expires_in !== "number"
    ) {
      throw new IntegrationNetworkError(
        `Invalid token response shape for provider '${providerAppCode}'`,
        { details: { url, data } },
      );
    }

    if (body.token_type.toLowerCase() !== "bearer") {
      throw new IntegrationNetworkError(
        `Unexpected token_type '${body.token_type}' for provider '${providerAppCode}' (expected Bearer)`,
        { details: { url } },
      );
    }

    const expiresAt = now + body.expires_in * 1000;
    this.cache.set(providerAppCode, {
      accessToken: body.access_token,
      expiresAt,
    });

    return body.access_token;
  }
}
