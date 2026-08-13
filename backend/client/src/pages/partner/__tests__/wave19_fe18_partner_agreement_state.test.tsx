/**
 * WAVE 19 · FE-18 — the partner agreement signature state.
 *
 * THE ROW'S PREMISE DOES NOT SURVIVE READING THE CODE, and this is recorded
 * rather than quietly worked around. Wave 7B asked for `signedVersion` to be
 * displayed. It ALREADY IS: `PartnerAgreementSign.tsx:218` renders
 * `Agreement {displayAgreementVersion(data?.signedVersion ?? version)} signed on
 * {formatDate(effectiveSignedAt)}`. Building "to the row" would have produced a
 * duplicate of something shipped, while the two defects actually sitting on
 * this page went out with the wave.
 *
 * DEFECT 1 — A FAILED LOAD RENDERED A SIGNABLE LEGAL AGREEMENT.
 * `isForbidden` only covers 403. Any other failure — 500, 502, a dropped
 * connection — left `data === undefined` and fell straight through to the main
 * render, where:
 *     agreementText = data?.agreement?.text ?? CONSORTIUM_AGREEMENT_TEXT
 *     version       = data?.agreement?.version ?? "—"
 *     canSign       = data?.canSign !== false          → TRUE for undefined
 * so the partner was shown the CLIENT-BUNDLED agreement text, labelled with an
 * unknown version, with a live "Sign agreement" button. Not a fabricated `$0`:
 * a fabricated signature surface on a contract governing commission economics,
 * SPV fees and payout terms. This is rule 3 at its sharpest — the failure must
 * be RENDERED.
 *
 * DEFECT 2 — A SUPERSEDED SIGNATURE WAS SILENTLY DROPPED FROM THE UI.
 * The server returns three distinct fields and the page consumed one:
 *     signed         — has this partner EVER signed
 *     signedCurrent  — signed && version === agreement.version
 *                      (server/lib/partnerSelfServiceRoutes.ts:322)
 *     signedVersion  — what they signed
 * `alreadySigned = !!data?.signedCurrent` (`:106`), so a partner who signed v1
 * when v2 is current got a BARE SIGN FORM with no mention of the signature the
 * server was returning in the very same payload. "Existing functionality must be
 * reflected in the UI", and an executed agreement is not a detail.
 *
 * SECOND PATH (rule 2). `GET /api/partner/me/agreement`
 * (`server/lib/partnerSelfServiceRoutes.ts:313-329`) has exactly one client
 * reader — this page; grepped, not assumed. The related
 * `GET /api/partner/me/subscription` returns an `agreement` config block but no
 * signature state, so it is not a second instance of either defect. The write
 * gate `requireSignedAgreement` redirects HERE, which is why a fabricated
 * signable state on this page is the whole system's signature story.
 *
 * MONEY. This surface renders no amount — the agreement text describes fee
 * mechanics in prose, and no minor-unit value is displayed. Fenced below with a
 * positive pole rather than assumed.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "ac_consortium_partner_test_partner_inc",
      tier: "builder",
      subRole: "managing_partner",
      identity: { userId: "u_avi_managing", email: "avi@example.com", name: "Test Partner Inc" },
    },
  }),
}));

vi.mock("@/components/partner/PartnerShell", async () => {
  const actual = await vi.importActual<typeof import("@/components/partner/PartnerShell")>(
    "@/components/partner/PartnerShell",
  );
  return {
    ...actual,
    PartnerShell: ({ children, title }: { children: React.ReactNode; title?: string }) => (
      <div data-testid="partner-shell" data-shell-title={title}>{children}</div>
    ),
  };
});

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

import { ApiError } from "@/lib/queryClient";
import PartnerAgreementSign from "../PartnerAgreementSign";
import { CONSORTIUM_AGREEMENT_TEXT } from "@shared/consortiumAgreement";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        queryFn: async ({ queryKey }) => {
          const url = queryKey.filter((k) => typeof k === "string").join("/").replace(/\/+/g, "/");
          return (await apiRequestMock("GET", url)).json();
        },
      },
      mutations: { retry: false },
    },
  });
}

function renderPage() {
  const { hook } = memoryLocation({ path: "/collective/partner/agreement", static: false });
  return render(
    <QueryClientProvider client={makeClient()}>
      <Router hook={hook}>
        <TooltipProvider><PartnerAgreementSign /></TooltipProvider>
      </Router>
    </QueryClientProvider>,
  );
}

/** The FULL server payload shape. Overrides are applied on top so a test states
 *  only the field it is about, and a field it forgets is realistic, not absent. */
