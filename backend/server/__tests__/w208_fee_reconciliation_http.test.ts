/**
 * WAVE 208 — DISPLAYED AND AUTHORITATIVE MAY NEVER DIVERGE AGAIN.
 *
 * ── WHY THIS FILE EXISTS AT ALL ─────────────────────────────────────────────
 *
 * The owner's words: "Add a test that fails if any tier's displayed and
 * authoritative values diverge… This is the durable half of the wave." Every
 * wave from 131 to 201 fixed part of this defect and every one of them shipped
 * without a test that would have caught the part it missed, which is why the
 * same divergence was rediscovered five times.
 *
 * ── IT DRIVES THE REAL ROUTE, NOT A REPLICA (handbook §8) ───────────────────
 *
 * `ENGINEERING_NOTES.md` records that wave 188 missed this exact defect because
 * its probe re-implemented the comparison instead of calling the real function.
 * So the DISPLAYED side here is obtained the only way a partner can obtain it:
 * a real HTTP GET of `/api/partner/fee-schedule/aggregate` against a real
 * Express app built by the real `registerRoutes`, authenticated as a real
 * managing partner. Nothing about the aggregate, the resolver chain or the
 * comparison is re-stated in this file.
 *
 * The AUTHORITATIVE side is obtained by calling the real
 * `resolveAuthoritativeDisplayedFee` — the same function the pricing console
 * calls. Comparing the route's answer against the authoritative resolver is the
 * whole assertion, and neither side is a copy of the other.
 *
 * ── BOTH POLES, SO THE SWEEP CANNOT PASS BY BEING EMPTY ─────────────────────
 *
 * A sweep that asserted only "nothing diverges" would also pass if every line
 * refused, and a sweep over zero rows passes trivially. So the sweep counts what
 * it examined, asserts that it examined every tier × fee kind, and asserts that
 * BOTH outcomes actually occurred: at least one line resolved to a real
 * authoritative amount and at least one line refused.
 *
 * MONEY. This file performs no arithmetic on any amount. Amounts are compared as
 * integer minor units with `toBe`, currencies as strings. No `Number()`, no
 * `parseInt`, no `parseFloat`, no `/100`, no `*100`. No expected amount, currency
 * or tier price is written as a literal anywhere below — every expectation is
 * read from the authoritative resolver at run time, so an admin repricing a tier
 * does not turn this suite red (R156.2).
 *
 * MUTATION TRANSCRIPT: build_log/wave208/W208_TESTS.md.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import { seedTestPartnerSandbox, partnerTeamStore } from "../partnerWorkspaceStore";
import { _registerSeedPartner } from "../adminContactsStoreShim";
import type { PartnerTier } from "../adminContactsStoreShim";
import { hydratePartnerWorkspaceV19Store } from "../partnerWorkspaceV19Store";
import { storeCredential } from "../userCredentialsStore";
import { wave45Db } from "../lib/applyWave45PricingSchema";
import { PARTNER_TIERS } from "../lib/partnerTiers";
import { AGGREGATE_FEE_KINDS } from "../lib/wave15FeeScheduleAggregate";
import {
  resolveAuthoritativeDisplayedFee,
  resolveEffectiveDisplayedFee,
  resolveReconciledDisplayedFee,
  classifyFeeComparison,
  buildRepointPreview,
  REPOINTABLE_FEE_KINDS,
  MONTHLY_NOT_OFFERED_CODE,
  NO_AUTHORITATIVE_PRICE_CODE,
  acknowledgeRepoint,
  isRepointAcknowledged,
  resolveDisplayedFee,
} from "../lib/pricingDisplaySourceRepoint";
/* THE REAL CLIENT FORMATTER. `PartnerBilling.tsx` renders every unresolved fee
   line's reason through this exact function, so asserting on its output is
   asserting what a partner reads — not what the server happened to store. It is
   a pure string helper with no React and no DOM dependency. */
import { humanizeMachineKey } from "../../client/src/lib/partnerDisplay";
/* The client's own gate, so the limit is not restated as a literal here. */
import { LOOKS_HUMAN_MAX_LENGTH } from "../../shared/refusalHeadlineGate";

/* ── principals: one real partner per canonical tier ─────────────────────── */

