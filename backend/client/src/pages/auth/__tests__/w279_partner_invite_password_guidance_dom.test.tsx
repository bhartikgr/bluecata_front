/**
 * ════════════════════════════════════════════════════════════════════════════
 * WAVE 279 — THE PARTNER INVITE NEVER TOLD THE PARTNER TO SET A PASSWORD.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * WHAT WAS AND WAS NOT WRONG. There was **no lockout and no broken door**.
 * Redemption sets a session cookie and signs the partner straight in
 * (`server/partnerRoutes.ts:3423` and `:3479` —
 * `if (!existing.isAuthed) setSessionCookie(res, userId)`), and the whole
 * forgot-password → set-password path composes. The partner also never reads
 * the string `WRONG_PORTAL_OR_NO_ACCOUNT`; `PartnerLogin.tsx:162-164` renders
 * the server *message*, "Email or password is incorrect."
 *
 * THE DEFECT was an absence rendering as reassurance (R224.1). The entire
 * success state of `RedeemPartnerInvite.tsx:142-147` was:
 *
 *     <h1 …>Welcome</h1>
 *     <p  …>Redirecting to your workspace…</p>
 *
 * and nothing else. The partner was not told that the link they just used *was*
 * their credential, that it is now consumed, or that "Forgot password?" is the
 * way back in. On their second visit they meet "Email or password is
 * incorrect." — true, generic, and useless to someone who has never had one.
 *
 * THE FIX IS COPY ONLY. Two appended static siblings, no logic touched, no
 * literal replaced, no interstitial, and the anti-enumeration refusal wording
 * left exactly as it was.
 *
 * ── WHY THE SENTENCE IS CONDITIONAL IN LANGUAGE ─────────────────────────────
 * The engineering document suggested wording opening "You don't have a password
 * yet." **That is false for part of this population** and I did not ship it.
 * `resolveOrCreateConsortiumPartnerId` (`server/partnerRoutes.ts:251-310`)
 * reuses an existing `users`/`auth_users` identity, its `ON CONFLICT(id) DO
 * UPDATE` touches only `role` — never `password_hash` — and it seeds a
 * credential only `if (!lookupByUserId(userId))`. A partner who already had a
 * Capavate account therefore keeps the password they already know, and the
 * client has no field in the redeem response that can distinguish the two
 * cases. So the shipped sentence says "If you have not set a password yet",
 * which is true for both, rather than asserting a state the platform does not
 * know. §1.3 pins that.
 *
 * ── HOW THIS FILE AVOIDS PROVING NOTHING ────────────────────────────────────
 * "the sentence is present" is satisfied by a page that renders nothing only if
 * the assertion is unscoped or unpaired. Counter-measures:
 *   · §0 is a POSITIVE CONTROL: the two protected pre-existing lines must still
 *     render byte-identically on the same mounted screen. If §0 is red, every
 *     other assertion here is void.
 *   · every query is scoped to the success block / the login form by testId.
 *   · §2 asserts POSITION (`lastElementChild`), not just presence, so appending
 *     in the wrong place fails even though the text is there.
 *   · §3 asserts the sentence is ABSENT from the error screen, so a sentence
 *     hoisted out of the conditional branch fails.
 *   · §5 asserts the refusal wording is EXACTLY unchanged — this wave must not
 *     have "improved" it.
 *   · §6 is labelled a SOURCE PIN, not execution, because it is one.
 *
 * Both real exported page components are mounted. No replica.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import fs from "node:fs";
import path from "node:path";

if (typeof globalThis.ResizeObserver === "undefined") {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }), toast: vi.fn() }));

const setLocationMock = vi.fn();
let routeToken = "tok_w279";

vi.mock("wouter", async () => {
  const react = await vi.importActual<typeof import("react")>("react");
  return {
    useLocation: () => ["/auth/redeem-partner-invite/tok_w279", setLocationMock],
    useSearch: () => "",
    useRoute: () => [true, { token: routeToken }],
    useRouter: () => ({}),
    Redirect: () => null,
    Link: ({ href, children, ...rest }: { href?: string; children?: React.ReactNode }) =>
      react.createElement("a", { href: href ?? "#", ...rest }, children),
  };
});

/** Mirrors the shape `client/src/lib/queryClient.ts` throws on a non-2xx, which
 *  `RedeemPartnerInvite` narrows with `e instanceof ApiError`. */
