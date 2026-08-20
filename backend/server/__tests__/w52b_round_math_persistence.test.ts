/**
 * WAVE 52b — MIGRATION 0189, THE DB-DRIVEN ROLLBACK FLAG, AND INVARIANT I-10.
 *
 * WHAT WAVE 52 LEFT UNDONE, AND WHY IT MATTERED
 *   Wave 52 computed `conversion_status` and `residual_disposition`, disclosed
 *   both on screen, and PERSISTED NEITHER. Its own report says so: "AC-17 asks
 *   for a *stored* per-instrument field. Not delivered." Under owner ruling R21
 *   ("no dead variables, no dead promises") a value that decides the pricing
 *   denominator and then evaporates on unmount is a dead variable, and
 *   `RESPONSE_TO_SHADIE_ROUND_MATH_2026_08_14.md` §10 item 7 — already in an
 *   external reviewer's hands — promises the residual's disposition "stored as an
 *   enumerated value rather than described in prose".
 *
 * THE SACRED CONSTRAINT, AND WHY NO WAIVER WAS NEEDED
 *   `rounds` and `securities` are created by inline DDL inside the SACRED
 *   `server/db/connection.ts`, and dev/test build SQLite from those definitions
 *   without running the numbered migrations. An `ALTER TABLE rounds` would have
 *   reached production and not test — the Repair Wave 1 failure that reported 20
 *   assertions as SKIPPED. Migration 0189 therefore adds NEW TABLES ONLY, and
 *   `applyWave52bRoundMathSchema.ts` reaches dev/test by READING 0189 and
 *   executing it through the real runner's `splitStatements`. Nothing sacred is
 *   touched and WAIVER-6 is not extended.
 *
 * I-10 IS NOT ASSERTED IN THIS PROCESS. §11.4.5 is explicit that "an in-memory
 * object asserted against its own literals proves nothing", and `NODE_ENV=test`
 * gives this file a `:memory:` database. So the I-10 block below SPAWNS TWO REAL
 * OS PROCESSES against a SQLite FILE via `scripts/w52b_i10_roundtrip.ts`, and
 * runs the falsifying mutation as a third.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CONVERSION_STATUSES,
  CONVERSION_TRIGGER_BASES,
  RESIDUAL_DISPOSITIONS,
  DENOMINATOR_SWITCHES,
  DENOMINATOR_SWITCH_KEYS,
  W52_PRICING_ORDER_FLAG_KEY,
  W52_PRICING_ORDER_DEFAULT,
  ROUND_MATH_BAD_ENUM,
  ROUND_MATH_NO_ACTOR,
  ROUND_MATH_RESIDUAL_UNRECONCILED,
  recordConversionStatus,
  listConversionStatuses,
  resolveConversionStatus,
  recordResidualDisposition,
  listResidualDispositions,
  assessRoundCompleteness,
  recordDenominatorSwitch,
  ensureDenominatorSwitchDefaults,
  resolveDenominatorSwitches,
  ensureW52PricingOrderFlag,
  resolveW52PricingOrder,
} from "../lib/roundMathDisclosureStore";
import { applyWave52bRoundMathSchema, WAVE52B_TABLES } from "../lib/applyWave52bRoundMathSchema";
import { updatePlatformConfigValue, readConfigRow } from "../lib/platformConfigWriter";
import { getDb, rawDb } from "../db/connection";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const R = (s: string) => `w52b_${s}_${Math.random().toString(36).slice(2, 8)}`;

beforeAll(() => {
  getDb();
});

/* ========================================================================= *
 * 1. THE SELF-HEAL INSTALLER — the Repair Wave 1 lesson, asserted
 * ========================================================================= */

