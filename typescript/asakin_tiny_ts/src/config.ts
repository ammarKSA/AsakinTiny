import { IntegrationError } from "./errors.js";

const APP_CODE_RE = /^[A-Z0-9_]{3,40}$/;

export interface TinyConfig {
  appCode: string;
  registryUrl: string;
  cacheTtlSeconds: number;
  defaultTimeoutMs: number;
}

export interface ConfigOverrides {
  appCode?: string;
  registryUrl?: string;
  cacheTtlSeconds?: number;
  defaultTimeoutMs?: number;
}

export function loadConfigFromEnv(overrides?: ConfigOverrides): TinyConfig {
  const appCode = overrides?.appCode ?? process.env.ASAKIN_APP_CODE ?? "";
  const registryUrl =
    overrides?.registryUrl ?? process.env.ASAKIN_REGISTRY_URL ?? "";
  const cacheTtlSeconds =
    overrides?.cacheTtlSeconds ??
    (process.env.ASAKIN_TINY_CACHE_TTL_SECONDS
      ? parseInt(process.env.ASAKIN_TINY_CACHE_TTL_SECONDS, 10)
      : 60);
  const defaultTimeoutMs =
    overrides?.defaultTimeoutMs ??
    (process.env.ASAKIN_TINY_DEFAULT_TIMEOUT_MS
      ? parseInt(process.env.ASAKIN_TINY_DEFAULT_TIMEOUT_MS, 10)
      : 10000);

  if (!appCode) {
    throw new IntegrationError(
      "ASAKIN_APP_CODE is required. Set it as an environment variable or pass it as appCode.",
    );
  }
  if (!APP_CODE_RE.test(appCode)) {
    throw new IntegrationError(
      `ASAKIN_APP_CODE '${appCode}' is invalid. It must match /^[A-Z0-9_]{3,40}$/.`,
    );
  }
  if (!registryUrl) {
    throw new IntegrationError(
      "ASAKIN_REGISTRY_URL is required. Set it as an environment variable or pass it as registryUrl.",
    );
  }
  if (!registryUrl.startsWith("http://") && !registryUrl.startsWith("https://")) {
    throw new IntegrationError(
      `ASAKIN_REGISTRY_URL '${registryUrl}' is invalid. It must start with http:// or https://.`,
    );
  }

  return { appCode, registryUrl, cacheTtlSeconds, defaultTimeoutMs };
}
