import { QueryClient, QueryFunction } from "@tanstack/react-query";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

/**
 * v23.4.5 Phase 8 — friendly error extraction.
 *
 * Servers in this codebase consistently return one of:
 *   { ok:false, error:"<CODE>", message:"...", errors?:{...} }
 *   { message:"..." }
 *   { detail:"..." }              (proxy / 404)
 *   plain text
 *
 * Toast components surface `Error.message` directly. Previously this meant
 * raw stringified JSON — `"400: {\"ok\":false,\"error\":..."` — surfaced
 * verbatim (QA #11). We now parse the body, surface a friendly message, and
 * attach the raw payload as `(err as ApiError).payload` for callers that
 * need the field-level `errors` map.
 */
export class ApiError extends Error {
  status: number;
  code: string | null;
  payload: unknown;
  constructor(status: number, message: string, code: string | null, payload: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

function friendlyMessageForStatus(status: number): string {
  if (status === 401) return "Please sign in to continue.";
  if (status === 403) return "You don’t have permission to do that.";
  if (status === 404) return "We couldn’t find what you were looking for.";
  if (status === 409) return "That action conflicts with the current state. Refresh and try again.";
  if (status === 422 || status === 400) return "Some of the information was invalid. Please review and try again.";
  if (status === 429) return "Too many requests — please wait a moment and try again.";
  if (status >= 500) return "Something went wrong on our side. Please try again.";
  return "Something went wrong. Please try again.";
}

async function throwIfResNotOk(res: Response) {
  if (res.ok) return;
  const raw = (await res.text()) || res.statusText;
  let payload: unknown = raw;
  let code: string | null = null;
  let serverMessage: string | null = null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    payload = parsed;
    if (typeof parsed.error === "string") code = parsed.error;
    if (typeof parsed.message === "string") serverMessage = parsed.message;
    else if (typeof parsed.detail === "string") serverMessage = parsed.detail as string;
  } catch {
    // Body was not JSON — keep as plain text.
  }
  // Prefer the server's human message when it looks human (not just an enum code).
  const looksHuman =
    !!serverMessage &&
    serverMessage.length > 0 &&
    serverMessage.length < 240 &&
    /[a-z]/.test(serverMessage); // crude check: contains a lowercase letter
  const friendly = looksHuman ? (serverMessage as string) : friendlyMessageForStatus(res.status);
  throw new ApiError(res.status, friendly, code, payload);
}

/**
 * v23.4.5 Phase 6 — Central COMPANY_NOT_FOUND recovery.
 *
 * The backend returns 404 with `{ ok:false, error:"COMPANY_NOT_FOUND", ... }`
 * whenever a request references a stale activeCompanyId (e.g. company was
 * deleted, or a tab is using an older session). When that happens we:
 *   1. Clone the 404 response body so we can read it without consuming the
 *      stream callers expect.
 *   2. Hit `/api/auth/me` and pick the first available founder company.
 *   3. POST `/api/founder/companies/:id/activate` to set it as active.
 *   4. Return `null` so the calling helper knows to retry.
 *
 * The recovery is best-effort: if the user truly has no companies (fresh
 * signup) we return null and the original 404 surfaces unchanged.
 */
async function tryRecoverFromCompanyNotFound(res: Response): Promise<string | null> {
  if (res.status !== 404) return null;
  // Clone first; reading body on the original would burn the stream.
  let parsed: unknown;
  try {
    parsed = await res.clone().json();
  } catch {
    return null;
  }
  const errCode = (parsed as { error?: string } | null)?.error;
  if (errCode !== "COMPANY_NOT_FOUND") return null;
  try {
    const meRes = await fetch(`${API_BASE}/api/auth/me`, { credentials: "include" });
    if (!meRes.ok) return null;
    const me = (await meRes.json()) as {
      isAuthed?: boolean;
      founder?: { companies?: Array<{ companyId: string }>; activeCompanyId?: string | null };
    };
    if (!me.isAuthed) return null;
    const firstCompanyId = me.founder?.companies?.[0]?.companyId;
    if (!firstCompanyId) return null;
    // If the auth/me activeCompanyId is already pointing at the first company,
    // there's no recovery to perform — the stale id is somewhere on the client.
    // Activate anyway to be defensive (server is idempotent).
    const actRes = await fetch(`${API_BASE}/api/founder/companies/${firstCompanyId}/activate`, {
      method: "POST",
      credentials: "include",
    });
    if (!actRes.ok) return null;
    return firstCompanyId;
  } catch {
    return null;
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  // Sprint 26 — always include credentials so the cap_uid session cookie set
  // by /api/auth/login travels with every API call. Required for the new
  // credentialed term-sheet save endpoint and any future endpoint that
  // gates writes on session identity. Same-origin browsers already do this
  // by default; explicit "include" also covers cross-origin (proxy) deploys.
  const doFetch = () =>
    fetch(`${API_BASE}${url}`, {
      method,
      headers: data ? { "Content-Type": "application/json" } : {},
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
    });
  let res = await doFetch();

  // v23.4.5 Phase 6 — if the server says the active company is unknown,
  // re-resolve to the user's first valid company and retry once.
  if (!res.ok && res.status === 404) {
    const recovered = await tryRecoverFromCompanyNotFound(res);
    if (recovered) {
      res = await doFetch();
    }
  }

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = `${API_BASE}${queryKey.join("/")}`;
    // Sprint 26 — send the session cookie on every GET as well.
    let res = await fetch(url, { credentials: "include" });

    // v23.4.5 Phase 6 — transparent recovery when the server reports the
    // active company id is unknown. Retry once after re-activating the first
    // available company.
    if (!res.ok && res.status === 404) {
      const recovered = await tryRecoverFromCompanyNotFound(res);
      if (recovered) {
        res = await fetch(url, { credentials: "include" });
      }
    }

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    // Sprint 16 hotfix — deploy proxy can return non-JSON or {"detail":"Not Found"}
    // for endpoints not wired in the static proxy. Treat any non-OK as null so
    // consumers see undefined data instead of an error-shaped object that crashes
    // when iterated.
    if (!res.ok) {
      return null;
    }
    try {
      return await res.json();
    } catch {
      return null;
    }
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
