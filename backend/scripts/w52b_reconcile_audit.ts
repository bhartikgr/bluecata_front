/**
 * WAVE 52b — THE ONE UNVERIFIED RISK FROM WAVE 52, MEASURED LOCALLY.
 *
 * WAVE 52's UNVERIFIED item 1, verbatim:
 *   "`reconcile()`'s `match` flag on existing ledger rows. The engine reorder
 *    changes what the sacred `captableCommitStore.ts` recomputes for any row
 *    whose round has NO stored `pricePerShare`. … `spv`, `rounds`, `users` and
 *    `companies` are 0 rows locally, so no `match` audit could be run.
 *    UNVERIFIED. This is a deployment-time check and it is the single
 *    highest-risk item in the wave."
 *
 * This script does the two things that CAN be done locally:
 *
 *   1. A STATIC DEPENDENCY DETERMINATION. `reconcile()` at
 *      captableCommitStore.ts:591-632 derives `ref` as
 *      `floor(Decimal(amount) / Decimal(round.pricePerShare))` using
 *      `getRoundById` from `roundsStore`. It does not import, call or reach the
 *      cap-table engine — the only two occurrences of the string
 *      "cap-table-engine" in the whole file are in header PROSE. So the Wave 52
 *      engine reorder cannot move `match`, for a stored-PPS round or an
 *      absent-PPS round, because the engine is not on that code path at all.
 *      That is a stronger statement than Wave 52's, which argued only that the
 *      stored-PPS branch was unchanged.
 *
 *   2. A REAL `match` AUDIT ON SEEDED ROWS. Zero rows locally is not a reason to
 *      leave it unmeasured: representative rounds can be seeded, which is
 *      legitimate under owner ruling R11 ("all of the data on the platform is
 *      currently 'test' mode"). The audit runs `reconcile()` over the four cases
 *      that matter, with the pricing-order flag ON and then OFF, and reports
 *      whether any `match` differs.
 *
 * WHAT IT STILL CANNOT DO is named in the report: these are SEEDED rows, not the
 * production ledger's own historical rows, and only Avi can run the same audit
 * against those.
 *
 * Usage (DATABASE_URL must point at a FILE, not :memory:):
 *   DATABASE_URL=file:/tmp/x.db npx tsx scripts/w52b_reconcile_audit.ts
 */
import { rawDb, getDb } from "../server/db/connection";
import { hydrateRoundsStore } from "../server/roundsStore";
import { reconcile } from "../server/captableCommitStore";
import {
  resolveW52PricingOrder,
  W52_PRICING_ORDER_FLAG_KEY,
  ensureW52PricingOrderFlag,
} from "../server/lib/roundMathDisclosureStore";
import { updatePlatformConfigValue } from "../server/lib/platformConfigWriter";

const NOW = new Date().toISOString();

type Case = {
  label: string;
  roundId: string;
  /** null = the round stores NO price per share — the risky branch. */
  pricePerShare: number | null;
  amount: string;
  shares: string;
  expectMatch: boolean;
  why: string;
};

const CASES: Case[] = [
  {
    label: "stored PPS, shares agree",
    roundId: "w52b_r_priced_ok", pricePerShare: 2, amount: "10000000", shares: "5000000",
    expectMatch: true,
    why: "floor(10,000,000 / 2) = 5,000,000 — the canonical round, reconciles",
  },
  {
    label: "stored PPS, shares DISAGREE by one",
    roundId: "w52b_r_priced_off", pricePerShare: 2, amount: "10000000", shares: "4999999",
    expectMatch: false,
    why: "the independent recomputation is 5,000,000; tolerance is exactly 0 shares",
  },
  {
    label: "NO stored PPS — the branch Wave 52 flagged as the risk",
    roundId: "w52b_r_unpriced", pricePerShare: null, amount: "10000000", shares: "5000000",
    expectMatch: true,
    why: "with no pricePerShare the `if (pps && pps > 0)` guard is not entered, ref stays = primary, and `match` is the format-only check. NOTHING is recomputed, so there is nothing for the engine reorder to change",
  },
  {
    label: "NO stored PPS, an ABSURD share count",
    roundId: "w52b_r_unpriced_absurd", pricePerShare: null, amount: "10000000", shares: "1",
    expectMatch: true,
    why: "MEASURED AND UNCOMFORTABLE: with no stored price the format-only check passes a share count that is off by a factor of five million. That is a pre-existing property of the sacred file, NOT something Wave 52 changed, and it is reported rather than smoothed over",
  },
];

