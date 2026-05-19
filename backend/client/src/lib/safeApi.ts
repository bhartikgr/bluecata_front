/**
 * safeApi.ts — defensive API helpers (Sprint-fix May 14 2026)
 *
 * Prevents the .map() crash when the server returns HTML (e.g. an unexpected
 * 404 page or index.html from the SPA fallback) instead of JSON.
 *
 * Usage:
 *   import { safeJsonArray } from "@/lib/safeApi";
 *
 *   const contacts = await safeJsonArray<Contact>(
 *     apiRequest("GET", "/api/founder/crm/contacts")
 *   );
 *   // contacts is always an array — never undefined, never HTML
 */

/**
 * safeJsonArray — wraps a fetch Promise, parses JSON, and returns an empty
 * array if the response is non-JSON (HTML, plain text, etc.) or if the
 * parsed result is not an array.
 *
 * @param promise - A Promise<Response> from `apiRequest(...)` or `fetch(...)`.
 * @returns Promise<T[]> — always an array, never throws on parse failure.
 */
export async function safeJsonArray<T = unknown>(promise: Promise<Response>): Promise<T[]> {
  let response: Response;
  try {
    response = await promise;
  } catch {
    // Network failure — return empty array
    return [];
  }

  if (!response.ok) {
    // Non-2xx status — don't try to parse
    return [];
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    // Server returned HTML or plain text — not what we expect
    console.warn(
      `[safeJsonArray] Expected JSON from ${response.url} but got "${contentType}". Returning [].`,
    );
    return [];
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return [];
  }

  if (!Array.isArray(data)) {
    // Response was JSON but not an array (e.g. { error: ... } or null)
    return [];
  }

  return data as T[];
}

/**
 * safeJsonObject — like safeJsonArray but for single objects.
 * Returns null on failure instead of throwing.
 */
export async function safeJsonObject<T = unknown>(promise: Promise<Response>): Promise<T | null> {
  let response: Response;
  try {
    response = await promise;
  } catch {
    return null;
  }

  if (!response.ok) return null;

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    console.warn(
      `[safeJsonObject] Expected JSON from ${response.url} but got "${contentType}". Returning null.`,
    );
    return null;
  }

  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}
