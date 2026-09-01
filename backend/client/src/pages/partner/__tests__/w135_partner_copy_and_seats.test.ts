/**
 * WAVE 135 · FINDING 1 (internal framing in client-facing copy) and
 *            FINDING 3 (the Team seat count).
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * §0 THE INSTRUMENT COMES FIRST
 * ══════════════════════════════════════════════════════════════════════════════
 * A copy scan is only worth its false-negative rate. Wave 126's `liveCode()`
 * character scanner treats an apostrophe in ordinary JSX prose as the opening
 * quote of a string literal and therefore STOPS STRIPPING COMMENTS from that
 * point in the file. Any scan built on it reports comment prose as live rendered
 * copy — the exact comment trap this wave was warned about, produced by the
 * instrument built to avoid it.
 *
 * §0 REPRODUCES that desync on a real file rather than describing it, and shows
 * this wave's AST-based replacement not having it. Wave 126's tests are owned by
 * wave 134; this is handed over as a proof, not a rumour.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * §1 FINDING 1 — WHAT WAS ACTUALLY WRONG, AND WHAT THE BRIEF GOT WRONG
 * ══════════════════════════════════════════════════════════════════════════════
 * The Consortium Partner surface is the surface a paying client sees, and these
 * strings described Capavate's own engineering, roadmap and data hygiene to that
 * client. Fifteen were rewritten.
 *
 * ALL THREE of the brief's "confirmed still live" strings were COMMENT text and
 * had already been fixed by wave 126. That is asserted below, because a stale
 * brief is a finding: a later wave must not re-open them.
 *
 * §2 asserts the CLASS is closed rather than the fifteen instances, by running
 * the AST classifier over every human-readable string on the whole partner
 * surface and pinning the exact residue, each survivor named with the reason it
 * is not rendered.
 *
 * §3 records why the internal-language fence does not already cover this: its
 * REGISTER of 30 DEBT sites is entirely admin screens with zero partner entries,
 * and it catches internal IDENTIFIERS, not internal FRAMING. Complementary, not
 * redundant.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * §4 FINDING 3 — the seat count was fixed by WAVE 126, not by this wave
 * ══════════════════════════════════════════════════════════════════════════════
 * The brief asked for a fix that already exists. Rather than report that and stop,
 * the behaviour is PINNED here, because it had no test: the banner figure derives
 * from the rendered rows, a signed-in active Managing Partner with no captured
 * name is not labelled pending, the unlimited sentinel is not printed as digits,
 * and the consolidation banner says nothing about our own cleanup.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT,
  liveCode135,
  humanStrings,
  classifyCopy,
  loadPartnerSources,
} from "./w135_ast_copy";
import { liveCode } from "./w126_live_code";

const { files: PARTNER_FILES, live: LIVE, raw: RAW } = loadPartnerSources();
const live = (f: string) => {
  const v = LIVE.get(f);
  if (v === undefined) throw new Error(`not scanned: ${f}`);
  return v;
};

const TEAM = "client/src/pages/partner/PartnerTeam.tsx";
const DASH = "client/src/pages/partner/PartnerDashboard.tsx";
const LOGIN = "client/src/pages/partner/PartnerLogin.tsx";
const ENGINE = "client/src/pages/partner/PartnerSpvEngine.tsx";
const PERF = "client/src/pages/partner/SpvPerformance.tsx";
const TABS = "client/src/components/partner/SpvDetailTabs.tsx";
const OPS = "client/src/components/partner/SpvOperationsPanels.tsx";
const SIDE = "client/src/components/partner/SpvSideLetterPanel.tsx";

/* ══════════════════════════════════════════════════════════════════════════ */
describe("§0 the instrument — wave 126's stripper desyncs on an apostrophe; this one does not", () => {
  const src = readFileSync(join(ROOT, SIDE), "utf8");

  it("the file really does contain both the apostrophe and, later, a comment", () => {
    expect(src).toMatch(/fund's default terms/);
    /* The comment text used as the probe is storage-model prose that appears
       ONLY inside a comment in this file. */
    expect(src).toMatch(/Integer billionths/);
    /* …and is not among the strings a human can read. */
    const human = humanStrings(SIDE, src).map((h) => h.text);
    expect(human.some((t) => /Integer billionths/.test(t))).toBe(false);
  });

  it("FAIL-BEFORE — wave 126's liveCode() leaves that comment in its output", () => {
    expect(/Integer billionths/.test(liveCode(src))).toBe(true);
  });

  it("this wave's AST stripper removes it, and keeps every rendered sentence", () => {
    const stripped = liveCode135(src);
    expect(/Integer billionths/.test(stripped)).toBe(false);
    /* Rendered copy is untouched… */
    expect(stripped).toContain("a rate that cannot be read is not guessed at");
    expect(stripped).toContain("fund's default terms");
    /* …and offsets are preserved, so a reported line number is a real one. */
    expect(stripped).toHaveLength(src.length);
  });

  it("no comment marker survives in any partner file after stripping", () => {
    /* `//` and `/*` also occur in things that are NOT comments — a URL, and
       rendered prose. Both survivors are named rather than pattern-excused, so
       this pin fails if a real comment starts surviving. */
    const RENDERED_DOUBLE_SLASH = "Sector // Sub-sector. Add more than one for a hybrid partner.";
    for (const f of PARTNER_FILES) {
      expect(live(f), f).not.toContain("/*");
      const remaining = live(f)
        .replace(/https?:\/\//g, "")
        .replace(RENDERED_DOUBLE_SLASH, "");
      expect(remaining, f).not.toMatch(/\/\//);
    }
    /* And that survivor really is copy on screen, not a comment. */
    const select = "client/src/components/partner/PartnerClassificationSelect.tsx";
    expect(
      humanStrings(select, RAW.get(select)!).some((h) => h.text === RENDERED_DOUBLE_SLASH),
    ).toBe(true);
  });

  it("CONTROL — the stripper is not simply blanking everything", () => {
    /* A stripper that returned all spaces would pass every `not.toMatch` above.
       Live code and live copy must still be there. */
    for (const f of PARTNER_FILES) {
      expect(live(f).trim().length, f).toBeGreaterThan(200);
    }
    expect(live(TEAM)).toContain("data-testid=\"seat-banner\"");
    expect(live(ENGINE)).toContain("export default");
  });

  it("CONTROL — a known positive is still flagged, and comment text is not", () => {
    const POSITIVE = `
export function Panel() {
  return <div>
    <span>Duplicate historical seats hidden; cleanup required.</span>
    <Input placeholder="Target Size (minor units)" data-testid="target-size" />
  </div>;
}`;
    const NEGATIVE = `
export function Panel() {
  /* Duplicate historical seats hidden; cleanup required. */
  /* Rates are stored as exact integer billionths of a fraction. */
  return <div>
    <span>Each member holds one seat. A seat can be reassigned at any time.</span>
    <Input placeholder="e.g. 5,000,000.00" data-testid="target-size" className="minor-units-grid" />
  </div>;
}`;
    const flag = (name: string, s: string) =>
      humanStrings(name, s).filter((h) => classifyCopy(h.text).length);
    expect(flag("pos.tsx", POSITIVE)).toHaveLength(2);
    expect(flag("neg.tsx", NEGATIVE)).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
describe("§1 FINDING 1 — the brief's three \"confirmed still live\" strings were comments, already fixed", () => {
  /* A stale brief is itself a finding. These are pinned as ABSENT from live code
     so that a later wave reading the same brief does not re-open them. */
  const alreadyFixed = [
    "Duplicate historical seats hidden; cleanup required",
    "Not yet available",
    "eligibility is fail-closed",
  ];
  it.each(alreadyFixed)("%s is not rendered anywhere on the partner surface", (phrase) => {
    for (const f of PARTNER_FILES) {
      expect(live(f), `${f} :: ${phrase}`).not.toContain(phrase);
    }
  });

  it("and the sentences that replaced them say what is true for the reader instead", () => {
    /* The duplicate-seat banner now describes the roster the reader can see,
       rather than confessing to a data-hygiene task of ours. */
    expect(live(TEAM)).toContain("This roster shows one row for each member of your organisation.");
    /* The dashboard states the CONSENT RULE that governs what is shown, rather
       than implying a feature is unfinished. */
    expect(live(DASH)).not.toMatch(/Not yet available/);
    /* The SPV engine states the eligibility rule in the reader's terms. */
    expect(live(ENGINE)).toContain("Anything that does not meet all three is never offered here.");
    expect(live(ENGINE)).not.toMatch(/fail-closed/i);
  });

  it("the demonstration sign-in no longer names our hosting arrangements", () => {
    expect(live(LOGIN)).toContain("Demonstration sign-in");
    expect(live(LOGIN)).toContain("Demonstration account");
    expect(live(LOGIN)).not.toMatch(/preview host/i);
    expect(live(LOGIN)).not.toMatch(/hidden in production/i);
    expect(live(LOGIN)).not.toMatch(/\?demo=1/);
    /* The CONTROL that this is a copy change and not a feature removal: the
       gating condition and the sign-in action are untouched. */
    expect(live(LOGIN)).toMatch(/demo/);
  });

  it("machine keys reaching the screen go through the shared humanizer, with a stated fallback", () => {
    /* Class-B: a raw enum value is an internal identifier a client should never
       read. Each call states what to show when the value is absent, so a blank
       is never rendered as if it were a fact. */
    expect(live(PERF)).toMatch(/humanizeMachineKey\(\s*[^)]*approvalMode/);
    expect(live(TABS)).toMatch(/humanizeMachineKey\(data\?\.provider, "Not on record"\)/);
    expect(live(TEAM)).toMatch(/humanizeMachineKey\(m\.status, "Status not recorded"\)/);
  });

  it("the esign failure is reported as a reference a client can quote, not as a stack trace", () => {
    expect(live(TABS)).toMatch(/Reference: \{esignReadFailure\}/);
    expect(live(TABS)).not.toMatch(/read successfully/i);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
describe("§2 the CLASS is closed — every human-readable partner string, classified", () => {
  const hits = PARTNER_FILES.flatMap((f) =>
    humanStrings(f, RAW.get(f)!).map((h) => ({ ...h, tags: classifyCopy(h.text) })),
  );

  it("the surface is scanned at a scale that could actually find something", () => {
    /* If a refactor moved the partner screens, this number would collapse and
       every `toEqual([])` below would pass for the wrong reason. */
    expect(PARTNER_FILES.length).toBeGreaterThanOrEqual(45);
    expect(hits.length).toBeGreaterThanOrEqual(3500);
  });

  it("the residue is exactly the known non-rendered set, each with a stated reason", () => {
    /* Every survivor is a string the AST cannot tell apart from copy but which
       no human reads. Named individually so a genuinely new leak cannot hide in
       a loosened matcher. */
    const residue = hits
      .filter((h) => h.tags.length)
      .map((h) => `${h.file}:${h.text}`)
      .sort();
    expect(residue).toEqual(
      [
        /* An HTTP request header value. */
        "client/src/pages/partner/OnboardingChecklistPage.tsx:application/json",
        /* Server refusal CODES, compared against `error.code` in a condition.
           The sentence the client reads is `serverRefusalMessage(error)`. */
        "client/src/pages/partner/PartnerBilling.tsx:PARTNER_COMMISSION_RATE_UNRESOLVED",
        "client/src/pages/partner/PartnerBilling.tsx:PARTNER_COMMISSION_RATE_UNRESOLVED",
        /* A `data-error-code` default — a machine attribute, beside a rendered
           sentence that says the same thing in English. */
        "client/src/pages/partner/PartnerBilling.tsx:PARTNER_TIER_UNRESOLVED",
        /* The two wave-106 cents-label helpers are DEAD exports kept only because
           a wave-128 test imports them. Nothing calls them (asserted below). */
        "client/src/components/partner/SpvDetailTabs.tsx:‹value› - in cents, not whole currency units",
        /* Thrown as an Error whose message is translated before display. */
        "client/src/components/partner/SpvDetailTabs.tsx:INVESTOR_ID_REQUIRED",
        /* A refusal code compared in a condition; the `title` beside it is the
           sentence a client reads. */
        "client/src/components/partner/SpvNavPanel.tsx:SHARE_COUNT_UNKNOWN",
        /* A discriminated-union tag on the capital-accounts data source. */
        "client/src/components/partner/SpvOperationsPanels.tsx:detail-payload",
        "client/src/components/partner/SpvOperationsPanels.tsx:detail-payload",
        /* A `typeof` comparison in the shared money parser. */
        "client/src/components/partner/partnerMoneyInput.ts:bigint",
      ].sort(),
    );
  });

  it("the dead cents-label helpers survive only for another wave's test — nothing CALLS them", () => {
    const tabs = live(TABS);
    expect(tabs).toMatch(/export function minorUnitsLabel\(/);
    expect(tabs).toMatch(/export function minorUnitsLabelNoCurrency\(/);
    for (const f of PARTNER_FILES) {
      expect(live(f), f).not.toMatch(/\{minorUnitsLabel/);
      expect(live(f), f).not.toMatch(/minorUnitsLabel(NoCurrency)?\("/);
    }
  });

  it("SpvOperationsPanels' capital-accounts source line is stated in the reader's terms", () => {
    /* The union TAG is still `detail-payload`, because that is what it is in the
       code. What the reader sees does not name a payload. */
    expect(live(OPS)).not.toMatch(/detail-payload<\//);
    expect(live(OPS)).not.toMatch(/>\s*detail-payload/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
describe("§3 why the internal-language fence does not already cover this", () => {
  const fence = readFileSync(join(ROOT, "scripts/lint/internalLanguageFence.ts"), "utf8");

  it("the fence's DEBT register names no partner SCREEN — only admin screens and one lib module", () => {
    /* Not a criticism of the fence: it is scoped to internal IDENTIFIERS leaking
       into copy. It structurally cannot see internal FRAMING and PROSE, which is
       the whole of Finding 1's Class A. The two are complementary.

       The one `/partner/` path in the register is `client/src/lib/partner/…`, a
       shared persona MODULE, not one of the 47 rendered partner screens this wave
       scanned. It is named rather than filtered away, so this pin fails if a
       partner screen is ever added to the register. */
    const registered = fence.match(/client\/src\/[A-Za-z0-9_./-]+\.tsx?/g) ?? [];
    expect(registered.length).toBeGreaterThan(0);
    expect(registered.filter((p) => /\/partner\//.test(p))).toEqual([
      "client/src/lib/partner/mfcrmPersona.ts",
    ]);
    /* Zero entries for the surfaces Finding 1 was about. */
    expect(
      registered.filter((p) => /^client\/src\/(pages|components)\/partner\//.test(p)),
    ).toEqual([]);
    /* And none of the 47 scanned files is in the register. */
    for (const f of PARTNER_FILES) expect(registered, f).not.toContain(f);
  });

  it("a Class-A sentence is invisible to an identifier fence, by construction", () => {
    /* "This shortcut only appears on preview hosts and is hidden in production."
       contains no identifier at all, so no identifier fence can flag it. This is
       asserted as a property of the sentence, not of the fence's implementation. */
    const CLASS_A = "This shortcut only appears on preview hosts and is hidden in production.";
    expect(CLASS_A).not.toMatch(/[a-z][A-Z]/);          /* no camelCase */
    expect(CLASS_A).not.toMatch(/[a-z]_[a-z]/);         /* no snake_case */
    expect(CLASS_A).not.toMatch(/\b[A-Z]{3,}\b/);       /* no SCREAMING_CASE */
    /* And the classifier in this wave's instrument DOES flag it. */
    expect(classifyCopy(CLASS_A)).toContain("internal-state");
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
describe("§4 FINDING 3 — the seat banner, fixed by WAVE 126 and pinned here", () => {
  const team = live(TEAM);

  it("the displayed figure derives from the rows the reader can actually count", () => {
    /* The server's `activeSeats` counts SEAT RECORDS; the roster collapses legacy
       duplicate identities to one row per person. When they disagreed the banner
       read "2 of 2 seats" above a single row, which on a client's screen is
       simply a wrong number. The roster is what can be counted, so it wins. */
    expect(team).toContain("const renderedMembers = q.data?.members ?? [];");
    expect(team).toContain('const activeCount = renderedMembers.filter((m) => m.status === "active").length;');
    /* And the banner renders THAT figure, not the server's. */
    expect(team).toMatch(/data-testid="seat-banner"/);
    expect(team).toMatch(/\$\{activeCount\} of \$\{seatLimitLabel\} seats · \$\{pendingCount\} pending/);
    expect(team).not.toMatch(/\$\{[^}]*activeSeats[^}]*\} of/);
  });

  it("FAIL-BEFORE, arithmetically — the two counts disagree on a collapsed roster", () => {
    /* One person, two legacy seat records. This is the payload shape that
       produced the wrong banner. */
    const payload = {
      members: [{ userId: "u1", status: "active", subRole: "managing_partner", name: null }],
      invitations: [] as Array<{ redeemedAt: string | null }>,
      seatLimit: 2,
      activeSeats: 2,
      meta: { duplicateSeatCount: 1 },
    };
    const rendered = payload.members.filter((m) => m.status === "active").length;
    expect(payload.activeSeats).toBe(2);   /* what the banner used to print */
    expect(rendered).toBe(1);              /* what the reader could count */
    expect(payload.activeSeats).not.toBe(rendered);
    /* The surplus is not discarded — it is what the consolidation note reports. */
    expect(payload.meta.duplicateSeatCount).toBe(payload.activeSeats - rendered);
  });

  /* ─────────────────────────────────────────────────────────────────────────
     RE-POINTED BY WAVE 229 (R198.6 / R202.1 — the fix and its proof move
     together, and the proof is TIGHTENED, not loosened).

     This assertion used to pin the source line
       const pendingCount = (q.data?.invitations ?? []).filter((i) => !i.redeemedAt).length;
     which wave 135 correctly identified as "unredeemed only". Wave 229 found
     that this was a SECOND derivation of a quantity the server already owns.
     `invitations` is built by `listByPartner()` from a PROCESS-LOCAL RAM array;
     the Dashboard tile and the seat-limit ENFORCEMENT path both use
     `countPendingByPartner()`, which reads the durable table and returns
     `Math.max(durable, ram)` precisely because a restarted server or a second
     instance sees an empty RAM array (WAVE 19 / SEAT-02). The two derivations
     could therefore disagree, and the banner was the one that under-reported.

     So the requirement wave 135 was expressing — the banner must not count
     redeemed invitations — is now satisfied by the SERVER resolver, whose
     predicate additionally excludes EXPIRED invitations. This test therefore
     asserts the stronger property: the banner reads the server's figure, and
     does not re-derive one. It is not relaxed to accept either shape.
     ───────────────────────────────────────────────────────────────────────── */
  it("the pending figure comes from the server resolver, not a second client derivation", () => {
    /* The banner reads the server's field … */
    expect(team).toContain("const serverPendingCount = q.data?.pendingCount;");
    expect(team).toContain('const pendingCount: number | string = serverPendingCount ?? "\\u2014";');
    /* … and the old client-side re-derivation is gone from the live code. */
    expect(team).not.toContain("const pendingCount = (q.data?.invitations ?? []).filter((i) => !i.redeemedAt).length;");
    /* An absent server figure must NOT become a fabricated 0 about seat
       capacity. The em dash is the honest render. */
    expect(team).not.toMatch(/serverPendingCount \?\? 0/);
    const banner = (server: number | undefined) => (server ?? "\u2014");
    expect(banner(3)).toBe(3);
    expect(banner(undefined)).toBe("\u2014");
  });

  it("the no-cap sentinel is rendered as a word, never as the digits 9999", () => {
    expect(team).toContain('const seatLimitLabel = seatLimit === 9999 ? "Unlimited" : String(seatLimit);');
    const label = (n: number | undefined) => (n === 9999 ? "Unlimited" : String(n));
    expect(label(9999)).toBe("Unlimited");
    expect(label(5)).toBe("5");
    /* And when the server sends no limit at all, the count-only wording is used
       rather than a guessed cap. */
    expect(team).toMatch(/seatLimit === undefined/);
    expect(team).toMatch(/\$\{activeCount\} active seats \+ \$\{pendingCount\} pending invitations/);
  });

  it("a signed-in ACTIVE Managing Partner with no captured name is not labelled pending", () => {
    /* The label used to be chosen on the basis of a MISSING NAME, so an active
       Managing Partner whose name had never been captured read as an outstanding
       invitation. The fallback now depends on the member's actual status, which
       is the thing the label claims to describe. */
    expect(team).toContain(
      'safePersonDisplayName(m.name, m.status === "active" ? "Name not on file" : "Invitation pending")',
    );
    const fallbackFor = (status: string) => (status === "active" ? "Name not on file" : "Invitation pending");
    expect(fallbackFor("active")).toBe("Name not on file");
    expect(fallbackFor("invited")).toBe("Invitation pending");
    expect(fallbackFor("active")).not.toMatch(/pending/i);
  });

  it("the consolidation banner is gated, and says nothing about our own cleanup", () => {
    expect(team).toMatch(/data-testid="duplicate-seat-warning"/);
    expect(team).toMatch(/canInvite && \(q\.data\?\.meta\?\.duplicateSeatCount \?\? 0\) > 0/);
    expect(team).toContain("Earlier duplicate records for the same people are consolidated into");
    expect(team).not.toMatch(/cleanup required/i);
    expect(team).not.toMatch(/duplicate historical/i);
    /* "hidden" is checked against the strings a HUMAN reads, not against the
       source: the file legitimately contains `overflow-hidden` twice, in
       Tailwind class names, and a source-level ban would fail on those. */
    const readable = humanStrings(TEAM, RAW.get(TEAM)!).map((h) => h.text);
    expect(readable.filter((t) => /\bhidden\b/i.test(t))).toEqual([]);
    expect(readable.some((t) => /consolidated into/.test(t))).toBe(true);
  });

  it("the sole active Managing Partner's destructive controls stay disabled", () => {
    /* Unrelated to the count, but it is derived from the SAME rendered list, so a
       later change to that derivation must not orphan a workspace. */
    expect(team).toMatch(/const managingPartnerCount = /);
    expect(team).toMatch(/m\.subRole === "managing_partner" && m\.status === "active"/);
    expect(team).toContain("Workspace requires at least one managing partner — promote another member first.");
  });
});
