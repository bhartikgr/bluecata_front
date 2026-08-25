/**
 * WAVE 117 — MISLABELLED CONTROLS AND INTERNAL DEPLOYMENT NAMES ON SCREEN.
 *
 * FINDING 1 — `PartnerSpvTemplates.tsx` promised that applying a template "fills
 * in the create form". It never did: `POST /apply` records an application and
 * returns a prefill payload that nothing on the platform carries into the SPV
 * wizard. The promise is gone; the control is kept, because it does real, logged
 * work, and it now (a) says what it does, (b) shows ALL eleven values the server
 * returned instead of four, (c) offers a clipboard hand-off, and (d) reports a
 * failure instead of looking as though it worked.
 *
 * FINDING 4 — admin screens naming internal deployment and storage settings to a
 * human. The brief said eight; the registered population is far larger and is
 * enumerated in build_log/wave117/W117_PREFLIGHT.md §4.2. THIS WAVE FIXED THE
 * CLASS THAT NAMES A DATABASE TABLE, A DATABASE COLUMN, A PLATFORM EVENT KEY OR
 * A RATE-LIMIT BUCKET — twelve sites on eleven screens, pinned one at a time
 * below. Machine-readable values are untouched by design (R77): a `data-testid`,
 * a query key, an `error.code` and an input placeholder whose PURPOSE is to show
 * the operator the value to type all keep their identifiers.
 *
 * BEFORE/AFTER IS PROVEN IN THIS FILE. Each site asserts twice: the identifier is
 * absent from the current source, and PRESENT in the pre-wave copy saved at
 * `w117_scratch/admin_before/`. If the saved copy is missing the suite says so
 * rather than passing quietly.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const REPO = path.resolve(__dirname, "..", "..", "..", "..", "..");
const ADMIN = "client/src/pages/admin";
const BEFORE_DIR = path.join(REPO, "w117_scratch/admin_before");

const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8");
/** Comments are stripped: a comment is documentation, not text a user reads. */
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const code = (rel: string) => strip(read(rel));
const beforeCode = (file: string) => strip(fs.readFileSync(path.join(BEFORE_DIR, file), "utf8"));

/**
 * EVERYTHING A HUMAN READS ON THE SCREEN, AND NOTHING ELSE.
 *
 * R77 is explicit that an identifier may stay in a machine-readable position — a
 * query key, an `error.code`, a comparison, a URL, a `data-testid`. Those are
 * short tokens with no prose around them. What a human reads is either a prose
 * string literal (a `description=`, `helper=`, `title=` or `placeholder=` value)
 * or a JSX text node. This extractor takes exactly those things: quoted or
 * backticked strings containing at least four spaces, prose text between JSX
 * tags, and — the case that caught PricingModelDetail — a SHORT, identifier-shaped
 * JSX text node, which is how these screens print a raw key: wrapped alone in a
 * `<span className="font-mono">`. `"lifecycle_policy.changed"` sitting in a query
 * key is therefore correctly ignored, while the same string printed inside a tag
 * is not.
 */
function humanProse(src: string): string {
  const out: string[] = [];
  for (const m of src.matchAll(/"([^"\n]{16,})"|`([^`]{16,})`/g)) {
    const s = m[1] ?? m[2] ?? "";
    if ((s.match(/ /g) ?? []).length >= 4) out.push(s);
  }
  for (const m of src.matchAll(/>([^<>{}]+)</gs)) {
    const s = m[1];
    const spaces = (s.match(/ /g) ?? []).length;
    /* Prose … */
    if (s.length >= 16 && spaces >= 4) { out.push(s); continue; }
    /* … or a bare identifier printed on its own, which is a rendered key. */
    if (spaces === 0 && /^[a-z][a-z0-9]*([._:][a-z0-9]+)+$/i.test(s.trim())) out.push(s.trim());
  }
  return out.join("\n");
}

