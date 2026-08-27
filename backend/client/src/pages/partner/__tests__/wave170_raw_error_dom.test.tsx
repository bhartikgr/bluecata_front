/**
 * WAVE 170 · BATCH 4 ITEM B · R77 / R111 Q13 / R137.1 — RENDERED DOM.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE STUBS `fetch` AND MOUNTS THE REAL `<Toaster/>`.
 * ═══════════════════════════════════════════════════════════════════════════════
 * A passing store or resolver test is not evidence a user sees anything (R137.1),
 * and mocking `@/lib/queryClient` would remove the very boundary that CAUSES half
 * of this defect: `throwIfResNotOk` (`client/src/lib/queryClient.ts:60-65`)
 * discards any server `message` that does not "look human" and substitutes a
 * generic sentence. So `global.fetch` is stubbed instead — the REAL `apiRequest`,
 * the REAL `ApiError`, the REAL `useToast` and the REAL `<Toaster/>` are all in
 * the path, and every assertion below reads text out of the mounted DOM.
 * (Precedent: `client/src/pages/founder/__tests__/w69_v1b_create_refusal_renders.test.tsx`.)
 *
 * WHAT WAS ON SCREEN BEFORE (fail-before recorded in
 * build_log/wave170/artefacts/):
 *   · §1 a NON-`ApiError` throw inside `mutationFn` — a truncated body, so
 *     `res.json()` throws — put "Unexpected end of JSON input" in the toast. An
 *     internal string in front of a paying client (R77).
 *   · §2 an `ApiError` with no `message` — the unmapped tail of `err()`, and the
 *     legacy capital-call adapter's `{ error: "CAPITAL_CALL_FAILED" }` — put the
 *     boundary's generic apology on screen: no next step, nothing traceable.
 *
 * WHAT MUST NOT CHANGE, and is asserted here as a REGRESSION pin:
 *   · §3 wave 164's cap-split disclosure, and §4 wave 166's GP offline-confirmation
 *     refusal, still reach the GP as ONE coherent sentence — the server's own
 *     words, with nothing of ours appended beside them.
 *   · §5 the client-side money refusal `commitMut` raises itself still renders
 *     verbatim; the fix must not silence our own explanations.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerSpvDetail from "../PartnerSpvDetail";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  PARTNER_ACTION_REFUSAL_FALLBACK,
  PARTNER_ACTION_REFERENCE_NOT_ON_RECORD,
} from "@/lib/serverRefusalMessage";
import { SPV_SUBSCRIPTION_REFUSAL_HEADLINE } from "@shared/spvSubscriptionRefusalCopy";

/** R77 — an ALL_CAPS_UNDERSCORE token anywhere in rendered text is a breach. */
const INTERNAL_CODE_TOKEN = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/;

const SPV_ID = "spv_w170";
const CAP_MINOR = 90_000_000;

/* The failure the stubbed transport serves for the next write. `raw` overrides
   the JSON body byte-for-byte, which is how §1 delivers a TRUNCATED body. */
type Failure = { status: number; body?: unknown; raw?: string } | null;
let writeFailure: Failure = null;

function response(status: number, body: unknown, raw?: string): Response {
  const text = raw ?? JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: { get: () => "application/json" },
    text: async () => text,
    json: async () => JSON.parse(text),
    clone: () => response(status, body, raw),
  } as unknown as Response;
}

const spvBody = {
  spv: {
    id: SPV_ID,
    name: "W170 SPV",
    jurisdiction: "delaware",
    spvType: "spv",
    targetRaiseMinor: null,
    capMinor: CAP_MINOR,
    currency: "USD",
    status: "open",
    revisionHash: "c".repeat(64),
    createdAt: new Date().toISOString(),
    terms: null,
  },
  positions: [],
};

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method !== "GET") {
        if (writeFailure) return response(writeFailure.status, writeFailure.body ?? {}, writeFailure.raw);
        return response(201, { ok: true });
      }
      if (u.includes("lp-roster")) {
        return response(200, { spvId: SPV_ID, lpVisibility: "gp_only", subscribers: [], invites: [] });
      }
      if (u.includes("capital-calls")) return response(200, { capitalCalls: [] });
      if (u.includes("distributions")) return response(200, { distributions: [] });
      return response(200, spvBody);
    }),
  );
}

vi.mock("@/components/partner/PartnerShell", () => ({
  PartnerShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PartnerEmptyState: ({ title }: { title?: string }) => <div>{title}</div>,
}));
vi.mock("wouter", () => ({
  useRoute: () => [true, { id: SPV_ID }],
  Link: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "p_w170",
      tier: "builder",
      subRole: "managing_partner",
      identity: { userId: "u_w170", email: "gp@example.com", name: "W170 GP" },
    },
  }),
}));
vi.mock("@/lib/sseClient", () => ({ useSse: () => {}, sseSubscribe: () => () => {} }));

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const r = render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <PartnerSpvDetail />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  await screen.findByTestId("partner-spv-lp-commit-form");
  return r;
}

