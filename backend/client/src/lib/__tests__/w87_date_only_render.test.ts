/**
 * WAVE 87 · ITEM 1 — THE TIMEZONE FIX, PROVED IN THE OWNER'S TIMEZONE.
 * ════════════════════════════════════════════════════════════════════════════
 * `new Date("2026-06-15")` is DEFINED by ECMA-262 to parse the date-only form as
 * UTC midnight. Rendered through any local-time reader that prints
 *
 *     TZ=America/New_York (UTC-4)  →  6/14/2026   ONE DAY EARLY
 *     TZ=Pacific/Auckland (UTC+12) →  6/15/2026   correct by luck
 *     TZ=UTC                       →  6/15/2026   correct — which is why CI never saw it
 *
 * A subscription renewal date that reads one day early is the kind of defect a
 * customer notices immediately and never forgets, and a UTC-only suite cannot
 * see it at all. So this file does two things:
 *
 *   1. asserts the FORMATTER is timezone-independent for date-only values by
 *      computing what the old code would have printed and requiring the new code
 *      to differ from it exactly when the process timezone is west of UTC —
 *      i.e. it proves the fix rather than restating it;
 *   2. asserts the FENCE has both poles, so the fix cannot be undone silently.
 *
 * The three-timezone transcript (TZ=America/New_York, TZ=Pacific/Auckland,
 * TZ=UTC) is in build_log/wave87/W87_DATE_CENSUS.md.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fmtDate, fmtLocaleDate, fmtLocaleDateTime, toCalendarDate } from "../format";
import {
  scanDateFile,
  runDateOnlyRenderFence,
  DATE_ONLY_REGISTRY,
  TIMESTAMP_FIELDS,
  SACRED_DEBT,
} from "../../../../scripts/lint/dateOnlyRenderFence";

const DATE_ONLY = "2026-06-15";
const INSTANT = "2026-06-15T02:30:00Z";

/* ══════════════════════════════════════════════════════════════════════════ *
 * 1 · THE FORMATTER                                                          *
 * ══════════════════════════════════════════════════════════════════════════ */

