/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 227 · ITEM 2 — the word "VERIFIED" on the investor profile page.
 * ══════════════════════════════════════════════════════════════════════════════
 * R137.1: "an LP-facing or partner-facing claim is only verified when the MOUNTED
 * component is verified — a passing store test is not evidence that a user sees
 * anything." So this file mounts the REAL shipped page — `client/src/pages/investor/Profile`,
 * default export, the same module the investor router renders — and reads the
 * resulting DOM. It does not re-implement a badge, and it does not assert on a
 * string constant: a test that asserts `SOME_LABEL === "..."` passes happily while
 * the JSX renders something else entirely, which is the "replica instead of the
 * real thing" inert-proof mechanism.
 *
 * WHAT WAS ESTABLISHED BEFORE ANYTHING WAS CHANGED (W227_PREFLIGHT §4).
 * `accreditationVerified` is a BOOLEAN field on the investor profile
 * (`client/src/lib/profile/types.ts:270-271`), not a status enum with a
 * `"verified"` member. There is therefore no code-contract identifier here that
 * had to survive a copy change — the word was a LABEL, and only a label. Nothing
 * on the server ever sets it true; the only writers set it false
 * (`server/lib/emptyInvestorProfile.ts:77`, `server/profileStore.ts:702`) and the
 * investor can set it true on themselves through
 * `PATCH /api/investors/:id/profile`. So the badge said "Verified" about a flag the
 * subject of the claim ticks for himself.
 *
 * THE TEST-ID CONTRACT IS SEPARATE FROM THE WORDS, AND IS KEPT.
 * `data-testid="badge-accred-verified"` is unchanged. The identifier stays, the
 * words a human reads change — which is the distinction Item 2 asked to be
 * established rather than assumed.
 *
 * WAVES 211 AND 212 DO NOT DEPEND ON THIS COPY, AND THAT IS PROVED ELSEWHERE.
 * Wave 211's claim gate matches `AFFIRMATIVE_CLAIMS` regexes against
 * `buildWave211AttestationText`; wave 212's matches its own stored round text.
 * Neither reads this page, this test id, or this boolean. Their suites are run
 * before and after in W227_TESTS.md rather than restated here.
 *
 * WHAT IS PROVED HERE
 *   A-1  with the flag TRUE — the state that used to render "Verified" — the
 *        mounted page renders NO occurrence of the word anywhere in its text
 *   A-2  the badge test id still exists, so the code contract survived
 *   A-3  the badge's own words say what is true: a status was RECORDED
 *   A-4  the false state is honest too, and says recording is not a check
 *   A-5  the R143.1 retained literals exist as static siblings and are NOT rendered
 *   A-6  the page tells the user, in words, that Capavate does not check this
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleProvider } from "@/lib/role";
import { TooltipProvider } from "@/components/ui/tooltip";

/* The page derives the investor id from the session hook. Only `useEntitlement`
   is stubbed, and only to make the id deterministic — every other import,
   including the page itself, its Badge, its HelpTip and its panel, is the real
   shipped module. `importOriginal` is spread so any other consumer of this module
   in the graph still gets the real thing. */
const INVESTOR_ID = "u_w227_profile_investor";
vi.mock("@/lib/entitlement", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/entitlement")>();
  return {
    ...actual,
    useEntitlement: () => ({ data: { userId: INVESTOR_ID }, isLoading: false }),
  };
});

import Profile, {
  W227_RETAINED_SUPERSEDED_COPY,
  W227_SUPERSEDED_COPY_COUNT,
} from "../Profile";
import { SEED_INVESTOR_PROFILE } from "@/lib/profile/seed";
import type { InvestorProfile } from "@/lib/profile/types";

