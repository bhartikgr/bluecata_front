/**
 * Real Redeem + shared UI controls + QueryClient + actual apiRequest error
 * parsing. Only transport, navigation and role/toast side effects are mocked.
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Redeem from "../Redeem";

const { navigate, setRole, toast } = vi.hoisted(() => ({
  navigate: vi.fn(), setRole: vi.fn(), toast: vi.fn(),
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/auth/redeem", navigate],
  Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));
vi.mock("@/lib/role", () => ({ useRole: () => ({ setRole }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }), toast }));

let preview: any;
let previewStatus = 200;
let postBody: any = { ok: true, kind: "team", redirectTo: "/founder/dashboard" };
let postStatus = 200;
let fetchMock: ReturnType<typeof vi.fn>;
let qc: QueryClient;
const token = "claim-fixture";
function posts() {
  return fetchMock.mock.calls.filter(([, options]) => options?.method === "POST");
}
function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
function mount(search = `?token=${token}`) {
  window.history.replaceState({}, "", `/auth/redeem${search}`);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={qc}><Redeem /></QueryClientProvider>);
}
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  preview = {
    ok: true, existingAccount: true, sessionState: "sign_in_required",
    invitation: {
      kind: "team", companyId: "co_fixture", companyName: "Fixture Company",
      inviteeEmail: "invited@test.example", inviteeName: "Invited Owner",
      role: "owner", expiresAt: new Date(Date.now() + 86400000).toISOString(),
    },
  };
  previewStatus = postStatus = 200;
  postBody = { ok: true, kind: "team", redirectTo: "/founder/dashboard" };
  fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (String(url).includes("/api/auth/redeem/preview")) return response(preview, previewStatus);
    if (String(url).endsWith("/api/auth/redeem") && options?.method === "POST") return response(postBody, postStatus);
    throw new Error(`Unexpected local fixture request: ${String(url)}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  qc?.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("A0 existing team DOM: canonical login and explicit acceptance", () => {
  it("existing account has no password form and only canonical internal login return", async () => {
    mount();
    const signin = await screen.findByTestId("link-team-invitation-signin");
    expect(screen.queryByTestId("input-password")).toBeNull();
    expect(screen.queryByTestId("checkbox-tos")).toBeNull();
    const login = new URL(signin.getAttribute("href")!, "https://capavate.test");
    expect(login.pathname).toBe("/login");
    expect(login.searchParams.get("returnTo")).toBe(`/auth/redeem?token=${token}&continue=1`);
    expect((screen.getByTestId("input-email-locked") as HTMLInputElement).value).toBe("invited@test.example");
    expect(posts()).toHaveLength(0);
  });
  it.each(["//evil.example", "https://evil.example", "/\\evil", "x&returnTo=//evil.example#bad"])(
    "encodes token as data and ignores a supplied unsafe return target: %s", async unsafe => {
      mount(`?token=${encodeURIComponent(unsafe)}&returnTo=${encodeURIComponent(unsafe)}`);
      const href = (await screen.findByTestId("link-team-invitation-signin")).getAttribute("href")!;
      const login = new URL(href, "https://capavate.test");
      expect(login.origin).toBe("https://capavate.test");
      expect(login.pathname).toBe("/login");
      const rt = login.searchParams.get("returnTo")!;
      expect(rt.startsWith("/auth/redeem?token=")).toBe(true);
      const claim = new URL(rt, login.origin);
      expect(claim.origin).toBe(login.origin);
      expect(claim.pathname).toBe("/auth/redeem");
      expect(claim.searchParams.get("token")).toBe(unsafe);
      expect(claim.searchParams.get("returnTo")).toBeNull();
      expect(claim.searchParams.get("continue")).toBe("1");
    },
  );
  it("continue=1 is not authentication and never auto-accepts a team invitation", async () => {
    mount(`?token=${token}&continue=1`);
    await screen.findByTestId("link-team-invitation-signin");
    expect(screen.queryByTestId("form-redeem-team-accept")).toBeNull();
    expect(posts()).toHaveLength(0);
  });
  it("matching session requires a fresh checkbox and an explicit Accept action; no password payload", async () => {
    preview.sessionState = "matching";
    mount(`?token=${token}&continue=1`);
    const accept = await screen.findByTestId("button-accept-team-invitation") as HTMLButtonElement;
    expect(accept.disabled).toBe(true);
    expect(screen.queryByTestId("input-password")).toBeNull();
    expect(screen.getByTestId("checkbox-tos").getAttribute("aria-checked")).toBe("false");
    expect(posts()).toHaveLength(0);
    fireEvent.click(screen.getByTestId("checkbox-tos"));
    expect(accept.disabled).toBe(false);
    expect(posts()).toHaveLength(0);
    fireEvent.click(accept);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/founder/dashboard"));
    expect(posts()).toHaveLength(1);
    expect(JSON.parse(posts()[0][1].body)).toEqual({ token, agreedToTerms: true });
    expect(setRole).toHaveBeenCalledWith("founder");
  });
  it("wrong-session preview gives truthful recovery and never logs another account out", async () => {
    preview.sessionState = "mismatch";
    mount();
    const text = await screen.findByTestId("text-redeem-session-mismatch");
    expect(text.textContent).toContain("different account");
    expect(text.textContent).toContain("Sign out, then sign in");
    expect(text.textContent).toContain("not been signed out automatically");
    expect(screen.queryByTestId("button-accept-team-invitation")).toBeNull();
    expect(screen.queryByTestId("input-password")).toBeNull();
    expect(posts()).toHaveLength(0);
  });
  it.each([
    ["SESSION_IDENTITY_MISMATCH", 403, "different account"],
    ["INVITED_IDENTITY_AMBIGUOUS", 409, "cannot safely match"],
    ["INVITED_IDENTITY_DELETED", 409, "deleted"],
    ["ACCOUNT_NOT_ACTIVE", 403, "not active"],
    ["ACCOUNT_STATUS_UNAVAILABLE", 503, "could not confirm"],
    ["ACCOUNT_RESOLUTION_UNAVAILABLE", 503, "could not confirm"],
    ["SIGN_IN_REQUIRED_TO_ACCEPT", 401, "Sign in with the invited email"],
    ["INVITED_IDENTITY_STATE_CHANGED", 409, "Refresh this page"],
    ["IDENTITY_STATE_NEEDS_OPERATOR", 503, "administrator attention"],
  ])("actual ApiError code %s renders distinctly after Accept", async (code, status, text) => {
    preview.sessionState = "matching";
    postStatus = status as number;
    postBody = { ok: false, error: code };
    mount();
    await screen.findByTestId("button-accept-team-invitation");
    fireEvent.click(screen.getByTestId("checkbox-tos"));
    fireEvent.click(screen.getByTestId("button-accept-team-invitation"));
    const error = await screen.findByTestId("text-redeem-submit-error");
    expect(error.textContent).toContain(text);
    expect(error.textContent).not.toContain("already been redeemed");
    expect(error.textContent).not.toContain("expired");
    expect(navigate).not.toHaveBeenCalled();
    expect(screen.getByTestId("link-team-invitation-signin")).toBeTruthy();
  });
  it.each([
    ["INVITED_IDENTITY_AMBIGUOUS", 409, "cannot safely match"],
    ["INVITED_IDENTITY_DELETED", 409, "deleted"],
    ["ACCOUNT_RESOLUTION_UNAVAILABLE", 503, "could not confirm"],
    ["revoked", 404, "was revoked"],
    ["expired", 410, "has expired"],
  ])("preview %s is not mislabeled as a used/invalid link", async (code, status, text) => {
    previewStatus = status as number;
    preview = { ok: false, kind: "team", error: code };
    mount();
    const error = await screen.findByTestId("text-redeem-error");
    expect(error.textContent).toContain(text);
    expect(error.textContent).not.toContain("already been redeemed");
    expect(posts()).toHaveLength(0);
  });
});

describe("A0 new team and untouched investor branches", () => {
  it("new team locked-email copy describes the invitation without claiming sending or delivery", async () => {
    preview.existingAccount = false;
    mount();
    await screen.findByTestId("form-redeem");
    const emailBlock = screen.getByTestId("input-email-locked").parentElement!;
    expect(emailBlock.textContent).toContain("Locked — this is the address on this invitation.");
    expect(emailBlock.textContent).not.toMatch(/\bsent\b|\bdelivered\b|\bdelivery\b/i);
  });
  it("new team form says company/team, not round, and retains signup + terms", async () => {
    preview.existingAccount = false;
    mount();
    await screen.findByTestId("form-redeem");
    expect(screen.getByRole("heading", { name: "Create your account to join the company" })).toBeTruthy();
    expect(screen.queryByTestId("row-round")).toBeNull();
    expect(screen.getByTestId("row-team-role").textContent).toContain("owner");
    expect(screen.getByTestId("button-submit-redeem").textContent).toBe("Create account and join company");
    fireEvent.change(screen.getByTestId("input-password"), { target: { value: "Fixture-only-password" } });
    fireEvent.change(screen.getByTestId("input-confirm"), { target: { value: "Fixture-only-password" } });
    fireEvent.click(screen.getByTestId("checkbox-tos"));
    fireEvent.click(screen.getByTestId("button-submit-redeem"));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/founder/dashboard"));
    expect(JSON.parse(posts()[0][1].body)).toEqual({ token, password: "Fixture-only-password", agreedToTerms: true });
  });
  it("new team durable-persistence failure is truthful, not invalid invitation", async () => {
    preview.existingAccount = false;
    postStatus = 500; postBody = { ok: false, error: "PERSONA_NOT_DURABLE" };
    mount();
    await screen.findByTestId("form-redeem");
    fireEvent.change(screen.getByTestId("input-password"), { target: { value: "Fixture-only-password" } });
    fireEvent.change(screen.getByTestId("input-confirm"), { target: { value: "Fixture-only-password" } });
    fireEvent.click(screen.getByTestId("checkbox-tos"));
    fireEvent.click(screen.getByTestId("button-submit-redeem"));
    expect((await screen.findByTestId("text-redeem-submit-error")).textContent).toContain("has not been accepted");
  });
  it("new investor retains round labels, password form and original login footer", async () => {
    preview.existingAccount = false;
    delete preview.invitation.kind;
    mount();
    await screen.findByTestId("form-redeem");
    expect(screen.getByTestId("row-round")).toBeTruthy();
    expect(screen.getByTestId("input-password")).toBeTruthy();
    expect(screen.getByTestId("button-submit-redeem").textContent).toBe("View this round");
    expect(screen.getByTestId("link-redeem-existing").getAttribute("href")).toBe("/auth/login?portal=investor");
    expect(screen.getByTestId("input-email-locked").parentElement!.textContent)
      .toContain("Locked — this is the address the invitation was sent to.");
  });
  it("existing investor still posts continue and follows its canonical requiresLogin response", async () => {
    delete preview.invitation.kind;
    postBody = { ok: true, requiresLogin: true, redirectTo: "/login?returnTo=%2Finvestor" };
    mount();
    fireEvent.click(await screen.findByTestId("button-redeem-existing-signin"));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/login?returnTo=%2Finvestor"));
    expect(JSON.parse(posts()[0][1].body)).toEqual({ token, continue: true });
  });
  it("only existing investor retains automatic continue consumption", async () => {
    delete preview.invitation.kind;
    postBody = { ok: true, redirectTo: "/investor/invitations/fixture" };
    mount(`?token=${token}&continue=1`);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/investor/invitations/fixture"));
    expect(posts()).toHaveLength(1);
    expect(JSON.parse(posts()[0][1].body)).toEqual({ token, continue: true });
    expect(setRole).toHaveBeenCalledWith("investor");
  });
});