class ApiErrorStub extends Error {
  code?: string;
  payload?: unknown;
  constructor(message: string, code?: string, payload?: unknown) {
    super(message);
    this.code = code;
    this.payload = payload;
  }
}

const apiRequestMock = vi.fn();

vi.mock("@/lib/queryClient", () => ({
  apiRequest: (...args: unknown[]) => apiRequestMock(...args),
  ApiError: ApiErrorStub,
  queryClient: { clear: vi.fn(), invalidateQueries: vi.fn(), setQueryData: vi.fn() },
}));

const setRoleMock = vi.fn();
vi.mock("@/lib/role", () => ({
  useRole: () => ({ role: null, setRole: setRoleMock }),
  RoleProvider: ({ children }: { children?: React.ReactNode }) => children,
}));

function mount(el: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, queryFn: async () => ({ isAuthed: false }) } },
  });
  return render(<QueryClientProvider client={qc}>{el}</QueryClientProvider>);
}

function ok(body: unknown = {}) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

afterEach(() => {
  cleanup();
  apiRequestMock.mockReset();
  setLocationMock.mockReset();
  routeToken = "tok_w279";
});

/* ── the exact literals under protection, written out once ─────────────────── */
const WELCOME = "Welcome";
const REDIRECTING = "Redirecting to your workspace…";
const FOURTEEN_DAY =
  "Magic links expire after 14 days and can only be used once. Ask your managing partner to send a new invite if needed.";
const MISMATCH_COPY =
  "You're currently signed in to a different Capavate account. We won't bind this invite to your current session for security reasons.";
const REFUSAL = "Email or password is incorrect.";
const NEW_REDEEM_SENTENCE =
  "You're signed in now. This invite link was your key and it can only be used once, so it will not work again. If you have not set a password yet, use the Forgot password? link on the partner login page to set one before you sign in next time.";
const NEW_LOGIN_HINT =
  "Just accepted an invite? Use the Forgot password? link to set your password for the first time.";

async function mountRedeemSuccess() {
  apiRequestMock.mockImplementation(async () => ok({ ok: true, partnerId: "p_1", subRole: "managing_partner" }));
  const { default: RedeemPartnerInvite } = await import("@/pages/auth/RedeemPartnerInvite");
  mount(<RedeemPartnerInvite />);
  await waitFor(() => expect(screen.getByTestId("partner-redeem-success")).toBeTruthy());
  return screen.getByTestId("partner-redeem-success");
}

async function mountRedeemMismatch() {
  apiRequestMock.mockImplementation(async (_m: string, url: string) => {
    if (url === "/api/auth/me") return ok({ isAuthed: true, identity: { email: "other@example.com" } });
    throw new ApiErrorStub("403: mismatch", "PARTNER_INVITATION_EMAIL_MISMATCH", {
      message: "This invitation was sent to a different email. Please log out and redeem with the invited address.",
      invitedEmail: "invited@example.com",
    });
  });
  const { default: RedeemPartnerInvite } = await import("@/pages/auth/RedeemPartnerInvite");
  mount(<RedeemPartnerInvite />);
  await waitFor(() => expect(screen.getByTestId("partner-redeem-error")).toBeTruthy());
  return screen.getByTestId("partner-redeem-error");
}

// ─────────────────────────────────────────────────────────────────────────────
describe("W279 §0 — POSITIVE CONTROL: the protected lines still render, byte-identically", () => {
  it("the success screen still says exactly 'Welcome' and 'Redirecting to your workspace…'", async () => {
    const block = await mountRedeemSuccess();
    /* If either of these is red, this wave degraded protected onboarding copy
       AND every assertion below is void, because the screen did not mount as
       expected. Both are asserted by exact string, not by substring of a blob. */
    expect(block.querySelector("h1")?.textContent).toBe(WELCOME);
    const paragraphs = Array.from(block.querySelectorAll("p")).map((p) => p.textContent?.trim() ?? "");
    expect(paragraphs[0]).toBe(REDIRECTING);
    expect(paragraphs.length, "the success block should now hold exactly two paragraphs").toBe(2);
  });
});

