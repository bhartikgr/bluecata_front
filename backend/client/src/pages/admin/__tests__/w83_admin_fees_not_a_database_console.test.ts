/**
 * WAVE 83 · ITEM 1 — /admin/fees stops reading like a database console.
 *
 * WHY THIS TEST EXISTS AND THE GUARD IS NOT ENOUGH: mutation W83-M6 restored the
 * `Table` row in the source-of-truth panel and `npm run guard` still passed —
 * the silent-drop guard detects REMOVALS, never RE-ADDITIONS. So the only thing
 * standing between this screen and a schema dump is this file.
 *
 * THE LINE THIS WAVE DREW, on an internal-facing screen, stated once here:
 *   an operator legitimately needs the UNITS, WHO LAST EDITED the value, WHETHER
 *   THEY CAN EDIT IT HERE, and an ERROR CODE or ENVIRONMENT VARIABLE they can act
 *   on outside the product. They do NOT need the SQL table, the column, the
 *   endpoint path or the function name: they cannot act on any of those from this
 *   screen, and this panel is screenshared during partner onboarding calls.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HERE = __dirname;
const ADMIN = join(HERE, "..");
const COMPONENTS = join(ADMIN, "..", "..", "components", "admin");
/** Comments stripped — a wave note recording the old string is evidence, not copy. */
const rendered = (p: string): string =>
  readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((l) => l.replace(/(^|\s)\/\/.*$/, ""))
    .join("\n");

describe("WAVE 83 · ITEM 1 — the source-of-truth panel no longer prints schema", () => {
  const fees = rendered(join(ADMIN, "AdminFeesConsolidated.tsx"));
  it("W83-I1a — no Table / Column / GET / WRITE rows are rendered", () => {
    expect(fees).not.toContain('<Row label="Table"');
    expect(fees).not.toContain('<Row label="Column"');
    expect(fees).not.toContain('<Row label="GET"');
    expect(fees).not.toContain('<Row label="WRITE"');
    expect(fees).toContain('<Row label="Units"');
  });
  it("W83-I1b — the units are rendered in plain English, and the type union is untouched", () => {
    expect(fees).toContain("UNIT_IN_PLAIN_ENGLISH[unit] ?? unit");
    expect(fees).toContain('"currency_minor (cents)": "Whole cents (integer)"');
    // every call site still passes the typed value — nothing downstream changed
    expect(fees).toContain('unit: "currency_minor (cents)"');
  });
  it("W83-I1c — the aria-label no longer reads a table and column to a screen reader", () => {
    expect(fees).not.toContain("Source of truth for ${table}.${column}");
    expect(fees).toContain('aria-label="Where this value is stored, and who last changed it"');
  });
  it("W83-I1d — no function name, error class or endpoint path is rendered as prose", () => {
    for (const banned of [
      "getPlanPriceStrict()",
      "TierNotConfiguredError",
      "pricing_models.discountCodes",
    ]) {
      expect(fees).not.toContain(banned);
    }
    /* Endpoint paths survive ONLY as `readEndpoint:` / `writeEndpoint:` PROPS,
       which nothing renders any more (the GET/WRITE rows are gone). Every line
       that mentions an /api/ path must be one of those props, an actual data
       fetch, or a query key — never rendered prose. */
    for (const line of fees.split("\n")) {
      if (!line.includes("/api/")) continue;
      /* ── CORRECTED 2026-08-20 ────────────────────────────────────────────────
         This loop guards ONE thing: that no `/api/` path reaches a user's EYES
         as rendered prose. Two classes were being rejected that a user can
         never see, so the assertion was failing on correct source:

         1. COMMENTS. A `//` or `*` line is not rendered. Comments in this file
            legitimately cite routes to explain which guard protects them, and
            deleting that reasoning to satisfy a copy test would destroy useful
            engineering context to fix nothing a customer sees.
         2. A BARE PATH ARGUMENT ending in MORE THAN ONE punctuation character.
            The previous pattern allowed a single trailing `)`/`,`/`;`, so
            `}>("/api/admin/payment-gateway/config");` — a plain fetch argument —
            was read as prose. Two real call sites hit exactly that.

         The guard itself is UNCHANGED for anything a user could read.
         ──────────────────────────────────────────────────────────────────────── */
      const isComment = /^\s*(\/\/|\/\*|\*)/.test(line);
      if (isComment) continue;
      const isProp = /(readEndpoint|writeEndpoint|editableVia|queryKey|apiRequest|invalidateQueries|refetchQueries|useQuery|mutationFn|fetch\()/.test(line);
      const isRouteConst = /^\s*(const|let)\s|=\s*"\/api\//.test(line);
      /* a line that is nothing but the path itself (a query key or a fetch
         argument on its own line) is code, not prose */
      const isBarePathArg = /^[\s}>(]*[`"']\/api\/[^`"']*[`"'][),;]*$/.test(line.trim());
      expect(
        isProp || isRouteConst || isBarePathArg,
        `an /api/ path appears to be rendered as prose: ${line.trim()}`,
      ).toBe(true);
    }
    /* Table names survive ONLY as the `table:` prop, which is no longer rendered.
       No JSX text may contain one. */
    for (const t of ["collective_payment_schedules", "partner_fee_schedules", "platform_fees", "pricing_models"]) {
      for (const line of fees.split("\n")) {
        if (!line.includes(t)) continue;
        expect(/^\s*(table|column|provenance):\s/.test(line.trim()) || /\*/.test(line)).toBe(true);
      }
    }
    // and the behaviour those identifiers used to carry is still stated
    expect(fees).toContain("it never invents or inherits a price");
    expect(fees).toContain("Checkout will refuse rather than charge a guessed price");
  });
  it("W83-I1e — environment variable names are DELIBERATELY KEPT", () => {
    /* An admin's only lever for these lives outside the product, so renaming them
       in copy would make the screen useless. This is the judgement call the brief
       asked for, pinned so a later wave does not quietly reverse it. */
    expect(fees).toContain("COLLECTIVE_RENEWAL_WORKER_ENABLED");
    expect(fees).toContain("COLLECTIVE_RENEWAL_POLL_MS");
  });
});

describe("WAVE 83 · ITEM 1 — the other two admin screens the owner named", () => {
  it("W83-I1f — partner billing ops states the rule, not the constant or the CHECK", () => {
    const s = rendered(join(ADMIN, "AdminPartnerBillingOps.tsx"));
    expect(s).not.toContain("TIER_PRICE_UNPRICED");
    expect(s).not.toContain("moderation_state = 'approved'");
    expect(s).not.toContain("percent_policy_record");
    expect(s).toContain("refused outright rather than charged at a guessed");
    expect(s).toContain("percent-policy register");
  });
  it("W83-I1g — the commission calculator no longer names the allocator's algorithm", () => {
    const s = rendered(join(COMPONENTS, "AdminInvoicingOpsPanel.tsx"));
    expect(s).not.toContain("the server&rsquo;s\n        largest-remainder allocator");
    expect(s).toContain("using the same rounding rules");
  });
  it("W83-I1h — the mark-override panel does not print the `able_to` mode token", () => {
    const s = rendered(join(COMPONENTS, "MarkOverrideReviewPanel.tsx"));
    expect(s).not.toContain('"able_to \u2014 a GP override');
    expect(s).not.toContain("approval_note");
    expect(s).toContain("takes effect the moment it is written");
  });
});