describe("W52b — migration 0189 reaches the dev/test bootstrap path without a sacred edit", () => {
  it("w52b both 0189 tables exist under NODE_ENV=test, where the numbered runner never ran", () => {
    const handle = rawDb() as any;
    const heal = applyWave52bRoundMathSchema(handle);
    expect(heal.tablesReady).toBe(true);
    expect(heal.failures).toEqual([]);
    for (const t of WAVE52B_TABLES) {
      expect(heal.present[t]).toBe(true);
    }
  });

  it("w52b the installer is IDEMPOTENT — a second call executes zero statements", () => {
    const handle = rawDb() as any;
    applyWave52bRoundMathSchema(handle);
    const again = applyWave52bRoundMathSchema(handle);
    expect(again.executed).toBe(0);
    expect(again.tablesReady).toBe(true);
  });

  it("w52b the installer READS migration 0189 rather than re-typing its DDL", () => {
    /* Parity by construction: if the installer carried its own copy of the DDL,
       0189 and the test schema could drift, which is the whole failure mode. */
    const src = fs.readFileSync(
      path.join(REPO_ROOT, "server/lib/applyWave52bRoundMathSchema.ts"), "utf8",
    );
    expect(src).toContain("0189_wave52b_round_conversion_and_residual.sql");
    expect(src).toContain("splitStatements");
    expect(src).not.toContain("CREATE TABLE IF NOT EXISTS round_instrument_conversion (");
  });

  it("w52b migration 0189 is ADDITIVE ONLY — no DROP, ALTER, UPDATE, DELETE or INSERT", () => {
    const sql = fs.readFileSync(
      path.join(REPO_ROOT, "migrations/0189_wave52b_round_conversion_and_residual.sql"), "utf8",
    );
    /* Strip `--` comments; the prose explains why an ALTER would be wrong. */
    const code = sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
    expect(code).not.toMatch(/\bDROP\b/i);
    expect(code).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(code).not.toMatch(/\bUPDATE\s+\w/i);
    expect(code).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(code).not.toMatch(/\bINSERT\s+INTO\b/i);
    /* And it is mirrored byte-identically, the convention for 0180-0188. */
    const mirror = fs.readFileSync(
      path.join(REPO_ROOT, "server/db/migrations/0189_wave52b_round_conversion_and_residual.sql"), "utf8",
    );
    expect(mirror).toBe(sql);
  });
});

/* ========================================================================= *
 * 2. CONVERSION STATUS — AC-17's STORED field
 * ========================================================================= */

