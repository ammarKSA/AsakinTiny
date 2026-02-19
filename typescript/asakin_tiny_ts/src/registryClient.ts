import {
  AppNotFoundError,
  IntegrationNetworkError,
} from "./errors.js";
import { fetchWithTimeout } from "./http.js";
import type { AppInfo, FetchLike } from "./types.js";

export interface RegistryClientOptions {
  registryUrl: string;
  fetcher?: FetchLike;
}

export class RegistryClient {
  private readonly registryUrl: string;
  private readonly fetcher: FetchLike;

  constructor(options: RegistryClientOptions) {
    this.registryUrl = options.registryUrl.replace(/\/+$/, "");
    this.fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  }

  async getAppByCode(code: string, timeoutMs: number): Promise<AppInfo> {
    const url = `${this.registryUrl}/api/registry/apps/${encodeURIComponent(code)}`;

    const response = await fetchWithTimeout(this.fetcher, url, undefined, timeoutMs);

    if (response.status === 404) {
      throw new AppNotFoundError(code);
    }

    if (response.status < 200 || response.status >= 300) {
      let bodySnippet = "";
      try {
        const text = await response.text();
        bodySnippet = text.slice(0, 200);
      } catch {
        // ignore
      }
      throw new IntegrationNetworkError(
        `Registry error ${response.status} for app_code=${code}`,
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
        `Invalid JSON from registry for app_code=${code}`,
        { cause: err, details: { url } },
      );
    }

    const info = data as Record<string, unknown>;
    if (
      typeof info.code !== "string" ||
      typeof info.base_url !== "string" ||
      typeof info.status !== "string"
    ) {
      throw new IntegrationNetworkError(
        `Invalid response shape from registry for app_code=${code}`,
        { details: { url, data } },
      );
    }

    if (
      !info.base_url.startsWith("http://") &&
      !info.base_url.startsWith("https://")
    ) {
      throw new IntegrationNetworkError(
        `Invalid base_url from registry for app_code=${code}: ${info.base_url}`,
        { details: { url } },
      );
    }

    return data as AppInfo;
  }
}
