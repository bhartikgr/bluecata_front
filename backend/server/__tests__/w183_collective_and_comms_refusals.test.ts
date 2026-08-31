/**
 * WAVE 183 — Surfaces 2, 3 and 4 of R154.2.
 *
 *   2. Collective "My Membership": "We couldn't load membership pricing." plus
 *      "Your membership tier could not be determined right now."
 *   3. Collective Partners: "Couldn't load partners. Please refresh."
 *   4. Founder Messages: "We could not reach Capavate to send this — your
 *      connection dropped, or the service is briefly unavailable."
 *
 * All three are instances of the one failure class wave 183 identified: a
 * deterministic 403 rendered as a transient failure. Surface 4 is the purest
 * case — the correct sentence was already compiled into the file and was
 * unreachable because `apiRequest` throws rather than resolving non-ok.
 *
 * Surface 4 is tested BEHAVIOURALLY here, by driving the real `thrownAsOutcome`
 * against a real `ApiError`, because that is where the dead branch was.
 * Surfaces 2 and 3 hold their logic inside module-private functions in `.tsx`
 * page components; those are asserted on the shipped source, and every such
 * assertion is labelled as structural rather than presented as behavioural.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ApiError } from "../../client/src/lib/queryClient";
import {
  TIER_ERROR_COPY,
  tierErrorCopy,
  thrownAsOutcome,
  refusalCodeFor,
  TRANSPORT_FAILURE,
} from "../../client/src/components/comms/CommsTierActionsPanel";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

/**
 * Strip comments before drawing any grep conclusion — the project's standing
 * rule, and it bites here for a reason worth stating: wave 183's fixes are
 * heavily commented, and those comments QUOTE the old broken conditions in order
 * to explain what was wrong with them. A naive `not.toContain` on the raw source
 * therefore fails against the explanation of the fix rather than the fix.
 *
 * Line comments, block comments and JSX comments are removed. String and
 * template literals are preserved, because the copy assertions depend on them.
 */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  type Mode = "code" | "line" | "block" | "sq" | "dq" | "tpl";
  let mode: Mode = "code";
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (mode === "code") {
      if (c === "/" && n === "/") { mode = "line"; i += 2; continue; }
      if (c === "/" && n === "*") { mode = "block"; i += 2; continue; }
      if (c === "'") { mode = "sq"; out += c; i += 1; continue; }
      if (c === '"') { mode = "dq"; out += c; i += 1; continue; }
      if (c === "`") { mode = "tpl"; out += c; i += 1; continue; }
      out += c; i += 1; continue;
    }
    if (mode === "line") {
      if (c === "\n") { mode = "code"; out += c; }
      i += 1; continue;
    }
    if (mode === "block") {
      if (c === "*" && n === "/") { mode = "code"; i += 2; continue; }
      /* Keep newlines so reported line numbers stay usable. */
      if (c === "\n") out += c;
      i += 1; continue;
    }
    /* Inside a literal: copy through, honouring backslash escapes. */
    out += c;
    if (c === "\\") { out += src[i + 1] ?? ""; i += 2; continue; }
    if ((mode === "sq" && c === "'") || (mode === "dq" && c === '"') || (mode === "tpl" && c === "`")) {
      mode = "code";
    }
    i += 1;
  }
  return out;
}