describe("W52b AC-17 — conversion_status is STORED, and fails closed when it is not", () => {
  it("w52b AC-17 a recorded conversion status round-trips with its trigger basis and share count", () => {
    const round = R("conv");
    const row = recordConversionStatus({
      roundId: round, instrumentId: "safe_1", instrumentKind: "safe_post",
      conversionStatus: "converts_in_this_round", conversionTriggerBasis: "cap_binding",
      asConvertedShares: "2500000", recordedBy: "tester",
    });
    expect(row.conversionStatus).toBe("converts_in_this_round");
    expect(row.conversionTriggerBasis).toBe("cap_binding");
    expect(row.asConvertedShares).toBe("2500000");
    expect(resolveConversionStatus(round, "safe_1").stored).toBe(true);
  });

  it("w52b AC-17 POLE B an instrument with NO stored row reads back `undetermined` — never `converts`", () => {
    const round = R("failclosed");
    const r = resolveConversionStatus(round, "never_recorded");
    expect(r.status).toBe("undetermined");
    expect(r.stored).toBe(false);
    expect(r.row).toBeNull();
  });

  it("w52b AC-17 `converts_in_this_round` with NO trigger basis is REFUSED by name", () => {
    expect(() =>
      recordConversionStatus({
        roundId: R("nobasis"), instrumentId: "s", instrumentKind: "safe_post",
        conversionStatus: "converts_in_this_round", recordedBy: "tester",
      }),
    ).toThrow(/conversion_trigger_basis:required_when_converting/);
  });

  it("w52b AC-17 a status outside the enumeration is REFUSED before it reaches SQL", () => {
    expect(() =>
      recordConversionStatus({
        roundId: R("badenum"), instrumentId: "s", instrumentKind: "safe_post",
        conversionStatus: "maybe" as never, recordedBy: "tester",
      }),
    ).toThrow(new RegExp(`${ROUND_MATH_BAD_ENUM}:conversion_status:maybe`));
  });

  it("w52b I-9 a FRACTIONAL as-converted share count is REFUSED by name", () => {
    expect(() =>
      recordConversionStatus({
        roundId: R("frac"), instrumentId: "s", instrumentKind: "safe_post",
        conversionStatus: "does_not_convert", asConvertedShares: "2500000.5", recordedBy: "tester",
      }),
    ).toThrow(/as_converted_shares:2500000\.5/);
  });

  it("w52b AC-17 an unattributed write is REFUSED — an anonymous decision is not a record", () => {
    expect(() =>
      recordConversionStatus({
        roundId: R("noactor"), instrumentId: "s", instrumentKind: "safe_post",
        conversionStatus: "does_not_convert", recordedBy: "",
      }),
    ).toThrow(ROUND_MATH_NO_ACTOR);
  });

  it("w52b AC-17 a founder changing their mind CORRECTS the row rather than adding a second one", () => {
    const round = R("upsert");
    recordConversionStatus({
      roundId: round, instrumentId: "safe_1", instrumentKind: "safe_post",
      conversionStatus: "undetermined", recordedBy: "tester",
    });
    recordConversionStatus({
      roundId: round, instrumentId: "safe_1", instrumentKind: "safe_post",
      conversionStatus: "converts_in_this_round", conversionTriggerBasis: "elective",
      asConvertedShares: "1", recordedBy: "tester2",
    });
    const rows = listConversionStatuses(round);
    /* One row, not two: a second would put the instrument in the denominator twice. */
    expect(rows).toHaveLength(1);
    expect(rows[0].conversionStatus).toBe("converts_in_this_round");
    expect(rows[0].recordedBy).toBe("tester2");
  });

  it("w52b the server enumerations match roundMath.ts element-for-element", () => {
    /* The two lists are deliberately separate modules (a server file must not
       depend on a client page's graph, and §11.4.6 requires roundMath.ts to stay
       import-isolated). A comment cannot fail; this can. */
    const client = fs.readFileSync(path.join(REPO_ROOT, "client/src/lib/roundMath.ts"), "utf8");
    const pick = (name: string) => {
      const m = client.match(new RegExp(`export const ${name} = \\[([^\\]]*)\\]`));
      return (m?.[1] ?? "").match(/"[^"]+"/g)!.map((s) => s.replace(/"/g, ""));
    };
    expect(pick("CONVERSION_STATUSES")).toEqual([...CONVERSION_STATUSES]);
    expect(pick("CONVERSION_TRIGGER_BASES")).toEqual([...CONVERSION_TRIGGER_BASES]);
    expect(pick("RESIDUAL_DISPOSITIONS")).toEqual([...RESIDUAL_DISPOSITIONS]);
  });
});

/* ========================================================================= *
 * 3. RESIDUAL DISPOSITION — §11.4.3's STORED, ENUMERATED value, no default
 * ========================================================================= */