function type(testid: string, value: string) {
  fireEvent.change(screen.getByTestId(testid) as HTMLInputElement, { target: { value } });
}

/* ONE TOAST, NOT THE VIEWPORT. `use-toast`'s store is module-global and survives
   `cleanup()` (TOAST_LIMIT 5, no reset export), so reading the whole viewport
   would let a previous test's toast satisfy this one's assertion — and the
   NEGATIVE assertions here ("our fallback must NOT appear") are exactly the ones
   that would then be meaningless. Each test therefore identifies its OWN toast by
   title plus a marker unique to that scenario, and asserts on that node's text. */
async function toastText(title: string, marker: string): Promise<string> {
  return await waitFor(
    () => {
      const nodes = Array.from(document.querySelectorAll("li, [role='status'], [data-radix-collection-item]"));
      const hit = nodes.find((n) => {
        const t = n.textContent ?? "";
        return t.includes(title) && t.includes(marker);
      });
      if (!hit) {
        /* The whole viewport goes into the failure message ON PURPOSE: when this
           file is run against a reverted mechanism (see scratch_w170_failbefore.py)
           the retained artefact then shows the exact text that WAS on screen —
           e.g. "Unexpected end of JSON input" — instead of a bare timeout. */
        const viewport = Array.from(document.querySelectorAll("li, [role='status']"))
          .map((n) => n.textContent ?? "")
          .join(" | ");
        throw new Error(`no toast yet for "${title}" / "${marker}" — viewport shows: ${viewport}`);
      }
      return hit.textContent ?? "";
    },
    { timeout: 4000 },
  );
}

async function submitInvite() {
  type("partner-spv-lp-invite-firstname", "Ida");
  type("partner-spv-lp-invite-lastname", "Lp");
  type("partner-spv-lp-invite-email", "ida@example.com");
  fireEvent.click(screen.getByTestId("partner-spv-lp-invite-submit"));
}

async function submitCommit(amount = "1000") {
  type("partner-spv-lp-commit-firstname", "Cal");
  type("partner-spv-lp-commit-lastname", "Lp");
  type("partner-spv-lp-commit-email", "cal@example.com");
  type("partner-spv-lp-commit-units", "100");
  type("partner-spv-lp-commit-amount", amount);
  fireEvent.click(screen.getByTestId("partner-spv-lp-commit-submit"));
}

async function submitCapitalCall() {
  type("partner-spv-capital-call-amount", "5000");
  fireEvent.click(screen.getByTestId("partner-spv-capital-call-submit"));
}