function agreementPayload(over: Record<string, unknown> = {}) {
  return {
    agreement: { version: "v2", url: null, text: "CURRENT SERVER AGREEMENT BODY", finalDocUrl: null, isDraft: false },
    signed: false,
    signedCurrent: false,
    signedAt: null,
    signedVersion: null,
    canSign: true,
    ...over,
  };
}

function mockAgreement(impl: () => Promise<Response>) {
  apiRequestMock.mockImplementation(async (method: string, url: string) => {
    if (url === "/api/partner/me/agreement" && method === "GET") return impl();
    return jsonResponse({ ok: true });
  });
}

const MONEY_SHAPES = [/[$€£¥]\s?\d/, /\b\d+\.\d{2}\b/, /\bamountMinor\b/, /\/\s?100\b/];
function moneyFragments(text: string): string[] {
  return MONEY_SHAPES.filter((re) => re.test(text)).map((re) => String(re));
}

afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
});
beforeEach(() => apiRequestMock.mockReset());

/* ==================================================================== */
describe("FE-18 defect 1 — a failed load is a refusal, never a signable agreement", () => {
  for (const status of [500, 502, 404]) {
    it(`a ${status} renders the refusal and NO sign affordance`, async () => {
      mockAgreement(async () => {
        throw new ApiError(status, "boom", null, { ok: false });
      });
      renderPage();
      const alert = await screen.findByTestId("partner-agreement-load-failed");
      expect(alert.getAttribute("role")).toBe("alert");
      expect(alert.textContent).toContain("could not be loaded");

      /* THE defect, stated as the three things that must not be on screen. */
      expect(screen.queryByTestId("button-sign-agreement")).toBeNull();
      expect(screen.queryByTestId("checkbox-agreement-accept")).toBeNull();
      expect(screen.queryByTestId("input-agreement-signature")).toBeNull();
    });
  }

  it("the CLIENT-BUNDLED fallback agreement text is not presented as the agreement", async () => {
    /* The sharpest form of the defect: `agreementText` fell back to
       CONSORTIUM_AGREEMENT_TEXT, so the partner read a document the server had
       not sent and could sign it. */
    mockAgreement(async () => {
      throw new ApiError(500, "boom", null, { ok: false });
    });
    renderPage();
    await screen.findByTestId("partner-agreement-load-failed");
    expect(screen.queryByTestId("partner-agreement-text")).toBeNull();
    const firstWords = CONSORTIUM_AGREEMENT_TEXT.replace(/<[^>]*>/g, " ").trim().slice(0, 40);
    expect(firstWords.length).toBeGreaterThan(10);
    expect(document.body.textContent ?? "").not.toContain(firstWords);
  });

  it("no unknown-version placeholder is presented as a version", async () => {
    mockAgreement(async () => {
      throw new ApiError(500, "boom", null, { ok: false });
    });
    renderPage();
    await screen.findByTestId("partner-agreement-load-failed");
    /* Pre-fix the header rendered `displayAgreementLabel("—")`. A dash is not a
       version, and a legal document labelled with one must not be signable. */
    expect(screen.queryByTestId("button-sign-agreement")).toBeNull();
  });

  it("the refusal offers a retry that re-issues the request", async () => {
    let calls = 0;
    mockAgreement(async () => {
      calls += 1;
      throw new ApiError(500, "boom", null, { ok: false });
    });
    renderPage();
    await screen.findByTestId("partner-agreement-load-failed");
    const before = calls;
    fireEvent.click(screen.getByTestId("button-retry-agreement"));
    await waitFor(() => expect(calls).toBeGreaterThan(before));
  });

  it("403 STILL takes the pre-existing managing-partner path — the fix must not swallow it", async () => {
    mockAgreement(async () => {
      throw new ApiError(403, "forbidden", null, { ok: false });
    });
    renderPage();
    const forbidden = await screen.findByTestId("partner-agreement-forbidden");
    expect(forbidden.textContent).toContain("The partner agreement is signed by your managing partner.");
    expect(screen.queryByTestId("partner-agreement-load-failed")).toBeNull();
    /* And its own copy is byte-identical — an addition, never a replacement. */
  });

  it("POSITIVE POLE — a successful load still renders a signable agreement", async () => {
    mockAgreement(async () => jsonResponse(agreementPayload()));
    renderPage();
    expect(await screen.findByTestId("button-sign-agreement")).toBeTruthy();
    expect(screen.getByTestId("partner-agreement-text")).toBeTruthy();
    expect(screen.queryByTestId("partner-agreement-load-failed")).toBeNull();
  });

  it("POSITIVE POLE — canSign:false still renders the pre-existing cannot-sign notice, not the refusal", async () => {
    mockAgreement(async () => jsonResponse(agreementPayload({ canSign: false })));
    renderPage();
    const notice = await screen.findByTestId("partner-agreement-cannot-sign");
    expect(notice.textContent).toContain("Only your managing partner can sign the Consortium Partner Agreement.");
    expect(screen.queryByTestId("partner-agreement-load-failed")).toBeNull();
    expect(screen.queryByTestId("button-sign-agreement")).toBeNull();
  });
});

