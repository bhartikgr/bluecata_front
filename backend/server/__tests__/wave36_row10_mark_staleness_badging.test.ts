/**
 * WAVE 36 · ROW 10 — mark-history staleness and GP-override badging.
 *
 * ── VERIFY FIRST, AS INSTRUCTED ─────────────────────────────────────────────
 * The row said to VERIFY before fixing, because the component "tracks
 * `overrideId` and imports Badge". Both of those are true and both were
 * misleading. Verified at source before any edit:
 *   · `MarkPoint` (client, :107-118) DECLARED `overrideId`, `overrideReason`
 *     and `originalFairValueMinor` — and the chart used none of them.
 *   · `Badge` IS imported and IS used — in the founder-updates card (:321) and
 *     in `PromotionBadge` (:720). Neither is anywhere near the chart.
 *   · The chart rendered `<RTooltip formatter={(v: number) => fmtAxis(v)} />`.
 *     A Recharts `formatter` receives the VALUE only. It is structurally
 *     incapable of rendering an override badge or an age, whatever the payload
 *     carries. The defect was real.
 *
 * ── WHERE THE FIX HAD TO GO, AND WHY NOT IN THE COMPONENT ───────────────────
 * The review asked for "expired (e.g. >365 days old)". Writing 180 and 365
 * into a React component would have been the wrong fix twice over: those
 * numbers already exist as `marks.stale_warn_days` / `marks.stale_expired_days`
 * in DB-driven config, read by `getMarkThresholds()` and applied by
 * `badgeForAge()` — the canonical decider used by the rest of the mark surface.
 * A second copy in the browser is a second thing to be wrong, and it would go
 * silently stale the day the owner changes the config.
 *
 * So the SERVER now emits `ageDays` + `badge` per point (from `badgeForAge`)
 * and `markThresholds` per response, and the tooltip renders what it is told.
 *
 * Poles below execute the real read model against the real database with real
 * seeded rows. Nothing reads `process.env`; every precondition is established
 * here, including the config values, which are set and restored per case.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { rawDb } from "../db/connection";
import { markHistoryForCompany } from "../lib/investorMarkHistory";
import { ensureWave9Schema, getW9Config, setW9Config, badgeForAge } from "../wave9ReportingStore";

const ROOT = path.resolve(__dirname, "..", "..");
const COMPONENT = "client/src/components/investor/PortfolioCompanyOverview.tsx";

const TENANT = "w36r10_tenant";
const CO = "w36r10_co";           // fresh + stale + expired USD marks
const CO_OV = "w36r10_co_ov";     // one old mark carrying an EFFECTIVE override
const CO_JPY = "w36r10_co_jpy";   // JPY (exponent 0) fixture

let db: any;
let savedWarn: number;
let savedExpired: number;

/** ISO date `n` whole days before today, UTC. */
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

function insertMark(a: { id: string; companyId: string; date: string; minor: number; currency: string }) {
  db.prepare(
    `INSERT OR REPLACE INTO valuation_event
       (id, tenant_id, vehicle_kind, vehicle_id, holding_id, valuation_date,
        fair_value_minor, currency, method, source, source_ref, preparer,
        is_external, created_by, actor_id, seq, created_at, superseded_at)
     -- WAVE 38 ROW 4 — migration 0183 gave valuation_event actor_id NOT NULL
     -- and seq NOT NULL CHECK (seq > 0). The shipped writer
     -- (wave9ReportingStore.insertValuationEvent) supplies both; this fixture
     -- did not, so the file failed at COLLECT time and skipped all 9 tests.
     -- It now mirrors the shipped shape: actor_id = created_by, and a real
     -- per-parent seq derived in-statement rather than a constant.
     VALUES (?, ?, 'company', ?, NULL, ?, ?, ?, 'last_priced_round', 'derived_priced_round', NULL,
             'w36r10_preparer', 0, 'w36r10_seed', 'w36r10_seed',
             (SELECT COALESCE(MAX(seq), 0) + 1 FROM valuation_event
               WHERE vehicle_kind = 'company' AND vehicle_id = ?),
             ?, NULL)`,
  ).run(a.id, TENANT, a.companyId, a.date, a.minor, a.currency, a.companyId, new Date().toISOString());
}

