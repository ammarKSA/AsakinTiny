export type AppStatus = "ACTIVE" | "INACTIVE";

export interface AppInfo {
  code: string;
  name?: string;
  base_url: string;
  status: AppStatus;
  description?: string;
}

export interface CallArgs {
  targetAppCode: string;
  path: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean | null | undefined>;
  jsonBody?: unknown;
  body?: BodyInit | null;
  timeoutMs?: number;
  correlationId?: string;
}

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
