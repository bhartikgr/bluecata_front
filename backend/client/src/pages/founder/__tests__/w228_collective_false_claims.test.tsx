/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 228 · R208.3 — THE FALSE CHECK-CLAIMS ON THE FOUNDER COLLECTIVE PAGE.
 * ══════════════════════════════════════════════════════════════════════════════
 * R137.1 / handbook §8: a claim is only corrected when the MOUNTED page is
 * corrected. A test that asserts a string constant equals something passes
 * happily while the JSX renders something else — the "replica instead of the real
 * thing" inert-proof mechanism. So this file mounts the REAL shipped page,
 * `client/src/pages/founder/Collective` (default export), which is the exact
 * module the production registrar imports:
 *
 *     client/src/App.tsx:61   import FounderCollective from "@/pages/founder/Collective";
 *     client/src/App.tsx:783  <Route path="/founder/collective">
 *                               {() => <RequireAuth><FounderCollective /></RequireAuth>}
 *                             </Route>
 *
 * and B-1 below re-reads App.tsx off disk to prove that binding still holds,
 * rather than taking my own preflight's word for it.
 *
 * WHAT WAS FALSE, AND WHAT REPLACED IT (evidence in W228_PREFLIGHT.md §2)
 *   1. "Verified accreditation per regional regulation (US Reg D 506(c), ...)"
 *      A signed self-declaration gate is real; NO verification of it exists, and
 *      no regional-regulation test exists at all. Criterion kept, rescoped;
 *      "Verified" and the regulation list retired.
 *   2. "Active investing track record (>= 3 rounds in the last 24 months)"
 *      No such check exists anywhere in the tree. The figure is WITHDRAWN, not
 *      synthesised: R-ASSERT forbids showing a figure the platform never
 *      measured, and enforcing the test would have added eligibility (R190.10).
 *   3. "Hash-chain audit, accreditation re-verification, KYC sweeps."
 *      Declared scope extension. Audit chain and re-declaration are real; KYC
 *      documents are stored but never screened.
 *
 * WHAT IS PROVED HERE
 *   A-1  the mounted page renders NO affirmative verification claim, anywhere
 *   A-2  the eligibility card still renders four criteria — nothing was hidden
 *   A-3  the accreditation criterion says what is true: recorded, not checked
 *   A-4  the track-record bullet states no figure, and says none is required
 *   A-5  NO fabricated or zero rounds figure can reach the screen
 *   A-6  the compliance feature line no longer claims re-verification or sweeps
 *   A-7  the R195.5 retained literals still exist and are NOT rendered
 *   A-8  every pre-existing test id survives — no capability was removed
 *   B-1  the production registrar still maps /founder/collective to this module
 *   C-1  negative controls: the detector catches what it is built to catch
 */
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleProvider } from "@/lib/role";
import { TooltipProvider } from "@/components/ui/tooltip";

/* Only the active-company hook is stubbed, and only to make `companyId` non-empty
   so the WAVE 60 · A-9 `enabled` guard lets the page render its resolved state
   rather than its pending one. Every other import — the page, its Card, its
   Badge, its PageHeader/PageBody, its Link — is the real shipped module.
   `importOriginal` is spread so other consumers in the graph keep the real thing. */
const COMPANY_ID = "c_w228_founder_co";
vi.mock("@/lib/useActiveCompany", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/useActiveCompany")>();
  return { ...actual, useActiveCompanyId: () => COMPANY_ID };
});

import Collective, {
  W228_RETAINED_SUPERSEDED_COPY,
  W228_SUPERSEDED_COPY_COUNT,
} from "../Collective";

/** Every non-empty text node a founder can actually read. Whitespace is collapsed
 *  HERE, when the snapshot is captured — never inside a comparison. The standing
 *  rule forbids a normalising call inside an equality assertion, because
 *  `expect(shown.trim()).toBe(stored.trim())` passes for two different strings.
 *  Attribute values are deliberately excluded: `data-testid` values legitimately
 *  contain "verified"/"superseded", and a sweep that swept attributes in would
 *  fail for the wrong reason and then get "fixed" by weakening the assertion. */
function renderedText(root: HTMLElement): string {
  return (root.textContent ?? "").replace(/\s+/g, " ");
}

/** The word to hunt is an AFFIRMATIVE one, and a blunt /verif/i sweep is wrong.
 *  This page now carries three deliberate DE-CLAIMS reused from the wave-215
 *  register — "it does not perform any verification on your behalf", "performs no
 *  independent verification of", "performs no verification or screening of it".
 *  Deleting those to satisfy a regex would remove the very disclosure this wave
 *  exists to install. So the gate is written to the claim, not the substring, on
 *  the rule wave 227 established (W227_BUILD.md):
 *
 *    · "verified" / "verifies" / "verify" / "verifying" — forbidden outright.
 *      These can only assert that Capavate did something, and it did not.
 *    · "verification" — permitted ONLY inside a negation.
 */