interface Principal {
  tier: string;
  partnerId: string;
  userId: string;
}

const PRINCIPALS: Principal[] = PARTNER_TIERS.map((t) => ({
  tier: t.slug,
  partnerId: `ac_consortium_partner_w208_${t.slug}`,
  userId: `u_w208_${t.slug}_managing`,
}));

let app: Express;
let server: http.Server;
let port = 0;

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
  await seedDemoData(getDb());
  wave45Db();
  seedTestPartnerSandbox({ force: true });

  for (const p of PRINCIPALS) {
    _registerSeedPartner({
      id: p.partnerId,
      legalName: `W208 ${p.tier.toUpperCase()} PARTNER, INC`,
      displayName: `W208 ${p.tier}`,
      email: `ops@w208-${p.tier}.example`,
      region: "US",
      regionCode: "US",
      tier: p.tier as PartnerTier,
      partnerType: "angel_network",
    });
    partnerTeamStore.add(p.partnerId, p.userId, "managing_partner", "u_system_seed", {
      isSeed: true,
    });
    storeCredential({
      userId: p.userId,
      email: `managing@w208-${p.tier}.example`,
      name: `W208 ${p.tier} Managing`,
      password: `test-password-w208-${p.tier}`,
    });
  }

  await hydratePartnerWorkspaceV19Store();

  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await registerRoutes(server, app);
  await new Promise<void>((resolve) =>
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    }),
  );
}, 120_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  delete process.env.COLLECTIVE_ENABLED;
});

function call(
  apiPath: string,
  userId: string,
): Promise<{ status: number; body: any; raw: string }> {
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: apiPath,
        method: "GET",
        headers: { "x-user-id": userId },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let b: any = null;
          try {
            b = JSON.parse(buf);
          } catch {
            /* keep raw */
          }
          resolve({ status: res.statusCode ?? 0, body: b, raw: buf });
        });
      },
    );
    r.on("error", reject);
    r.end();
  });
}

const AGGREGATE_PATH = "/api/partner/fee-schedule/aggregate";

/** One route-served fee line, as the partner's own page receives it. */
async function servedLines(p: Principal): Promise<any[]> {
  const r = await call(AGGREGATE_PATH, p.userId);
  expect(r.status, `${AGGREGATE_PATH} for ${p.tier} answered ${r.status}: ${r.raw}`).toBe(200);
  expect(r.body?.ok).toBe(true);
  /* The tier the ROUTE resolved, not the tier this file asked for: if canonical
     tier resolution ever disagreed with the seed, every assertion below would be
     measuring the wrong tier and would still pass. */
  expect(r.body?.aggregate?.tier).toBe(p.tier);
  const lines = r.body?.aggregate?.lines;
  expect(Array.isArray(lines)).toBe(true);
  expect(lines.length).toBe(AGGREGATE_FEE_KINDS.length);
  return lines;
}

/* ========================================================================= *
 *  ITEM B.2 — THE DURABLE INVARIANT
 * ========================================================================= */

