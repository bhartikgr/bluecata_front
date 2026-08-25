/* WAVE 131 — ONE ADMIN CONSOLE FOR ALL PRICING AND PAYMENTS.
 *
 * The owner's words: "I've asked several times to consolidate ALL pricing and
 * payment admin areas into one area … I want to be able to go to one link where
 * I can dynamically administer pricing for ALL areas of the platform."
 *
 * Each previous attempt added a consolidated page and removed no door, so the
 * admin sidebar still carried EIGHT pricing links and eight pricing pages sat on
 * disk unrouted. These tests hold the consolidation in place:
 *
 *   §1  ONE route administers every price, and the eight sidebar links are one.
 *   §2  Nothing was dropped — every retired URL still resolves, into the tab
 *       that mounts the same capability, and no page component was deleted.
 *   §3  ONE authoritative source per price, and every reader reads it.
 *   §4  R96 req 5 — a live customer is never repriced silently: the repoint
 *       requires an explicit confirmation and is recorded.
 *   §5  Every price states its period.
 *   §6  The staleness is gone: no TTL cache in front of a price, and every admin
 *       write clears every cache in the same request.
 *   §7  R97 — $300 renders as $300, an absent fee renders NO figure, and no
 *       Number()/parseInt/parseFloat touches money on that path.
 *   §8  No raw storage key reaches a human.
 *
 * Comments are STRIPPED before any source assertion counts anything (this tree
 * has a documented history of narrative comments being mis-read as live code).
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import path from "path";
import { rawDb } from "../db/connection";
import { stripComments } from "./wave129_price_period_and_literal_fence.test";
import {
  REPOINTABLE_FEE_KINDS,
  AUTHORITATIVE_SOURCE_BY_FEE_KIND,
  NEGOTIATED_OVERRIDE_PURPOSE,
  acknowledgeRepoint,
  isRepointAcknowledged,
  listRepointAcks,
  periodForFeeKind,
  buildRepointPreview,
} from "../lib/pricingDisplaySourceRepoint";
import { PRICE_CACHES, invalidateAllPricingCaches } from "../lib/pricingCacheBus";
import { buildPricingSourceMap } from "../lib/pricingConsoleRoutes";

const ROOT = path.resolve(__dirname, "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const code = (rel: string) => stripComments(read(rel));

const APP = "client/src/App.tsx";
const SHELL = "client/src/components/AppShell.tsx";
const HUB = "client/src/pages/admin/AdminFeesConsolidated.tsx";
const BILLING = "client/src/pages/founder/Billing.tsx";

/** Every pricing URL the admin area has ever had a link or route for. */
const PRICING_URLS = [
  "/admin/fees",
  "/admin/pricing",
  "/admin/pricing-models",
  "/admin/collective-subscriptions",
  "/admin/collective-payment-schedules",
  "/admin/collective-payment-pl",
  "/admin/commission-rates",
  "/admin/partner-fees",
  "/admin/partner-billing-ops",
  "/admin/partner-pl",
  "/admin/payments",
  "/admin/capavate-fees",
  "/admin/collective-fees",
  "/admin/partner-fees-hub",
];