/* ── THE CORRECTED SITES, ONE ROW EACH ─────────────────────────────────────
   Thirteen identifiers across fourteen rendered sites on eleven screens. The
   brief said eight; it was low, as the brief itself warned it might be. Two of
   these (`lifecycle_policy.changed` in the guidance panel and
   `archivalRetentionDays` in the legal warning) were NOT in the fence registry at
   all and were found by this test failing on its first run.

   `kind` records WHY each one is internal deployment language, so a later reader
   can tell this class apart from product vocabulary (which this wave did not
   touch — see the preflight). */
const FIXED: Array<{ file: string; token: string; kind: string }> = [
  { file: "Users.tsx", token: "auth_users", kind: "database table" },
  { file: "Payments.tsx", token: "payment_ledger", kind: "database table" },
  { file: "AdminPlatformFees.tsx", token: "platform_fees", kind: "database table" },
  { file: "AdminPlatformFees.tsx", token: "collective.member_subscription", kind: "event key" },
  { file: "CollectivePaymentPL.tsx", token: "collective_payment_entries", kind: "database table" },
  { file: "ConsortiumApplicationsPage.tsx", token: "partner_organizations", kind: "database table" },
  { file: "ConsortiumApplicationsPage.tsx", token: "public:apply", kind: "rate-limit bucket" },
  { file: "PartnerDetail.tsx", token: "contacts.metadata_json", kind: "database table.column" },
  { file: "LifecyclePolicies.tsx", token: "lifecycle_policy.changed", kind: "event key" },
  { file: "LifecyclePolicies.tsx", token: "archivalRetentionDays", kind: "internal field name" },
  { file: "PricingModelDetail.tsx", token: "pricing_model.published", kind: "event key" },
  { file: "Dashboard.tsx", token: "wired_minor", kind: "database column" },
  { file: "PartnerPL.tsx", token: "commission_minor", kind: "database column" },
];

describe("W117 F4 — no admin screen names a database table, column, event key or rate-limit bucket to a human", () => {
  for (const { file, token, kind } of FIXED) {
    it(`W117-T-A · ${file} no longer renders the ${kind} \`${token}\``, () => {
      const prose = humanProse(code(`${ADMIN}/${file}`));
      expect(prose, `${file} still shows \`${token}\` to a human`).not.toContain(token);
    });

    it(`W117-T-B · BEFORE-PROOF — the pre-wave ${file} DID render \`${token}\``, () => {
      const p = path.join(BEFORE_DIR, file);
      expect(fs.existsSync(p), `pre-wave copy missing: ${p}`).toBe(true);
      expect(
        humanProse(beforeCode(file)),
        `the pre-wave ${file} should have shown \`${token}\` to a human`,
      ).toContain(token);
    });
  }
});

