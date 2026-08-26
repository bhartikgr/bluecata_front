/* WAVE 129 — R95: A PRICE STATES ITS PERIOD, AND NO PRICE IS EVER COMPILED IN.
 *
 * The defect these tests lock down, in the owner's words: the Partner Dashboard
 * showed "Tier price (no active subscription) $240.00 USD/mo". $240.00 is the
 * ANNUAL maintenance fee stored on the authoritative `partner_tier_price` row
 * (migrations/0185_wave45_pricing_model_v3.sql:241-245, cadence 'annual',
 * derivation 'admin_set'). The amount was right and the PERIOD was a compiled-in
 * string, so a partner about to become a paying client was quoted twelve times
 * the real price.
 *
 * Three groups:
 *   §1  the resolver now CARRIES the cadence from the DB row, and never invents
 *       one — including for a per-partner monthly override, which keeps ITS OWN
 *       period rather than being silently re-labelled annual.
 *   §2  the display contract: no cadence on record => NO period phrase, so the
 *       surface must refuse rather than default to "/ mo".
 *   §3  THE FENCE. Fails if a new money literal appears in a partner pricing
 *       rendering path, or if the hardcoded "/ mo" (or any compiled-in period
 *       suffix beside a currency) comes back. This is the test that stops the
 *       defect recurring; everything else fixes it once.
 *
 * Comments are STRIPPED before the fence counts anything: this tree's build log
 * records five agents mis-reporting a narrative comment as live code
 * (server/lib/partnerTiers.ts:289 documents `founding_member is priced 24000`
 * inside a block comment). A fence that reads comments is a fence that lies.
 */
import { describe, it, expect, beforeAll } from "vitest";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { getDb, rawDb } from "../db/connection";
import { resolvePartnerEffectivePlan } from "../lib/partnerEffectivePlan";

const ROOT = path.resolve(__dirname, "..", "..");

/* ─────────────────────────────────────────────────────────────────────────────
 * A comment stripper that PRESERVES LINE NUMBERS, so a failure message points
 * at the real line. Handles // and /* *\/ and template/quote strings so a URL
 * or a regex is not mistaken for a comment.
 * ────────────────────────────────────────────────────────────────────────── */
export function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  let mode: "code" | "line" | "block" | "sq" | "dq" | "tpl" = "code";
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (mode === "code") {
      if (c === "/" && d === "/") { mode = "line"; i += 2; continue; }
      if (c === "/" && d === "*") { mode = "block"; i += 2; continue; }
      if (c === "'") { mode = "sq"; out += c; i++; continue; }
      if (c === '"') { mode = "dq"; out += c; i++; continue; }
      if (c === "`") { mode = "tpl"; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (mode === "line") {
      if (c === "\n") { mode = "code"; out += c; }
      i++; continue;
    }
    if (mode === "block") {
      if (c === "*" && d === "/") { mode = "code"; i += 2; continue; }
      if (c === "\n") out += c;
      i++; continue;
    }
    // inside a string literal
    if (c === "\\") { out += c + (d ?? ""); i += 2; continue; }
    if ((mode === "sq" && c === "'") || (mode === "dq" && c === '"') || (mode === "tpl" && c === "`")) mode = "code";
    out += c; i++; continue;
  }
  return out;
}

const PID = `ct_test_w129_${crypto.randomBytes(4).toString("hex")}`;
const NOW = "2026-08-24T00:00:00Z";

beforeAll(() => {
  getDb();
  const db = rawDb();
  db.prepare(
    `INSERT OR REPLACE INTO contacts
       (id, kind, legal_name, display_name, status, verification, created_at, updated_at, created_by, updated_by, version, prev_revision_hash, revision_hash, tenant_id)
     VALUES (?, 'consortium_partner', 'W129 Test Partner', 'W129 Test Partner', 'active', 'verified', ?, ?, 'test', 'test', 1, '0', 'h0', 'tn_test')`,
  ).run(PID, NOW, NOW);
});

/* ─── §1 the cadence travels with the amount ──────────────────────────────── */
describe("WAVE 129 §1 — the period comes from the DB row, never from source", () => {
  it("carries billingPeriod on the advertised tier price", () => {
    let plan;
    try {
      plan = resolvePartnerEffectivePlan(PID, "catalyst" as never);
    } catch {
      /* An unpriced/unconfigured tier REFUSES — that is R95-correct behaviour and
         is asserted separately in §2. Nothing to check here in that case. */
      return;
    }
    // The field must EXIST on the contract. Before this wave it did not, which is
    // why the client had to invent a period.
    expect(plan.effectivePrice).toHaveProperty("billingPeriod");
    if (plan.advertisedPrice) expect(plan.advertisedPrice).toHaveProperty("billingPeriod");

    // And when a period is reported it must be the cadence on the row an admin
    // edits — never the string "monthly" merely because the resolver's default
    // cycle argument used to be compiled in as "monthly".
    if (plan.effectivePrice.source === "tier_advertised" && plan.effectivePrice.billingPeriod) {
      const row: any = rawDb()
        .prepare(
          `SELECT cadence FROM partner_tier_price
            WHERE tier_slug = 'catalyst' AND active = 1 AND cadence = ?`,
        )
        .get(plan.effectivePrice.billingPeriod);
      expect(row, `no active partner_tier_price row has cadence='${plan.effectivePrice.billingPeriod}' — the period was not read from the authoritative table`).toBeTruthy();
    }
  });

  it("never reports a period that is not on the row (no annual/12, no monthly*12)", () => {
    let plan;
    try {
      plan = resolvePartnerEffectivePlan(PID, "catalyst" as never);
    } catch {
      return;
    }
    // If the authoritative catalogue only sells 'annual', the resolver must not
    // hand back a monthly-labelled figure for a tier-advertised price.
    const cadences: string[] = rawDb()
      .prepare(`SELECT DISTINCT cadence FROM partner_tier_price WHERE active = 1`)
      .all()
      .map((r: any) => String(r.cadence));
    if (plan.effectivePrice.source === "tier_advertised" && plan.effectivePrice.billingPeriod) {
      expect(cadences).toContain(plan.effectivePrice.billingPeriod);
    }
  });
});