/* PROVE THE STRIPPER STRIPPED — required before trusting any conclusion from it. */
describe("W183 · the comment stripper used by this file actually strips", () => {
  it("removes line, block and JSX comments and keeps string literals intact", () => {
    const sample = [
      'const a = "keep me"; // drop this',
      "/* drop\n   this too */",
      "const b = `keep ${x} me`;",
      "const c = 'it\\'s kept';",
      "{/* jsx comment dropped */}",
    ].join("\n");
    const out = stripComments(sample);
    expect(out).toContain('"keep me"');
    expect(out).toContain("keep ${x} me");
    expect(out).not.toContain("drop this");
    expect(out).not.toContain("drop\n   this too");
    expect(out).not.toContain("jsx comment dropped");
  });

  it("removes a quoted anchor string that appears only inside a comment", () => {
    /* This is the exact hazard: the fix's own explanation naming the old code. */
    const sample = '/* WAS: tierQ.isError || catalogQ.isError */\nconst x = tierQ.isError;';
    const out = stripComments(sample);
    expect(out).not.toContain("catalogQ.isError");
    expect(out).toContain("tierQ.isError");
  });

  it("confirms the membership page still CONTAINS the anchors in comments, so stripping is load-bearing", () => {
    /* If this ever stops being true the negative assertions below become
       vacuous, and a reader deserves to know that from a failing test rather
       than from silence. */
    expect(read("../../client/src/pages/collective/MembershipPage.tsx")).toContain(
      "tierQ.isError " + "|| catalogQ.isError",
    );
  });
});

function apiError(status: number, code: string | null, extra: Record<string, unknown> = {}) {
  return new ApiError(status, `${status}`, code, { ok: false, error: code, ...extra });
}