describe("W117 F4 — what was deliberately NOT changed, pinned so the reasoning cannot be lost", () => {
  it("W117-T-C · the ratified env-var sites are untouched (owner ruling Q25/R44, pinned by the w83 test)", () => {
    /* `COLLECTIVE_RENEWAL_*`, `MAX_CONSECUTIVE_FAILURES` and
       `ENABLE_MOCK_MIGRATION=1` are OWNER-RATIFIED admin exceptions in
       `scripts/lint/internalLanguageFence.ts`, and two of them are additionally
       pinned by `w83_admin_fees_not_a_database_console.test.ts`. Renaming them
       here would have broken a ratified decision and a passing test. */
    const fees = read(`${ADMIN}/AdminFeesConsolidated.tsx`);
    expect(fees).toContain("COLLECTIVE_RENEWAL_WORKER_ENABLED");
    expect(fees).toContain("MAX_CONSECUTIVE_FAILURES");
    expect(read(`${ADMIN}/Migration.tsx`)).toContain("ENABLE_MOCK_MIGRATION");
  });

  it("W117-T-D · an input placeholder that shows the operator the VALUE to type keeps it (R77)", () => {
    /* `PlatformSurfaces.tsx` asks the admin to type an incident key, and
       `RegionExtensionDetail.tsx` asks for an adjustment kind. The placeholder is
       an example of the field's own value, not a description of the product, so
       removing it would break the control rather than clarify it. */
    expect(read(`${ADMIN}/PlatformSurfaces.tsx`)).toContain('placeholder="audit.chain_integrity"');
    expect(read(`${ADMIN}/RegionExtensionDetail.tsx`)).toContain("safe_conversion");
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   FINDING 1 — THE APPLY-TEMPLATE PROMISE
   ════════════════════════════════════════════════════════════════════════════ */
const TPL = "client/src/pages/partner/PartnerSpvTemplates.tsx";

describe("W117 F1 — Apply Template no longer promises to fill a form it cannot reach", () => {
  it("W117-T-E · the dead promise is gone from the page and from its docblock", () => {
    /* BEFORE: \"Applying a template fills in the create form\" (rendered copy) and
       \"it copies the template's values into the SPV create form\" (docblock). */
    const src = read(TPL);
    expect(strip(src)).not.toContain("fills in the create form");
    expect(src).not.toContain("it copies the template's values into the SPV create form.");
  });

  it("W117-T-F · the copy now states what the click actually does, and still refuses the SPV claim", () => {
    const src = strip(read(TPL));
    expect(src).toContain("records that the template was used and lists its");
    expect(src).toContain("it does not create an SPV");
    /* The panel heading no longer says the values were carried anywhere. */
    expect(src).toContain("Template recorded — these are its saved values, to copy into the SPV create form");
    expect(src).not.toContain("Template applied — carry these values into the SPV create form");
  });

  it("W117-T-G · every value the server returns is now on screen — four of eleven was the reason 'carry these across' was impossible", () => {
    const src = read(TPL);
    for (const testid of [
      "prefill-template-name",
      "prefill-spv-type",
      "prefill-jurisdiction",
      "prefill-carry-basis",
      "prefill-distribution-scope",
      "prefill-lp-visibility",
      "prefill-min-check",
      "prefill-target-raise",
      "prefill-cap",
      "prefill-carry",
    ]) {
      expect(src, `the prefill panel must show ${testid}`).toContain(`data-testid="${testid}"`);
    }
  });

  it("W117-T-H · the hand-off is a real control, and a refused apply is stated instead of looking successful", () => {
    const src = read(TPL);
    expect(src).toContain('data-testid="button-copy-prefill"');
    expect(src).toContain('data-testid="prefill-copy-state"');
    /* The clipboard path reports its own failure — a silent no-op is the defect
       this wave exists to remove. */
    expect(src).toContain("nothing was copied");
    /* And the mutation has an `onError` at all, which it did not before. */
    expect(src).toContain('data-testid="spv-template-apply-error"');
    expect(src).toContain("nothing was applied");
  });

  it("W117-T-I · no money value on this page passes through Number(), parseInt or parseFloat", () => {
    const src = strip(read(TPL));
    expect(src).not.toContain("parseInt");
    expect(src).not.toContain("parseFloat");
    /* `formatMinor` is the only renderer of a minor-unit amount, in the panel and
       in the clipboard text alike, so the two cannot disagree. */
    expect(src).toContain("formatMinor(minor, currency)");
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   FINDING 4 (third bullet) — REPORTED, NOT FIXED: A REFUSED CAP-TABLE VIEW
   STILL PRINTS A FIGURE IN ITS SMALL PRINT.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W117 F4c — the refused-view figure, now FIXED by the file's owner", () => {
  it("W117-T-J · founder/CapTable.tsx hints ARE gated on the refusal — the defect is closed", () => {
    /* FLIPPED, as this test's own instructions required.

       W117 located the defect and left it because `founder/CapTable.tsx` was on
       its DO-NOT-TOUCH list. The lead developer applied the one-line fix it
       supplied, on 2026-08-22, and this assertion is therefore inverted from
       "expected to still be refusal-blind" to "must be refusal-gated".

       WHY IT MATTERED: the three ownership tiles gated their VALUE on
       `!viewRefusal` but their `hint` only on `securities.isSuccess`, so a
       refused view rendered an em-dash with "0 shares" printed underneath it.
       Under a refusal the engine has published nothing, so that zero meant
       "nothing was computed", not "the company has no founder shares" — a share
       count we do not have, stated as fact.

       The genuine-zero case that `w61a_captable_zero_shares_percent` pins is
       unaffected: it has no refusal, so `!viewRefusal` is true and "0 shares"
       still renders. That is the distinction the fix turns on, and it is why
       the hint had to be gated on the SAME condition as the value above it
       rather than simply deleted. */
    /* ═════════════════════════════════════════════════════════════════════
       WAVE 133 · R98 — RE-PINNED ONTO WAVE 125'S STRONGER, THIRD GATE.
       ═════════════════════════════════════════════════════════════════════
       RULING: OWNER_RULINGS_2026_08_13.md R98.

       The pin below used to require the founder hint to BEGIN literally with
       `hint={securities.isSuccess && !viewRefusal ? ${fmtNum(`. Wave 125 then
       added a THIRD gate in front of it — `founderHolding.refuse`, which fires on
       founder-row PRESENCE rather than on publication — because the tile was
       printing a false `0.00%` over `0 shares` for a company with 150 shares and
       no founder row at all. So the literal prefix moved, and the pin failed
       against code that is STRICTLY STRONGER than the code it was written for.
       The CODE is correct; the pin was stale.

       Not weakened: the two original assertions per tile are kept verbatim in
       substance (the load-success + refusal gate, and the unit-qualified
       fallback) — they are simply no longer anchored to the start of the hint
       attribute, so a further gate may be prepended but none may be removed. A
       THIRD assertion is then added for `stat-founders` requiring wave 125's
       row-presence gate to be present AND to be evaluated BEFORE the
       publication gate, which is the property that actually closes the
       `0.00%` defect and which nothing pinned until now. 6 pins out, 9 in. */
    const src = read("client/src/pages/founder/CapTable.tsx");
    for (const [testid, unit] of [["stat-founders", "shares"], ["stat-investors", "shares"], ["stat-options", "options"]] as const) {
      const line = src.split("\n").find((l) => l.includes(`testid="${testid}"`));
      expect(line, `expected a ${testid} tile`).toBeTruthy();
      const hint = line!.slice(line!.indexOf("hint={"));
      expect(hint, `${testid} hint must be gated on the refusal, not only on load success`).toContain(
        `securities.isSuccess && !viewRefusal ? \`\${fmtNum(`,
      );
      /* The hint's own fallback, matched together with its unit so this cannot
         be satisfied by the VALUE's `: MONEY_UNAVAILABLE` earlier on the line. */
      expect(hint, `${testid} must fall back to the unavailable marker, never a figure`).toContain(
        `${unit}\` : MONEY_UNAVAILABLE}`,
      );
      if (testid === "stat-founders") {
        /* WAVE 125 · FINDING 1 — the row-presence refusal must come FIRST, so a
           cap table with no founder row can never reach the percentage branch. */
        expect(hint, "the founder hint must also carry wave 125's row-presence refusal").toContain("founderHolding.refuse");
        expect(
          hint.indexOf("founderHolding.refuse"),
          "wave 125's row-presence refusal must be evaluated BEFORE the publication gate",
        ).toBeLessThan(hint.indexOf("securities.isSuccess"));
        const value = line!.slice(line!.indexOf("value={"), line!.indexOf("hint={"));
        expect(value, "the founder VALUE must carry the same row-presence refusal as its hint").toContain("founderHolding.refuse");
      }
    }
  });
});