function affirmativeVerificationClaims(text: string): string[] {
  const offenders: string[] = [];
  /* `exec` in a loop rather than `matchAll`: the root tsconfig target predates
     es2015, so iterating a `RegExpStringIterator` raises TS2802 and would add to
     the compile-error count this wave is required not to increase. */
  const affirmative = /\bverif(?:ied|ies|y|ying)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = affirmative.exec(text)) !== null) {
    offenders.push(`AFFIRMATIVE WORD: ...${text.slice(Math.max(0, m.index - 90), m.index + 90)}...`);
  }
  const noun = /\bverification\b/gi;
  let n: RegExpExecArray | null;
  while ((n = noun.exec(text)) !== null) {
    const before = text.slice(Math.max(0, n.index - 90), n.index);
    if (!/\b(?:does not|do not|no|not|never|without|cannot|isn't)\b/i.test(before)) {
      offenders.push(`UNNEGATED: ...${before}${text.slice(n.index, n.index + 90)}...`);
    }
  }
  return offenders;
}

/** A rounds/track-record FIGURE of any kind, including a fabricated zero. The
 *  brief's binding constraint is that an absent measurement must be absent in
 *  words, never substituted by "0". So both a threshold and a bare count are
 *  offences, and so is a window. */
function roundsFigures(text: string): string[] {
  const offenders: string[] = [];
  const patterns: Array<[string, RegExp]> = [
    ["THRESHOLD", /(?:\u2265|>=|at least|minimum of|min\.?)\s*\d+\s*(?:rounds?|deals?|investments?)/gi],
    ["COUNT", /\b\d+\s*(?:rounds?|deals?|investments?)\b/gi],
    ["WINDOW", /\b(?:last|past|trailing)\s*\d+\s*(?:months?|years?|quarters?)\b/gi],
    ["ZERO", /\b(?:0|zero|none|n\/a)\s*(?:rounds?|deals?|investments?)\b/gi],
  ];
  for (const [label, re] of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      offenders.push(`${label}: ...${text.slice(Math.max(0, m.index - 70), m.index + 70)}...`);
    }
  }
  return offenders;
}

function mountCollective() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } },
  });
  /* Seeded rather than fetched: jsdom has no server, and the subject under test is
     the rendered copy, not the transport. Seeded through the page's OWN query keys
     so a key rename breaks this test rather than silently skipping it. */
  qc.setQueryData(["/api/founder/collective/nominations", COMPANY_ID], []);
  qc.setQueryData(["/api/founder/collective/applications", COMPANY_ID], []);
  /* The real shipped providers, wired the way client/src/App.tsx wires them. This
     is assembling the page as the app assembles it, not replacing anything under
     test. */
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RoleProvider>
      <QueryClientProvider client={qc}>
        <TooltipProvider>{children}</TooltipProvider>
      </QueryClientProvider>
    </RoleProvider>
  );
  return render(<Collective />, { wrapper });
}