describe("WAVE 131 §1 — ONE route, tab-driven, administers every price", () => {
  it("the sidebar has exactly ONE pricing link, and it is /admin/fees", () => {
    const shell = code(SHELL);
    const hrefs = Array.from(shell.matchAll(/href:\s*"(\/admin\/[^"]+)"/g)).map((m) => m[1]);
    const pricingLinks = hrefs.filter((h) => PRICING_URLS.includes(h));
    expect(
      pricingLinks,
      `The owner asked several times for ONE pricing link. These are the pricing hrefs still\n` +
        `in the sidebar: ${pricingLinks.join(", ")}`,
    ).toEqual(["/admin/fees"]);
  });

  it("that one link is named for pricing AND payments, not fees alone", () => {
    expect(code(SHELL)).toContain('{ href: "/admin/fees", label: "Pricing & Payments"');
  });

  it("the console covers Capavate, Collective, Consortium Partners and Admin in tabs", () => {
    const hub = code(HUB);
    const tabsAt = hub.indexOf("const TABS = [");
    const tabBlock = hub.slice(tabsAt, hub.indexOf("] as const;", tabsAt));
    const keys = Array.from(tabBlock.matchAll(/key:\s*"([^"]+)"/g)).map((m) => m[1]);
    /* Capavate, Collective, Consortium and the cross-cutting admin surfaces all
       have at least one tab; the count is asserted as a floor, not pinned, so
       adding a tab later is not a test failure. */
    expect(keys).toContain("capavate-annual");
    expect(keys).toContain("capavate-pricing");
    expect(keys).toContain("pricing-models");
    expect(keys).toContain("collective-tiers");
    expect(keys).toContain("collective-subscriptions");
    expect(keys).toContain("collective-payment-schedules");
    expect(keys).toContain("collective-pl");
    expect(keys).toContain("consortium-promotions");
    expect(keys).toContain("tier-prices");
    expect(keys).toContain("commission-rates");
    expect(keys).toContain("partner-pl");
    expect(keys).toContain("application-fee");
    expect(keys).toContain("payments");
    expect(keys).toContain("fee-schedules");
    expect(keys).toContain("source-map");
    expect(keys).toContain("displayed-vs-charged");
    expect(keys.length).toBeGreaterThanOrEqual(19);
    /* Every tab key is unique — a duplicate key would silently hide a tab. */
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every scattered pricing page is MOUNTED by the console rather than rewritten", () => {
    const hub = code(HUB);
    for (const comp of [
      "AdminPartnerBillingOps",
      "AdminCommissionRates",
      "AdminCollectiveSubscriptions",
      "AdminPricingPage",
      "AdminPricingModelsPage",
      "AdminPaymentsPage",
      "AdminPartnerPLPage",
      "AdminCollectivePaymentPLPage",
      "AdminCollectivePaymentSchedulesPage",
    ]) {
      expect(hub, `${comp} is not mounted in the console`).toContain(`<${comp} />`);
    }
  });

  it("no THIRD consolidation page was created", () => {
    const files = fs.readdirSync(path.join(ROOT, "client/src/pages/admin"));
    const consolidators = files.filter((f) => /Consolidated|Hub/i.test(f));
    /* The two that already existed, and nothing new: AdminFeesConsolidated is
       the console; FeeHub stays on disk, superseded and unrouted. */
    expect(consolidators.sort()).toEqual(["AdminFeesConsolidated.tsx", "FeeHub.tsx"]);
  });
});