function insertApprovedOverride(a: { id: string; eventId: string; companyId: string; minor: number; priorMinor: number; currency: string }) {
  db.prepare(
    `INSERT OR REPLACE INTO valuation_mark_override
       (id, tenant_id, valuation_event_id, vehicle_kind, vehicle_id, holding_id,
        prior_fair_value_minor, fair_value_minor, currency, reason,
        overridden_by, overridden_at, approval_state, approved_by, approved_at,
        approval_note, grandfathered_effective)
     VALUES (?, ?, ?, 'company', ?, NULL, ?, ?, ?, 'w36r10 secondary quote',
             'w36r10_gp', ?, 'approved', 'w36r10_admin', ?, NULL, 0)`,
  ).run(a.id, TENANT, a.eventId, a.companyId, a.priorMinor, a.minor, a.currency,
        new Date().toISOString(), new Date().toISOString());
}

beforeAll(() => {
  ensureWave9Schema();
  db = rawDb();
  savedWarn = getW9Config<number>("marks.stale_warn_days");
  savedExpired = getW9Config<number>("marks.stale_expired_days");
  /* The harness sets the thresholds it reasons about rather than inheriting
     whatever the platform happens to be configured with — a case that passes
     only under today's config is a case that will lie tomorrow. */
  setW9Config("marks.stale_warn_days", 180, "w36r10");
  setW9Config("marks.stale_expired_days", 365, "w36r10");

  insertMark({ id: "w36r10_fresh",   companyId: CO, date: daysAgo(10),  minor: 100_000_00, currency: "USD" });
  insertMark({ id: "w36r10_stale",   companyId: CO, date: daysAgo(200), minor: 200_000_00, currency: "USD" });
  insertMark({ id: "w36r10_expired", companyId: CO, date: daysAgo(400), minor: 300_000_00, currency: "USD" });

  insertMark({ id: "w36r10_ov_evt", companyId: CO_OV, date: daysAgo(400), minor: 500_000_00, currency: "USD" });
  insertApprovedOverride({ id: "w36r10_ov", eventId: "w36r10_ov_evt", companyId: CO_OV, minor: 900_000_00, priorMinor: 500_000_00, currency: "USD" });

  /* JPY, ISO 4217 exponent 0 — the minor unit IS the yen. */
  insertMark({ id: "w36r10_jpy", companyId: CO_JPY, date: daysAgo(400), minor: 900_000, currency: "JPY" });
});

afterAll(() => {
  setW9Config("marks.stale_warn_days", savedWarn, "w36r10");
  setW9Config("marks.stale_expired_days", savedExpired, "w36r10");
});

const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/* ── the server now tells the truth about age ────────────────────────────── */

