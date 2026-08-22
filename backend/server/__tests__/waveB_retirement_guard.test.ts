/**
 * Wave B (v26.4.0) Stage 3 — Retirement guard tests.
 *
 * Enforces that the Wave B Stage 2 retirement of `spvFundStore` as a
 * route-registration module holds as a code artifact:
 *
 *   (G-1) `server/routes.ts` no longer imports from `./spvFundStore`
 *   (G-2) `server/routes.ts` no longer calls `registerSpvFundRoutes(app)`
 *   (G-3) `server/spvLegacyAdapters.ts` exists and exports
 *         `registerSpvLegacyAdapterRoutes`
 *   (G-4) `server/routes.ts` DOES import and call
 *         `registerSpvLegacyAdapterRoutes` (positive assertion — retirement
 *         happened AND the replacement is wired)
 *   (G-5) The sole remaining `spvFundStore` imports outside test files are:
 *         - `server/lib/hydrateStores.ts` (hydration, retires in Wave B.5)
 *         - `server/spvEngineStore.ts`   (Stage 2 delegation)
 *         - `server/partnerWorkspaceStore.ts` (dynamic require for shadow-persist,
 *            actually rewired to spvEngineStore in Stage 1 — assert it does NOT
 *            require spvFundStore any more)
 *   (G-6) `server/partnerWorkspaceStore.ts` no longer contains
 *         `require("./spvFundStore")` (Stage 1 rewired both call sites to
 *         `require("./spvEngineStore")`)
 *   (G-7) `server/lib/seedDemoData.ts` no longer imports from `./spvFundStore`
 *         (Stage 1 repointed to spvEngineStore.createSpv)
 *   (G-8) Sacred baseline is still self-consistent (40/40)
 *
 * These are cheap static checks that catch regressions where a future edit
 * accidentally re-imports `spvFundStore` into the route or seed layer.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(__dirname, "..", "..");
const ROUTES_TS = path.join(ROOT, "server", "routes.ts");
const ADAPTER_TS = path.join(ROOT, "server", "spvLegacyAdapters.ts");
const ENGINE_TS = path.join(ROOT, "server", "spvEngineStore.ts");
const HYDRATE_TS = path.join(ROOT, "server", "lib", "hydrateStores.ts");
const WORKSPACE_TS = path.join(ROOT, "server", "partnerWorkspaceStore.ts");
const SEED_TS = path.join(ROOT, "server", "lib", "seedDemoData.ts");
const SACRED_MANIFEST = path.join(ROOT, "sacred_baseline", "SACRED_SHA256.txt");

function read(p: string): string {
  return fs.readFileSync(p, "utf8");
}

function sha256File(p: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

describe("Wave B (v26.4.0) Stage 2 — Retirement guard", () => {
  /* ---------- G-1: routes.ts no longer imports from spvFundStore ---------- */
  it("(G-1) server/routes.ts does NOT import from './spvFundStore'", () => {
    const src = read(ROUTES_TS);
    // Match either a plain import or a dynamic require. Grep-tolerant regex.
    const badImport = /import\s+.*\s+from\s+["']\.\/spvFundStore["']/;
    const badRequire = /require\s*\(\s*["']\.\/spvFundStore["']\s*\)/;
    expect(src).not.toMatch(badImport);
    expect(src).not.toMatch(badRequire);
  });

  /* ---------- G-2: routes.ts no longer calls registerSpvFundRoutes(app) ---------- */
  it("(G-2) server/routes.ts does NOT call registerSpvFundRoutes(app) as a live registration", () => {
    const src = read(ROUTES_TS);
    // Strip comments so a comment referencing the historical call doesn't false-positive.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(stripped).not.toMatch(/registerSpvFundRoutes\s*\(\s*app\s*\)/);
  });

  /* ---------- G-3: adapter file exists and exports registerSpvLegacyAdapterRoutes ---------- */
  it("(G-3) server/spvLegacyAdapters.ts exists and exports registerSpvLegacyAdapterRoutes", () => {
    expect(fs.existsSync(ADAPTER_TS)).toBe(true);
    const src = read(ADAPTER_TS);
    expect(src).toMatch(/^export\s+function\s+registerSpvLegacyAdapterRoutes\s*\(/m);
  });

  /* ---------- G-4: routes.ts imports AND calls registerSpvLegacyAdapterRoutes ---------- */
  it("(G-4) server/routes.ts imports and calls registerSpvLegacyAdapterRoutes(app)", () => {
    const src = read(ROUTES_TS);
    expect(src).toMatch(
      /import\s*\{\s*registerSpvLegacyAdapterRoutes\s*\}\s*from\s*["']\.\/spvLegacyAdapters["']/,
    );
    // Strip comments before verifying the live call
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(stripped).toMatch(/registerSpvLegacyAdapterRoutes\s*\(\s*app\s*\)/);
  });

  /* ---------- G-5: the ONLY remaining spvFundStore imports are documented ---------- */
  it("(G-5) The whitelist of files that may import from spvFundStore is exactly {hydrateStores, spvEngineStore}", () => {
    // Walk server/**/*.ts and collect every file that imports/requires spvFundStore.
    // (Test files under __tests__ are exempt — they exercise the store as an
    //  internal implementation module, which is legitimate.)
    const offenders: string[] = [];
    function walk(dir: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "__tests__" || entry.name === "node_modules") continue;
          walk(p);
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        if (entry.name.endsWith(".d.ts")) continue;
        // Skip the retiring file itself.
        if (p === path.join(ROOT, "server", "spvFundStore.ts")) continue;
        const src = fs.readFileSync(p, "utf8");
        // Match either static import or dynamic require of ./spvFundStore.
        const importRe = /import\s+[^;]*\s+from\s+["'][^"']*\/spvFundStore["']/;
        const requireRe = /require\s*\(\s*["'][^"']*\/spvFundStore["']\s*\)/;
        if (importRe.test(src) || requireRe.test(src)) {
          offenders.push(path.relative(ROOT, p));
        }
      }
    }
    walk(path.join(ROOT, "server"));

    // Expected whitelist (paths relative to project ROOT).
    const WHITELIST = new Set([
      "server/lib/hydrateStores.ts",
      "server/spvEngineStore.ts",
    ]);

    const unexpected = offenders.filter((f) => !WHITELIST.has(f));
    expect(unexpected, `Unexpected spvFundStore importers: ${unexpected.join(", ")}`).toEqual([]);

    // And every WHITELIST entry must actually be present — otherwise Stage 2
    // regressed by removing an intended import.
    for (const wl of WHITELIST) {
      expect(offenders, `Missing expected importer: ${wl}`).toContain(wl);
    }
  });

  /* ---------- G-6: partnerWorkspaceStore has NO runtime require to engine or fund stores ---------- */
  //
  // v26.4.0-fix2 (Opus DEFECT-12) update: the dual shadow-persist was MOVED
  // to spvEngineStore.createSpv / .subscribe (the actual LIVE paths). The
  // partnerWorkspaceStore methods that once carried the requires
  // (partnerSpvStore.create / .addPosition) are dead per
  // spvUnifiedCanonical.test.ts:148, so we no longer need the requires here.
  //
  // G-6 now asserts BOTH negative: no requires to spvFundStore OR
  // spvEngineStore in partnerWorkspaceStore.ts. This closes G-5's failure
  // ('partnerWorkspaceStore.ts' unexpected in the whitelist) and prevents a
  // future refactor from silently re-introducing the coupling.
  it("(G-6) server/partnerWorkspaceStore.ts has NO runtime require to spvFundStore OR spvEngineStore", () => {
    const src = read(WORKSPACE_TS);
    // Strip comments so a comment referencing the historical requires doesn't
    // false-positive.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(stripped).not.toMatch(/require\s*\(\s*["']\.\/spvFundStore["']\s*\)/);
    expect(stripped).not.toMatch(/require\s*\(\s*["']\.\/spvEngineStore["']\s*\)/);
  });

  /* ---------- G-7: seedDemoData no longer imports from spvFundStore ---------- */
  it("(G-7) server/lib/seedDemoData.ts does NOT import from '../spvFundStore'", () => {
    const src = read(SEED_TS);
    expect(src).not.toMatch(
      /import\s+.*\s+from\s+["']\.\.\/spvFundStore["']/,
    );
    // And POSITIVE assertion — repointed to spvEngineStore
    expect(src).toMatch(/from\s+["']\.\.\/spvEngineStore["']/);
  });

  /* WAVE 36 · ROW 5 — hoisted from inside the (G-8) test body to describe
     scope so (G-10) below can assert coverage against it. Contents unchanged. */
    const WAIVER_1_FROZEN: Record<string, string> = {
      "client/src/components/home3compo/LearnSection.jsx":
        "63ff0c9fd78e8bc749661c28f7bb5825f648ab7db0efd39cb90d48fa8eb9dc33",
      "client/src/components/home3compo/PricingSection.jsx":
        "e8da7f99a1eba63b3ad2099a9cbe5dba9ec3f10ce00d68f7efe4399c10fa8b6a",
      "server/lib/rateLimit.ts":
        "0c2f117299ea503b31356da2f9267f8bd9577345c7d718ad646ebf74b92bccfc",
      // WAIVER-4 (owner-signed 2026-08-11, "Signatures confirmed") — X-C1 / P1-8.
      // SPV limited partners were resolving as cap-table counterparties, so two
      // passive LPs in one vehicle could be revealed to each other by six live
      // callers. See scripts/sacred_check.sh for the full rationale and hash
      // lineage, and server/__tests__/xc1_spv_comembership_privacy.test.ts for
      // both-pole proof (LPs hidden AND real counterparties still authorised).
      //
      // THIS ENTRY EXISTS BECAUSE OF A SECOND-PATH MISS. WAIVER-4 was recorded in
      // sacred_check.sh but not here, and there are TWO enforcement points reading
      // the same 40-path manifest. sacred_check.sh went green while this test went
      // red — the same "fix landed where the data does not flow" failure this build
      // has hit a dozen times, committed while adding a waiver ABOUT that very
      // discipline. Any future sacred waiver must update BOTH places.
      "server/lib/capTableMembership.ts":
        "688b555426544527534afa12ce54e34069480db989c74c85d7d9020b9a45d750",
      // WAIVER-5 — WAVE 34, taken under delegated authority 2026-08-11,
      // **OWNER-RATIFIED 2026-08-13** (WAVE 48 · ITEM 2, ruling R13 "Ratify").
      // The ratification changed the DECISION record only: the hash pinned below
      // is the same Wave 34 hash, and G-8/G-9 still enforce it byte-for-byte.
      // Covers client/src/pages/founder/Billing.tsx, whose
      // `minor / 100` hardcoded an ISO-4217 exponent of 2 and would render a JPY
      // invoice wrong by a factor of 100 to a paying customer. Now exponent-driven
      // via client/src/lib/currency.ts formatMinor.
      //
      // THE FILE IS SACRED AND THE EDIT WAS DIRECTED BY THE PARENT'S OWN BRIEF,
      // which named it by path and line while omitting it from that brief's
      // read-never-edit list. The build agent made the fix under that instruction
      // and escalated rather than hiding it — the correct behaviour.
      //
      // AND THIS ENTRY, AGAIN, IS THE SECOND-PATH MISS. WAIVER-5 was recorded in
      // sacred_check.sh, which reported 47/47 green (48/48 since Wave 50), while this test stayed RED.
      // That is the identical failure documented for WAIVER-4 eleven lines above,
      // repeated on the very next waiver despite the warning being written here.
      // A waiver is not installed until BOTH enforcement points are updated and
      // BOTH have been observed green.
      //
      // TO DECLINE: restore hash 813de790… as the live content, delete this entry
      // and the sacred_check.sh row. Nothing else depends on it.
      //
      // WAVE 89 (2026-08-21) — THE HASH BELOW MOVED, under a SECOND owner grant on
      // the same file: ruling R79 waives the four DATE-ONLY render calls on this
      // page, which printed the founder's own renewal / cancellation date ONE DAY
      // EARLY for every customer west of UTC (the owner is in New York). They now
      // call `fmtLocaleDate` from client/src/lib/format.ts. Nothing else in the
      // file changed, and the two TIMESTAMP sites still localise, which is correct.
      // R79 calls the grant "WAIVER-10"; it is recorded on the existing WAIVER-5
      // row because a second row for one path, and a WAIVER-10 id, each abort
      // sacred_check.sh with exit 3 (transcript: build_log/wave89/probe/).
      // Wave 34 bytes, retained: ddbc591cc49b8b95ac9bfea90062486bc13e2eed134687235506e5e06d57ce5f
      "client/src/pages/founder/Billing.tsx":
        "bad47bfdb6a30c4fafefaeb046caff4951af0266db19a17573b1bc5c2e7c3dd7",
      /* WAIVER-7 — WAVE 58g, OWNER-APPROVED 2026-08-15 (ruling R34, "If approved
       * is the best practice. Then OK.").
       *
       * `server/roundCarryForwardEngine.ts` held a SECOND unit-conversion
       * authority: `discountAsDecimalStr()` divided a stored discount percent by
       * 100 itself, independently of `toWireDiscount` in
       * shared/roundMathEngineAdapter.ts, which is the platform's single declared
       * bridge from percent-as-written storage (R30) to the engine's [0,1] wire
       * unit. Wave 58f proved the site REACHABLE from a live HTTP route
       * (roundCarryForwardRoutes.ts:485) and inert only because its data source
       * is empty. R34 chose the waiver over quarantine because "a freeze that
       * preserves a bug is not integrity". The local division is gone; the
       * function now delegates to `toWireDiscount`. Nothing else in the file
       * changed — `computeConversionProjections` (:744-817) is untouched because
       * it does NOT divide by 100 and "fixing" it would turn 20% into 0.2%.
       *
       * It lives in WAIVER_1_FROZEN because the path IS one of the base 40
       * manifest rows (line 2 of sacred_baseline/SACRED_SHA256.txt), so (G-10)
       * resolves it through THIS table. It is ALSO listed in
       * EXTRA_WAIVED_FROZEN below because R34 names that table by name and the
       * second-path miss has now happened four times — a duplicate pin costs
       * nothing and a missing one costs a silent hole.
       *
       * Lineage: d7fa53f0… (pre-waiver) → 42d04653… (Wave 58g, current).
       * TO DECLINE: restore d7fa53f0… as the live content and delete this entry,
       * the EXTRA_WAIVED_FROZEN entry, the RATIFIED_HERE entry and the
       * sacred_check.sh row (and put the freeze count back to 7). */
      "server/roundCarryForwardEngine.ts":
        "42d04653278caefe85093fff778bdc1c8f0aabc0916a9deec29b1862729212a8",
      /* WAIVER-8 — WAVE 75 · ITEM 1, OWNER-RATIFIED 2026-08-18 (ruling R70, "Q2:
       * Change it. Has to be dynamic and real-time. No hard codes.").
       *
       * `server/paymentGatewayAdapter.ts:630` and `:765` wrote the literal
       * `ownershipPct: 1.0` onto a brand-new company. The founder dashboard
       * consumes that field as a FRACTION (`Dashboard.tsx:283` → `× 100`), so a
       * company with `capTableHolders: 0` and NO securities rendered a confident
       * `100.00%` on its first screen. It is now COMPUTED from the single
       * cap-table engine via `server/lib/founderOwnershipEngine.ts`, and is `null`
       * — rendered `—` — only when the engine has nothing to compute from.
       *
       * REGISTERED AS -8, NOT -9. R70 condition 5 names it "WAIVER-9", counting
       * the eight KNOWN_DRIFT ROWS then in force. Field 4 is a waiver ID, and the
       * distinct ids are 1..7, so `sacred_check.sh`'s closed-vocabulary check
       * ABORTS (exit 3) on a WAIVER-9 row with no WAIVER-8. Transcript:
       * build_log/wave75/W75_WAIVER9_REGISTRATION.md §2.
       *
       * It lives in WAIVER_1_FROZEN because the path IS one of the base 40
       * manifest rows (line 3 of sacred_baseline/SACRED_SHA256.txt), so (G-10)
       * resolves it through THIS table and (G-8)'s
       * `ok + |WAIVER_1_FROZEN| === 40` identity still holds.
       *
       * Lineage: 83757c54… (pre-waiver, and the base manifest hash) → 15679904…
       * (Wave 75, R70 dynamic founder ownership) → 7b515904… (WAVE 97B, current).
       *
       * WAVE 97B RE-FREEZE (2026-08-21) — R86, on the owner's instruction "remove
       * stripe. I can add this at a later date. We are using Airwallex today."
       * The frozen hash moved because the sacred adapter's Stripe wiring was
       * removed: the ./lib/stripeGateway import, the
       * POST /api/webhooks/payment-gateway/stripe registration, Stripe's entry in
       * what the admin config endpoint serves, and the one-armed verifyStripeSig
       * ternary. WAIVER-8's ROW IS UNCHANGED — same path, same id, same RATIFIED
       * state, field 3 advanced. This is the same re-freeze pattern WAVE 21/23
       * used for WAIVER-2 and WAVE 89 used for WAIVER-5, and it is why the printed
       * waiver count stays at NINE.
       * Nothing was erased: 15679904… is retained above and in sacred_check.sh's
       * HASH LINEAGE block.
       * TO DECLINE THE WAVE 97B RE-FREEZE ONLY: put this pin, the (G-11) POLE-5
       * literal below if present, sacred_check.sh's field 3 and the third copy in
       * wave18_cpmsg05_rate_limit_identity.test.ts back to 15679904…, and restore
       * the Stripe wiring in the live file. The WAIVER-8 row STAYS.
       * TO DECLINE WAIVER-8 ENTIRELY: restore 83757c54… as the live content and
       * delete this entry, the RATIFIED_HERE entry, the sacred_check.sh row and the
       * WAIVER-8 block in wave18_cpmsg05_rate_limit_identity.test.ts (and put the
       * freeze count back to 8). */
      "server/paymentGatewayAdapter.ts":
        "7b5159047803610592ffb4fe32eee18c9261ae027f990073a1131a7a5f980372",
    };

  /* ---------- G-8: Sacred manifest still 40/40 ---------- */
  it("(G-8) Sacred baseline is self-consistent (40/40)", () => {
    const manifest = fs.readFileSync(SACRED_MANIFEST, "utf8");
    const lines = manifest
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
    let ok = 0;
    let total = 0;
    const mismatches: string[] = [];
    for (const line of lines) {
      // Format: "<sha> <filepath>" (whitespace-delimited)
      const m = line.match(/^([a-f0-9]{64})\s+(.+)$/i);
      if (!m) continue;
      total++;
      const [, expected, rel] = m;
      const abs = path.join(ROOT, rel);
      if (!fs.existsSync(abs)) {
        mismatches.push(`${rel} — file missing`);
        continue;
      }
      const actual = sha256File(abs);
      if (actual === expected) {
        ok++;
      } else {
        mismatches.push(`${rel} — expected ${expected.slice(0, 12)}… got ${actual.slice(0, 12)}…`);
      }
    }
    // Baseline size invariant — 40 is CORRECT and must not be "corrected" to 47.
    // This test reads sacred_baseline/SACRED_SHA256.txt, which holds 40 entries.
    // `npm run sacred` reports 48/48 because scripts/sacred_check.sh checks those
    // 40 PLUS 7 (Wave 47) PLUS 1 (Wave 50: server/db/connection.ts) further files it
    // tracks separately (see its header). Two different manifests, two different
    // correct numbers. Changing this to 48 makes the test
    // fail, which is how this comment came to be written.
    expect(total).toBe(40);
    // WAIVER-1 (owner ruling 2026-08-09, spec/OWNER_RULINGS_2026_08_09.md item G-4 /
    // DEF-081): LearnSection.jsx and PricingSection.jsx drifted from their recorded
    // 2026-07 hashes and the owner ruled ADOPT THE CURRENT BYTES AS FROZEN.
    // scripts/sacred_check.sh enforces them against the NEW frozen hash; this test
    // read only the old base manifest and so reported them as mismatches. It now
    // honours the SAME waiver, with the frozen hashes duplicated here deliberately
    // so a further change to either file still fails BOTH checks.
    // WAIVER-2 (owner ruling 2026-08-11, CP-MSG-05): server/lib/rateLimit.ts.
    // WAVE 21 finding — Wave 19 took this waiver, edited the file and re-froze
    // the hash in scripts/sacred_check.sh, but never added the entry HERE. This
    // test therefore reported the waived file as an unwaived mismatch, exactly
    // as WAIVER-1 did before it was recorded. Wave 21 edited the same file
    // again under the same waiver (ITEM 1 fail-closed TRUSTED_PROXY_HOPS,
    // ITEM 4 durable buckets), which is what surfaced the omission.
    // Kept structurally identical to WAIVER_1_FROZEN, and duplicated from
    // sacred_check.sh deliberately, so a further unwaived change to
    // rateLimit.ts still fails BOTH checks.
    //
    // WAVE 23 (2026-08-11) — and the duplication did its job. ITEM 2 edited
    // rateLimit.ts again under WAIVER-2 (the x-forwarded-for header is now
    // honoured only when the DIRECT SOCKET PEER is itself a trusted proxy;
    // fail-closed otherwise). `scripts/sacred_check.sh` was re-frozen to
    // 0c2f1172…bccfc and THIS test immediately failed on the stale c76574f9…
    // copy — which is precisely the omission Wave 21 documented above. The
    // second copy is updated here rather than deleted: two independent checks
    // is the point.
    // Lineage: 50abd000… (original) → cda4a32e… (Wave 19) → c76574f9…
    // (Wave 21) → 0c2f1172… (Wave 23, current).
    //
    // WAIVER-3 (owner-granted 2026-08-11, delegated) covers server/db/migrate.ts.
    // The comment that stood here said it "needs NO entry" because the path is
    // not one of the 40 in sacred_baseline/SACRED_SHA256.txt. That was true and
    // it was still the third half-installed waiver in a row: WAIVER-3 was
    // enforced at ONE point (sacred_check.sh EXTRA_FROZEN) and at zero points
    // here, so an edit to migrate.ts — a SACRED file, and the one that decides
    // what a fresh install\'s schema is — turned exactly one light red. It is
    // now enforced by (G-9) below, with the hash duplicated independently, and
    // (G-10) makes a future half-install impossible to land silently.
    const unwaived = mismatches.filter((m) => {
      const rel = String(m).split(" \u2014 ")[0];
      const frozen = WAIVER_1_FROZEN[rel];
      if (!frozen) return true;
      return sha256File(path.join(ROOT, rel)) !== frozen;
    });
    expect(unwaived).toEqual([]);
    expect(ok + Object.keys(WAIVER_1_FROZEN).length).toBe(40);
  });

  /* ---------- G-9: waived files OUTSIDE the 40-path manifest ---------- */
  /* WAVE 36 · ROW 5. The 40-path manifest is not the whole sacred surface.
   * sacred_check.sh additionally enforces KNOWN_DRIFT rows whose path is not in
   * the base manifest, through its EXTRA_FROZEN pass. This test had no
   * counterpart, so those files had ONE enforcement point, not two.
   *
   * The hash below is duplicated from sacred_check.sh deliberately — the same
   * reasoning as WAIVER_1_FROZEN. Two independent copies is the mechanism; a
   * single shared source of truth would fail open if that source were edited. */
  const EXTRA_WAIVED_FROZEN: Record<string, { sha: string; waiver: string }> = {
    "server/db/migrate.ts": {
      sha: "5790f11d1182be1c5af8b59a52a4314dd3e1ad5f9a6d0049986bc42d1ee1a44c",
      waiver: "WAIVER-3",
    },
    /* WAIVER-6 — REPAIR WAVE 1 · ITEM 1, owner-approved 2026-08-14.
     *
     * `server/db/connection.ts` gains `audit_log.hash_version` on the inline
     * SQLite path, so dev/test agree with `shared/schema.ts` and migration 0188.
     * That column is what lets the actor-bound v2 audit hash ship WITHOUT
     * invalidating a single existing row (DEFAULT 1 = keep v1 meaning).
     *
     * It lives HERE rather than in WAIVER_1_FROZEN because connection.ts is not
     * one of the base 40 manifest paths — it was added as the 48th entry by
     * Wave 50 (ADDED_WAVE50), so (G-10) resolves it through this table.
     *
     * AND THIS ENTRY IS THE SECOND-PATH MISS AGAIN — the fourth time. WAIVER-6
     * was recorded in sacred_check.sh, which printed a clean 48/48 with all 7
     * waivers ratified, while (G-10)/(G-11) went red here. The warning against
     * exactly this is written eleven lines above WAIVER-4 and was still not
     * enough. The assertion caught it; the prose did not. A waiver is not
     * installed until BOTH enforcement points carry it. */
    "server/db/connection.ts": {
      sha: "8a73c3d194c20ceaec2c4c9057bfecc29c78e2b142c295999d8afc63defdeef0",
      waiver: "WAIVER-6",
    },
    /* WAIVER-7 — WAVE 58g, owner-approved 2026-08-15 (R34). Registered here
     * BECAUSE R34 names `EXTRA_WAIVED_FROZEN` explicitly, even though this path
     * is one of the base 40 and is therefore also pinned in WAIVER_1_FROZEN
     * above. The two pins are independent copies of the same one legal state, so
     * a further unwaived edit to the carry-forward engine fails BOTH of them as
     * well as sacred_check.sh. Rationale and hash lineage: see WAIVER_1_FROZEN. */
    "server/roundCarryForwardEngine.ts": {
      sha: "42d04653278caefe85093fff778bdc1c8f0aabc0916a9deec29b1862729212a8",
      waiver: "WAIVER-7",
    },
  };

  it("(G-9) waived files outside the 40-path manifest are pinned to an EXACT hash here too", () => {
    /* An exact hash, not an ignore. The distinction is the whole finding: a
     * waiver that skips the file makes every future edit invisible; a waiver
     * that pins bytes makes exactly ONE state legal. */
    for (const [rel, { sha, waiver }] of Object.entries(EXTRA_WAIVED_FROZEN)) {
      const abs = path.join(ROOT, rel);
      expect(fs.existsSync(abs), `${rel} (${waiver}) is waived but missing`).toBe(true);
      expect(sha256File(abs), `${rel} drifted from its ${waiver} frozen bytes`).toBe(sha);
      /* And the pin is a real sha256, not a placeholder that would match anything. */
      expect(sha).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(Object.keys(EXTRA_WAIVED_FROZEN).length).toBeGreaterThan(0);
  });

  /* ---------- G-10: no waiver may be installed at only ONE point ---------- */
  it("(G-10) EVERY KNOWN_DRIFT waiver in sacred_check.sh is also enforced by this test", () => {
    /* WAVE 36 · ROW 5. WAIVER-3, WAIVER-4 and WAIVER-5 were each recorded in
     * sacred_check.sh and omitted here — three times, with the warning against
     * it written in this very file. Prose did not stop it; this assertion does.
     * It reads the shell script and requires every waived path to be covered by
     * one of the two tables above. Coverage is checked structurally; the HASHES
     * stay independently duplicated, so this does not turn the second
     * enforcement point into a mirror of the first. */
    const sh = fs.readFileSync(path.join(ROOT, "scripts", "sacred_check.sh"), "utf8");
    /* Matched over the WHOLE script, not a slice. The first draft sliced from
       `KNOWN_DRIFT=(` to the next `)`, which lands inside a comment in the
       array body — it parsed 2 of the 6 rows and would have passed while
       checking a third of what it claims to check. Caught by the S0 count
       assertion below, which is why that assertion is there. */
    expect(sh).toContain("KNOWN_DRIFT=(");
    const block = sh;
    /* WAVE 38 · ROW 6 — field 5 (ratification state) is now part of every row,
       so the pattern accepts it and CAPTURES it. It is optional in the regex on
       purpose: a row that lost its field 5 must still be parsed and then fail
       the explicit ratification assertion below with a readable message, rather
       than vanish from `rows` and be silently uncovered. */
    const rows = [...block.matchAll(/^"([^"|]+)\|([a-f0-9]{64})\|([a-f0-9]{64})\|(WAIVER-\d+)(?:\|([A-Z-]+))?"/gm)]
      .map((m) => ({ path: m[1], frozen: m[3], waiver: m[4], ratification: m[5] ?? "" }));
    /* S0 — the parser parses. Five waivers were in force when this was written;
     * a sixth must RAISE this number, never lower it. */
    expect(rows.length).toBeGreaterThanOrEqual(6);
    const baseManifestPaths = new Set(
      fs.readFileSync(SACRED_MANIFEST, "utf8")
        .split("\n")
        .map((l) => l.trim().match(/^[a-f0-9]{64}\s+(.+)$/i)?.[1])
        .filter(Boolean) as string[],
    );
    const uncovered: string[] = [];
    for (const r of rows) {
      const coveredHere = baseManifestPaths.has(r.path)
        ? WAIVER_1_FROZEN[r.path] === r.frozen
        : EXTRA_WAIVED_FROZEN[r.path]?.sha === r.frozen;
      if (!coveredHere) uncovered.push(`${r.path} (${r.waiver})`);
    }
    expect(uncovered, "waivers installed in sacred_check.sh but NOT in this test").toEqual([]);
  });

  /* ---------- G-11: ratification state must agree at BOTH points ------------- */
  /* WAVE 38 · ROW 6. WAIVER-5 (client/src/pages/founder/Billing.tsx) was taken
   * under DELEGATED authority and had never been signed off by the owner. Its
   * bytes were enforced — but every gate an operator reads printed a flat green
   * `SACRED OK: 47/47` (48/48 since Wave 50), so nothing distinguished a sacred edit the owner
   * approved from one nobody has yet agreed to. Enforcement of BYTES is not
   * ratification of a DECISION, and a summary that conflates them is a check
   * that passes while checking nothing.
   *
   * WAVE 48 · ITEM 2 (R13) — THE OWNER RATIFIED WAIVER-5 ON 2026-08-13
   * ("Ratify"). So the pending set is now EMPTY and WAIVER-5 moves into
   * RATIFIED_HERE below. This is NOT a weakening of Row 6's check, and the
   * distinction matters enough to spell out:
   *   • field 5 is still MANDATORY and still validated against the recognised
   *     set on EVERY row (POLE 1), so a missing or unknown state still fails;
   *   • the pending set is still compared with sacred_check.sh in BOTH
   *     directions (POLE 2), so a NEW delegated waiver appearing there while
   *     this table says "nothing is pending" still fails;
   *   • the RATIFIED set is now ALSO compared in both directions (POLE 3), so a
   *     row cannot be quietly flipped to RATIFIED in the shell script without
   *     this second enforcement point recording the same decision — which is the
   *     property the empty pending set would otherwise have cost us;
   *   • the waived file's bytes are untouched: WAIVER_1_FROZEN still pins
   *     ddbc591c… for Billing.tsx and G-8/G-9 still enforce it. Ratifying a
   *     waiver changes a DECISION record, never a hash.
   *
   * These tables are the SECOND enforcement point's independent copy of the
   * ratification state — the same reasoning as WAIVER_1_FROZEN and
   * EXTRA_WAIVED_FROZEN. */
  const PENDING_RATIFICATION: Record<string, string> = {
    /* EMPTY since 2026-08-13. A new delegated, unsigned waiver belongs here. */
  };

  /** WAVE 48 · ITEM 2 — waiver id → the date the owner ratified it, keyed by
   *  path. Independently written here; compared with sacred_check.sh below. */
  const RATIFIED_HERE: Record<string, string> = {
    "client/src/components/home3compo/LearnSection.jsx": "WAIVER-1",
    "client/src/components/home3compo/PricingSection.jsx": "WAIVER-1",
    "server/lib/capTableMembership.ts": "WAIVER-4",
    "server/lib/rateLimit.ts": "WAIVER-2",
    "server/db/migrate.ts": "WAIVER-3",
    /* Ratified 2026-08-13 by owner ruling R13 (WAVE 48 · ITEM 2). */
    "client/src/pages/founder/Billing.tsx": "WAIVER-5",
    /* Ratified 2026-08-14 — REPAIR WAVE 1 · ITEM 1. The owner was asked directly,
       with the alternatives (payload-encoded version, or roll the item back) and
       the cost of each, and approved the additive connection.ts edit. Approval
       came BEFORE the edit, not after, so this is a ratified waiver and not a
       delegated one awaiting sign-off. */
    "server/db/connection.ts": "WAIVER-6",
    /* Ratified 2026-08-15 by owner ruling R34 (WAVE 58g). The owner was shown
       both options — quarantine the second conversion authority, or waive the
       sacred freeze and delete it — with the cost of each, and approved the
       waiver BEFORE the edit. A ratified waiver, not a delegated one. */
    "server/roundCarryForwardEngine.ts": "WAIVER-7",
    /* Ratified 2026-08-18 by owner ruling R70 (WAVE 75 · ITEM 1). The owner was
       shown the two lines, the `100.00%` they render on a brand-new company's
       dashboard, and the alternatives (render a dash, or compute the figure), and
       chose the stronger option — COMPUTE IT — granting the waiver BEFORE the
       edit. A ratified waiver, not a delegated one. Registered as WAIVER-8 rather
       than the ruling's "WAIVER-9" because the gate's own contiguity check
       forbids the gap; see WAIVER_1_FROZEN above. */
    "server/paymentGatewayAdapter.ts": "WAIVER-8",
  };

  it("(G-11) the pending-ratification set matches sacred_check.sh in BOTH directions", () => {
    const sh = fs.readFileSync(path.join(ROOT, "scripts", "sacred_check.sh"), "utf8");
    const rows = [...sh.matchAll(/^"([^"|]+)\|([a-f0-9]{64})\|([a-f0-9]{64})\|(WAIVER-\d+)(?:\|([A-Z-]+))?"/gm)]
      .map((m) => ({ path: m[1], waiver: m[4], ratification: m[5] ?? "" }));
    expect(rows.length).toBeGreaterThanOrEqual(6);

    /* POLE 1 — every row states a RECOGNISED ratification state. A missing or
       unknown value must never be read as approval. */
    for (const r of rows) {
      expect(
        ["RATIFIED", "PENDING-OWNER-RATIFICATION"],
        `${r.path} (${r.waiver}) has no recognised ratification state: "${r.ratification}"`,
      ).toContain(r.ratification);
    }

    /* POLE 2 — the two sets are equal. */
    const pendingThere = rows
      .filter((r) => r.ratification === "PENDING-OWNER-RATIFICATION")
      .map((r) => `${r.waiver} ${r.path}`)
      .sort();
    const pendingHere = Object.entries(PENDING_RATIFICATION)
      .map(([p, w]) => `${w} ${p}`)
      .sort();
    expect(pendingThere, "pending waivers in sacred_check.sh vs this test").toEqual(pendingHere);

    /* POLE 3 — WAVE 48 · ITEM 2. The pending set is empty, so the load-bearing
       both-directions assertion moves to the RATIFIED set: every row the shell
       script calls RATIFIED must be recorded as ratified HERE, and vice versa.
       Without this, an empty pending table would make POLE 2 satisfiable by a
       script in which every waiver had been silently self-ratified. */
    const ratifiedThere = rows
      .filter((r) => r.ratification === "RATIFIED")
      .map((r) => `${r.waiver} ${r.path}`)
      .sort();
    const ratifiedHere = Object.entries(RATIFIED_HERE)
      .map(([p, w]) => `${w} ${p}`)
      .sort();
    expect(ratifiedThere, "RATIFIED waivers in sacred_check.sh vs this test").toEqual(ratifiedHere);

    /* POLE 4 — the two sets PARTITION the rows: every waiver row is in exactly
       one of them, so a row can neither be counted twice nor vanish. */
    expect(ratifiedThere.length + pendingThere.length).toBe(rows.length);

    /* POLE 5 — WAIVER-5 specifically is now RATIFIED, and is still a waiver in
       force (not deleted, its bytes still frozen). */
    expect(ratifiedHere.join("\n")).toContain("WAIVER-5 client/src/pages/founder/Billing.tsx");
    expect(Object.keys(PENDING_RATIFICATION)).toEqual([]);
    /* WAVE 89 — the enforced bytes are the R79 / WAIVER-10 bytes (the four
       date-only renewal-date renders). Independently duplicated here, as always. */
    expect(WAIVER_1_FROZEN["client/src/pages/founder/Billing.tsx"]).toBe(
      "bad47bfdb6a30c4fafefaeb046caff4951af0266db19a17573b1bc5c2e7c3dd7",
    );
  });

  it("(G-11b) sacred_check.sh's OWN OUTPUT states the ratification state honestly", () => {
    /* The point of Row 6 is what an OPERATOR SEES, so this executes the gate and
       reads the line, rather than trusting the array it is derived from. The
       script only reads files, so running it here cannot dirty the tree. */
    const out = execFileSync("bash", [path.join(ROOT, "scripts", "sacred_check.sh")], {
      encoding: "utf8",
      cwd: ROOT,
    });
    expect(out).toContain("SACRED OK: 48/48");
    for (const [rel, waiver] of Object.entries(PENDING_RATIFICATION)) {
      expect(out, `${waiver} is pending ratification but the summary line does not say so`).toContain(waiver);
      expect(out).toContain(rel);
    }
    /* WAVE 48 · ITEM 2 — with nothing pending, the operator line must say so
       POSITIVELY rather than simply omitting the subject, and must not still be
       claiming a pending ratification. */
    if (Object.keys(PENDING_RATIFICATION).length === 0) {
      expect(out).toContain("waivers OWNER-RATIFIED");
      expect(out).not.toContain("PENDING OWNER RATIFICATION");
      expect(out).not.toContain("UNRATIFIED");
    } else {
      expect(out).toContain("PENDING OWNER RATIFICATION");
    }
    /* The ratified waiver is STILL LISTED AS WAIVED — ratification must not make
       a waiver disappear from what the operator sees. */
    expect(out).toContain("WAIVER-5 x1");
        /* REPAIR WAVE 1 (2026-08-14): WAIVER-6 raised the frozen count 6 -> 7.
       The number is asserted, not loosened: a waiver must never vanish from
       what the operator reads. Update it deliberately when a waiver is added. */
    /* WAVE 58g (2026-08-15): WAIVER-7 raised the frozen count 7 -> 8. */
    /* WAVE 75 · ITEM 1 — 8 → 9. WAIVER-8 (server/paymentGatewayAdapter.ts, ruling
       R70) adds the ninth KNOWN_DRIFT row. The number is asserted rather than
       matched loosely precisely so a waiver cannot be added without a wave
       stating that it did. */
    expect(out).toContain("9 under KNOWN_DRIFT freeze");
    expect(out).toContain("WAIVER-6 x1");
    expect(out).toContain("WAIVER-7 x1");
    const listed = execFileSync("bash", [path.join(ROOT, "scripts", "sacred_check.sh"), "--list"], {
      encoding: "utf8",
      cwd: ROOT,
    });
    expect(listed).toContain("client/src/pages/founder/Billing.tsx");

    /* BOTH POLES. The machine-readable form must agree with the human line —
       a JSON consumer (the deploy gate) must not see a cleaner story. */
    const json = JSON.parse(
      execFileSync("bash", [path.join(ROOT, "scripts", "sacred_check.sh"), "--json"], {
        encoding: "utf8",
        cwd: ROOT,
      }).trim(),
    ) as { entries: number; ok: number; unratified_waivers: number; unratified: string; exit: number };
    expect(json.entries).toBe(48);
    expect(json.ok).toBe(48);
    expect(json.exit).toBe(0);
    expect(json.unratified_waivers).toBe(Object.keys(PENDING_RATIFICATION).length);
    for (const waiver of Object.values(PENDING_RATIFICATION)) {
      expect(json.unratified).toContain(waiver);
    }
    /* WAVE 48 · ITEM 2 — the machine-readable form must tell the SAME story as
       the human line: nothing pending, and WAIVER-5 no longer named as such. */
    if (Object.keys(PENDING_RATIFICATION).length === 0) {
      expect(json.unratified_waivers).toBe(0);
      expect(json.unratified).toBe("");
    }
  });
});

/* ============================================================
 * Bonus — Wave B additions are actually present (not just no-diff)
 * ============================================================ */

describe("Wave B (v26.4.0) Stage 2 — Positive assertions on new code", () => {
  it("Engine exports all 11 Stage 2 adapter methods", () => {
    const src = read(ENGINE_TS);
    const expected = [
      "engineAddCommitment",
      "engineTransitionCommitment",
      "engineRecordCapitalCall",
      "engineRecordDistribution",
      "engineRecordLegacyPosition",
      "engineListLegacyCommitments",
      "engineListCapitalCalls",
      "engineListLegacyDistributions",
      "engineListLegacyPositions",
      "engineReconcileLegacySpv",
      "engineGetLegacySpvById",
    ];
    for (const name of expected) {
      expect(src, `missing export: ${name}`).toMatch(
        new RegExp(`^\\s*export\\s+function\\s+${name}\\s*\\(`, "m"),
      );
    }
  });

  it("Engine exports Wave B Stage 1 shadow-persist helpers", () => {
    const src = read(ENGINE_TS);
    expect(src).toMatch(/^\s*export\s+function\s+shadowPersistPartnerSpvToEngine\s*\(/m);
    expect(src).toMatch(/^\s*export\s+function\s+shadowCommitmentToEngine\s*\(/m);
  });

  it("adminKpiDbReads exports the 3 new SPV KPI functions", () => {
    const src = read(path.join(ROOT, "server", "lib", "adminKpiDbReads.ts"));
    expect(src).toMatch(/^\s*export\s+function\s+dbTotalSpvCommittedMinor\s*\(/m);
    expect(src).toMatch(/^\s*export\s+function\s+dbTotalSpvWiredMinor\s*\(/m);
    expect(src).toMatch(/^\s*export\s+function\s+dbTotalActiveSpvs\s*\(/m);
  });

  it("Migration 0125 exists at both sites and is byte-identical", () => {
    const a = path.join(ROOT, "migrations", "0125_wave_b_backups.sql");
    const b = path.join(ROOT, "server", "db", "migrations", "0125_wave_b_backups.sql");
    expect(fs.existsSync(a)).toBe(true);
    expect(fs.existsSync(b)).toBe(true);
    expect(sha256File(a)).toBe(sha256File(b));
  });

  it("Version is at or beyond the Wave B bump (26.4.0)", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    // Originally pinned to exactly "26.4.0". That form breaks on EVERY subsequent
    // release, which trains people to edit the test instead of reading it — the
    // version reached 26.9.0 before anyone noticed this was red. The intent was
    // always "the Wave B bump happened and was never rolled back", so assert that.
    const [maj, min, pat] = String(pkg.version).split(".").map(Number);
    expect(Number.isFinite(maj) && Number.isFinite(min) && Number.isFinite(pat)).toBe(true);
    const asNum = maj * 1_000_000 + min * 1_000 + pat;
    expect(asNum).toBeGreaterThanOrEqual(26 * 1_000_000 + 4 * 1_000 + 0);
  });
});