describe("W208 · the figure the route serves IS the authoritative figure, on every tier", () => {
  it("never serves an amount that differs from the authoritative resolver, and never serves one at all when the authoritative side cannot answer", async () => {
    let examined = 0;
    let resolvedLines = 0;
    let refusedLines = 0;

    for (const p of PRINCIPALS) {
      const lines = await servedLines(p);
      for (const line of lines) {
        examined += 1;
        const authoritative = resolveAuthoritativeDisplayedFee(
          p.partnerId,
          p.tier,
          String(line.feeKind),
          { sizeMinor: null },
        );
        /* R176.1 — "did this side answer" is never "is it non-zero". */
        const authoritativeAnswered =
          authoritative.error === null && authoritative.amountMinor !== null;

        if (authoritativeAnswered) {
          resolvedLines += 1;
          expect(
            line.ok,
            `${p.tier}/${line.feeKind}: authoritative resolved but the route refused (${line.error})`,
          ).toBe(true);
          expect(
            line.amountMinor,
            `${p.tier}/${line.feeKind}: DISPLAYED ≠ AUTHORITATIVE`,
          ).toBe(authoritative.amountMinor);
          expect(line.currency).toBe(authoritative.currency);
          /* Provenance too: an identical number reached through a different
             source is a divergence waiting to happen the next time either
             source is edited. */
          expect(line.computedVia).toBe(authoritative.computedVia);
          expect(line.error).toBe(null);
        } else {
          refusedLines += 1;
          expect(
            line.ok,
            `${p.tier}/${line.feeKind}: authoritative did NOT resolve, yet the route served ${line.amountMinor} via ${line.computedVia}`,
          ).toBe(false);
          expect(line.amountMinor).toBe(null);
          expect(line.currency).toBe(null);
          expect(typeof line.error).toBe("string");
          expect(String(line.error).length).toBeGreaterThan(0);
        }
      }
    }

    /* THE SWEEP MUST HAVE SWEPT. Without these three the suite would pass on an
       empty tier list, on a route that 200s with no lines, or on a build where
       every single line refuses. */
    expect(examined).toBe(PRINCIPALS.length * AGGREGATE_FEE_KINDS.length);
    expect(resolvedLines).toBeGreaterThan(0);
    expect(refusedLines).toBeGreaterThan(0);
  }, 120_000);

  it("never serves the seeded platform-default placeholder for a repointable fee", async () => {
    /* The demoted level, named. `partner_fee_schedules` seeds every default row
       at amount_minor = 0 with tier IS NULL; that row reaching a partner's screen
       IS the defect this wave removes. Negotiated levels are NOT excluded here —
       `partner_override` and `tier_default` are deliberate and still win. */
    let checked = 0;
    for (const p of PRINCIPALS) {
      for (const line of await servedLines(p)) {
        if (!REPOINTABLE_FEE_KINDS.includes(String(line.feeKind))) continue;
        checked += 1;
        expect(
          line.computedVia,
          `${p.tier}/${line.feeKind} was served via the seeded platform default`,
        ).not.toBe("platform_default");
      }
    }
    expect(checked).toBe(PRINCIPALS.length * REPOINTABLE_FEE_KINDS.length);
  }, 120_000);
});

/* ========================================================================= *
 *  ITEM A.4 — THE MONTHLY CADENCE CONTRADICTION REFUSES
 * ========================================================================= */

describe("W208 · monthly is not displayed as a rate while the admin does not offer monthly", () => {
  it("refuses the monthly line on every tier, by name, with no amount", async () => {
    let checked = 0;
    for (const p of PRINCIPALS) {
      const monthly = (await servedLines(p)).find(
        (l: any) => String(l.feeKind) === "subscription_monthly",
      );
      expect(monthly, `no subscription_monthly line for ${p.tier}`).toBeTruthy();
      checked += 1;
      expect(monthly.ok).toBe(false);
      expect(monthly.amountMinor).toBe(null);
      expect(String(monthly.error)).toContain(MONTHLY_NOT_OFFERED_CODE);
      /* The refusal must not smuggle the annual price in under a monthly label. */
      const annualAuthoritative = resolveAuthoritativeDisplayedFee(
        p.partnerId,
        p.tier,
        "subscription_annual",
        { sizeMinor: null },
      );
      if (annualAuthoritative.amountMinor !== null) {
        expect(String(monthly.error)).not.toContain(String(annualAuthoritative.amountMinor));
      }
    }
    expect(checked).toBe(PRINCIPALS.length);
  }, 120_000);

  it("cannot be talked into a monthly rate by asking for one with a committed size", async () => {
    /* The one query parameter the route accepts. A size must not open a band that
       produces a monthly figure the cadence policy just refused. */
    const p = PRINCIPALS[0];
    const r = await call(`${AGGREGATE_PATH}?committedMinor=500000000`, p.userId);
    expect(r.status).toBe(200);
    const monthly = r.body?.aggregate?.lines?.find(
      (l: any) => String(l.feeKind) === "subscription_monthly",
    );
    expect(monthly?.ok).toBe(false);
    expect(monthly?.amountMinor).toBe(null);
    expect(String(monthly?.error)).toContain(MONTHLY_NOT_OFFERED_CODE);
  }, 120_000);
});

/* ========================================================================= *
 *  THE REFUSAL A PARTNER ACTUALLY READS
 * ========================================================================= */