describe("W279 §1 — the redeem success screen now names the password step", () => {
  it("§1.1 the appended sentence renders, in the success block, scoped", async () => {
    const block = await mountRedeemSuccess();
    const hint = screen.getByTestId("partner-redeem-set-password-hint");
    expect(block.contains(hint), "the hint must be inside the success block, not floating elsewhere").toBe(true);
    expect(hint.textContent?.trim()).toBe(NEW_REDEEM_SENTENCE);
  });

  it("§1.2 it states all three facts the partner needs", async () => {
    await mountRedeemSuccess();
    const t = screen.getByTestId("partner-redeem-set-password-hint").textContent ?? "";
    /* (a) they are in — matches setSessionCookie at partnerRoutes.ts:3423/:3479 */
    expect(t).toContain("You're signed in now.");
    /* (b) the link was the credential and is spent — matches the single-use
           consume at partnerRoutes.ts:3402 */
    expect(t).toContain("This invite link was your key and it can only be used once");
    /* (c) the exact control to use, named as it is labelled on the login page */
    expect(t).toContain("Forgot password?");
    expect(t).toContain("partner login page");
  });

  it("§1.3 it does NOT assert that the partner has no password — a claim the platform cannot make", async () => {
    await mountRedeemSuccess();
    const t = screen.getByTestId("partner-redeem-set-password-hint").textContent ?? "";
    /* resolveOrCreateConsortiumPartnerId reuses an existing identity and never
       clobbers password_hash, so an already-registered partner keeps the
       password they know. The sentence must stay conditional. */
    expect(t).toContain("If you have not set a password yet");
    expect(t).not.toContain("You don't have a password");
    expect(t).not.toContain("You do not have a password");
    /* R227.2 — never write "verified" about a person. */
    expect(t.toLowerCase()).not.toContain("verified");
  });
});

describe("W279 §2 — POSITION: appended as the LAST child, so no existing sibling moved", () => {
  it("the hint is the success block's lastElementChild, and the two protected lines precede it in order", async () => {
    const block = await mountRedeemSuccess();
    const hint = screen.getByTestId("partner-redeem-set-password-hint");
    expect(block.lastElementChild).toBe(hint);
    const order = Array.from(block.children).map((el) => el.tagName.toLowerCase());
    expect(order).toEqual(["h1", "p", "p"]);
    expect(block.children[0].textContent).toBe(WELCOME);
    expect(block.children[1].textContent?.trim()).toBe(REDIRECTING);
  });
});

describe("W279 §3 — the ERROR screen is untouched, and the new sentence does not leak into it", () => {
  it("§3.1 the email-mismatch recovery panel, its button and the 14-day sentence all still render", async () => {
    const block = await mountRedeemMismatch();
    expect(block.querySelector("h1")?.textContent).toBe("Could not redeem invite");
    expect(block.textContent).toContain(MISMATCH_COPY);
    expect(screen.getByTestId("partner-redeem-invited-email").textContent).toBe("invited@example.com");
    await waitFor(() =>
      expect(screen.getByTestId("partner-redeem-logged-in-email").textContent).toBe("other@example.com"),
    );
    const btn = screen.getByTestId("partner-redeem-logout-retry");
    expect(btn.textContent?.trim()).toBe("Log out and continue");
    expect(block.textContent).toContain(FOURTEEN_DAY);
  });

  it("§3.2 the appended sentence is ABSENT on the error screen — it was not hoisted out of the success branch", async () => {
    const block = await mountRedeemMismatch();
    expect(screen.queryByTestId("partner-redeem-set-password-hint")).toBeNull();
    expect(block.textContent).not.toContain("If you have not set a password yet");
  });
});

describe("W279 §4 — the partner login page points a first-time partner at the right control", () => {
  async function mountLogin() {
    apiRequestMock.mockImplementation(async () => ok({ ok: true }));
    const { default: PartnerLogin } = await import("@/pages/partner/PartnerLogin");
    mount(<PartnerLogin />);
    return await waitFor(() => screen.getByTestId("form-partner-login"));
  }

  it("§4.1 the hint renders and names 'Forgot password?'", async () => {
    await mountLogin();
    const hint = screen.getByTestId("text-partner-login-first-password-hint");
    expect(hint.textContent?.trim()).toBe(NEW_LOGIN_HINT);
    expect(hint.textContent).toContain("Forgot password?");
  });

  it("§4.2 it is the LAST child of the form — the existing controls did not move", async () => {
    const form = await mountLogin();
    const hint = screen.getByTestId("text-partner-login-first-password-hint");
    expect(form.lastElementChild).toBe(hint);
  });

  it("§4.3 the 'Forgot password?' link itself is unchanged: same label, same href, same testid", async () => {
    await mountLogin();
    const link = screen.getByTestId("link-forgot");
    expect(link.textContent?.trim()).toBe("Forgot password?");
    expect(link.getAttribute("href")).toBe("/auth/forgot");
  });
});