/* ══════════════════════════════════════════════════════════════════════════
   SURFACE 4 — FOUNDER MESSAGES. The dead-branch fix, proved behaviourally.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W183 · Surface 4 · a thrown ApiError is no longer reported as a dropped connection", () => {
  it("recovers the server's own refusal code from the thrown ApiError", () => {
    const out = thrownAsOutcome(apiError(403, "NOT_ON_CAP_TABLE"));
    expect(out.ok).toBe(false);
    expect(out.status).toBe(403);
    expect(out.refusalCode).toBe("NOT_ON_CAP_TABLE");
    /* THE POINT OF THE WHOLE FIX: it is NOT the transport sentence. */
    expect(out.refusalCode).not.toBe(TRANSPORT_FAILURE);
  });

  it("selects the correct sentence, which was already in the file and unreachable", () => {
    const code = thrownAsOutcome(apiError(403, "NOT_ON_CAP_TABLE")).refusalCode;
    /* `/api/founder/crm/high-value-advocates` returns exactly this 403
       (`server/commsTiersStore.ts`), and the panel already had the right words
       for it. No new copy string was added by this wave. */
    expect(tierErrorCopy(code)).toBe(TIER_ERROR_COPY.NOT_ON_CAP_TABLE);
    expect(tierErrorCopy(code)).toContain("advocate list");
    expect(tierErrorCopy(code)).not.toContain("connection dropped");
  });

  it("falls back to the numeric status key when the server sends no code", () => {
    /* `TIER_ERROR_COPY` has "400"/"401"/"403" entries that were also unreachable. */
    expect(thrownAsOutcome(apiError(401, null)).refusalCode).toBe("401");
    expect(tierErrorCopy("401")).toBe(TIER_ERROR_COPY["401"]);
  });

  it("STILL reports a transport failure for a genuine transport failure (ITEM C)", () => {
    /* A dropped connection is not an `ApiError`. The preserved sentence must
       still be selected here, and now it is selected ONLY here. */
    expect(thrownAsOutcome(new TypeError("Failed to fetch")).refusalCode).toBe(TRANSPORT_FAILURE);
    expect(thrownAsOutcome(new Error("network down")).refusalCode).toBe(TRANSPORT_FAILURE);
    expect(tierErrorCopy(TRANSPORT_FAILURE)).toContain("We could not reach Capavate to send this");
  });

  it("refusalCodeFor handles all three outcome shapes without inventing a code", async () => {
    expect(await refusalCodeFor(null)).toBe(TRANSPORT_FAILURE);
    expect(await refusalCodeFor(thrownAsOutcome(apiError(409, "ROUND_CLOSED")))).toBe("ROUND_CLOSED");
    /* The resolved-but-not-ok path is kept live rather than deleted: `readError`
       still parses a real Response body. */
    const res = new Response(JSON.stringify({ error: "MISSING_FIELDS" }), { status: 400 });
    expect(await refusalCodeFor(res)).toBe("MISSING_FIELDS");
  });

  it("every one of the eight call sites was converted — none still swallows the error", () => {
    const src = stripComments(read("../../client/src/components/comms/CommsTierActionsPanel.tsx"));
    /* `.catch(() => null)` is what discarded the ApiError and forced `res` to
       `null`, which is what selected the transport sentence unconditionally. */
    expect(src).not.toContain(".catch(() => null)");
    expect(src).not.toContain("res ? await readError(res) : TRANSPORT_FAILURE");
    expect(src.split(".catch(thrownAsOutcome)").length - 1).toBeGreaterThanOrEqual(8);
    expect(src.split("await refusalCodeFor(res)").length - 1).toBeGreaterThanOrEqual(8);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   SURFACE 2 — COLLECTIVE MEMBERSHIP PRICING AND TIER.

   `tierQ` (GET /api/collective/member-tier) is open to any authenticated user,
   answers 200, and resolves the real figure from `platform_fees`. `catalogQ`
   (GET /api/collective/membership/tiers) sits behind `requireCollectiveMember`
   and answers 403 for a non-member by design. The page suppressed the price
   whenever EITHER failed, so a prospective member — the population the page
   exists to sell to — could never see a price.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W183 · Surface 2 · the real database price is no longer suppressed by an unrelated 403", () => {
  const raw = read("../../client/src/pages/collective/MembershipPage.tsx");
  /* Comments stripped: this wave's explanatory blocks quote the old conditions. */
  const src = stripComments(raw);

  it("the refusal conditions no longer depend on the member-only catalog query", () => {
    /* Structural assertion on the shipped conditions. */
    expect(src).not.toContain("tierQ.isError || catalogQ.isError");
    expect(src).not.toContain("!tierQ.isSuccess || !catalogQ.isSuccess");
    expect(src).toContain("useAdminCatalog ? null : tierQ.isError ?");
    expect(src).toContain(") : !tierQ.isSuccess ? (");
  });

  it("BOTH refusal branches and BOTH testids survive — only the conditions narrowed", () => {
    /* Deleting a branch would be a drop:restyle failure and would also lose the
       protection the wave-24 comment was written for: a live Subscribe button
       beside a price the page cannot state. */
    expect(src).toContain('testId="membership-pricing-load-failed"');
    expect(src).toContain('testId="membership-pricing-unavailable"');
    /* And the price element itself is unchanged. */
    expect(src).toContain('data-testid="membership-tier-price"');
  });

  it("a catalog 403 is disclosed as a stated limitation, not as a missing price", () => {
    expect(src).toContain('data-testid="membership-catalog-unavailable-note"');
    expect(src).toContain("MEMBERSHIP_CATALOG_UNREADABLE_COPY");
    /* It must not imply the price shown is wrong or provisional. */
    expect(src).toContain("the current published membership price held by Capavate");
  });

  it("a genuinely absent price record names that fact and prints no number", () => {
    expect(src).toContain("MEMBERSHIP_TIER_NO_RECORD_COPY");
    expect(src).toContain("The missing fact is a published price");
    /* The owner's constraint, verbatim in intent: never a fabricated zero,
       never a blank. */
    expect(src).toContain("will not display a placeholder or a zero for a price it does not hold");
  });

  it("the price still comes from the database and is never hardcoded in the page", () => {
    /* The wave-183 probe found `collective.member_subscription.standard = 24900
       USD monthly`. That figure must NOT appear as a literal in client code —
       it must be resolved. */
    expect(src).not.toMatch(/24900|\$249\.00|249\.00/);
    expect(src).toContain("tier?.amountMinor");
  });
});

