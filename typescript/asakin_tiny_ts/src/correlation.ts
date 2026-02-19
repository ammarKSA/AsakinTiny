import { randomUUID } from "node:crypto";

export function getOrCreateCorrelationId(existing?: string): string {
  if (existing && existing.length > 0) {
    return existing;
  }
  return randomUUID();
}