function mountProfile(accreditationVerified: boolean) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: Infinity } },
  });
  const profile: InvestorProfile = {
    ...SEED_INVESTOR_PROFILE,
    id: INVESTOR_ID,
    profile: {
      ...SEED_INVESTOR_PROFILE.profile,
      accreditationVerified,
      accreditationVerifiedAt: accreditationVerified ? "2026-04-01T00:00:00Z" : null,
    },
  };
  /* Seeded rather than fetched: jsdom has no server, and the subject under test is
     the rendering of a known profile state, not the transport. The shape is the
     shipped fixture type, so a field rename would break this test rather than
     silently skip it. */
  qc.setQueryData(["/api/investors", INVESTOR_ID, "profile"], profile);
  /* `RoleProvider` is the real shipped provider, not a stub. The page mounts
     `CollectiveDeepLink`, which calls `useRole()` and throws without it, and the
     accreditation `HelpTip` is a Radix tooltip that needs its provider. Both are
     the real shipped providers, wired the way `client/src/App.tsx` wires them —
     this is assembling the page as the app assembles it, not replacing anything
     under test. */
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RoleProvider>
      <QueryClientProvider client={qc}>
        <TooltipProvider>{children}</TooltipProvider>
      </QueryClientProvider>
    </RoleProvider>
  );
  const r = render(<Profile />, { wrapper });
  return r;
}

/** The word to hunt is an AFFIRMATIVE one. A blunt `/verif/i` sweep is wrong here
 *  and finding out why was worth the trip: step 2 legitimately carries three
 *  wave-215 DE-CLAIMS — "it does not perform any verification on your behalf" and
 *  "does not replace company/founder verification". Deleting those to satisfy a
 *  regex would remove the very disclosure Item 2 exists to protect, so the gate is
 *  written to the actual claim instead:
 *
 *    · "verified" / "verifies" / "verify" — forbidden outright. These can only be
 *      assertions that Capavate did something, and it did not.
 *    · "verification" — permitted ONLY inside a negation. An affirmative
 *      "verification complete" would be caught; "does not perform any
 *      verification" is the disclosure and is kept.
 */