describe("WAVE 36 ROW 10 · P1-P4 — the read model badges every point from DB-driven thresholds", () => {
  it("P1 — fresh / stale / expired are all three distinguished on one series", () => {
    const h = markHistoryForCompany(CO);
    expect(h.unavailableReason).toBeNull();
    expect(h.marks.length).toBe(3);
    const by = Object.fromEntries(h.marks.map((m) => [m.id, m]));
    expect(by["w36r10_fresh"]!.badge).toBe("fresh");
    expect(by["w36r10_stale"]!.badge).toBe("stale");
    expect(by["w36r10_expired"]!.badge).toBe("expired");
    /* Non-vacuity: three DIFFERENT verdicts, so a producer that returns one
       constant cannot pass. */
    expect(new Set(h.marks.map((m) => m.badge)).size).toBe(3);
    /* Ages are real, not zeros. */
    expect(by["w36r10_stale"]!.ageDays).toBeGreaterThanOrEqual(199);
    expect(by["w36r10_stale"]!.ageDays).toBeLessThanOrEqual(201);
  });

  it("P2 — the thresholds travel with the response and are the ones actually applied", () => {
    const h = markHistoryForCompany(CO);
    expect(h.markThresholds).toEqual({ staleWarnDays: 180, staleExpiredDays: 365 });
    /* The verdicts agree with the canonical decider, run independently here. */
    for (const m of h.marks) {
      expect(m.badge).toBe(badgeForAge(m.ageDays, { staleWarnDays: 180, staleExpiredDays: 365, autoDerive: false }));
    }
  });

  it("P3 — CHANGING THE CONFIG CHANGES THE VERDICT (the badge is not hardcoded)", () => {
    /* The pole that proves 180/365 were not baked in anywhere. With the warn
       threshold moved past it, the 200-day mark must become fresh. */
    setW9Config("marks.stale_warn_days", 900, "w36r10");
    setW9Config("marks.stale_expired_days", 1000, "w36r10");
    try {
      const h = markHistoryForCompany(CO);
      const by = Object.fromEntries(h.marks.map((m) => [m.id, m]));
      expect(by["w36r10_stale"]!.badge).toBe("fresh");
      expect(by["w36r10_expired"]!.badge).toBe("fresh");
      expect(h.markThresholds).toEqual({ staleWarnDays: 900, staleExpiredDays: 1000 });
    } finally {
      setW9Config("marks.stale_warn_days", 180, "w36r10");
      setW9Config("marks.stale_expired_days", 365, "w36r10");
    }
    /* …and restoring the config restores the verdict. Both poles. */
    const back = Object.fromEntries(markHistoryForCompany(CO).marks.map((m) => [m.id, m]));
    expect(back["w36r10_stale"]!.badge).toBe("stale");
  });

  it("P4 — an override does NOT reset the clock, and the original figure survives", () => {
    const h = markHistoryForCompany(CO_OV);
    expect(h.marks.length).toBe(1);
    const m = h.marks[0]!;
    expect(m.overrideId).toBe("w36r10_ov");
    expect(m.overrideReason).toContain("secondary quote");
    /* The override's figure is what is plotted; the event's own figure is kept
       so the reader can see the size of the restatement. */
    expect(m.fairValueMinor).toBe(900_000_00);
    expect(m.originalFairValueMinor).toBe(500_000_00);
    /* A GP restating a 400-day-old mark must not thereby make it look current. */
    expect(m.badge).toBe("expired");
  });

  it("P5 — JPY (exponent 0) is badged identically and its integer is untouched", () => {
    const h = markHistoryForCompany(CO_JPY);
    expect(h.currency).toBe("JPY");
    expect(h.marks[0]!.fairValueMinor).toBe(900_000);   // not 9_000, not 90_000_000
    expect(h.marks[0]!.badge).toBe("expired");
  });

  it("P6 — an empty series carries null thresholds, not a fabricated default", () => {
    const h = markHistoryForCompany("w36r10_company_that_does_not_exist");
    expect(h.unavailableReason).toBe("NO_MARKS_RECORDED");
    expect(h.marks).toEqual([]);
    expect(h.markThresholds).toBeNull();
  });
});

/* ── the tooltip actually renders it ─────────────────────────────────────── */

describe("WAVE 36 ROW 10 · P7-P9 — the tooltip renders the badges instead of discarding them", () => {
  it("P7 — the value-only `formatter` tooltip is gone, replaced by a content component", () => {
    const src = stripComments(read(COMPONENT));
    /* Pole 1 — the old shape, structurally incapable of showing a badge. */
    expect(src).not.toContain("<RTooltip formatter={(v: number) => fmtAxis(v)} />");
    /* Pole 2 — and something real took its place. */
    expect(src).toContain("<RTooltip content={<MarkTooltip />} />");
    expect(src).toContain("function MarkTooltip");
  });

  it("P8 — staleness and GP-override are both rendered, with the reason and the original", () => {
    const src = stripComments(read(COMPONENT));
    expect(src).toContain('data-testid="mark-history-tooltip-staleness"');
    expect(src).toContain('data-testid="mark-history-tooltip-override"');
    expect(src).toContain('data-testid="mark-history-tooltip-override-original"');
    expect(src).toContain("m.overrideReason");
    expect(src).toContain("No reason was recorded.");
    expect(src).toContain("originalFairValueMinor");
    /* The badge is keyed on the SERVER's verdict. */
    expect(src).toContain('m.badge === "expired"');
    expect(src).toContain('m.badge === "stale"');
  });

  it("P9 — the component hardcodes NO threshold and computes NO staleness", () => {
    const src = stripComments(read(COMPONENT));
    /* The numbers the review suggested writing here. They must not appear as
       comparisons — the component may only echo `markThresholds`. */
    expect(src).not.toMatch(/ageDays\s*[<>]=?\s*\d+/);
    expect(src).not.toMatch(/\b(180|365)\b\s*(\)|;|,)/);
    expect(src).toContain("markThresholds");
    expect(src).toContain("thresholds.staleWarnDays");
    expect(src).toContain("thresholds.staleExpiredDays");
    /* And it degrades honestly if the server could not read the config. */
    expect(src).toContain('m.badge === "unmarked"');
    expect(src).toContain("Age not assessed");
  });
});