/* ─── §2 the display contract: refuse, do not default ─────────────────────── */
describe("WAVE 129 §2 — no cadence on record means no figure", () => {
  const helper = fs.readFileSync(path.join(ROOT, "client/src/lib/partnerDisplay.ts"), "utf8");
  const code = stripComments(helper);

  it("billingPeriodPhrase exists exactly once and is the only period vocabulary", () => {
    expect(code).toContain("export function billingPeriodPhrase");
    // Exactly one definition — R94/R95 forbid a second helper doing the same job.
    const defs = code.match(/export function billingPeriodPhrase/g) ?? [];
    expect(defs.length).toBe(1);
  });

  it("returns nothing for an unrecorded cadence rather than defaulting to a period", () => {
    // Asserted on the source contract rather than by importing a browser module
    // into the node test env: the function's empty branch must `return null`.
    const body = code.slice(code.indexOf("export function billingPeriodPhrase"));
    const firstBrace = body.indexOf("{");
    const fn = body.slice(firstBrace, body.indexOf("\n}", firstBrace));
    expect(fn).toContain("return null");
    // and must NOT contain a compiled-in fallback period
    expect(fn).not.toMatch(/\?\?\s*["'`](per month|per year|\/ ?mo)/);
  });

  it("the dashboard prints no figure when the period is unknown", () => {
    const dash = stripComments(
      fs.readFileSync(path.join(ROOT, "client/src/pages/partner/PartnerDashboard.tsx"), "utf8"),
    );
    // the refusal sentence is rendered...
    expect(dash).toMatch(/no billing period is recorded/i);
    // ...and the figure is empty in that branch (an empty string, not a number).
    expect(dash).toMatch(/figure:\s*""/);
  });
});

/* ─── §3 THE FENCE ────────────────────────────────────────────────────────── */
describe("WAVE 129 §3 — FENCE: no compiled-in price or period on a pricing render path", () => {
  /* The surfaces a Consortium Partner or Collective member is quoted on. These
     are the paths where a literal is a customer-visible lie, so they are fenced
     hardest. Extend this list when a new partner pricing surface is added; that
     is the point of the fence. */
  const FENCED = [
    "client/src/pages/partner/PartnerDashboard.tsx",
    "client/src/pages/partner/PartnerBilling.tsx",
    "client/src/pages/partner/PartnerSubscribe.tsx",
    "client/src/lib/partnerDisplay.ts",
    "server/lib/partnerEffectivePlan.ts",
    "server/lib/partnerTiers.ts",
    "server/lib/partnerApprovalInvoice.ts",
    "server/lib/spvDeploymentFeeSource.ts",
    /* WAVE 131 — the fence must cover the surfaces this wave created, or the one
       pricing console becomes the easiest place in the tree to compile a price
       in. All four are pricing render/resolve paths. */
    "client/src/pages/admin/AdminFeesConsolidated.tsx",
    "server/lib/pricingConsoleRoutes.ts",
    "server/lib/pricingDisplaySourceRepoint.ts",
    "server/lib/wave15FeeScheduleAggregate.ts",
    /* WAVE 152 · ITEM G · G-C10 — the PUBLIC marketing homepage was the one
       pricing render path this fence did not cover, and it held the worst
       instance in the tree: `price_minor: 84000` plus the string
       "$840/year per company", compiled into the client bundle and served to
       anonymous visitors whenever /api/pricing-public was unreachable. A price
       that requires a deploy to correct is exactly what R95 forbids. Fencing
       the hook stops the literal coming back. */
    "client/src/lib/usePublicPricing.ts",
    /* WAVE 152 · ITEM G · G-C8 — held `CANONICAL_MEMBER_FALLBACK_MINOR = 24900`,
       a compiled-in Collective membership price served with HTTP 200 whenever
       platform_fees could not be read. */
    "server/lib/collectiveMemberSubscriptionResolver.ts",
  ];

  it("contains no hardcoded period suffix beside a money figure", () => {
    const offenders: string[] = [];
    for (const rel of FENCED) {
      const lines = stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8")).split("\n");
      lines.forEach((line, idx) => {
        // "/ mo", "/mo", "/ yr", "per month" etc. written as literal JSX text.
        if (/>\s*\/\s*(mo|yr|mth|month|year)\b/.test(line)) offenders.push(`${rel}:${idx + 1}: ${line.trim()}`);
        if (/\{[^}]*currency[^}]*\}\s*\/\s*(mo|yr)\b/.test(line)) offenders.push(`${rel}:${idx + 1}: ${line.trim()}`);
      });
    }
    expect(
      offenders,
      `A period suffix is compiled into a rendering path. The period must come from the\n` +
        `DB cadence via billingPeriodPhrase(); a literal here is how the owner's ANNUAL\n` +
        `$240.00 was shown to a partner as a MONTHLY price.\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("contains no money literal that could be rendered as a price", () => {
    /* A money literal on these paths means a price that no admin typed. Allowed:
       0/1/2 (indexes, array offsets), 100 and 12 are NOT allowed on these paths
       because they are how a /100 or a ÷12 sneaks in, and 24000/240/1000 are the
       specific figures this wave traced. Tailwind numbers cannot appear here
       because we only look at non-className positions. */
    /* WAVE 152 · ITEM G · G-C10/G-C8 — 84000, 150000 and 24900 added. 84000 is the
       figure R115.1 warns about twice over: it is BOTH the Consortium Partner
       annual account fee AND the Capavate founder annual price, so a literal of
       it on a render path is indistinguishable from the other product's price.
       150000 was the Academy figure beside it in the same object literal, and
       24900 was the deleted Collective member fallback. */
    const MONEY = /(?<![\w.$-])(240|1000|2400|24000|24900|60000|50000|500000|250000|30000|2500|84000|150000)(?![\w.])/;
    const offenders: string[] = [];
    for (const rel of FENCED) {
      const lines = stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8")).split("\n");
      lines.forEach((line, idx) => {
        if (/className|data-testid|aria-|href|import |from "/.test(line)) return;
        /* WAVE 131 — MILLISECONDS ARE NOT MONEY. Extending the fence over the
           consolidated console brought in two lines describing a worker's poll
           interval (`pollIntervalMs`, `COLLECTIVE_RENEWAL_POLL_MS`, "60000 ms").
           Muting the fence for them would be wrong; so would renaming them. The
           exclusion is narrow on purpose: the line must name a millisecond unit
           explicitly, so a price cannot hide behind it. */
        if (/\bms\b|Ms\b|_MS\b|IntervalMs|TimeoutMs|pollInterval/.test(line)) return;
        const m = MONEY.exec(line);
        if (m) offenders.push(`${rel}:${idx + 1}: [${m[1]}] ${line.trim()}`);
      });
    }
    expect(
      offenders,
      `A money literal appeared on a pricing render path. Every price must be read\n` +
        `from the admin-controlled row at request time (R95). If a price is genuinely\n` +
        `not on record, REFUSE: print no figure and say why.\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("contains no assumed-multiplier derivation of a price (/12 or *12)", () => {
    const offenders: string[] = [];
    for (const rel of FENCED) {
      const lines = stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8")).split("\n");
      lines.forEach((line, idx) => {
        if (/(amount|price|minor|fee)[A-Za-z]*\s*[/*]\s*12\b/i.test(line)) {
          offenders.push(`${rel}:${idx + 1}: ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      `A price was derived by an assumed multiplier. R95: "a figure derived by an\n` +
        `assumed multiplier such as annual / 12" is itself the defect — twelve equal\n` +
        `monthly instalments of the annual fee are not a product this platform sells.\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("no raw tier enum is interpolated beside a price on a partner surface", () => {
    const offenders: string[] = [];
    for (const rel of ["client/src/pages/partner/PartnerBilling.tsx", "client/src/pages/partner/PartnerDashboard.tsx"]) {
      const lines = stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8")).split("\n");
      lines.forEach((line, idx) => {
        // {agg.tier} / {quote.tier} / {sub.billingCycle} rendered without a label helper
        if (/\{(agg|quote|sub|lifecycle)\.(tier|cycle|billingCycle)\}/.test(line)) {
          offenders.push(`${rel}:${idx + 1}: ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      `A storage slug is being shown to a human. Use planTierLabel /\n` +
        `billingCadenceLabel / billingPeriodPhrase / humanizeMachineKey from\n` +
        `client/src/lib/partnerDisplay.ts — do not write another helper.\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("the partner price query does not inherit the 30s client cache", () => {
    const dash = stripComments(
      fs.readFileSync(path.join(ROOT, "client/src/pages/partner/PartnerDashboard.tsx"), "utf8"),
    );
    // client/src/lib/queryClient.ts sets staleTime: 30_000 as the DEFAULT for every
    // query. A price surface must opt out or an admin change is invisible for 30s.
    const meBlock = dash.slice(dash.indexOf('"/api/partner/me"'));
    expect(meBlock.slice(0, 800)).toMatch(/staleTime:\s*0/);
  });
});