/**
 * The wording contract every wave-208 refusal is held to, in one place so the
 * swept refusals and the directly-driven ones cannot drift apart.
 *
 *   · fits the client's 240-character `looksHuman` gate, or the client discards it
 *     and the partner sees nothing at all;
 *   · SCREAMING_SNAKE code, colon, then a lower-case sentence — the shape
 *     `humanizeMachineKey` turns into prose;
 *   · no storage key, identifier or bare code survives humanising;
 *   · names WHICH tier was looked up, so the reader knows what was asked.
 */
function assertReadableRefusal(raw: string, tier: string): void {
  expect(raw.length).toBeLessThan(LOOKS_HUMAN_MAX_LENGTH);
  expect(raw).toMatch(/^[A-Z0-9_]+: [a-z]/);
  const human = humanizeMachineKey(raw, "Could not be resolved");
  expect(human.length).toBeLessThan(LOOKS_HUMAN_MAX_LENGTH);
  expect(human).not.toContain("_");
  expect(human[0]).toBe(human[0].toUpperCase());
  /* NAMES WHICH TIER WAS LOOKED UP. A very long slug is deliberately truncated by
     `boundedFragment` so the sentence cannot breach the client's gate and get
     discarded whole, so what is required is that the tier remains IDENTIFIABLE —
     a 24-character prefix at worst — not that it appears in full. Measured
     2026-08-30: every canonical tier slug appears in full; only the 36-character
     synthetic slug this suite uses to drive the branch is shortened. */
  if (raw.includes(tier)) {
    /* nothing further: the whole slug is there */
  } else {
    expect(
      raw,
      `refusal names no recognisable form of tier "${tier}"`,
    ).toContain(tier.slice(0, 24));
    /* And the shortening is VISIBLE, so no reader mistakes a truncated slug for
       a different tier's name. */
    expect(raw).toContain("\u2026");
  }
  /* A sentence, not a concatenation of keys: at least four words after the code. */
  expect(raw.split(": ").slice(1).join(": ").trim().split(/\s+/).length).toBeGreaterThan(4);
}

describe("W208 · a refused fee line says plainly that no authoritative price is on file", () => {
  it("renders through the real client formatter as one readable sentence inside the client's gate", async () => {
    let refusals = 0;
    for (const p of PRINCIPALS) {
      for (const line of await servedLines(p)) {
        if (line.ok) continue;
        refusals += 1;
        assertReadableRefusal(String(line.error), p.tier);
      }
    }
    expect(refusals).toBeGreaterThan(0);
  }, 120_000);

  it("uses the no-price-on-file wording when the authoritative side is the thing that failed", async () => {
    /* WHICH ROWS TAKE THIS BRANCH IS A DATA QUESTION, NOT A CODE QUESTION, and
       this suite must not depend on the answer. Measured 2026-08-30: in the demo
       seed every canonical tier HAS an authoritative annual price, so no annual
       line refuses here; against a copy of the production database five of the
       six tiers refuse (build_log/wave208/W208_PREFLIGHT.md §1). So the branch is
       driven directly, through the real resolver, on a tier that provably has no
       authoritative price on file — and any annual line that DOES refuse on this
       database is checked with the same wording rule. */
    const p = PRINCIPALS[0];
    const unpricedTier = "w208_tier_with_no_authoritative_price";
    const authoritative = resolveAuthoritativeDisplayedFee(
      p.partnerId,
      unpricedTier,
      "subscription_annual",
      { sizeMinor: null },
    );
    /* The precondition, asserted rather than assumed. */
    expect(authoritative.amountMinor).toBe(null);
    expect(authoritative.error).not.toBe(null);

    const reconciled = resolveReconciledDisplayedFee(
      p.partnerId,
      unpricedTier,
      "subscription_annual",
      { sizeMinor: null },
    );
    expect(reconciled.amountMinor).toBe(null);
    expect(reconciled.currency).toBe(null);
    expect(String(reconciled.error)).toContain(NO_AUTHORITATIVE_PRICE_CODE);
    expect(humanizeMachineKey(String(reconciled.error), "x")).toMatch(/no authoritative price/i);
    /* THE SAME READABILITY RULES THE SERVED REFUSALS ARE HELD TO. Added because
       disarming this message down to a bare `CODE_feeKind_tier` string came back
       GREEN on the first attack run (build_log/wave208/DISARM_RESULTS.txt, D6):
       the sweep above only reaches refusals this database actually serves, and on
       the demo seed every annual line resolves, so nothing was checking the
       wording of the branch this test exists to cover. */
    assertReadableRefusal(String(reconciled.error), unpricedTier);
    /* The authoritative resolver's own diagnosis is preserved, not discarded. */
    expect(reconciled.refusedBecause).toBe(authoritative.error);

    for (const q of PRINCIPALS) {
      const annual = (await servedLines(q)).find(
        (l: any) => String(l.feeKind) === "subscription_annual",
      );
      if (annual.ok) continue;
      expect(String(annual.error)).toContain(NO_AUTHORITATIVE_PRICE_CODE);
    }
  }, 120_000);
});

