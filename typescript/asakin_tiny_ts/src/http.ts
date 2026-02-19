import { IntegrationNetworkError } from "./errors.js";
import type { FetchLike } from "./types.js";

export async function fetchWithTimeout(
  fetcher: FetchLike,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const mergedInit: RequestInit = {
      ...init,
      signal: controller.signal,
    };
    return await fetcher(input, mergedInit);
  } catch (err: unknown) {
    if (err instanceof IntegrationNetworkError) {
      throw err;
    }
    const message =
      err instanceof Error ? err.message : String(err);
    throw new IntegrationNetworkError(
      `Network error: ${message}`,
      { cause: err },
    );
  } finally {
    clearTimeout(timer);
  }
}