/* ==================================================================== */
describe("FE-18 defect 2 — a superseded signature is stated, not dropped", () => {
  it("THE DEFECT: signed v1 while v2 is current shows the prior signature", async () => {
    mockAgreement(async () =>
      jsonResponse(
        agreementPayload({
          signed: true,
          signedCurrent: false,
          signedVersion: "v1",
          signedAt: "2026-03-04T10:00:00.000Z",
        }),
      ),
    );
    renderPage();
    const notice = await screen.findByTestId("partner-agreement-superseded");
    /* The version they signed, and WHEN — both were in the payload and neither
       reached the screen pre-fix. */
    /* RAW ids, not `displayAgreementVersion()`. That helper
       (partnerAgreement.ts:38) ignores its argument and returns the constant
       "Version 1.0", so rendering both versions through it would print the same
       string twice and communicate nothing. This assertion failed on first run
       and is what surfaced that — recorded rather than relaxed. */
    expect(notice.textContent).toMatch(/v1/i);
    expect(notice.textContent).toMatch(/2026/);
    expect(notice.textContent).toContain("has not been withdrawn");
  });

  it("and the CURRENT version is still signable — this is a notice, not a block", async () => {
    mockAgreement(async () =>
      jsonResponse(
        agreementPayload({ signed: true, signedCurrent: false, signedVersion: "v1", signedAt: "2026-03-04T10:00:00.000Z" }),
      ),
    );
    renderPage();
    await screen.findByTestId("partner-agreement-superseded");
    expect(screen.getByTestId("button-sign-agreement")).toBeTruthy();
    /* Over-correcting into a block would strand every partner on an agreement
       bump, so the opposite pole is asserted too. */
    expect(screen.getByTestId("checkbox-agreement-accept")).toBeTruthy();
  });

  it("the notice names the CURRENT version too, so the partner knows what they are signing", async () => {
    mockAgreement(async () =>
      jsonResponse(
        agreementPayload({ signed: true, signedCurrent: false, signedVersion: "v1", signedAt: "2026-03-04T10:00:00.000Z" }),
      ),
    );
    renderPage();
    const versions = await screen.findByTestId("partner-agreement-superseded-versions");
    expect(versions.textContent).toMatch(/v2/i);
    expect(versions.textContent).toMatch(/v1/i);
  });

  it("POSITIVE POLE — signed the CURRENT version shows the signed block and NO superseded notice", async () => {
    mockAgreement(async () =>
      jsonResponse(
        agreementPayload({
          signed: true,
          signedCurrent: true,
          signedVersion: "v2",
          signedAt: "2026-07-01T10:00:00.000Z",
        }),
      ),
    );
    renderPage();
    const signed = await screen.findByTestId("partner-agreement-signed");
    /* CORRECTION OF MY OWN EARLIER RECORD. I first reported that this row was
       already satisfied because `signedVersion` is rendered at :218. It is
       PASSED there, but through `displayAgreementVersion()`, which discards it
       and returns the constant "Version 1.0" — so the raw signed version has
       never actually reached the screen. The literal in that block is NOT
       touched (guard rule 5: rewriting it reads as a copy removal, and the
       displayed label is a deliberate GROUP E product decision); the gap is
       closed where it matters, in the superseded notice. What is asserted here
       is what the block genuinely does. */
    expect(signed.textContent).toContain("Version 1.0");
    expect(signed.textContent).toContain("signed on");
    expect(screen.queryByTestId("partner-agreement-superseded")).toBeNull();
    expect(screen.queryByTestId("button-sign-agreement")).toBeNull();
  });

  it("POSITIVE POLE — never signed shows the sign form and NO superseded notice", async () => {
    mockAgreement(async () => jsonResponse(agreementPayload()));
    renderPage();
    expect(await screen.findByTestId("button-sign-agreement")).toBeTruthy();
    expect(screen.queryByTestId("partner-agreement-superseded")).toBeNull();
  });

  it("signedCurrent WITH NO TIMESTAMP still suppresses the notice — `!signedCurrent` is load-bearing", async () => {
    /* HARNESS-DRIVEN ADDITION. Mutating `signed && !signedCurrent` down to
       `signed` left the suite green, because the neighbouring
       `!effectiveSignedAt` guard hides the notice whenever a timestamp exists.
       It is NOT redundant: `effectiveSignedAt` is
       `signedAt ?? (alreadySigned ? data?.signedAt : null)`, so a partner who
       signed the CURRENT version but whose `signed_at` is null — an older row,
       or a backfill — falls through both and would be told their current,
       valid signature is superseded. */
    mockAgreement(async () =>
      jsonResponse(
        agreementPayload({ signed: true, signedCurrent: true, signedVersion: "v2", signedAt: null }),
      ),
    );
    renderPage();
    await screen.findByTestId("partner-agreement-card");
    await waitFor(() => expect(screen.queryByTestId("partner-agreement-loading")).toBeNull());
    expect(screen.queryByTestId("partner-agreement-superseded")).toBeNull();
  });

  it("a signed:true / signedVersion:null payload does not invent a version", async () => {
    /* Defensive pole. The server can in principle report a signature whose
       version predates the column; the notice must not render a fabricated id. */
    mockAgreement(async () =>
      jsonResponse(agreementPayload({ signed: true, signedCurrent: false, signedVersion: null, signedAt: null })),
    );
    renderPage();
    const notice = await screen.findByTestId("partner-agreement-superseded");
    expect(notice.textContent).not.toMatch(/undefined|null|NaN/);
  });
});