describe("W87 · a date-only value renders as the calendar day it is", () => {
  it("toCalendarDate builds LOCAL midnight for YYYY-MM-DD, so the day cannot shift", () => {
    const d = toCalendarDate(DATE_ONLY)!;
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(5);
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(0);
  });

  it("fmtLocaleDate prints 15 June in EVERY timezone the process could be in", () => {
    /* Read the day back through the same local calendar the browser would use. */
    const out = fmtLocaleDate(DATE_ONLY, "en-US", { year: "numeric", month: "numeric", day: "numeric" });
    expect(out).toBe("6/15/2026");
  });

  it("THE DEFECT, stated as an assertion: the OLD shape disagrees west of UTC", () => {
    const old = new Date(DATE_ONLY).toLocaleDateString("en-US", { year: "numeric", month: "numeric", day: "numeric" });
    const fixed = fmtLocaleDate(DATE_ONLY, "en-US", { year: "numeric", month: "numeric", day: "numeric" });
    const offsetMinutes = new Date(DATE_ONLY).getTimezoneOffset(); /* > 0 west of UTC */
    if (offsetMinutes > 0) {
      expect(old).not.toBe(fixed);      /* New York: 6/14/2026 vs 6/15/2026 */
      expect(old).toBe("6/14/2026");
    } else {
      expect(old).toBe(fixed);          /* UTC and east of it: no visible shift */
    }
    /* Either way the FIXED value is the entered day. That is the whole point. */
    expect(fixed).toBe("6/15/2026");
  });

  it("a TIMESTAMP still localises — an instant is an instant and must not be frozen", () => {
    const viaFence = fmtLocaleDateTime(INSTANT, "en-US");
    const viaDate = new Date(INSTANT).toLocaleString("en-US");
    expect(viaFence).toBe(viaDate);
  });

  it("fmtLocaleDate is a drop-in for toLocaleDateString on a timestamp", () => {
    expect(fmtLocaleDate(INSTANT)).toBe(new Date(INSTANT).toLocaleDateString());
  });

  it("Wave 83's fmtDate keeps its own contract (unchanged by this wave)", () => {
    expect(fmtDate(DATE_ONLY)).toBe("Jun 15, 2026");
  });

  it("absent, blank and impossible values fall back rather than inventing a day", () => {
    expect(fmtLocaleDate(null)).toBe("—");
    expect(fmtLocaleDate(undefined)).toBe("—");
    expect(fmtLocaleDate("")).toBe("—");
    expect(fmtLocaleDate("2026-02-31")).toBe("—");
    expect(fmtLocaleDate("not a date")).toBe("—");
    expect(toCalendarDate("2026-13-01")).toBeNull();
  });

  it("a date-only value has no time, so no spurious midnight is printed in the wrong day", () => {
    expect(fmtLocaleDateTime(DATE_ONLY, "en-US", { year: "numeric", month: "numeric", day: "numeric" }))
      .toBe("6/15/2026");
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * 2 · THE FENCE — BOTH POLES                                                 *
 * ══════════════════════════════════════════════════════════════════════════ */

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "w87-date-"));
function scan(code: string, rel = "client/src/pages/collective/W87Fixture.tsx") {
  const abs = path.join(tmp, `f${Math.random().toString(36).slice(2)}.tsx`);
  fs.writeFileSync(abs, code, "utf8");
  return scanDateFile(abs, rel);
}

describe("W87 · the date-only render fence — RED pole", () => {
  it("M1 · the exact defect reviewer 1 reported (renewsOn)", () => {
    const v = scan(`export const A = ({ s }: any) => <div>{new Date(s.renewsOn).toLocaleDateString()}</div>;`);
    expect(v.map((x) => x.field)).toContain("renewsOn");
  });

  it("M2 · lastRaiseDate, through an optional chain and a ternary", () => {
    const v = scan(`export const A = ({ snap }: any) => <div>{snap?.lastRaiseDate ? new Date(snap.lastRaiseDate).toLocaleDateString() : "—"}</div>;`);
    expect(v.map((x) => x.field)).toContain("lastRaiseDate");
  });

  it("M3 · toLocaleString, toLocaleTimeString, toDateString and getFullYear are all local-time readers", () => {
    for (const m of ["toLocaleString()", "toLocaleTimeString()", "toDateString()", "getFullYear()"]) {
      const v = scan(`export const A = ({ r }: any) => <div>{new Date(r.closeDate).${m}}</div>;`);
      expect(v.length, m).toBeGreaterThan(0);
    }
  });

  it("M4 · Intl.DateTimeFormat", () => {
    const v = scan(`export const A = ({ r }: any) => <div>{new Intl.DateTimeFormat("en-US").format(new Date(r.openDate))}</div>;`);
    expect(v.length).toBeGreaterThan(0);
  });

  it("M5 · THE CLASS REVIEWER 1 UNDERCOUNTED — a LOCAL helper that shadows the safe fmtDate", () => {
    const v = scan(`
      function fmtDate(iso: string) { try { return new Date(iso).toLocaleDateString(); } catch { return iso; } }
      export const A = ({ s }: any) => <div>{fmtDate(s.renewsOn)}</div>;
    `);
    expect(v.map((x) => x.kind)).toContain("local-helper");
    expect(v.map((x) => x.field)).toContain("renewsOn");
  });

  it("M6 · an arrow-function local helper counts too", () => {
    const v = scan(`
      const show = (v: string | null) => (v ? new Date(v).toLocaleDateString() : "—");
      export const A = ({ p }: any) => <div>{show(p.lastRaiseAt)}</div>;
    `);
    expect(v.length).toBeGreaterThan(0);
  });

  it("M7 · a `?? ` fallback does not launder the field name", () => {
    const v = scan(`export const A = ({ t }: any) => <div>{new Date(t.dueDate ?? t.due_date ?? "").toLocaleDateString()}</div>;`);
    expect(v.length).toBeGreaterThan(0);
  });
});

describe("W87 · the date-only render fence — GREEN pole", () => {
  it("G1 · the FIX is green: the same field through the imported safe formatter", () => {
    expect(scan(`
      import { fmtLocaleDate } from "@/lib/format";
      export const A = ({ s }: any) => <div>{fmtLocaleDate(s.renewsOn)}</div>;
    `)).toHaveLength(0);
    expect(scan(`
      import { fmtDate } from "@/lib/format";
      export const A = ({ r }: any) => <div>{fmtDate(r.closeDate)}</div>;
    `)).toHaveLength(0);
  });

  it("G2 · A TIMESTAMP MUST KEEP LOCALISING — this is the pole that stops a wrong 'fix'", () => {
    for (const f of ["createdAt", "updatedAt", "ts", "sentAt", "closedAt", "occurredAt", "uploadedAt"]) {
      expect(scan(`export const A = ({ e }: any) => <div>{new Date(e.${f}).toLocaleString()}</div>;`), f).toHaveLength(0);
    }
  });

  it("G3 · `effective_from` is a TIMESTAMP in this tree and is deliberately NOT policed", () => {
    /* Reviewer 1 listed it as date-only. The rows are written as full ISO
       instants (`2026-06-22T00:00:00Z`, migrations/0054:150; server default is
       `nowIso()`, server/lib/partnerFeeAdminRoutes.ts:120), and the resolver
       compares them as instants (`effective_from <= ?`). See W87_DATE_CENSUS.md. */
    expect(scan(`export const A = ({ r }: any) => <div>{new Date(r.effective_from).toLocaleDateString()}</div>;`)).toHaveLength(0);
  });

  it("G4 · date ARITHMETIC is timezone-independent and must not be flagged", () => {
    expect(scan(`
      export const A = ({ r }: any) => <div>{Math.round((new Date(r.closeDate).getTime() - new Date(r.openDate).getTime()) / 86400000)}</div>;
    `)).toHaveLength(0);
  });

  it("G5 · a RAW date-only string never crosses a timezone", () => {
    expect(scan(`export const A = ({ n }: any) => <div>as of {n.asOfDate}</div>;`)).toHaveLength(0);
  });

  it("G6 · a helper that DELEGATES to the safe formatter is not an unsafe helper", () => {
    expect(scan(`
      import { fmtLocaleDate } from "@/lib/format";
      function show(v: string | null) { return v ? fmtLocaleDate(v) : "—"; }
      export const A = ({ s }: any) => <div>{show(s.renewsOn)}</div>;
    `)).toHaveLength(0);
  });

  it("G7 · a computed instant (Date.now() + n days) is not a schema date-only value", () => {
    expect(scan(`
      export const A = ({ d }: any) => <div>{new Date(Date.now() + d * 86400000).toLocaleDateString()}</div>;
    `)).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * 3 · THE REGISTRY AND THE TREE                                              *
 * ══════════════════════════════════════════════════════════════════════════ */

describe("W87 · the fence, the registry and the sacred debt", () => {
  it("every registry entry carries file:line evidence — no name-guessing", () => {
    expect(DATE_ONLY_REGISTRY.length).toBeGreaterThanOrEqual(20);
    for (const e of DATE_ONLY_REGISTRY) {
      expect(e.evidence, e.field).toMatch(/:\d+|type="date"|slice\(0, 10\)/);
    }
  });

  it("no field is claimed as BOTH date-only and timestamp", () => {
    for (const e of DATE_ONLY_REGISTRY) expect(TIMESTAMP_FIELDS.has(e.field), e.field).toBe(false);
  });

  it("the sacred debt is declared, not hidden", () => {
    expect(SACRED_DEBT.length).toBeGreaterThan(0);
    for (const d of SACRED_DEBT) expect(d.note).toMatch(/SACRED/);
  });

  it("THE WHOLE TREE IS CLEAN — this is the gate", () => {
    const r = runDateOnlyRenderFence();
    const detail = r.violations.map((v) => `${v.file}:${v.line} «${v.field}» via ${v.via}`).join("\n");
    expect(detail).toBe("");
    expect(r.ok).toBe(true);
    expect(r.filesScanned).toBeGreaterThan(300);
  });
});