function affirmativeVerificationClaims(text: string): string[] {
  const offenders: string[] = [];
  /* `exec` in a loop rather than `matchAll`: the root tsconfig target predates
     es2015, so iterating a `RegExpStringIterator` raises TS2802 and would have
     added to the compile-error count this wave is required not to increase. */
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

/** Walk the page the way the investor does. The accreditation panel and the
 *  wave-215 explanatory note live on STEP 2, so a sweep that only ever renders
 *  step 1 would report a clean page while the word "Verified" sat one click away —
 *  exactly the "fixture no mutation can move" failure. Every assertion about
 *  absence below is taken across all three steps. */
function textAcrossAllSteps(container: HTMLElement): string {
  const chunks: string[] = [];
  for (const stepId of [1, 2, 3] as const) {
    fireEvent.click(screen.getByTestId(`step-button-${stepId}`));
    /* Proof the click landed — otherwise this loop silently reads step 1 three
       times and the sweep is worthless. */
    const heading = renderedText(container);
    expect(heading, `step ${stepId} did not open`).toContain(`Step ${stepId} of 3`);
    chunks.push(heading);
  }
  return chunks.join(" \u2016 ");
}

/** Every non-empty text node the user can actually read. Attribute values are
 *  deliberately excluded: `data-testid="badge-accred-verified"` legitimately keeps
 *  the word, and a scan that swept attributes in would fail for the wrong reason
 *  and then get "fixed" by weakening the assertion. */
function renderedText(root: HTMLElement): string {
  return (root.textContent ?? "").replace(/\s+/g, " ");
}

beforeEach(() => {
  /* Real jsdom, no server. Any stray request resolves as a failure the page
     already handles, so a network attempt cannot hang the suite. */
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("W227 Item 2 — the mounted investor profile page no longer calls accreditation verified", () => {
  it('A-1 — with accreditationVerified TRUE, the page renders no "verified" anywhere', () => {
    const { container } = mountProfile(true);
    const text = renderedText(container);
    /* Sanity first: if the page did not actually render its accreditation area,
       an absence assertion below would pass vacuously. This is the "fixture no
       mutation can move" trap, so the positive anchor is asserted first. */
    expect(screen.getByTestId("badge-accred-verified")).toBeTruthy();
    expect(text).toMatch(/Accredited status recorded/);
    /* The claim. Not scoped to the badge, and not scoped to one step — the word
       appeared in four separate places across two steps, and a per-element or
       single-step assertion would have missed three of them. */
    const all = textAcrossAllSteps(container);
    expect(affirmativeVerificationClaims(all)).toEqual([]);
    /* Belt and braces on the exact word the owner named: it must not appear on any
       step, in any casing, for any reason. */
    expect(all).not.toMatch(/\bverified\b/i);
    /* Negative control on the gate itself — if the detector cannot see the word it
       is supposed to catch, every assertion above is inert. */
    expect(affirmativeVerificationClaims("Accreditation Verified \u00b7 last confirmed").length).toBe(1);
    expect(affirmativeVerificationClaims("it does not perform any verification on your behalf")).toEqual([]);
    /* And step 2 really did render the accreditation panel, so the absence above
       is an absence from a page that had the opportunity to say it. */
    expect(all).toMatch(/Accredited status recorded · last updated 2026-04-01/);
  });

  it("A-2 — the test-id contract survived the copy change", () => {
    mountProfile(true);
    const badge = screen.getByTestId("badge-accred-verified");
    expect(badge).toBeTruthy();
    /* The identifier keeps the old word; the words inside it do not. That is the
       whole point of the label-versus-value distinction. */
    expect(badge.getAttribute("data-testid")).toBe("badge-accred-verified");
    expect(badge.textContent ?? "").not.toMatch(/verif/i);
  });

  it("A-3 — the badge says what is actually true: the status was RECORDED", () => {
    mountProfile(true);
    expect(screen.getByTestId("badge-accred-verified").textContent?.trim())
      .toBe("Accredited status recorded");
  });

  it("A-4 — the false state is honest, and says recording is not a check", () => {
    const { container } = mountProfile(false);
    expect(screen.getByTestId("badge-accred-pending")).toBeTruthy();
    const all = textAcrossAllSteps(container);
    expect(all).toMatch(/Accredited status not recorded/);
    expect(all).toMatch(/Recording it is not a check by Capavate/);
    expect(affirmativeVerificationClaims(all)).toEqual([]);
    expect(all).not.toMatch(/\bverified\b/i);
  });

  it("A-5 — R143.1: the superseded literals are retained as static siblings and are NOT rendered", () => {
    /* R143.1 as the owner restated it for this wave: "append static siblings,
       never replace a literal". The old words still exist in the module, so the
       mechanism is retained and auditable, and `guard`/`drop:restyle` see no
       disappearance. They must not reach the screen. */
    expect(W227_SUPERSEDED_COPY_COUNT).toBe(W227_RETAINED_SUPERSEDED_COPY.length);
    expect(W227_SUPERSEDED_COPY_COUNT).toBeGreaterThanOrEqual(7);
    const { container } = mountProfile(true);
    const all = textAcrossAllSteps(container);
    for (const superseded of W227_RETAINED_SUPERSEDED_COPY) {
      expect(all, `superseded copy is on screen: ${superseded}`).not.toContain(superseded);
    }
  });

  it("A-6 — the page states in plain words that Capavate does not check this", () => {
    const { container } = mountProfile(true);
    const text = textAcrossAllSteps(container);
    /* The replacement is not merely a de-claim; it has to leave the user knowing
       who asserted what. R188.3: the platform "advertises a 506(c) standard while
       operating a 506(b) verification posture" — this sentence is where that gap
       stops being invisible to the person it concerns. */
    expect(text).toMatch(/nobody at Capavate screens or confirms/i);
    expect(text).toMatch(/you or an administrator can set/i);
    /* WAVE 215 CONTRACT, kept deliberately. `w215_accreditation_dom` H2 asserts
       this note contains "internal admin screening". Wave 227's first draft of the
       copy dropped the phrase and turned that COMPLETE wave's test RED — caught in
       the after-capture, not in review. The phrase is back, negated, which is both
       true and what wave 215 was warning about. Asserted here as well so a future
       wave cannot drop it again without two suites objecting. */
    expect(text).toMatch(/not internal admin screening/i);
    expect(text).toMatch(/performs no\s+screening of accreditation/i);
  });
});