describe("W52b §11.4.3 — residual_disposition is stored, enumerated, and has NO default", () => {
  it("w52b the seven enumerated dispositions are exactly the seven of §11.4.3", () => {
    expect([...RESIDUAL_DISPOSITIONS]).toEqual([
      "returned", "not_called", "credited_next_close", "waived",
      "subscription_receivable", "subscription_payable", "retained_by_agreement",
    ]);
  });

  it("w52b a residual round-trips with all three of I_committed, I_applied and r (§11.4.2)", () => {
    const round = R("resid");
    const row = recordResidualDisposition({
      roundId: round, investorId: "inv_b", currency: "USD",
      committedMinor: 49_999_897, appliedMinor: 49_999_800, residualMinor: 97,
      residualDisposition: "credited_next_close", creditedToCloseRef: "second",
      recordedBy: "tester",
    });
    expect(row.committedMinor).toBe(49_999_897);
    expect(row.appliedMinor).toBe(49_999_800);
    expect(row.residualMinor).toBe(97);
    expect(row.residualDisposition).toBe("credited_next_close");
    expect(row.creditedToCloseRef).toBe("second");
    expect(listResidualDispositions(round, "initial")).toHaveLength(1);
  });

  it("w52b I-5 a row where applied + residual != committed is REFUSED, tolerance exactly zero", () => {
    expect(() =>
      recordResidualDisposition({
        roundId: R("i5"), investorId: "inv", currency: "USD",
        committedMinor: 1000, appliedMinor: 900, residualMinor: 50,
        residualDisposition: "waived", recordedBy: "tester",
      }),
    ).toThrow(new RegExp(`${ROUND_MATH_RESIDUAL_UNRECONCILED}:900\\+50!=1000`));
  });

  it("w52b PROSE is not a disposition — 'carried and disclosed' is refused", () => {
    expect(() =>
      recordResidualDisposition({
        roundId: R("prose"), investorId: "inv", currency: "USD",
        committedMinor: 1, appliedMinor: 1, residualMinor: 0,
        residualDisposition: "carried and disclosed" as never, recordedBy: "tester",
      }),
    ).toThrow(/residual_disposition:carried and disclosed/);
  });

  it("w52b 'retained_by_agreement' without its clause reference is refused", () => {
    expect(() =>
      recordResidualDisposition({
        roundId: R("clause"), investorId: "inv", currency: "USD",
        committedMinor: 1, appliedMinor: 1, residualMinor: 0,
        residualDisposition: "retained_by_agreement", recordedBy: "tester",
      }),
    ).toThrow(/disposition_clause_ref:required/);
  });

  it("w52b 'credited_next_close' without a target close is refused — carried nowhere is not carried", () => {
    expect(() =>
      recordResidualDisposition({
        roundId: R("credit"), investorId: "inv", currency: "USD",
        committedMinor: 1, appliedMinor: 1, residualMinor: 0,
        residualDisposition: "credited_next_close", recordedBy: "tester",
      }),
    ).toThrow(/credited_to_close_ref:required/);
  });

  it("w52b a NON-ZERO residual with NO stored disposition reports the round INCOMPLETE, naming the investor", () => {
    const round = R("incomplete");
    recordResidualDisposition({
      roundId: round, investorId: "inv_a", currency: "USD",
      committedMinor: 100, appliedMinor: 100, residualMinor: 0,
      residualDisposition: "returned", recordedBy: "tester",
    });
    const a = assessRoundCompleteness({
      roundId: round, residualsByInvestor: { inv_a: 0, inv_b: 97 },
    });
    expect(a.complete).toBe(false);
    expect(a.missingDispositions).toEqual(["inv_b"]);
    expect(a.totalResidualMinor).toBe(97);
    expect(a.reason).toContain("INCOMPLETE ROUND");
    /* And it does NOT quietly choose `waived`, which would hand the money to the
       company and close the identity in the company's favour. */
    expect(a.reason).not.toContain("waived");
  });

  it("w52b a ZERO residual needs no disposition — the round is complete", () => {
    const round = R("zero");
    const a = assessRoundCompleteness({ roundId: round, residualsByInvestor: { inv_a: 0, inv_b: 0 } });
    expect(a.complete).toBe(true);
    expect(a.missingDispositions).toEqual([]);
    expect(a.reason).toBeNull();
  });
});

/* ========================================================================= *
 * 4. THE §5.8 SWITCHES
 * ========================================================================= */