/* ========================================================================= *
 *  THE ACKNOWLEDGED BRANCH IS GATED TOO
 * ========================================================================= */

describe("W208 · acknowledging the repoint does not unlock a monthly rate", () => {
  it("still refuses the monthly line after an admin has acknowledged that fee kind", async () => {
    /* FOUND BY ATTACKING THE FIX, NOT BY A FAILING TEST. `resolveDisplayedFee`
       has two branches, and the acknowledged one used to call the authoritative
       resolver directly — which would have walked straight past the cadence
       policy the moment any tier got an active monthly price row. This pins the
       gate on the branch that had the hole.

       NOT PROVEN HERE: the fully loaded version of that hole, i.e. an acked fee
       kind on a tier that DOES have an active monthly `partner_tier_price` row.
       Creating one would mean writing a price into the pricing tables from a
       test, which is not this suite's business. Recorded as a limitation in
       build_log/wave208/W208_TESTS.md. */
    const p = PRINCIPALS[0];
    const before = (await servedLines(p)).find(
      (l: any) => String(l.feeKind) === "subscription_monthly",
    );
    expect(before.ok).toBe(false);

    acknowledgeRepoint({
      feeKind: "subscription_monthly",
      displayedAmountMinor: null,
      displayedCurrency: null,
      authoritativeAmountMinor: null,
      authoritativeCurrency: null,
      billingPeriod: null,
      acknowledgedByUserId: "u_w208_test",
      note: "W208 attack A2 — does an ack unlock a monthly rate?",
    });
    /* The precondition, asserted: the ack really is in effect. */
    expect(isRepointAcknowledged("subscription_monthly")).toBe(true);

    const after = (await servedLines(p)).find(
      (l: any) => String(l.feeKind) === "subscription_monthly",
    );
    expect(after.ok).toBe(false);
    expect(after.amountMinor).toBe(null);
    expect(String(after.error)).toContain(MONTHLY_NOT_OFFERED_CODE);
    /* And the ack DID take effect on the flag it is supposed to govern, so this
       test is not passing because the ack was quietly ignored. */
    const flags = resolveDisplayedFee(p.partnerId, p.tier, "subscription_monthly", {
      sizeMinor: null,
    });
    expect(flags.authoritative).toBe(true);
    expect(flags.pendingRepoint).toBe(false);
    expect(flags.amountMinor).toBe(null);
    expect(String(flags.error)).toContain(MONTHLY_NOT_OFFERED_CODE);
  }, 120_000);
});

/* ========================================================================= *
 *  THE FIXTURE THE REAL SCREEN IS MOUNTED AGAINST
 *
 *  `client/src/pages/partner/__tests__/w208_fee_schedule_refusal_dom.test.tsx`
 *  mounts the REAL partner fee-schedule surface. A jsdom test cannot open the
 *  SQLite database, so it renders a RECORDING of this route's real output. A
 *  recording that nothing checks is a replica, so this suite asserts that the
 *  recording still matches what the real route serves.
 *
 *  ONLY THE POLICY-BEARING FIELDS ARE PINNED — `ok`, `error`, `computedVia`,
 *  and whether the amount is absent. Amounts are DELIBERATELY not pinned: an
 *  administrator repricing a tier must not turn this suite red (R156.2). A change
 *  in WHICH ROWS RESOLVE, or in WHAT A REFUSAL SAYS, must.
 *
 *  Regenerate deliberately with W208_WRITE_FIXTURE=1; the default path asserts.
 * ========================================================================= */

