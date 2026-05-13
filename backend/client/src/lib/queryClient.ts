import { QueryClient, QueryFunction } from "@tanstack/react-query";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
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
  const res = await fetch(`${API_BASE}${url}`, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    // Sprint 26 — send the session cookie on every GET as well.
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`, { credentials: "include" });

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