describe("W52b §5.8 — the eleven denominator switches are stored and versioned", () => {
  it("w52b all eleven switches of §5.8 are present, with the ISR-recommended defaults", () => {
    expect(DENOMINATOR_SWITCH_KEYS).toHaveLength(11);
    const round = R("switches");
    ensureDenominatorSwitchDefaults(round, "tester");
    const s = resolveDenominatorSwitches(round);
    expect(s.complete).toBe(true);
    expect(s.missing).toEqual([]);
    expect(s.values.note_conversion_method).toBe("pre_money_method");
    expect(s.values.pool_top_up_placement).toBe("pre_money");
    expect(s.values.liquidity_denominator).toBe("without_pool");
  });

  it("w52b a value belonging to a DIFFERENT switch is refused — 'in' is not a note method", () => {
    expect(() =>
      recordDenominatorSwitch({
        roundId: R("cross"), switchKey: "note_conversion_method",
        switchValue: "in", recordedBy: "tester",
      }),
    ).toThrow(/note_conversion_method:in/);
  });

  it("w52b a correction is a HIGHER VERSION, and the earlier value survives", () => {
    const round = R("version");
    recordDenominatorSwitch({
      roundId: round, switchKey: "pool_target_basis",
      switchValue: "post_money_fd", recordedBy: "tester",
    });
    const v2 = recordDenominatorSwitch({
      roundId: round, switchKey: "pool_target_basis", switchValue: "pre_money_fd",
      isDefault: false, authorityRef: "ISR §4.3 / §13 #5", recordedBy: "tester",
    });
    expect(v2.version).toBe(2);
    expect(resolveDenominatorSwitches(round).values.pool_target_basis).toBe("pre_money_fd");
    /* History intact: "which convention was this percentage computed under, on
       the day it was published?" still has an answer. */
    const all = (rawDb() as any)
      .prepare("SELECT version, switch_value FROM round_denominator_switches WHERE round_id = ? AND switch_key = ? ORDER BY version")
      .all(round, "pool_target_basis");
    expect(all).toHaveLength(2);
    expect(all[0].switch_value).toBe("post_money_fd");
  });

  it("w52b a NON-default choice must name its authority", () => {
    expect(() =>
      recordDenominatorSwitch({
        roundId: R("noauth"), switchKey: "rsu_sar_in_fd", switchValue: "out",
        isDefault: true, authorityRef: null, recordedBy: "tester",
      }),
    ).not.toThrow();
    expect(() =>
      recordDenominatorSwitch({
        roundId: R("noauth2"), switchKey: "rsu_sar_in_fd", switchValue: "out",
        isDefault: false, authorityRef: null, recordedBy: "tester",
      }),
    ).toThrow(/authority_ref:required_for_non_default/);
  });

  it("w52b fx_rate_date carries its UNVERIFIED authority rather than inventing one", () => {
    expect(DENOMINATOR_SWITCHES.fx_rate_date.authority).toContain("UNVERIFIED");
  });

  it("w52b a round with NO stored switches reports every one as MISSING and refuses to assume", () => {
    const s = resolveDenominatorSwitches(R("bare"));
    expect(s.complete).toBe(false);
    expect(s.missing).toHaveLength(11);
    expect(Object.keys(s.values)).toHaveLength(0);
  });
});

/* ========================================================================= *
 * 5. THE FLAG — DB-DRIVEN, BOTH POLES, R21
 * ========================================================================= */