const FIXTURE_PATH = path.join(
  "client",
  "src",
  "pages",
  "partner",
  "__tests__",
  "__fixtures__",
  "w208_fee_schedule_aggregate.json",
);

/** The policy shape of one served line: everything except the amount itself. */
function policyShape(line: any) {
  return {
    feeKind: String(line.feeKind),
    ok: line.ok === true,
    error: line.error === null ? null : String(line.error),
    computedVia: line.computedVia === null ? null : String(line.computedVia),
    amountIsAbsent: line.amountMinor === null,
    authoritativeSource:
      line.authoritativeSource === null ? null : String(line.authoritativeSource),
  };
}

describe("W208 · the recording the real screen is mounted against is still true", () => {
  it("matches the live route line for line, or is regenerated on purpose", async () => {
    const recorded: Record<string, any> = {};
    for (const p of PRINCIPALS) {
      const lines = await servedLines(p);
      recorded[p.tier] = { tier: p.tier, lines };
    }

    if (process.env.W208_WRITE_FIXTURE === "1") {
      fs.mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
      fs.writeFileSync(FIXTURE_PATH, `${JSON.stringify(recorded, null, 2)}\n`, "utf8");
    }

    expect(
      fs.existsSync(FIXTURE_PATH),
      `${FIXTURE_PATH} is missing; regenerate with W208_WRITE_FIXTURE=1`,
    ).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));

    expect(Object.keys(onDisk).sort()).toEqual(Object.keys(recorded).sort());
    for (const tier of Object.keys(recorded)) {
      const live = recorded[tier].lines.map(policyShape);
      const disk = onDisk[tier].lines.map(policyShape);
      expect(disk, `recording for tier ${tier} no longer matches the real route`).toEqual(live);
    }
  }, 120_000);
});

/* ========================================================================= *
 *  ITEM B.3 — WAVE 201'S THREE STATES ARE INTACT
 * ========================================================================= */

describe("W208 · the three-state comparison is not weakened and 'cannot compare' is not collapsed", () => {
  it("still returns all three states from the one classifier", () => {
    /* Driven with hand-built SourcedAmounts on purpose: this is the unit whose
       three-valued contract wave 201 was told never to lose. The amounts are
       arbitrary sentinels, not prices, and no fee is asserted from them. */
    const a = {
      amountMinor: 1,
      currency: "USD",
      computedVia: "x",
      feeScheduleId: null,
      billingPeriod: null,
      error: null,
    };
    expect(classifyFeeComparison(a, a).comparisonState).toBe("match");
    expect(classifyFeeComparison(a, { ...a, amountMinor: 2 }).comparisonState).toBe("mismatch");
    const gap = { ...a, amountMinor: null, error: "NOPE" };
    expect(classifyFeeComparison(gap, a).comparisonState).toBe("incomplete");
    expect(classifyFeeComparison(a, gap).comparisonState).toBe("incomplete");
    expect(classifyFeeComparison(gap, gap).comparisonState).toBe("incomplete");
    expect(classifyFeeComparison(gap, gap).missingSide).toBe("both");
  });

  it("never reports agreement for a row whose authoritative side did not resolve", () => {
    let incomplete = 0;
    for (const p of PRINCIPALS) {
      for (const row of buildRepointPreview(p.partnerId, p.tier)) {
        const authoritativeAnswered =
          row.authoritative.error === null && row.authoritative.amountMinor !== null;
        if (authoritativeAnswered) continue;
        incomplete += 1;
        expect(row.comparisonState).toBe("incomplete");
        expect(row.divergent).toBe(false);
        expect(row.displayed.amountMinor).toBe(null);
        /* Wave 201's requirement: an incomplete control is a finding, and the
           screen keys its action button off this state. */
        expect(row.missingSide).not.toBe(null);
      }
    }
    expect(incomplete).toBeGreaterThan(0);
  });

  it("keeps the pre-wave-208 legacy finding readable instead of erasing it", () => {
    /* Demoting the seeded zero must not also destroy the evidence that the two
       sources disagreed. At least one row must still record a legacy divergence
       or a legacy finding against the authoritative source. */
    let legacyFindings = 0;
    for (const p of PRINCIPALS) {
      for (const row of buildRepointPreview(p.partnerId, p.tier)) {
        const legacyAnswered =
          row.legacyDisplayed.error === null && row.legacyDisplayed.amountMinor !== null;
        const authoritativeAnswered =
          row.authoritative.error === null && row.authoritative.amountMinor !== null;
        if (legacyAnswered && authoritativeAnswered) {
          expect(row.legacyComparisonState).not.toBe("incomplete");
          if (row.legacyDivergent) legacyFindings += 1;
        } else {
          expect(row.legacyComparisonState).toBe("incomplete");
          legacyFindings += 1;
        }
      }
    }
    expect(legacyFindings).toBeGreaterThan(0);
  });
});

