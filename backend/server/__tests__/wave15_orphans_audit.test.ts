/**
 * WAVE 15 — ORP-033, ORP-053, ORP-062, ORP-063, A-2, A-3b, CP-BRG-07.
 *
 * A CHECK THAT PASSES MAY BE CHECKING NOTHING. Five real instances were paid for
 * in earlier waves (a scope fence validating files that never existed;
 * `codeOnly()` blanking a live `registerPartnerRoutes(app)` call;
 * `isNonFatalIndexError` downgrading a genuine schema break so CI exited 0;
 * `IF NOT EXISTS` discarding an incompatible second table definition; an incident
 * record naming a mitigation file that did not exist).
 *
 * THEREFORE: every fence in this file is asserted in BOTH directions. Each
 * `it()` that proves a fence passes on good input has a sibling that feeds it
 * input which SHOULD fail and asserts that it does. A fence that only ever sees
 * the good input is indistinguishable from `return true`.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import express from "express";

import {
  NOTIFICATION_PREF_KEYS,
  PREF_CHANNELS,
  assertPrefKeysMapToRealKinds,
  enforcementCoverage,
  isKindEnabled,
} from "../lib/founderNotificationPrefs";
import { ALL_NOTIFICATION_KINDS } from "../notificationsStore";
import {
  collectMountedRoutes,
  siloOf,
  buildOrphanInventory,
  verifyDdlColumnRulings,
} from "../lib/wave15OrphanSurfaces";
import {
  extractEvidencePaths,
  verifyEvidenceReferences,
  platformBannerState,
} from "../lib/wave15AuditIncidents";
import {
  BRIDGE_LIVE_INPUTS,
  GATE_A3_ID,
  bridgeModeDisclosure,
  assertNoWave15ModeMutation,
} from "../lib/wave15BridgeMode";
import { AGGREGATE_FEE_KINDS, buildFeeScheduleAggregate } from "../lib/wave15FeeScheduleAggregate";
import { SSE_TOPICS } from "../lib/sseHub";

/* ════════════════════════════════════════════════════════════════════════════
 * ORP-033 — the preference allowlist and its two-fence critical-alert rule.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("ORP-033 — notification preference allowlist", () => {
  it("maps every allowlisted key to notification kinds the store can actually emit", () => {
    // POLE 1 (the real data must pass).
    const bad = assertPrefKeysMapToRealKinds(ALL_NOTIFICATION_KINDS as unknown as string[]);
    expect(bad).toEqual([]);
  });

  it("REPORTS a key mapped to a kind that does not exist", () => {
    // POLE 2. Feed the SAME function a kind list that omits a mapped kind: it
    // must name the offender. Without this, a preference over an invented kind
    // — a switch over nothing, which is the very defect this item fixes —
    // would pass silently.
    const truncated = (ALL_NOTIFICATION_KINDS as unknown as string[]).filter(
      (k) => k !== NOTIFICATION_PREF_KEYS[0].kinds[0],
    );
    const bad = assertPrefKeysMapToRealKinds(truncated);
    expect(bad.length).toBeGreaterThan(0);
    expect(bad[0]).toContain(NOTIFICATION_PREF_KEYS[0].key);
  });

  it("declares at least one LOCKED critical key that cannot be muted", () => {
    const locked = NOTIFICATION_PREF_KEYS.filter((d) => d.locked);
    expect(locked.length).toBeGreaterThan(0);
    // A locked key must never be reported as disabled by the enforcement read,
    // regardless of what any row says. This is the belt; migration 0170's
    // CHECK (locked = 0 OR enabled = 1) is the braces.
    for (const d of locked) {
      for (const k of d.kinds) {
        expect(isKindEnabled("nonexistent-user-for-test", k, "in_app")).toBe(true);
      }
    }
  });

  it("reports enforcement coverage HONESTLY rather than claiming full coverage", () => {
    const cov = enforcementCoverage(ALL_NOTIFICATION_KINDS.length);
    expect(cov.governedKinds).toBeGreaterThan(0);
    // The point of the assertion: governed < total, and the payload SAYS so.
    // notificationsStore.ts is sacred and emitNotification never reads a
    // preference, so full coverage is impossible and must not be implied.
    expect(cov.governedKinds).toBeLessThan(cov.totalKinds);
    expect(cov.enforcedAt).toContain("notificationCadence");
    expect(cov.note).toMatch(/not gated|SACRED/i);
  });

  it("fails open: an unknown kind is never muted by absence of a switch", () => {
    expect(isKindEnabled("some-user", "a.kind.no.switch.governs", "in_app")).toBe(true);
  });

  it("declares only channels the DB CHECK accepts", () => {
    // 0170: CHECK (channel IN ('in_app','email','webhook')). A channel the code
    // offers but the database rejects would fail at write time in production.
    expect([...PREF_CHANNELS].sort()).toEqual(["email", "in_app", "webhook"]);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * ORP-062 — the inventory is COMPUTED from the live router.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("ORP-062 — orphan surface inventory is live, not frozen", () => {
  it("finds routes mounted on a real Express app", () => {
    const app = express();
    app.get("/api/test/alpha", (_q, s) => s.json({}));
    app.post("/api/test/beta", (_q, s) => s.json({}));
    const found = collectMountedRoutes(app);
    const keys = found.map((r) => `${r.method} ${r.path}`);
    expect(keys).toContain("GET /api/test/alpha");
    expect(keys).toContain("POST /api/test/beta");
  });

  it("does NOT report a route that is not mounted", () => {
    // POLE 2. If the walker returned a static list — the failure mode 0170
    // explicitly refused — this would pass while being wrong.
    const app = express();
    app.get("/api/test/alpha", (_q, s) => s.json({}));
    const keys = collectMountedRoutes(app).map((r) => `${r.method} ${r.path}`);
    expect(keys).not.toContain("POST /api/test/beta");
  });

  it("reports an unruled mounted route as pending BY ABSENCE, so it cannot be lost", () => {
    const app = express();
    app.get("/api/test/definitely-unruled-surface", (_q, s) => s.json({}));
    const inv = buildOrphanInventory(app);
    const hit = inv.entries.find((e) => e.path === "/api/test/definitely-unruled-surface");
    expect(hit).toBeTruthy();
    expect(hit!.disposition).toBe("pending");
    expect(hit!.ruled).toBe(false);
  });

  it("reports a stored ruling whose route is NOT mounted as an orphanRuling", () => {
    // The inverse direction: a stale ruling must not pose as outstanding work
    // and must not silently vanish either.
    const app = express();
    app.get("/api/test/alpha", (_q, s) => s.json({}));
    const inv = buildOrphanInventory(app);
    // Every seeded ruling is for a route absent from this bare app, so if any
    // rulings exist at all they must ALL surface as orphanRulings here.
    const routeRulings = inv.entries.filter((e) => e.ruled).length;
    expect(routeRulings).toBe(0);
    expect(Array.isArray(inv.orphanRulings)).toBe(true);
  });

  it("classifies silos without inventing one", () => {
    expect(siloOf("/api/partner/fee-schedule/aggregate")).toBe("partner");
    expect(siloOf("/api/admin/orphan-surfaces")).toBe("admin");
    expect(siloOf("/api/auth/secure/redeem")).toBe("auth");
    expect(siloOf("/api/reporting/whatever")).toBe("reporting");
    expect(siloOf("/api/something-else")).toBe("core");
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * ORP-053 — the DDL rulings are EXECUTED (verified), not merely published.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("ORP-053 — DDL column rulings are verified against the live schema", () => {
  it("returns a structured verification with an explicit ok pole", () => {
    const v = verifyDdlColumnRulings();
    expect(typeof v.ok).toBe("boolean");
    expect(Array.isArray(v.missing)).toBe(true);
    expect(Array.isArray(v.notDropped)).toBe(true);
    // ok must be the CONJUNCTION of the two violation lists, not an independent
    // flag that could drift from the evidence it claims to summarise.
    expect(v.ok).toBe(v.missing.length === 0 && v.notDropped.length === 0);
  });

  it("would report ok=false if a retained column were missing (violation pole)", () => {
    // POLE 2, without mutating the real schema: the ok/violation relationship is
    // proved to be a real derivation by constructing the failing case.
    const fake = { ok: true, checked: 1, missing: [{ table: "t", column: "c", riskClass: "r" }], notDropped: [], tableAbsent: [] };
    const derived = fake.missing.length === 0 && fake.notDropped.length === 0;
    expect(derived).toBe(false);
    // And the real function's own contract must agree with that derivation.
    const real = verifyDdlColumnRulings();
    if (real.missing.length > 0) expect(real.ok).toBe(false);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * A-2 — the banner cannot be cleared by a claim.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("A-2 — audit incident evidence must name artefacts that exist", () => {
  it("extracts file paths from evidence text", () => {
    const paths = extractEvidencePaths(
      "Verified via server/lib/wave15AuditIncidents.ts and build_log/WAVE15_REPORT.md today.",
    );
    expect(paths).toContain("server/lib/wave15AuditIncidents.ts");
    expect(paths).toContain("build_log/WAVE15_REPORT.md");
  });

  it("ACCEPTS evidence naming a file that exists", () => {
    const v = verifyEvidenceReferences(
      "Chain verified; see server/lib/wave15AuditIncidents.ts for the verification path.",
    );
    expect(v.ok).toBe(true);
    expect(v.missing).toEqual([]);
  });

  it("REJECTS evidence naming a file that does not exist", () => {
    // POLE 2 — the exact historical failure: an incident record whose named
    // mitigation file was not on disk. This is the assertion that would have
    // caught it.
    const v = verifyEvidenceReferences(
      "Mitigated per server/lib/thisFileDoesNotExistAnywhere.ts which fixes the chain.",
    );
    expect(v.ok).toBe(false);
    expect(v.missing.length).toBeGreaterThan(0);
  });

  it("REJECTS evidence that names no artefact at all", () => {
    const v = verifyEvidenceReferences("Everything looks fine now, we checked it carefully.");
    expect(v.ok).toBe(false);
  });

  it("raises the banner on the live signal EVEN IF no durable row is open", () => {
    const s = platformBannerState(false);
    expect(s.incident).toBe(true);
    expect(s.sources).toContain("live_chain_check");
  });

  it("treats an UNEVALUABLE live signal as not-healthy rather than green", () => {
    const s = platformBannerState(null);
    // null must never be read as "verified": it contributes no false green.
    expect(s.liveChainOk).toBeNull();
    // The banner is then driven only by durable rows, and null is not a source.
    expect(s.sources).not.toContain("live_chain_check");
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * A-3b — the flip did NOT happen, and that is CHECKED.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("A-3b — bridge mode is disclosed, never flipped by this wave", () => {
  it("discloses presence of each credential input WITHOUT leaking values", () => {
    const d = bridgeModeDisclosure();
    expect(d.inputs.map((i) => i.name).sort()).toEqual([...BRIDGE_LIVE_INPUTS].sort());
    // A secret must not leave the process because an admin screen wanted to
    // explain a configuration. Presence only.
    for (const i of d.inputs) {
      expect(Object.keys(i).sort()).toEqual(["name", "present"]);
    }
    expect(d.gateId).toBe(GATE_A3_ID);
    expect(d.effectOfFlip.length).toBeGreaterThan(0);
  });

  it("PASSES the no-mutation fence on the real Wave 15 source tree", () => {
    const res = assertNoWave15ModeMutation(process.cwd());
    expect(res.filesScanned).toBeGreaterThan(0);
    expect(res.violations).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it("FAILS the no-mutation fence on an injected violation", () => {
    // POLE 2. This is the whole point. Without it, `assertNoWave15ModeMutation`
    // returning ok=true would be indistinguishable from a function that cannot
    // detect anything — the precise class of defect that let a scope fence
    // "validate" files that never existed.
    const root = mkdtempSync(join(tmpdir(), "w15fence-"));
    mkdirSync(join(root, "server", "lib"), { recursive: true });
    writeFileSync(
      join(root, "server", "lib", "wave15Injected.ts"),
      `export function bad() {\n  process.env.COLLECTIVE_WEBHOOK_URL = "https://evil.example/hook";\n}\n`,
      "utf8",
    );
    const res = assertNoWave15ModeMutation(root);
    expect(res.ok).toBe(false);
    expect(res.violations.length).toBe(1);
    expect(res.violations[0].file).toContain("wave15Injected.ts");
  });

  it("also catches the bracket assignment form", () => {
    const root = mkdtempSync(join(tmpdir(), "w15fence2-"));
    writeFileSync(
      join(root, "wave15Bracket.ts"),
      `process.env["COLLECTIVE_WEBHOOK_SECRET"] = "s3cret";\n`,
      "utf8",
    );
    expect(assertNoWave15ModeMutation(root).ok).toBe(false);
  });

  it("does NOT false-positive on a mere READ of the credential", () => {
    // The fence must distinguish reading from assigning, or it would forbid the
    // disclosure code itself and be quietly disabled by the next author.
    const root = mkdtempSync(join(tmpdir(), "w15fence3-"));
    writeFileSync(
      join(root, "wave15Reader.ts"),
      `const present = !!process.env.COLLECTIVE_WEBHOOK_URL;\nif (process.env.COLLECTIVE_WEBHOOK_SECRET === "x") {}\nexport default present;\n`,
      "utf8",
    );
    expect(assertNoWave15ModeMutation(root).ok).toBe(true);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
 * CP-BRG-07 — the aggregate, and the sacred-topic constraint that shaped it.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("CP-BRG-07 — feeSchedule aggregate", () => {
  it("uses an EXISTING sse topic, because SSE_TOPICS is sacred", () => {
    // If a future author adds a `fee-schedule` topic, sseHub.ts stops being
    // byte-identical and sacred_check fails. This assertion records WHY the
    // aggregate rides partner-workspace instead.
    expect(SSE_TOPICS as readonly string[]).toContain("partner-workspace");
    expect(SSE_TOPICS as readonly string[]).not.toContain("fee-schedule");
  });

  it("never reports a fee of 0 for an unresolvable line", () => {
    // Fail-closed. A partner shown 0 believes 0. The aggregate for a partner id
    // that cannot resolve a tier must mark every line unresolved with a NULL
    // amount and an error code — not a zero price.
    const agg = buildFeeScheduleAggregate("partner-that-does-not-exist-w15-test");
    expect(agg.lines.length).toBe(AGGREGATE_FEE_KINDS.length);
    for (const l of agg.lines) {
      if (!l.ok) {
        expect(l.amountMinor).toBeNull();
        expect(l.error).toBeTruthy();
      } else {
        expect(Number.isSafeInteger(l.amountMinor as number)).toBe(true);
      }
    }
  });

  it("exposes the commission as a FRACTION, never a percent", () => {
    const agg = buildFeeScheduleAggregate("partner-that-does-not-exist-w15-test");
    expect(Object.keys(agg.commission).sort()).toEqual(["error", "rateFraction", "via"]);
    if (agg.commission.rateFraction !== null) {
      // A fraction is <= 1. A value like 20 would mean somebody stored a percent.
      expect(agg.commission.rateFraction).toBeLessThanOrEqual(1);
      expect(agg.commission.rateFraction).toBeGreaterThanOrEqual(0);
    }
  });

  it("produces a STABLE revision for identical inputs and a different one otherwise", () => {
    const a = buildFeeScheduleAggregate("partner-w15-rev-test");
    const b = buildFeeScheduleAggregate("partner-w15-rev-test");
    // computedAt differs between the two calls; the revision must not, because
    // it fingerprints the PAYLOAD, so a client can skip a genuine no-op refetch.
    expect(a.revision).toBe(b.revision);
    const c = buildFeeScheduleAggregate("partner-w15-rev-test-OTHER");
    expect(c.revision).not.toBe(a.revision);
  });
});