describe("W52b §11.6.2 / R21 — the rollback flag is resolved from the DATABASE", () => {
  it("w52b the flag is seeded into platform_config and defaults to the CORRECTED behaviour", () => {
    const f = ensureW52PricingOrderFlag("test");
    expect(f.source).toBe("platform_config");
    expect(W52_PRICING_ORDER_DEFAULT).toBe(true);
    expect(f.enabled).toBe(true);
    expect(f.mode).toBe("w52_post_pool_post_conversion");
    const row = readConfigRow(W52_PRICING_ORDER_FLAG_KEY);
    expect(row).not.toBeNull();
    expect(row!.valueType).toBe("boolean");
    expect(JSON.parse(row!.valueJson)).toBe(true);
  });

  it("w52b flipping the DB row flips the resolved mode — and flipping it back restores it", () => {
    ensureW52PricingOrderFlag("test");
    expect(resolveW52PricingOrder().mode).toBe("w52_post_pool_post_conversion");

    updatePlatformConfigValue({
      key: W52_PRICING_ORDER_FLAG_KEY, valueJson: "false", changedBy: "test",
    });
    const off = resolveW52PricingOrder();
    expect(off.enabled).toBe(false);
    expect(off.mode).toBe("legacy_pre_w52");
    expect(off.source).toBe("platform_config");

    updatePlatformConfigValue({
      key: W52_PRICING_ORDER_FLAG_KEY, valueJson: "true", changedBy: "test",
    });
    expect(resolveW52PricingOrder().mode).toBe("w52_post_pool_post_conversion");
  });

  it("w52b the flag is NOT an env constant and NOT read at import time (R21)", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "server/lib/roundMathDisclosureStore.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    /* No process.env anywhere in the resolution path, and no module-level cache:
       a flag memoised at import time cannot be flipped without a restart, and a
       rollback that needs a restart is a worse rollback. */
    expect(code).not.toContain("process.env");
    expect(code).not.toMatch(/let\s+cachedFlag/);
    expect(src).toContain("resolveW52PricingOrder");
  });

  it("w52b an UNREADABLE flag value falls back to the CORRECT behaviour, not the defective one", () => {
    /* A malformed flag must not silently restore a known arithmetic defect. */
    const src = fs.readFileSync(path.join(REPO_ROOT, "server/lib/roundMathDisclosureStore.ts"), "utf8");
    expect(src).toContain("enabled = W52_PRICING_ORDER_DEFAULT");
    expect(resolveW52PricingOrder().enabled).toBe(true);
  });
});

/* ========================================================================= *
 * 6. I-10 — THE PERSISTENCE ROUND TRIP, IN TWO SEPARATE OS PROCESSES
 * ========================================================================= */

describe("W52b I-10 — persistence round trip across a process boundary", () => {
  const tmp = path.join(os.tmpdir(), `w52b-i10-${Date.now()}.db`);

  function harness(mode: string, extra: string[] = []): { digest: string; payload: any } {
    const out = execFileSync(
      "npx",
      ["tsx", "scripts/w52b_i10_roundtrip.ts", mode, ...extra],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: { ...process.env, NODE_ENV: "production", DATABASE_URL: `file:${tmp}` },
        maxBuffer: 32 * 1024 * 1024,
      },
    );
    /* Fenced markers, because the store's boot path legitimately logs to stdout
       and a bare JSON dump could not be parsed. */
    const a = out.indexOf("##W52B_JSON_START##");
    const b = out.indexOf("##W52B_JSON_END##");
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    return JSON.parse(out.slice(a + "##W52B_JSON_START##".length, b));
  }

  it(
    "w52b I-10 POLE A save → NEW PROCESS, fresh DB read → recompute → byte-identical digest",
    () => {
      const written = harness("write");
      const read = harness("read");
      expect(read.digest).toBe(written.digest);
      /* All eleven §5.8 switches survived, including the deliberate non-default. */
      expect(read.payload.switches).toHaveLength(11);
      expect(Object.fromEntries(read.payload.switches).note_conversion_method).toBe("post_money_method");
      /* Fail-closed survived the round trip too. */
      expect(read.payload.unrecordedInstrument).toBe("undetermined");
      /* And the flag resolved from platform_config in the child process. */
      expect(read.payload.flag.source).toBe("platform_config");
      expect(read.payload.flag.mode).toBe("w52_post_pool_post_conversion");
    },
    180_000,
  );

  it(
    "w52b I-10 POLE B MUTATION dropping one switch from the persisted set makes the digest DIFFER",
    () => {
      const written = harness("write");
      const dropped = harness("read", ["--drop=note_conversion_method"]);
      expect(dropped.digest).not.toBe(written.digest);
      expect(dropped.payload.switches).toHaveLength(10);
    },
    180_000,
  );
});