/* ========================================================================= *
 *  WHAT WAS DELIBERATELY LEFT ALONE
 * ========================================================================= */

describe("W208 · the reconciliation is a sibling, not a rewrite", () => {
  it("leaves wave 201's resolveEffectiveDisplayedFee answering exactly as before", () => {
    /* If this ever starts refusing, wave 208 has mutated wave 201's function
       instead of adding to it, and every wave that depends on the legacy-first
       rule has silently changed behaviour. */
    let legacyResolved = 0;
    for (const p of PRINCIPALS) {
      const legacy = resolveEffectiveDisplayedFee(p.partnerId, p.tier, "subscription_annual", {
        sizeMinor: null,
      });
      if (legacy.error === null && legacy.amountMinor !== null) legacyResolved += 1;
    }
    expect(legacyResolved).toBe(PRINCIPALS.length);
  });

  it("leaves non-repointable fee kinds on wave 201's path, byte for byte", () => {
    /* A fee kind with no declared authoritative source has nothing to reconcile
       to, so the reconciliation must be a pass-through — not a refusal. */
    const p = PRINCIPALS[0];
    const kind = "spv_management_per_lp_quarter";
    expect(REPOINTABLE_FEE_KINDS.includes(kind)).toBe(false);
    const viaWave201 = resolveEffectiveDisplayedFee(p.partnerId, p.tier, kind, { sizeMinor: null });
    const viaWave208 = resolveReconciledDisplayedFee(p.partnerId, p.tier, kind, { sizeMinor: null });
    expect(JSON.stringify(viaWave208)).toBe(JSON.stringify(viaWave201));
  });
});

/* ========================================================================= *
 *  WAVE 224'S INVARIANT — THE SAME QUESTION TWICE
 * ========================================================================= */

describe("W208 · asserting the same fee resolution twice returns byte-identical output", () => {
  it("gives the same lines and the same revision on two consecutive real requests", async () => {
    for (const p of PRINCIPALS) {
      const first = await call(AGGREGATE_PATH, p.userId);
      const second = await call(AGGREGATE_PATH, p.userId);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      /* `computedAt` is a timestamp and is excluded by name rather than by being
         quietly ignored; everything that describes money is compared. */
      expect(JSON.stringify(second.body.aggregate.lines)).toBe(
        JSON.stringify(first.body.aggregate.lines),
      );
      expect(second.body.aggregate.revision).toBe(first.body.aggregate.revision);
      expect(second.body.aggregate.tier).toBe(first.body.aggregate.tier);
    }
  }, 120_000);

  it("gives the same answer from the resolver as from the route, twice", async () => {
    const p = PRINCIPALS[0];
    const lines = await servedLines(p);
    for (const line of lines) {
      const one = resolveReconciledDisplayedFee(p.partnerId, p.tier, String(line.feeKind), {
        sizeMinor: null,
      });
      const two = resolveReconciledDisplayedFee(p.partnerId, p.tier, String(line.feeKind), {
        sizeMinor: null,
      });
      expect(JSON.stringify(two)).toBe(JSON.stringify(one));
      expect(one.amountMinor).toBe(line.amountMinor);
      expect(one.error).toBe(line.error);
    }
  }, 120_000);
});