beforeEach(() => {
  /* Real jsdom, no server. Any stray request resolves as a failure the page
     already handles (`.catch(() => [])` is a JSON-parse guard), so a network
     attempt cannot hang the suite. */
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("W228 · R208.3 — the mounted founder Collective page states no check it does not perform", () => {
  it("A-1 — the rendered page contains no affirmative verification claim", () => {
    const { container } = mountCollective();
    /* POSITIVE ANCHOR FIRST. Every absence assertion below is worthless if the
       eligibility card never rendered — the "fixture no mutation can move" trap.
       So prove the surface is really on screen before proving what is not on it. */
    expect(screen.getByTestId("card-eligibility")).toBeTruthy();
    const text = renderedText(container);
    expect(text).toContain("Eligibility");
    expect(text).toContain("Accredited-investor self-declaration");

    expect(affirmativeVerificationClaims(text)).toEqual([]);
    /* Belt and braces on the exact words the owner named. */
    expect(text).not.toMatch(/\bverified\b/i);
    expect(text).not.toMatch(/\bre-?verification\b/i);
    /* And the regulation citation the platform does not rely on is gone. */
    expect(text).not.toMatch(/506\(c\)/);
    expect(text).not.toMatch(/NI 45-106|FCA|MAS|ASIC/);
  });

  it("A-2 — the eligibility card still lists four criteria; nothing was hidden (R190.10)", () => {
    const { container } = mountCollective();
    const card = screen.getByTestId("card-eligibility");
    const bullets = card.querySelectorAll("ul > li");
    /* Four before, four after. A correction that quietly dropped a bullet would
       be a restriction, which this wave is forbidden to make. */
    expect(bullets.length).toBe(4);
    const text = renderedText(container);
    /* The two criteria this wave did not touch must still be there verbatim. */
    expect(text).toContain("Contribution to chapter meetings and deal reviews");
    expect(text).toContain("Hash-chain audit-trail consent");
  });

  it("A-3 — the accreditation criterion says the declaration is recorded, not checked", () => {
    const { container } = mountCollective();
    const text = renderedText(container);
    /* Reused byte-verbatim from the wave-215 register
       (client/src/components/AccreditationForm.tsx:247-248) — not new prose. */
    expect(text).toContain(
      "Capavate records your declaration; it does not check it, and it does not perform any verification on your behalf",
    );
    expect(text).toContain("signed for one named jurisdiction");
  });

  it("A-4 — the track-record criterion states no figure and says none is required", () => {
    const { container } = mountCollective();
    const text = renderedText(container);
    expect(text).toContain("Investing experience as described by the investor in their own application");
    /* R-ASSERT: the missing measurement is stated in WORDS. */
    expect(text).toContain("no minimum number of rounds is measured or required");
    expect(text).toContain("performs no independent verification of any Member's track record");
    /* The withdrawn claim, in every form it took. */
    expect(text).not.toMatch(/Active investing track record/i);
    expect(text).not.toMatch(/\u2265\s*3/);
    expect(text).not.toMatch(/24 months/i);
  });

  it("A-5 — no rounds figure of any kind reaches the screen, fabricated or zero", () => {
    const { container } = mountCollective();
    const text = renderedText(container);
    expect(text).toContain("no minimum number of rounds is measured or required");
    /* The whole point: an absent measurement must not acquire a number, and must
       not acquire a "0" standing in for one. */
    expect(roundsFigures(text)).toEqual([]);
    expect(text).not.toMatch(/\b0\s*rounds?\b/i);
    expect(text).not.toMatch(/\brounds?\s*:\s*\d/i);
    /* "rounds" may appear ONLY inside the sentence that denies a threshold. */
    const roundsHits: string[] = [];
    const re = /\brounds?\b/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      roundsHits.push(text.slice(Math.max(0, m.index - 60), m.index + 40));
    }
    expect(roundsHits.length).toBe(1);
    expect(roundsHits[0]).toContain("no minimum number of");
  });

  it("A-6 — the compliance feature line claims only what the platform does", () => {
    const { container } = mountCollective();
    const text = renderedText(container);
    /* Real: wave 223 measured the chain (730/730 tenants, 1452/1452 links). */
    expect(text).toContain("Hash-chain audit trail");
    /* Real: the append-only re-declaration. */
    expect(text).toContain("investor re-declaration of accredited status");
    /* Real: POST /api/collective/kyc-upload persists to collective_kyc_blobs. */
    expect(text).toContain("KYC document upload");
    /* Verbatim from server/lib/collectiveAccessDecision.ts:301. */
    expect(text).toContain("self-certification, not KYC/AML");
    expect(text).toContain("performs no verification or screening of it");
    /* Not real, and now absent. */
    expect(text).not.toMatch(/KYC sweeps/i);
    expect(text).not.toMatch(/accreditation re-verification/i);
  });

  it("A-7 — the superseded literals are retained (R195.5) and are not rendered", () => {
    const { container } = mountCollective();
    const text = renderedText(container);
    /* Retained, byte-identical, so nothing was deleted. */
    expect(W228_RETAINED_SUPERSEDED_COPY.length).toBe(W228_SUPERSEDED_COPY_COUNT);
    expect(W228_RETAINED_SUPERSEDED_COPY).toContain(
      "Verified accreditation per regional regulation (US Reg D 506(c), CA NI 45-106, UK FCA, SG MAS, AU ASIC)",
    );
    expect(W228_RETAINED_SUPERSEDED_COPY).toContain(
      "Active investing track record (\u2265 3 rounds in the last 24 months)",
    );
    expect(W228_RETAINED_SUPERSEDED_COPY).toContain(
      "Hash-chain audit, accreditation re-verification, KYC sweeps.",
    );
    /* And NOT rendered — retention must not become re-publication. The retention
       block is the one place the false words still exist as JSX, so if the guard
       flag were ever flipped this assertion is what would catch it. */
    expect(screen.queryByTestId("w228-superseded-copy-retained")).toBeNull();
    for (const superseded of W228_RETAINED_SUPERSEDED_COPY) {
      expect(text).not.toContain(superseded);
    }
  });

  it("A-8 — every pre-existing test id survives; no capability was removed", () => {
    mountCollective();
    for (const id of [
      "collective-status-bar",
      "badge-collective-status",
      "card-collective-hero",
      "button-apply-to-present",
      "button-membership-info",
      "card-eligibility",
      "card-for-founders",
      "button-go-apply",
      "button-back-dashboard",
    ]) {
      expect(screen.getByTestId(id), `missing test id: ${id}`).toBeTruthy();
    }
  });

  it("B-1 — the production registrar still mounts THIS module at /founder/collective", () => {
    /* Handbook §8: confirm the production registrar. Read off disk, so this is the
       shipped router and not my recollection of it. If someone re-points the route
       at a different component, or adds a second registration, this fails. */
    const app = readFileSync(resolve(__dirname, "../../../App.tsx"), "utf8");
    expect(app).toContain('import FounderCollective from "@/pages/founder/Collective";');
    expect(app).toContain('<Route path="/founder/collective">');
    expect(app).toContain("<RequireAuth><FounderCollective /></RequireAuth>");
    const registrations = app.split('<Route path="/founder/collective">').length - 1;
    expect(registrations).toBe(1);
    /* And it is genuinely reachable: the founder's own sidebar links to it. */
    const shell = readFileSync(resolve(__dirname, "../../../components/AppShell.tsx"), "utf8");
    expect(shell).toContain('href: "/founder/collective"');
  });

  it("C-1 — negative controls: both detectors catch what they are built to catch", () => {
    /* Without these, every assertion above could be inert — a detector that
       matches nothing reports a clean page forever. */
    expect(affirmativeVerificationClaims(
      "Verified accreditation per regional regulation (US Reg D 506(c))",
    ).length).toBe(1);
    expect(affirmativeVerificationClaims("Accreditation re-verification pending").length).toBe(1);
    expect(affirmativeVerificationClaims("Verification complete").length).toBe(1);
    /* ...and do NOT catch the wave-215 disclosures, which must survive. */
    expect(affirmativeVerificationClaims(
      "it does not perform any verification on your behalf",
    )).toEqual([]);
    expect(affirmativeVerificationClaims(
      "Capavate performs no independent verification of any Member's track record",
    )).toEqual([]);

    expect(roundsFigures("Active investing track record (\u2265 3 rounds in the last 24 months)").length)
      .toBeGreaterThan(0);
    expect(roundsFigures("Rounds in last 24 months: 0").length).toBeGreaterThan(0);
    expect(roundsFigures("0 rounds").length).toBeGreaterThan(0);
    expect(roundsFigures("no minimum number of rounds is measured or required")).toEqual([]);
  });

  /* ══════════════════════════════════════════════════════════════════════════
   * C-2 — WRITTEN BECAUSE DISARM D9 CAME BACK GREEN.
   * ══════════════════════════════════════════════════════════════════════════
   * D9 blinds `roundsFigures`'s COUNT pattern, and the suite stayed GREEN. The
   * harness said INVESTIGATE, so I did, and the finding is real: every control in
   * C-1 above happens to be caught by a DIFFERENT pattern than the one being
   * disarmed — "(>= 3 rounds in the last 24 months)" trips THRESHOLD and WINDOW,
   * "Rounds in last 24 months: 0" trips WINDOW, "0 rounds" trips ZERO. So the
   * COUNT pattern's installation was UNPROVED, which is inert-proof mechanism
   * four applied at sub-pattern granularity. It is also load-bearing: a bare
   * fabricated count with no threshold word and no window — "Backed 3 rounds" —
   * is caught by COUNT and by nothing else, and that is precisely the shape a
   * future "improvement" to the honest bullet would take.
   *
   * A composite detector needs one isolating control PER BRANCH, asserted by
   * label, or a branch can rot unnoticed behind its neighbours.
   */
  it("C-2 — each of the four rounds-figure patterns is individually installed", () => {
    const labelled = (text: string): string[] =>
      roundsFigures(text).map((o) => o.slice(0, o.indexOf(":")));
    /* Isolating for COUNT: no threshold word, no window, not a zero. This is the
       case D9 proved was otherwise unguarded. */
    expect(labelled("Backed 3 rounds")).toContain("COUNT");
    expect(labelled("Backed 3 rounds")).not.toContain("WINDOW");
    expect(labelled("Backed 3 rounds")).not.toContain("THRESHOLD");
    /* THRESHOLD, in each form it is written to catch. */
    expect(labelled("at least 4 rounds")).toContain("THRESHOLD");
    expect(labelled("\u2265 3 rounds")).toContain("THRESHOLD");
    expect(labelled("minimum of 2 investments")).toContain("THRESHOLD");
    /* WINDOW, isolated from any rounds noun so COUNT cannot cover for it. */
    expect(labelled("in the last 24 months")).toContain("WINDOW");
    expect(labelled("over the trailing 8 quarters")).toContain("WINDOW");
    /* ZERO — the fabricated-zero substitution R-ASSERT forbids outright. */
    expect(labelled("zero rounds")).toContain("ZERO");
    expect(labelled("none rounds")).toContain("ZERO");
    /* And the honest sentence still trips nothing, in any branch. */
    expect(labelled("no minimum number of rounds is measured or required")).toEqual([]);
  });
});
