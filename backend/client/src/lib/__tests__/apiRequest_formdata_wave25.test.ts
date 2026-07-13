/**
 * v26.1.x WAVE 2.5 AVI-B — apiRequest FormData handling.
 *
 * Locks two contracts at the exact fetch boundary apiRequest builds:
 *
 *   1. FORMDATA branch (the fix): when the body is a FormData instance,
 *      apiRequest MUST pass it through as-is (no JSON.stringify) and MUST NOT
 *      set a Content-Type header (the browser adds the multipart boundary).
 *
 *   2. JSON branch (unregressed): every existing JSON caller MUST still send
 *      Content-Type: application/json AND a JSON.stringify'd body, byte-identical
 *      to the pre-fix behavior.
 *
 * These directly prove the AVI-B root-cause fix (FormData was being
 * JSON.stringify'd to "{}", losing the multipart body) without regressing any
 * of the many existing JSON callers.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { apiRequest } from "../queryClient";

type FetchCall = { url: string; init: RequestInit };
let calls: FetchCall[];
const realFetch = globalThis.fetch;

beforeEach(() => {
  calls = [];
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("WAVE 2.5 AVI-B — apiRequest JSON path (unregressed)", () => {
  it("sends application/json + JSON.stringify for a plain object body", async () => {
    const payload = { contact: { firstName: "Maya", lastName: "Chen" } };
    await apiRequest("PATCH", "/api/investors/x/profile", payload);
    expect(calls).toHaveLength(1);
    const { init } = calls[0];
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    // Body is the EXACT JSON.stringify of the payload (byte-identical contract).
    expect(init.body).toBe(JSON.stringify(payload));
    expect(init.credentials).toBe("include");
  });

  it("merges extra headers on the JSON path and keeps application/json", async () => {
    await apiRequest("POST", "/api/x", { a: 1 }, { "x-confirm": "yes" });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["x-confirm"]).toBe("yes");
  });

  it("sends no body and no Content-Type when data is undefined (GET-like)", async () => {
    await apiRequest("POST", "/api/ping");
    const headers = (calls[0].init.headers ?? {}) as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
    expect(calls[0].init.body).toBeUndefined();
  });
});

describe("WAVE 2.5 AVI-B — apiRequest FormData path (the fix)", () => {
  it("passes FormData through as-is and does NOT set Content-Type", async () => {
    const fd = new FormData();
    fd.append("files", new Blob(["%PDF-1.4 fake"], { type: "application/pdf" }), "passport.pdf");
    await apiRequest("POST", "/api/investors/x/kyc", fd);

    expect(calls).toHaveLength(1);
    const { init } = calls[0];
    // The body is the SAME FormData instance — never JSON.stringify'd to "{}".
    expect(init.body).toBe(fd);
    expect(init.body).toBeInstanceOf(FormData);
    expect(typeof init.body).not.toBe("string");
    // Content-Type must be absent so the browser can set the multipart boundary.
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
    expect(init.credentials).toBe("include");
  });

  it("still merges extra headers on the FormData path without adding Content-Type", async () => {
    const fd = new FormData();
    fd.append("files", new Blob(["x"]), "a.png");
    await apiRequest("POST", "/api/investors/x/kyc", fd, { "x-trace": "1" });
    const headers = (calls[0].init.headers ?? {}) as Record<string, string>;
    expect(headers["x-trace"]).toBe("1");
    expect(headers["Content-Type"]).toBeUndefined();
  });
});