/* ==================================================================== */
describe("FE-18 — money and copy fences", () => {
  it("no money is rendered on the agreement surface", async () => {
    mockAgreement(async () => jsonResponse(agreementPayload()));
    renderPage();
    await screen.findByTestId("button-sign-agreement");
    const card = screen.getByTestId("partner-agreement-card");
    expect(moneyFragments(card.textContent ?? "")).toEqual([]);
  });

  it("FENCE POSITIVE POLE — the money fence can actually fail", () => {
    expect(moneyFragments("Carry of $12.50 per unit").length).toBeGreaterThan(0);
    expect(moneyFragments("¥1200 fee").length).toBeGreaterThan(0);
  });

  it("the refusal states no amount and no fabricated zero", async () => {
    mockAgreement(async () => {
      throw new ApiError(500, "boom", null, { ok: false });
    });
    renderPage();
    const alert = await screen.findByTestId("partner-agreement-load-failed");
    expect(moneyFragments(alert.textContent ?? "")).toEqual([]);
    expect(alert.textContent).not.toMatch(/\b0\b/);
  });

  it("the PRE-EXISTING counsel footnote is untouched on the success path", async () => {
    /* Guard rule 5 — this wave adds siblings and removes no copy. */
    mockAgreement(async () => jsonResponse(agreementPayload()));
    renderPage();
    const note = await screen.findByTestId("partner-agreement-counsel-note");
    expect(note.textContent).toContain(
      "This document is provided for review by counsel and does not constitute legal advice.",
    );
  });
});