function seed(): void {
  const db = rawDb() as any;
  /* Column list read from the LIVE schema, not assumed: `companies` in this tree
     has no `created_at`. Measured with PRAGMA table_info before writing. */
  db.prepare(
    `INSERT OR IGNORE INTO companies (id, name, sector, stage) VALUES (?,?,?,?)`,
  ).run("w52b_co", "WAVE 52b audit company", "software", "series_a");
  for (const c of CASES) {
    /* INSERT OR IGNORE + UPDATE, deliberately NOT `INSERT OR REPLACE`.
       `wave0_9_program_wide_replace_lint.test.ts` R4 requires every static,
       non-money REPLACE to live in an allowlisted file, and widening that
       allowlist for an audit script would be exactly the "silently widen the
       allowlist" move this wave is forbidden to make. Caught by that lint going
       RED on the first full-suite run. */
    db.prepare(
      `INSERT OR IGNORE INTO rounds
         (id, company_id, name, type, state, target_amount, raised_amount,
          pre_money, price_per_share, instrument, currency, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      c.roundId, "w52b_co", c.label, "priced", "open",
      10000000, 0, 30000000, c.pricePerShare, "preferred", "USD", NOW, NOW,
    );
    db.prepare(
      `UPDATE rounds SET price_per_share = ?, pre_money = ?, target_amount = ?,
              instrument = ?, currency = ?, updated_at = ?
        WHERE id = ?`,
    ).run(c.pricePerShare, 30000000, 10000000, "preferred", "USD", NOW, c.roundId);
  }
}

function audit(tag: string) {
  const flag = resolveW52PricingOrder();
  const rows = CASES.map((c) => {
    const r = reconcile({
      invitationId: `inv_${c.roundId}`,
      amount: c.amount,
      currency: "USD",
      shares: c.shares,
      roundId: c.roundId,
    });
    return { ...c, primary: r.primary, ref: r.ref, match: r.match };
  });
  console.log(`\n===== ${tag} =====`);
  console.log(`  flag: mode=${flag.mode} enabled=${flag.enabled} source=${flag.source}`);
  for (const r of rows) {
    const verdict = r.match === r.expectMatch ? "as expected" : "*** UNEXPECTED ***";
    console.log(
      `  [${verdict}] ${r.label}\n` +
      `      roundId=${r.roundId} pps=${r.pricePerShare} amount=${r.amount} shares=${r.shares}\n` +
      `      primary=${r.primary} ref=${r.ref} match=${r.match}\n` +
      `      why: ${r.why}`,
    );
  }
  return rows;
}

getDb();
ensureW52PricingOrderFlag("w52b_reconcile_audit");
seed();

/*
 * MEASURED, AND MY FIRST RUN OF THIS SCRIPT WAS WRONG BECAUSE I OMITTED IT.
 *
 * `reconcile()` resolves the round through `getRoundById`, which is
 * `ROUNDS_BY_ID.get(id)` (roundsStore.ts:359-361) — an in-memory Map, NOT a
 * query against the `rounds` table. Seeding the table alone left the Map empty,
 * `_getRound` returned undefined, the `if (input.roundId)` block fell through,
 * and `ref` stayed equal to `primary` — so a deliberately WRONG share count
 * (4,999,999 against a true 5,000,000 at a stored $2.00) reported `match: true`.
 * The audit was reporting a green that meant nothing, which is exactly the shape
 * this project keeps catching. `hydrateRoundsStore()` is the missing step.
 */
await hydrateRoundsStore();

const on = audit("FLAG ON  (default) — w52_post_pool_post_conversion");
updatePlatformConfigValue({
  key: W52_PRICING_ORDER_FLAG_KEY, valueJson: "false", changedBy: "w52b_reconcile_audit",
});
const off = audit("FLAG OFF (rollback) — legacy_pre_w52");
updatePlatformConfigValue({
  key: W52_PRICING_ORDER_FLAG_KEY, valueJson: "true", changedBy: "w52b_reconcile_audit",
});

console.log("\n===== VERDICT =====");
let drift = 0;
for (let i = 0; i < on.length; i++) {
  const same = on[i].match === off[i].match && on[i].ref === off[i].ref && on[i].primary === off[i].primary;
  if (!same) drift += 1;
  console.log(`  ${same ? "IDENTICAL" : "*** DIFFERS ***"}  ${on[i].label}`);
}
const unexpected = [...on, ...off].filter((r) => r.match !== r.expectMatch).length;
console.log(`\n  rows audited              : ${on.length} cases x 2 flag poles = ${on.length * 2}`);
console.log(`  reconcile() results that MOVED between the two poles: ${drift}`);
console.log(`  results differing from the stated expectation       : ${unexpected}`);
console.log(
  `\n  CONCLUSION: reconcile() does not call the cap-table engine, so neither the\n` +
  `  Wave 52 reorder nor the Wave 52b flag can move its \`match\`. Confirmed on\n` +
  `  seeded rows for both a stored-PPS and an absent-PPS round.\n` +
  `  STILL DEPLOYMENT-ONLY: these are SEEDED rows. The production ledger's own\n` +
  `  historical rows have not been audited and cannot be from here.`,
);
process.exit(drift === 0 && unexpected === 0 ? 0 : 1);