beforeEach(() => {
  writeFailure = null;
  installFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/* ═══════════════════════════════════════════════════════════════════════════════
   §1 — THE RAW INTERNAL STRING. A non-ApiError throw inside `mutationFn`.
   ═══════════════════════════════════════════════════════════════════════════════
   A 201 with a TRUNCATED body: `apiRequest` returns fine and `res.json()` throws.
   Pre-wave the toast read "Unexpected end of JSON input".                        */
describe("§1 an internal string never reaches the screen", () => {
  it("1.1 invite — a truncated response body shows a plain sentence, not the parser's error", async () => {
    writeFailure = { status: 201, raw: '{"invite":' };
    await mount();
    await submitInvite();
    const t = await toastText("Invite failed", PARTNER_ACTION_REFUSAL_FALLBACK);
    expect(t).toContain("Invite failed");
    expect(t).toContain(PARTNER_ACTION_REFUSAL_FALLBACK);
    expect(t).not.toMatch(/JSON/);
    expect(t).not.toMatch(/SyntaxError/);
    expect(INTERNAL_CODE_TOKEN.test(t)).toBe(false);
  });

  it("1.2 LP commit — same shape, same outcome", async () => {
    writeFailure = { status: 201, raw: "{" };
    await mount();
    await submitCommit();
    const t = await toastText("LP commit failed", PARTNER_ACTION_REFUSAL_FALLBACK);
    expect(t).toContain("LP commit failed");
    expect(t).not.toMatch(/JSON/);
    expect(t).toContain(PARTNER_ACTION_REFUSAL_FALLBACK);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════
   §2 — THE UNMAPPED REFUSAL. A plain sentence AND a traceable reference.
   ═══════════════════════════════════════════════════════════════════════════════ */
describe("§2 an unmapped refusal names the next step and carries a reference", () => {
  it("2.1 LP commit — err()'s unmapped tail: the opaque reference is on screen, the code is not", async () => {
    writeFailure = {
      status: 500,
      body: { error: "LP_IDENTITY_PERSIST_FAILED", incidentCode: "SPV-1A2B3C4D" },
    };
    await mount();
    await submitCommit();
    const t = await toastText("LP commit failed", "SPV-1A2B3C4D");
    expect(t).toContain("SPV-1A2B3C4D");
    expect(t).toContain("nothing was changed");
    expect(t).not.toContain("LP_IDENTITY_PERSIST_FAILED");
    expect(t).not.toContain("Something went wrong on our side");
    expect(INTERNAL_CODE_TOKEN.test(t.replace("SPV-1A2B3C4D", ""))).toBe(false);
  });

  it("2.2 capital call — the legacy adapter's bare 500 says 'Not on record', never $0.00 or a dash", async () => {
    writeFailure = { status: 500, body: { error: "CAPITAL_CALL_FAILED" } };
    await mount();
    await submitCapitalCall();
    const t = await toastText("Capital call failed", PARTNER_ACTION_REFERENCE_NOT_ON_RECORD);
    expect(t).toContain("Capital call failed");
    expect(t).toContain(PARTNER_ACTION_REFERENCE_NOT_ON_RECORD);
    expect(t).not.toContain("CAPITAL_CALL_FAILED");
    expect(t).not.toContain("$0.00");
  });

  it("2.3 capital call — INVALID_BODY never renders the zod blob or the code", async () => {
    writeFailure = {
      status: 400,
      body: {
        error: "INVALID_BODY",
        details: { fieldErrors: { amount_minor: ["Expected number, received string"] } },
        incidentCode: "SPV-DEADBEEF",
      },
    };
    await mount();
    await submitCapitalCall();
    const t = await toastText("Capital call failed", "SPV-DEADBEEF");
    expect(t).toContain("SPV-DEADBEEF");
    expect(t).not.toContain("INVALID_BODY");
    expect(t).not.toContain("amount_minor");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════
   §3 / §4 — REGRESSION PINS. The structured refusals waves 164 and 166 built
   must still reach the GP intact, as ONE sentence.
   ═══════════════════════════════════════════════════════════════════════════════ */
describe("§3 wave 164's cap-split refusal is unchanged", () => {
  it("3.1 the server's own headline renders, and nothing of ours is appended to it", async () => {
    const headline = SPV_SUBSCRIPTION_REFUSAL_HEADLINE.EXCEEDS_CAP as string;
    writeFailure = {
      status: 400,
      body: {
        error: "EXCEEDS_CAP",
        message: headline,
        guidance: "the unabridged form of the same refusal",
        capSplit: { capMinor: CAP_MINOR, confirmedMinor: 41_000_029 },
      },
    };
    await mount();
    await submitCommit();
    const t = await toastText("LP commit failed", headline);
    expect(t).toContain(headline);
    expect(t).not.toContain(PARTNER_ACTION_REFUSAL_FALLBACK);
    expect(t).not.toContain("the unabridged form of the same refusal");
    expect(t).not.toContain("EXCEEDS_CAP");
  });
});

describe("§4 wave 166's GP offline-confirmation refusal is unchanged", () => {
  it("4.1 the headline renders as one sentence, with no competing message", async () => {
    const headline = SPV_SUBSCRIPTION_REFUSAL_HEADLINE.GP_OFFLINE_CONFIRMATION_REQUIRED as string;
    writeFailure = {
      status: 409,
      body: { error: "GP_OFFLINE_CONFIRMATION_REQUIRED", message: headline },
    };
    await mount();
    await submitCommit();
    const t = await toastText("LP commit failed", headline);
    expect(t).toContain(headline);
    expect(t).not.toContain(PARTNER_ACTION_REFUSAL_FALLBACK);
    expect(t).not.toContain("That action conflicts with the current state");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════
   §5 — OUR OWN EXPLANATIONS SURVIVE. `commitMut` raises the money parser's
   sentence itself, as a non-ApiError throw; silencing it would be a new defect.
   ═══════════════════════════════════════════════════════════════════════════════ */
describe("§5 the client-side money refusal still renders verbatim", () => {
  /* The capital-call channel, not the commit channel, and that is a FINDING not a
     convenience: wave 135 gates the commit submit button on the SAME parser, so a
     negative commitment cannot be submitted at all and `commitMut`'s own throw is
     unreachable from the button. The capital-call button is gated only on
     non-empty input, so its parse refusal IS reachable — and it is one of the
     three `(err as Error).message` sites this wave also routed through the
     resolver. A sentence the parser wrote must survive that routing untouched. */
  it("5.1 a negative capital-call amount is refused in words, on screen", async () => {
    await mount();
    type("partner-spv-capital-call-amount", "-5000");
    fireEvent.click(screen.getByTestId("partner-spv-capital-call-submit"));
    const t = await toastText("Capital call not recorded", "negative");
    expect(t.toLowerCase()).toContain("negative");
    expect(t).toContain("USD");
    expect(t).not.toContain(PARTNER_ACTION_REFUSAL_FALLBACK);
  });
});