describe("W183 · Surface 2 · the tier message distinguishes 'not a member' from 'tier unresolved'", () => {
  const src = stripComments(read("../../client/src/components/collective/MemberBillingPanel.tsx"));

  it("keeps the original 409 sentence byte-verbatim and adds siblings beside it", () => {
    expect(src).toContain(
      "tier_unavailable: \"Your membership tier could not be determined right now. Please retry shortly.\",",
    );
    expect(src).toContain("not_collective_member:");
    expect(src).toContain("missing_identity:");
  });

  it("a 403 non-member no longer reads a retry instruction", () => {
    expect(src).toContain("The missing fact is a Collective membership");
    expect(src).toContain("Retrying will not change this");
    /* The render site now selects by cause instead of hardcoding one key. */
    expect(src).toContain("{quoteErrorCopy(quoteQ.error)}");
    expect(src).not.toContain("{QUOTE_ERROR_COPY.tier_unavailable}");
    /* The testid is unchanged. */
    expect(src).toContain('data-testid="member-billing-quote-error"');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   SURFACE 3 — COLLECTIVE PARTNERS.

   The page classified exactly one status (503). `requireCollectiveMember`
   answers 403, so a permanent access decision rendered as "Please refresh."
   ══════════════════════════════════════════════════════════════════════════ */
describe("W183 · Surface 3 · a 403 is an access fact, and zero rows is a successful read", () => {
  const src = stripComments(read("../../client/src/pages/collective/PartnersDirectory.tsx"));

  it("adds a 403/401 branch ABOVE the generic error arm without removing it", () => {
    expect(src).toContain('data-testid="partners-access-refused"');
    /* Order matters: the refusal arm must be evaluated before `error ?`, or the
       red "Please refresh." card keeps winning. */
    expect(src.indexOf('data-testid="partners-access-refused"')).toBeLessThan(
      src.indexOf('data-testid="partners-error"'),
    );
    /* ADVERSARIAL PASS FOUND THIS GAP. The first version of this test asserted
       only that the testid string and the copy existed somewhere in the file.
       Reverting the branch CONDITION to a constant `false` — leaving all the copy
       in place but making it unreachable — kept the test green. That is precisely
       the class of defect wave 183 is fixing (a correct sentence compiled in and
       never selected), so the condition itself is now pinned. */
    expect(src).toContain(") : refusal ? (");
    expect(src).toContain("const refusal = (() => {");
    expect(src).toContain("error.status !== 403 && error.status !== 401");
    /* All four pre-existing states survive. */
    for (const t of ["partners-loading", "partners-unavailable", "partners-error", "partners-empty", "partners-list", "heading-partners"]) {
      expect(src).toContain(`data-testid="${t}"`);
    }
  });

  it("prefers the server's own message, which already names the missing fact", () => {
    expect(src).toContain("payload.message");
    expect(src).toContain("PARTNERS_REFUSAL_FALLBACK");
    expect(src).toContain("PARTNERS_REFUSAL_GENERIC");
  });

  it("covers every 403/401 code requireCollectiveMember can emit", () => {
    for (const code of [
      "not_collective_member",
      "not_on_cap_table",
      "ACCREDITATION_DECLARATION_REQUIRED",
      "ACCREDITATION_STATUS_UNAVAILABLE",
      "missing_identity",
    ]) {
      expect(src).toContain(code);
    }
  });

  it("does not advise refreshing for a permanent access decision", () => {
    expect(src).toContain("Refreshing will not change this");
    /* …while the genuine-DB-failure sentence keeps its refresh advice. */
    expect(src).toContain("Couldn't load partners. Please refresh.");
  });

  it("states that an authorised empty read IS a successful read", () => {
    /* `partner_organizations` holds 0 rows on this build, so this is the state a
       legitimate member most likely sees, and it must not look like breakage. */
    expect(src).toContain('data-testid="partners-empty-reason"');
    expect(src).toContain("This is a successful read");
    expect(src).toContain("No partners listed yet.");
  });
});