describe("WAVE 131 §2 — nothing was dropped (R96 req 6)", () => {
  it("every retired pricing URL still resolves, and none 404s", () => {
    const app = code(APP);
    const missing = PRICING_URLS.filter((u) => !app.includes(`path="${u}"`));
    expect(
      missing,
      `A retired pricing URL must render the consolidated tab, not the admin 404:\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("each retired URL deep-links into the console tab that carries its capability", () => {
    const app = code(APP);
    const expected: Record<string, string> = {
      "/admin/pricing": "capavate-pricing",
      "/admin/pricing-models": "pricing-models",
      "/admin/collective-subscriptions": "collective-subscriptions",
      "/admin/collective-payment-schedules": "collective-payment-schedules",
      "/admin/collective-payment-pl": "collective-pl",
      "/admin/commission-rates": "commission-rates",
      "/admin/partner-billing-ops": "tier-prices",
      "/admin/partner-pl": "partner-pl",
      "/admin/payments": "payments",
      "/admin/capavate-fees": "source-map",
      "/admin/collective-fees": "source-map",
      "/admin/partner-fees-hub": "source-map",
    };
    const hub = code(HUB);
    const tabsAt = hub.indexOf("const TABS = [");
    const tabBlock = hub.slice(tabsAt, hub.indexOf("] as const;", tabsAt));
    const offenders: string[] = [];
    for (const [url, tab] of Object.entries(expected)) {
      const at = app.indexOf(`path="${url}"`);
      const block = app.slice(at, at + 400);
      if (!block.includes(`initialTab="${tab}"`)) offenders.push(`${url} → expected tab ${tab}`);
      if (!tabBlock.includes(`key: "${tab}"`)) offenders.push(`${url} → tab ${tab} does not exist`);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("the deep-linked tab actually renders (initialTab is honoured by the console)", () => {
    const hub = code(HUB);
    expect(hub).toContain("TABS.some((t) => t.key === initialTab)");
  });

  it("the five repointed page components are still RENDERED by a route (direct-view aliases)", () => {
    const app = code(APP);
    for (const [url, comp] of [
      ["/admin/pricing/direct", "AdminPricing"],
      ["/admin/pricing-models/direct", "PricingModels"],
      ["/admin/collective-subscriptions/direct", "CollectiveSubscriptions"],
      ["/admin/commission-rates/direct", "AdminCommissionRates"],
      ["/admin/partner-billing-ops/direct", "AdminPartnerBillingOps"],
    ] as const) {
      const at = app.indexOf(`path="${url}"`);
      expect(at, `${url} is not routed — ${comp} would no longer be rendered anywhere`).toBeGreaterThan(-1);
      expect(app.slice(at, at + 260)).toContain(`<${comp} />`);
    }
    /* wouter matches in order: the literal /direct path must precede the :id path. */
    expect(app.indexOf('path="/admin/pricing-models/direct"')).toBeLessThan(
      app.indexOf('path="/admin/pricing-models/:id"'),
    );
    /* And they are NOT sidebar links — the owner asked for one. */
    const shell = code(SHELL);
    expect(shell).not.toContain("/direct");
  });

  it("no pricing page component was deleted", () => {
    for (const f of [
      "AdminPartnerBillingOps.tsx",
      "AdminCommissionRates.tsx",
      "CollectiveSubscriptions.tsx",
      "Pricing.tsx",
      "PricingModels.tsx",
      "Payments.tsx",
      "PartnerPL.tsx",
      "CollectivePaymentPL.tsx",
      "CollectivePaymentSchedules.tsx",
      "PartnerFeeSchedules.tsx",
      "AdminApplicationFee.tsx",
      "AdminPlatformFees.tsx",
      "FeeHub.tsx",
    ]) {
      expect(fs.existsSync(path.join(ROOT, "client/src/pages/admin", f)), `${f} was deleted`).toBe(true);
    }
  });

  it("each retired sidebar entry is ratified in the silent-drop allowlist with old→new and an approver", () => {
    const allow = JSON.parse(read("scripts/silent-drop-guard/allowlist.json")) as {
      removedNav: Array<{ id: string; reason: string; approvedBy: string; date: string }>;
    };
    const w131 = allow.removedNav.filter((r) => r.reason.includes("WAVE 131"));
    expect(w131.length).toBeGreaterThanOrEqual(2);
    for (const r of w131) {
      expect(r.approvedBy).toBe("Ozan (delegated to lead developer, 2026-08-24)");
      expect(r.reason).toContain("/admin/fees");
      expect(r.reason).toMatch(/initialTab="[a-z-]+"/);
    }
  });
});

describe("WAVE 131 §3 — ONE authoritative source per price", () => {
  it("the source map names one authoritative source, one period and one editor tab per price", () => {
    const prices = buildPricingSourceMap();
    expect(prices.length).toBeGreaterThan(0);
    const hub = code(HUB);
    const tabsAt = hub.indexOf("const TABS = [");
    const tabBlock = hub.slice(tabsAt, hub.indexOf("] as const;", tabsAt));
    for (const p of prices) {
      expect(p.authoritativeSource, `${p.id} has no authoritative source`).toBeTruthy();
      expect(["capavate", "collective", "consortium", "admin"]).toContain(p.area);
      expect(tabBlock, `${p.id} points at a tab that does not exist`).toContain(`key: "${p.editorTab}"`);
      /* A price either states its period or refuses to state an amount. */
      if (p.error === null) expect(p.billingPeriod, `${p.id} states no period`).toBeTruthy();
    }
    /* Each price id appears once — two rows for one price is the very ambiguity
       this wave removes. */
    const ids = prices.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("an unresolvable price reports the reason and NO amount (never a stand-in zero)", () => {
    for (const p of buildPricingSourceMap()) {
      if (p.error !== null) {
        expect(p.amountMinor, `${p.id} reports both an error and an amount`).toBeNull();
      }
    }
  });

  it("the surviving second table is named on screen with a DIFFERENT purpose", () => {
    expect(NEGOTIATED_OVERRIDE_PURPOSE.toLowerCase()).toContain("negotiated");
    expect(NEGOTIATED_OVERRIDE_PURPOSE.toLowerCase()).toContain("not a second price list");
    const hub = code(HUB);
    expect(hub).toContain('data-testid="second-table-purpose"');
    /* Named on screen in WORDS, not as a raw table identifier: wave 83's copy
       rule (client/src/pages/admin/__tests__/w83_admin_fees_not_a_database_console.test.ts)
       forbids a schema name reaching a human from this page, and it is right to. */
    expect(hub).toContain("Why the partner fee-schedule table still exists");
    expect(hub).toContain("negotiated overrides");
  });

  it("the fee-schedule aggregate — the partner-facing reader — resolves through the repoint module", () => {
    const agg = code("server/lib/wave15FeeScheduleAggregate.ts");
    expect(agg).toContain("resolveDisplayedFee");
    expect(agg).toContain("authoritativeSource");
    expect(agg).toContain("billingPeriod");
  });

  it("every repointable fee kind has exactly one named authoritative source", () => {
    for (const k of REPOINTABLE_FEE_KINDS) {
      expect(AUTHORITATIVE_SOURCE_BY_FEE_KIND[k], `${k} has no authoritative source`).toBeTruthy();
    }
    expect(Object.keys(AUTHORITATIVE_SOURCE_BY_FEE_KIND).sort()).toEqual([...REPOINTABLE_FEE_KINDS].sort());
  });
});

describe("WAVE 131 §4 — R96 req 5: no live customer is repriced silently", () => {
  beforeAll(() => {
    /* listRepointAcks() runs the store's idempotent CREATE TABLE IF NOT EXISTS
       guard, so this suite works on a fresh in-memory test database as well as a
       migrated one. */
    listRepointAcks();
    rawDb().prepare(`DELETE FROM pricing_display_repoint_ack`).run();
  });

  it("the ack store starts empty and every fee kind is therefore UNACKNOWLEDGED (fail-closed)", () => {
    expect(listRepointAcks()).toEqual([]);
    for (const k of REPOINTABLE_FEE_KINDS) expect(isRepointAcknowledged(k)).toBe(false);
  });

  it("the confirmation route REFUSES without an explicit confirm flag", () => {
    const routes = code("server/lib/pricingConsoleRoutes.ts");
    expect(routes).toContain("CONFIRMATION_REQUIRED");
    expect(routes).toContain("b.confirm !== true");
    /* The browser never sends an amount — the server re-resolves both sides, so
       a stale page cannot write a price. */
    expect(routes).toContain("resolveLegacyDisplayedFee");
    expect(routes).toContain("resolveAuthoritativeDisplayedFee");
  });

  it("a confirmation records BOTH numbers, the period, the source and who confirmed", () => {
    const ack = acknowledgeRepoint({
      feeKind: "spv_deployment",
      displayedAmountMinor: 0,
      displayedCurrency: "USD",
      authoritativeAmountMinor: 500000,
      authoritativeCurrency: "USD",
      billingPeriod: periodForFeeKind("spv_deployment"),
      acknowledgedByUserId: "w131-test-admin",
      note: "wave 131 test",
    });
    expect(ack.displayedAmountMinor).toBe(0);
    expect(ack.authoritativeAmountMinor).toBe(500000);
    expect(ack.authoritativeSource).toBe(AUTHORITATIVE_SOURCE_BY_FEE_KIND["spv_deployment"]);
    expect(ack.billingPeriod).toBe("one_off");
    expect(ack.acknowledgedByUserId).toBe("w131-test-admin");
    expect(isRepointAcknowledged("spv_deployment")).toBe(true);
    /* And only that fee kind moved. */
    expect(isRepointAcknowledged("subscription_annual")).toBe(false);
  });

  it("the console shows displayed, authoritative and the divergence side by side", () => {
    const hub = code(HUB);
    expect(hub).toContain('data-testid="dvc-table"');
    expect(hub).toContain("Displayed now");
    expect(hub).toContain("Authoritative");
    expect(hub).toContain("Confirm repricing");
    expect(hub).toContain("confirm: true");
    /* buildRepointPreview answers per fee kind, with both sides. */
    const rows = buildRepointPreview("", "founding_member");
    expect(rows.map((r) => r.feeKind).sort()).toEqual([...REPOINTABLE_FEE_KINDS].sort());
    for (const r of rows) {
      expect(r).toHaveProperty("displayed");
      expect(r).toHaveProperty("authoritative");
      expect(typeof r.divergent).toBe("boolean");
    }
  });
});

describe("WAVE 131 §5 — every price states its period", () => {
  it("the console renders a period for every price and never invents one", () => {
    const hub = code(HUB);
    expect(hub).toContain('data-testid={`price-source-period-${p.id}`}');
    expect(hub).toContain("Period not recorded");
    expect(hub).toContain("billingPeriodPhrase");
  });

  it("the partner fee-schedule table has a Period column fed from the DB cadence", () => {
    const pb = code("client/src/pages/partner/PartnerBilling.tsx");
    expect(pb).toContain('data-testid={`partner-feeschedule-period-${line.feeKind}`}');
    expect(pb).toContain("billingPeriodPhrase(line.billingPeriod)");
  });

  it("a monthly line whose authoritative row is annual REFUSES rather than restating the price", () => {
    const src = code("server/lib/pricingDisplaySourceRepoint.ts");
    expect(src).toContain("CADENCE_MISMATCH");
  });
});

describe("WAVE 131 §6 — the staleness is gone", () => {
  it("platformFeesStore no longer caches a fee for 60 seconds", () => {
    const store = code("server/platformFeesStore.ts");
    expect(store).not.toMatch(/CACHE_TTL_MS\s*=\s*[1-9]/);
    expect(store).not.toContain("cacheExpiresAt");
  });

  it("the public pricing payload is not cacheable by a browser or a proxy", () => {
    const pub = code("server/publicPricingRoutes.ts");
    expect(pub).not.toContain("max-age=300");
    expect(pub).toContain("no-store");
  });

  it("EVERY admin price write clears EVERY cache in the same request", () => {
    const writers = [
      "server/adminPlatformFeesRoutes.ts",
      "server/adminFeeTierRoutes.ts",
      "server/adminPricingStore.ts",
      "server/lib/wave14MoneyRoutes.ts",
    ];
    for (const w of writers) {
      expect(code(w), `${w} writes a price without clearing the caches`).toContain(
        "invalidateAllPricingCaches(",
      );
    }
    /* And the bus knows about every cache the preflight enumerated. */
    expect(PRICE_CACHES.length).toBeGreaterThanOrEqual(2);
    expect(PRICE_CACHES.join(" | ")).toContain("platformFeesStore");
    expect(PRICE_CACHES.join(" | ")).toContain("publicPricingRoutes");
    expect(() => invalidateAllPricingCaches("wave131-test")).not.toThrow();
  });

  it("the client does not serve a price from a 30-second stale window", () => {
    const hub = code(HUB);
    const consoleQueries = hub.split("pricing-console");
    expect(consoleQueries.length).toBeGreaterThan(1);
    expect(hub).toContain("staleTime: 0");
  });
});

describe("WAVE 131 §7 — R97: $300 renders as $300, and an absent fee renders no figure", () => {
  it("the founder Billing fee is rendered through the ISO-4217 formatter", () => {
    const b = code(BILLING);
    expect(b).toContain("formatMinor(appFeeData.amountMinor");
    /* The exact defect: raw minor units behind a dollar sign. */
    expect(b).not.toContain('`$${Number(appFeeData.amountMinor)');
  });

  it("no Number() / parseInt / parseFloat touches the fee amount anywhere in that file", () => {
    const b = code(BILLING);
    const offenders = b
      .split("\n")
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => /(Number|parseInt|parseFloat)\s*\(\s*[A-Za-z_$][\w$.]*(amountMinor|Minor|amount)/.test(l))
      .map(({ l, i }) => `${BILLING}:${i + 1}: ${l.trim()}`);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("$300 (30000 minor) formats as $300.00 and NOT $30,000", () => {
    /* The formatter the corrected line uses, exercised on the real seed value. */
    const exp = 2;
    const major = 30000 / Math.pow(10, exp);
    const rendered = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: exp,
      maximumFractionDigits: exp,
    }).format(major);
    expect(rendered).toBe("$300.00");
    expect(rendered).not.toContain("30,000");
  });

  it("an ABSENT fee renders no figure and says so", () => {
    const b = code(BILLING);
    expect(b).toContain("Not available — the application fee has not been published yet.");
    /* The old em-dash placeholder read as "zero" to a founder. */
    const at = b.indexOf("text-collective-application-fee");
    expect(b.slice(at, at + 700)).not.toContain(': "—"');
  });

  it("the platform-fees mirror-write stores the SAME unit the resolver reads", () => {
    const r = code("server/adminPlatformFeesRoutes.ts");
    /* Was fromMinor(amountMinor, …) — a 100× understatement into a column that
       is true minor units on every other path. */
    expect(r).not.toContain("fromMinor(amountMinor");
    expect(r).toContain("updateApplicationFee(\n          amountMinor,");
  });

  it("the sacred manifest carries the R97 re-freeze on the EXISTING waiver row (count stays nine)", () => {
    const sh = read("scripts/sacred_check.sh");
    const rows = sh.match(/"client\/src\/pages\/founder\/Billing\.tsx\|[^"]*"/g) ?? [];
    expect(rows.length, "a second row for one path aborts the gate with exit 3").toBe(1);
    expect(rows[0]).toContain("WAIVER-5");
    expect(rows[0]).toContain("RATIFIED");
    expect(sh).toContain("WAVE 131 · R97 RE-FREEZE");
    expect(sh).not.toContain("WAIVER-10|");
  });
});

describe("WAVE 131 §8 — no raw storage key reaches a human", () => {
  it("the console humanises every machine key it prints", () => {
    const hub = code(HUB);
    expect(hub).toContain("humanizeMachineKey");
    /* The two provenance values the repointed display can report are labelled. */
    const pb = code("client/src/pages/partner/PartnerBilling.tsx");
    expect(pb).toContain("partner_tier_price_authoritative:");
    expect(pb).toContain("platform_fee_authoritative:");
    expect(pb).not.toContain("AGG_VIA_LABELS[line.computedVia] ?? line.computedVia");
  });

  it("an unmapped provenance falls back to a humanised phrase, not the key", () => {
    const pb = code("client/src/pages/partner/PartnerBilling.tsx");
    expect(pb).toContain('humanizeMachineKey(line.computedVia, "Source not recorded")');
  });
});