describe("W279 §5 — ANTI-ENUMERATION: the login refusal wording is EXACTLY as it was", () => {
  it("a 401 still renders 'Email or password is incorrect.' and never an error code", async () => {
    apiRequestMock.mockImplementation(async (_m: string, url: string) => {
      if (url === "/api/auth/login") {
        throw new Error(`401: ${JSON.stringify({ error: "WRONG_PORTAL_OR_NO_ACCOUNT", message: REFUSAL })}`);
      }
      return ok({ ok: true });
    });
    const { default: PartnerLogin } = await import("@/pages/partner/PartnerLogin");
    mount(<PartnerLogin />);

    fireEvent.change(await waitFor(() => screen.getByTestId("input-partner-email")), {
      target: { value: "nobody@example.com" },
    });
    fireEvent.change(screen.getByTestId("input-partner-password"), { target: { value: "whatever" } });
    fireEvent.click(screen.getByTestId("button-submit-partner-login"));

    const alert = await waitFor(() => screen.getByTestId("text-partner-login-error"));
    /* The server's own sentence, verbatim. Not "improved", not made specific to
       partners — a specific refusal would tell an attacker which addresses are
       registered partners. */
    expect(alert.textContent).toContain(REFUSAL);
    expect(alert.textContent).not.toContain("WRONG_PORTAL");
    expect(alert.textContent).not.toContain("NO_ACCOUNT");
    /* and the first-password hint is still on the page, below the form */
    expect(screen.getByTestId("text-partner-login-first-password-hint").textContent?.trim()).toBe(NEW_LOGIN_HINT);
  });
});

describe("W279 §6 — SOURCE PINS, not execution: the server invariants this wave relies on", () => {
  /* HONEST LABEL. These read source text. They are NOT proof that the running
     server behaves this way. The HTTP end-to-end test the engineering document
     asks for (redeem → /api/auth/forgot → /auth/set-password → login) was NOT
     run: `server/lib/emailSender.ts` defaults `SMTP_MODE` to "smtp" with no
     NODE_ENV guard, and `work/.env` holds live Gmail credentials, so exercising
     /api/auth/forgot risks a real send from the owner's business address —
     exactly the incident R241.0 was written about. That claim remains
     unproven and is reported as unproven. */
  const ROOT = path.resolve(__dirname, "../../../../..");
  const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

  it("§6.1 redemption still SIGNS THE PARTNER IN — both branches set a session cookie", () => {
    const s = read("server/partnerRoutes.ts");
    expect(s).toContain("if (!existingCtx.isAuthed) setSessionCookie(res, approvedUserId);");
    expect(s).toContain("if (!existing.isAuthed) setSessionCookie(res, userId);");
  });

  it("§6.2 the single-use consume still carries its `consumed_at IS NULL` guard", () => {
    const s = read("server/partnerRoutes.ts");
    expect(s).toContain("SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL");
    expect(s).toContain('PARTNER_INVITATION_ALREADY_REDEEMED');
  });

  it("§6.3 an existing partner's password is NEVER clobbered — the basis for §1.3's wording", () => {
    const s = read("server/partnerRoutes.ts");
    /* ON CONFLICT updates `role` only; password_hash is not in the SET list. */
    expect(s).toContain(
      "ON CONFLICT(id) DO UPDATE SET role = CASE WHEN auth_users.role = 'admin' THEN 'admin' ELSE 'consortium_partner' END",
    );
    expect(s).toContain("if (!lookupByUserId(userId)) {");
  });

  it("§6.4 the token-as-credential design is untouched, comment and all (R195.5)", () => {
    const s = read("server/partnerRoutes.ts");
    expect(s).toContain("the single-use token is the real credential.");
  });

  it("§6.5 the server refusal still carries the generic message alongside the code", () => {
    const s = read("server/lib/authRoutes.ts");
    expect(s).toContain("WRONG_PORTAL_OR_NO_ACCOUNT");
    expect(s).toContain("Email or password is incorrect.");
  });

  it("§6.6 the sacred user-context module was not touched by this wave", () => {
    /* userContext.ts is FROZEN. This wave's whole shape exists to avoid it. */
    const s = read("client/src/pages/auth/RedeemPartnerInvite.tsx");
    expect(s).not.toContain("userContext");
    expect(s).not.toContain("registerPersona");
  });
});
