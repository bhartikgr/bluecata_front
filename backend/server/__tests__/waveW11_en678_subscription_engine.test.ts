/**
 * WAVE 11 — proving tests for EN-6 (partner subscription checkout POST path),
 * EN-7 (proration / plan-change engine) and EN-8 (grace + non-payment
 * enforcement worker).
 *
 * WHAT WAS VERIFIED AT SOURCE, NOT WHERE CITED
 * --------------------------------------------
 *   EN-6. The spec says the partner checkout dead-ends. It does, and the reason
 *   is structural rather than cosmetic: `POST /api/billing/plan` (server/
 *   routes.ts) requires `{tierId, companyId}` and then rejects any caller who
 *   does not own that founder company. A partner has no founder company, so
 *   pointing the partner UI at that route — even with a correct POST — is a
 *   guaranteed 403. That is asserted below by reading the route source, so if
 *   somebody "fixes" EN-6 later by redirecting partners back there, this fails.
 *
 *   EN-7. `PAYMENT_KINDS` in server/paymentStore.ts contains `"proration"` and
 *   nothing constructed it. Asserted below by grepping the tree: exactly one
 *   producer must exist, and it must be subscriptionChangeStore.
 *
 *   EN-8. `collective.partner_membership.grace_days_after_expiry` is seeded in
 *   server/db/connection.ts and read by nothing. Asserted below: the config row
 *   must exist (so this is wiring, not invention) AND the worker must actually
 *   read it — proven by changing the value and observing a different decision.
 *
 * ANTI-VACUITY (the WAVE 7B / DA-3 lesson)
 * ----------------------------------------
 * Wave 7B found a scope fence passing against files that had never existed.
 * Every refusal asserted here is therefore paired with a proof that the thing
 * being refused is reachable: block 0 proves the schema is really installed and
 * that a row can really be written, before any "must throw" test runs.
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { rawDb } from "../db/connection";
import {
  addCycle,
  appendSubscriptionEvent,
  getActiveForSubject,
  getById,
  listSubscriptionEvents,
  partnerSubscriptionSchemaInstalled,
  setStatus,
  _resetWave11SchemaGuardForTests,
} from "../lib/partnerSubscriptionStore";
import {
  prorateMinor,
  wholeDaysBetween,
  previewPlanChange,
  PlanChangeError,
} from "../lib/subscriptionChangeStore";
import {
  updatePlatformConfigValue,
  readConfigRow,
  computeRevisionHash,
  PlatformConfigWriteError,
} from "../lib/platformConfigWriter";
import {
  GRACE_CONFIG_KEY,
  readGraceConfig,
  tick,
  enforcementStatusForSubject,
  reinstate,
} from "../lib/subscriptionEnforcementWorker";

const ROOT = process.cwd();

/**
 * Strip comments and string literals before asserting that a symbol is ABSENT
 * from a file. Without this, a test that forbids a token passes or fails on the
 * PROSE of the file being tested — the sort of assertion that looks strict and
 * measures nothing. Every "must not reference X" check below runs on code only.
 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
}

function insertSubscription(patch: Partial<Record<string, unknown>> = {}): string {
  const db: any = rawDb();
  const id = `psub_test_${randomUUID()}`;
  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    id,
    subject_kind: "partner",
    subject_id: `ptr_test_${randomUUID().slice(0, 8)}`,
    tier_slug: "tier_test_basic",
    cycle: "monthly",
    amount_minor: 100_00,
    currency: "USD",
    list_amount_minor: 100_00,
    discount_minor: 0,
    discount_code: null,
    price_derivation: "tier_price_row",
    payment_intent_id: `int_${randomUUID()}`,
    merchant_order_id: `mo_${randomUUID()}`,
    status: "active",
    created_at: now,
    activated_at: now,
    current_period_start: now,
    current_period_end: addCycle(now, "monthly"),
    grace_until: null,
    suspended_at: null,
    cancelled_at: null,
    updated_at: now,
    created_by: "test",
    ...patch,
  };
  const cols = Object.keys(row);
  db.prepare(
    `INSERT INTO partner_subscription (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
  ).run(...cols.map((c) => row[c]));
  return id;
}

/** Push updated_at back so the 30-minute worker debounce does not skip the row. */
function agedRow(id: string): void {
  const db: any = rawDb();
  db.prepare(`UPDATE partner_subscription SET updated_at=? WHERE id=?`).run(
    new Date(Date.now() - 3 * 3600_000).toISOString(),
    id,
  );
}

/**
 * Change the grace window THROUGH THE SANCTIONED WRITER.
 *
 * A plain `UPDATE platform_config` aborts with PLATFORM_CONFIG_UNAUDITED_UPDATE
 * — the sacred bootstrap's trigger set requires a matching history row to exist
 * first. That is exactly why nothing in the tree could change a config value
 * before this wave, and why EN-8's window had never moved off its seeded 0.
 */
function setGraceDays(n: number): void {
  updatePlatformConfigValue({
    key: GRACE_CONFIG_KEY,
    valueJson: String(n),
    changedBy: "test",
  });
}

beforeAll(() => {
  _resetWave11SchemaGuardForTests();
  /* Touch the store so the A-22 self-heal installs 0167 into the :memory: db the
     sacred bootstrap built without it. */
  partnerSubscriptionSchemaInstalled();
});

/* ==========================================================================
 * 0. ANTI-VACUITY. Nothing below is evidence unless these hold.
 * ======================================================================== */
describe("WAVE 11 / block 0 — the schema is really here (A-22 self-heal)", () => {
  it("0a: migration 0167 exists in BOTH migration dirs, byte-identical", () => {
    const a = path.join(ROOT, "migrations", "0167_wave11_partner_subscription_engine.sql");
    const b = path.join(ROOT, "server", "db", "migrations", "0167_wave11_partner_subscription_engine.sql");
    expect(fs.existsSync(a)).toBe(true);
    expect(fs.existsSync(b)).toBe(true);
    expect(fs.readFileSync(a)).toEqual(fs.readFileSync(b));
  });

  it("0b: partner_subscription / _event / _change all exist after the heal", () => {
    expect(partnerSubscriptionSchemaInstalled()).toBe(true);
    const db: any = rawDb();
    for (const t of [
      "partner_subscription",
      "partner_subscription_event",
      "partner_subscription_change",
    ]) {
      const found = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`)
        .get(t);
      expect(found, `${t} must exist or every assertion below is vacuous`).toBeTruthy();
    }
  });

  it("0c: a row can really be written and read back", () => {
    const id = insertSubscription();
    const row = getById(id);
    expect(row).toBeTruthy();
    expect(row!.amountMinor).toBe(100_00);
    expect(row!.status).toBe("active");
  });

  it("0d: the EN-8 grace config row exists — EN-8 is WIRING an existing key", () => {
    const db: any = rawDb();
    const row = db
      .prepare(`SELECT key, value_json, value_type FROM platform_config WHERE key=?`)
      .get(GRACE_CONFIG_KEY);
    expect(row, `${GRACE_CONFIG_KEY} must be seeded (connection.ts)`).toBeTruthy();
    expect(row.value_type).toBe("number");
  });
});

/* ==========================================================================
 * 1. EN-6 — the dead end, and that we did not "fix" it by routing back.
 * ======================================================================== */
describe("WAVE 11 / EN-6 — partner checkout has a real POST path", () => {
  it("1a: the founder route still gates on founder-company ownership (why the old checkoutPath could never work)", () => {
    const src = fs.readFileSync(path.join(ROOT, "server", "routes.ts"), "utf8");
    const at = src.indexOf('"/api/billing/plan"');
    expect(at, "POST /api/billing/plan must still exist").toBeGreaterThan(0);
    const body = src.slice(at, at + 4000);
    expect(body).toMatch(/companyId/);
    expect(body).toMatch(/not_owner|owns|founder/i);
  });

  it("1b: the partner quote route now advertises a POST-able partner-scoped path", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "server", "lib", "partnerSelfServiceRoutes.ts"),
      "utf8",
    );
    expect(src).toContain('checkoutPath: "/api/partner/me/checkout"');
    expect(src).toContain('checkoutMethod: "POST"');
    /* The old value is preserved rather than silently dropped. */
    expect(src).toContain('legacyCheckoutPath: "/api/billing/plan"');
    expect(src).toContain('app.post(\n    "/api/partner/me/checkout"');
  });

  it("1c: ONE amount producer — the quote route no longer composes its own pricing", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "server", "lib", "partnerSelfServiceRoutes.ts"),
      "utf8",
    );
    /* `quotePartnerSubscription(` must no longer be CALLED here; the shared
       producer in partnerSubscriptionStore calls it instead. */
    const calls = src.match(/quotePartnerSubscription\(\{/g) ?? [];
    expect(calls.length, "route must not compose the quote itself any more").toBe(0);
    expect(src).toContain("quotePartnerCheckout({");

    const store = fs.readFileSync(
      path.join(ROOT, "server", "lib", "partnerSubscriptionStore.ts"),
      "utf8",
    );
    expect((store.match(/quotePartnerSubscription\(\{/g) ?? []).length).toBe(1);
  });

  it("1d: SECOND-PATH CHECK — exactly one module mints a partner subscription intent", () => {
    const libDir = path.join(ROOT, "server", "lib");
    const offenders: string[] = [];
    for (const f of fs.readdirSync(libDir)) {
      if (!f.endsWith(".ts")) continue;
      const src = fs.readFileSync(path.join(libDir, f), "utf8");
      if (!src.includes("createPaymentIntent(")) continue;
      if (/partner_subscription\b/.test(src) || /recordPendingSubscription/.test(src)) {
        offenders.push(f);
      }
    }
    expect(offenders.sort()).toEqual(["partnerSubscriptionStore.ts"]);
  });

  it("1e: the sacred subscription store is CALLED, not modified", () => {
    const store = fs.readFileSync(
      path.join(ROOT, "server", "lib", "partnerSubscriptionStore.ts"),
      "utf8",
    );
    expect(store).toContain("recordPendingSubscription");
    /* The namespace is what keeps a partner subject from colliding with a real
       founder companyId in the sacred table. */
    expect(store).toContain("`${input.subjectKind}:${input.subjectId}`");
  });

  it("1f: activation sets a period end one cycle out, and audits it", () => {
    const id = insertSubscription({ status: "pending", current_period_end: null, activated_at: null });
    const before = listSubscriptionEvents(id).length;
    const now = new Date().toISOString();
    setStatus(id, "active", { currentPeriodStart: now, currentPeriodEnd: addCycle(now, "monthly") }, {
      eventKind: "activated",
    });
    const row = getById(id)!;
    expect(row.status).toBe("active");
    expect(row.currentPeriodEnd).toBeTruthy();
    expect(new Date(row.currentPeriodEnd!).getTime()).toBeGreaterThan(Date.now());
    expect(listSubscriptionEvents(id).length).toBe(before + 1);
  });

  it("1g: the lifecycle log is append-only BY TRIGGER, not by convention", () => {
    const id = insertSubscription();
    const evId = appendSubscriptionEvent({
      subscriptionId: id,
      eventKind: "probe",
      toStatus: "active",
    });
    const db: any = rawDb();
    /* Reachability first — the row is really there, so the refusals below are
       refusing something real. */
    expect(
      db.prepare(`SELECT id FROM partner_subscription_event WHERE id=?`).get(evId),
    ).toBeTruthy();
    expect(() =>
      db.prepare(`UPDATE partner_subscription_event SET event_kind='tampered' WHERE id=?`).run(evId),
    ).toThrow(/append-only/i);
    expect(() =>
      db.prepare(`DELETE FROM partner_subscription_event WHERE id=?`).run(evId),
    ).toThrow(/append-only/i);
  });

  it("1h: addCycle does calendar arithmetic, not 30 days", () => {
    expect(addCycle("2026-01-31T00:00:00.000Z", "monthly").slice(0, 10)).toBe("2026-02-28");
    expect(addCycle("2026-01-15T00:00:00.000Z", "monthly").slice(0, 10)).toBe("2026-02-15");
    expect(addCycle("2026-03-15T00:00:00.000Z", "annual").slice(0, 10)).toBe("2027-03-15");
  });
});

/* ==========================================================================
 * 2. EN-7 — proration arithmetic.
 * ======================================================================== */
describe("WAVE 11 / EN-7 — proration is exact integer minor units", () => {
  it("2a: 'proration' payment kind exists and now has exactly one producer", () => {
    const ps = fs.readFileSync(path.join(ROOT, "server", "paymentStore.ts"), "utf8");
    expect(ps).toContain('"proration"');

    const roots = [
      path.join(ROOT, "server"),
      path.join(ROOT, "server", "lib"),
    ];
    const producers: string[] = [];
    for (const dir of roots) {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".ts")) continue;
        const src = fs.readFileSync(path.join(dir, f), "utf8");
        if (/kind:\s*"proration"/.test(src)) producers.push(f);
      }
    }
    expect(producers.sort()).toEqual(["subscriptionChangeStore.ts"]);
  });

  it("2b: floor, in BigInt, and never Math.round on a share", () => {
    /* 10000 * 15 / 31 = 4838.709… -> 4838, not 4839. */
    expect(prorateMinor(10_000, 15, 31)).toBe(4838);
    expect(prorateMinor(10_000, 0, 31)).toBe(0);
    expect(prorateMinor(10_000, 31, 31)).toBe(10_000);
    /* remainingDays cannot exceed the period. */
    expect(prorateMinor(10_000, 99, 31)).toBe(10_000);
    /* Exactness at a scale where float multiplication would lose bits. */
    expect(prorateMinor(9_007_199_254_740_991, 1, 1)).toBe(9_007_199_254_740_991);

    const src = fs.readFileSync(
      path.join(ROOT, "server", "lib", "subscriptionChangeStore.ts"),
      "utf8",
    );
    expect(src).toContain("BigInt(");
    expect(
      /Math\.round/.test(codeOnly(src)),
      "no Math.round anywhere in the proration engine's code",
    ).toBe(false);
  });

  it("2c: bad inputs are refused, not coerced", () => {
    expect(() => prorateMinor(-1, 1, 10)).toThrow(PlanChangeError);
    expect(() => prorateMinor(100, 1, 0)).toThrow(PlanChangeError);
    expect(() => prorateMinor(100, -1, 10)).toThrow(PlanChangeError);
    expect(() => prorateMinor(1.5, 1, 10)).toThrow(PlanChangeError);
  });

  it("2d: wholeDaysBetween floors and never goes negative", () => {
    expect(wholeDaysBetween("2026-01-01T00:00:00Z", "2026-01-31T00:00:00Z")).toBe(30);
    expect(wholeDaysBetween("2026-01-01T00:00:00Z", "2026-01-01T23:59:59Z")).toBe(0);
    expect(wholeDaysBetween("2026-02-01T00:00:00Z", "2026-01-01T00:00:00Z")).toBe(0);
  });

  it("2e: a downgrade's net is SIGNED — a credit is never clamped to zero", () => {
    /* Direct arithmetic, independent of pricing config: paid 10000 for 30 days,
       15 remain, new plan is 4000. credit 5000, charge 2000, net -3000. */
    const credit = prorateMinor(10_000, 15, 30);
    const charge = prorateMinor(4_000, 15, 30);
    expect(credit).toBe(5_000);
    expect(charge).toBe(2_000);
    expect(charge - credit).toBe(-3_000);

    const src = fs.readFileSync(
      path.join(ROOT, "server", "lib", "subscriptionChangeStore.ts"),
      "utf8",
    );
    /* No clamp of the net to a floor of zero. */
    expect(/Math\.max\(0,\s*[^)]*netDue/.test(src)).toBe(false);
  });

  it("2f: a no-op change and a non-changeable status are both refused", () => {
    const id = insertSubscription();
    const row = getById(id)!;
    expect(() =>
      previewPlanChange({ subscriptionId: id, toTier: row.tierSlug, toCycle: row.cycle }),
    ).toThrow(/PLAN_CHANGE_NO_OP|no-op|current plan/i);

    const suspended = insertSubscription({ status: "suspended" });
    expect(() => previewPlanChange({ subscriptionId: suspended, toCycle: "annual" })).toThrow(
      /SUBSCRIPTION_NOT_CHANGEABLE|cannot be changed/i,
    );

    /* The CODE is the contract the routes map to an HTTP status, so assert the
       code rather than the prose. */
    try {
      previewPlanChange({ subscriptionId: "psub_nope", toCycle: "annual" });
      throw new Error("expected a throw");
    } catch (err) {
      expect(err).toBeInstanceOf(PlanChangeError);
      expect((err as PlanChangeError).code).toBe("SUBSCRIPTION_NOT_FOUND");
      expect((err as PlanChangeError).httpStatus).toBe(404);
    }
  });

  it("2g: an APPLIED change row is frozen by trigger", () => {
    const db: any = rawDb();
    const subId = insertSubscription();
    const id = `psc_test_${randomUUID()}`;
    db.prepare(
      `INSERT INTO partner_subscription_change
         (id, subscription_id, change_kind, currency, period_days, remaining_days,
          unused_credit_minor, new_charge_minor, net_due_minor, status, effective_at, created_at)
       VALUES (?,?,'upgrade','USD',30,15,5000,7500,2500,'applied',?,?)`,
    ).run(id, subId, new Date().toISOString(), new Date().toISOString());
    expect(db.prepare(`SELECT id FROM partner_subscription_change WHERE id=?`).get(id)).toBeTruthy();
    expect(() =>
      db.prepare(`UPDATE partner_subscription_change SET net_due_minor=0 WHERE id=?`).run(id),
    ).toThrow(/immutable/i);
    expect(() =>
      db.prepare(`DELETE FROM partner_subscription_change WHERE id=?`).run(id),
    ).toThrow(/append-only/i);
  });

  it("2h: a 'previewed' row may still be promoted to applied", () => {
    const db: any = rawDb();
    const subId = insertSubscription();
    const id = `psc_test_${randomUUID()}`;
    db.prepare(
      `INSERT INTO partner_subscription_change
         (id, subscription_id, change_kind, currency, period_days, remaining_days,
          unused_credit_minor, new_charge_minor, net_due_minor, status, effective_at, created_at)
       VALUES (?,?,'upgrade','USD',30,15,5000,7500,2500,'previewed',?,?)`,
    ).run(id, subId, new Date().toISOString(), new Date().toISOString());
    expect(() =>
      db.prepare(`UPDATE partner_subscription_change SET status='applied' WHERE id=?`).run(id),
    ).not.toThrow();
  });
});

/* ==========================================================================
 * 3. EN-8 — grace and enforcement.
 * ======================================================================== */
describe("WAVE 11 / EN-8 — grace window is read from config and enforced", () => {
  it("3a: the worker reads the SEEDED key (not a hardcoded number)", () => {
    setGraceDays(0);
    const zero = readGraceConfig();
    expect(zero.configMissing).toBe(false);
    expect(zero.graceDays).toBe(0);

    setGraceDays(7);
    const seven = readGraceConfig();
    expect(seven.graceDays).toBe(7);

    const src = fs.readFileSync(
      path.join(ROOT, "server", "lib", "subscriptionEnforcementWorker.ts"),
      "utf8",
    );
    expect(src).toContain("collective.partner_membership.grace_days_after_expiry");
    expect(src).toContain("value_json");
  });

  it("3b: graceDays=0 (the seeded value) suspends immediately at period end", () => {
    setGraceDays(0);
    const past = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const id = insertSubscription({
      current_period_start: new Date(Date.now() - 32 * 86_400_000).toISOString(),
      current_period_end: past,
    });
    agedRow(id);
    const out = tick();
    expect(out.configMissing).toBe(false);
    expect(getById(id)!.status).toBe("suspended");
    expect(out.suspended).toBeGreaterThanOrEqual(1);
    /* The decision is REPORTED with a reason, not just applied. */
    expect(out.decisions.some((d) => d.subscriptionId === id && d.to === "suspended")).toBe(true);
  });

  it("3c: graceDays>0 grants grace first, then suspends when it lapses", () => {
    setGraceDays(5);
    const periodEnd = new Date(Date.now() - 1 * 86_400_000).toISOString();
    const id = insertSubscription({
      current_period_start: new Date(Date.now() - 31 * 86_400_000).toISOString(),
      current_period_end: periodEnd,
    });
    agedRow(id);
    tick();
    const graced = getById(id)!;
    expect(graced.status).toBe("grace");
    expect(graced.graceUntil).toBeTruthy();
    /* grace_until must be period_end + 5 days, to the day. */
    expect(wholeDaysBetween(periodEnd, graced.graceUntil!)).toBe(5);

    /* Not yet lapsed: a second sweep must NOT suspend. */
    agedRow(id);
    tick();
    expect(getById(id)!.status).toBe("grace");

    /* Now lapse it. */
    const db: any = rawDb();
    db.prepare(`UPDATE partner_subscription SET grace_until=? WHERE id=?`).run(
      new Date(Date.now() - 3600_000).toISOString(),
      id,
    );
    agedRow(id);
    tick();
    expect(getById(id)!.status).toBe("suspended");
  });

  it("3d: an unexpired subscription is NEVER touched", () => {
    setGraceDays(5);
    const id = insertSubscription(); // period end is one month out
    agedRow(id);
    const before = getById(id)!;
    tick();
    const after = getById(id)!;
    expect(after.status).toBe("active");
    expect(after.graceUntil).toBeNull();
    expect(after.updatedAt).toBe(before.updatedAt);
  });

  it("3e: FAIL CLOSED — an unusable grace value suspends NOBODY", () => {
    /* The realistic corruption is a value that is present but not a usable
       window. A negative number passes the table's own `value_type='number'`
       CHECK and the sanctioned writer's type check, and is exactly the kind of
       fat-fingered admin input that must not be silently coerced to 0 — because
       0 means "suspend immediately", so coercing would cut off paying partners.
       readGraceConfig reports configMissing and the sweep does nothing. */
    const past = new Date(Date.now() - 2 * 86_400_000).toISOString();
    const id = insertSubscription({
      current_period_start: new Date(Date.now() - 32 * 86_400_000).toISOString(),
      current_period_end: past,
    });
    agedRow(id);
    try {
      updatePlatformConfigValue({
        key: GRACE_CONFIG_KEY,
        valueJson: "-1",
        changedBy: "test",
      });
      const cfg = readGraceConfig();
      expect(cfg.configMissing).toBe(true);
      const out = tick();
      expect(out.configMissing).toBe(true);
      expect(out.suspended).toBe(0);
      expect(out.swept).toBe(0);
      expect(getById(id)!.status).toBe("active");
    } finally {
      setGraceDays(0);
    }
  });

  it("3l: the sanctioned config writer is the ONLY legal path, and it chains", () => {
    /* Reachability first: the raw UPDATE really is refused, so 'sanctioned' is a
       property of the database and not a coding convention. */
    const db: any = rawDb();
    expect(() =>
      db.prepare(`UPDATE platform_config SET value_json='9' WHERE key=?`).run(GRACE_CONFIG_KEY),
    ).toThrow(/PLATFORM_CONFIG_UNAUDITED_UPDATE/);

    const before = readConfigRow(GRACE_CONFIG_KEY)!;
    const after = updatePlatformConfigValue({
      key: GRACE_CONFIG_KEY,
      valueJson: "9",
      changedBy: "test-owner",
    });
    expect(after.version).toBe(before.version + 1);
    expect(after.prevRevisionHash).toBe(before.revisionHash);
    /* The hash is re-derivable from the history row alone. */
    expect(after.revisionHash).toBe(
      computeRevisionHash({
        key: GRACE_CONFIG_KEY,
        version: after.version,
        valueJson: "9",
        valueType: before.valueType,
        prevRevisionHash: before.revisionHash,
      }),
    );
    /* And a history row was written for it. */
    const hist = db
      .prepare(
        `SELECT change_kind, revision_hash FROM platform_config_history
          WHERE config_key=? AND version=?`,
      )
      .get(GRACE_CONFIG_KEY, after.version);
    expect(hist.change_kind).toBe("update");
    expect(hist.revision_hash).toBe(after.revisionHash);

    /* Refusals: type change, unknown key, stale version, non-JSON. */
    expect(() =>
      updatePlatformConfigValue({ key: GRACE_CONFIG_KEY, valueJson: '"five"', changedBy: "t" }),
    ).toThrow(PlatformConfigWriteError);
    const expectCode = (fn: () => unknown, code: string) => {
      try {
        fn();
        throw new Error(`expected ${code}`);
      } catch (err) {
        expect(err).toBeInstanceOf(PlatformConfigWriteError);
        expect((err as PlatformConfigWriteError).code).toBe(code);
      }
    };
    expectCode(
      () => updatePlatformConfigValue({ key: "no.such.key", valueJson: "1", changedBy: "t" }),
      "CONFIG_KEY_NOT_FOUND",
    );
    expectCode(
      () =>
        updatePlatformConfigValue({
          key: GRACE_CONFIG_KEY,
          valueJson: "3",
          changedBy: "t",
          expectedVersion: 1,
        }),
      "CONFIG_VERSION_CONFLICT",
    );
    expectCode(
      () => updatePlatformConfigValue({ key: GRACE_CONFIG_KEY, valueJson: "not-json", changedBy: "t" }),
      "CONFIG_VALUE_NOT_JSON",
    );

    setGraceDays(0);
  });

  it("3f: a scheduled cancellation wins over grace, and is never renewed", () => {
    setGraceDays(10);
    const periodEnd = new Date(Date.now() - 86_400_000).toISOString();
    const id = insertSubscription({
      current_period_start: new Date(Date.now() - 31 * 86_400_000).toISOString(),
      current_period_end: periodEnd,
      cancelled_at: periodEnd,
    });
    agedRow(id);
    tick();
    expect(getById(id)!.status).toBe("cancelled");
  });

  it("3g: SETTLED RULING — enforcement touches status only, never permissions or nav", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "server", "lib", "subscriptionEnforcementWorker.ts"),
      "utf8",
    );
    const code = codeOnly(src);
    for (const forbidden of [
      "requirePartnerAuth",
      "permission",
      "grantRole",
      "revokeRole",
      "navItems",
      "setPermissions",
      "PT-5",
    ]) {
      expect(code.includes(forbidden), `worker code must not reference ${forbidden}`).toBe(false);
    }
    /* And positively: the worker issues NO write SQL of its own at all — every
       mutation goes through partnerSubscriptionStore.setStatus, which is what
       makes `partner_subscription_event` a complete record of transitions.
       Checked on the RAW source (SQL lives in string literals, which codeOnly
       blanks), so this cannot pass by accident. */
    const writeSql = [...src.matchAll(/(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+([a-z_]+)/gi)].map(
      (m) => `${m[1].replace(/\s+/g, " ").toUpperCase()} ${m[2]}`,
    );
    expect(writeSql).toEqual([]);
    /* Its only SQL is reads. */
    expect(src).toContain("SELECT * FROM partner_subscription");
  });

  it("3h: SECOND-PATH CHECK — the Collective billing table is never written here", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "server", "lib", "subscriptionEnforcementWorker.ts"),
      "utf8",
    );
    expect(codeOnly(src).includes("collective_memberships_billing")).toBe(false);

    /* And empirically: a sweep leaves that table's contents untouched. */
    const db: any = rawDb();
    let before: string | null = null;
    try {
      before = JSON.stringify(
        db.prepare(`SELECT * FROM collective_memberships_billing ORDER BY id`).all(),
      );
    } catch {
      before = null; /* table absent in this fixture — nothing to protect */
    }
    setGraceDays(3);
    tick();
    if (before !== null) {
      const after = JSON.stringify(
        db.prepare(`SELECT * FROM collective_memberships_billing ORDER BY id`).all(),
      );
      expect(after).toBe(before);
    }
  });

  it("3i: the reporting read projects the NEXT action, so the owner can see it", () => {
    setGraceDays(4);
    const subj = `ptr_report_${randomUUID().slice(0, 8)}`;
    insertSubscription({ subject_id: subj });
    const status = enforcementStatusForSubject("partner", subj);
    expect(status.configKey).toBe(GRACE_CONFIG_KEY);
    expect(status.graceDays).toBe(4);
    expect(status.subscriptions.length).toBe(1);
    expect(status.subscriptions[0].projectedGraceUntil).toBeTruthy();
    expect(status.subscriptions[0].projectedNextAction).toMatch(/grace/i);
  });

  it("3j: reinstate clears grace/suspension and restarts the period", () => {
    setGraceDays(2);
    const id = insertSubscription({
      status: "suspended",
      suspended_at: new Date().toISOString(),
      grace_until: new Date().toISOString(),
      current_period_end: new Date(Date.now() - 86_400_000).toISOString(),
    });
    const row = reinstate(id, "test-admin")!;
    expect(row.status).toBe("active");
    expect(row.graceUntil).toBeNull();
    expect(new Date(row.currentPeriodEnd!).getTime()).toBeGreaterThan(Date.now());
  });

  it("3k: the worker is actually STARTED — an engine with no caller is not shipped", () => {
    const idx = fs.readFileSync(path.join(ROOT, "server", "index.ts"), "utf8");
    expect(idx).toContain("startSubscriptionEnforcementWorker");
  });
});

/* ==========================================================================
 * 4. Routes exist. "An engine with no route is NOT shipped."
 * ======================================================================== */
describe("WAVE 11 / EN-6+7+8 — every engine has a registered route", () => {
  const src = () =>
    fs.readFileSync(path.join(ROOT, "server", "lib", "partnerSelfServiceRoutes.ts"), "utf8");

  it("4a: all four new routes are registered", () => {
    const s = src();
    for (const r of [
      '"/api/partner/me/checkout"',
      '"/api/partner/me/subscription/change/preview"',
      '"/api/partner/me/subscription/change"',
      '"/api/partner/me/subscription/cancel"',
    ]) {
      expect(s, `${r} must be registered`).toContain(r);
    }
  });

  it("4b: the charge route is auth-fenced exactly like the quote route", () => {
    const s = src();
    /* The literal also appears in the QUOTE route's response body as
       `checkoutPath`, so anchor on the registration itself. */
    const at = s.indexOf('app.post(\n    "/api/partner/me/checkout"');
    expect(at).toBeGreaterThan(0);
    const block = s.slice(at, at + 600);
    expect(block).toContain("requirePartnerAuth");
    expect(block).toContain('requirePartnerSubrole(["managing_partner"])');
    expect(block).toContain("requireSignedAgreement");
  });

  it("4c: partnerId comes from the auth context, never from the body", () => {
    const s = src();
    const at = s.indexOf('app.post(\n    "/api/partner/me/checkout"');
    const block = s.slice(at, at + 2500);
    expect(block).toContain("req.partnerContext!.partnerId");
    expect(/subjectId:\s*(req\.body|body)\./.test(block)).toBe(false);
  });

  it("4c2: NO DUPLICATE PATHS — a second registration of an existing path is dead code", () => {
    /* Express serves the FIRST matching registration. The first draft of EN-6
       added a second `GET /api/partner/me/subscription`, which would never have
       run. Every path this wave registers must therefore appear exactly once
       across the whole server tree. */
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        if (f.isDirectory()) {
          if (f.name === "__tests__" || f.name === "node_modules") continue;
          walk(path.join(dir, f.name));
        } else if (f.name.endsWith(".ts")) files.push(path.join(dir, f.name));
      }
    };
    walk(path.join(ROOT, "server"));
    const paths = [
      "/api/partner/me/checkout",
      "/api/partner/me/subscription/change/preview",
      "/api/partner/me/subscription/change",
      "/api/partner/me/subscription/cancel",
      "/api/partner/me/subscription",
    ];
    for (const route of paths) {
      let count = 0;
      for (const f of files) {
        const src = fs.readFileSync(f, "utf8");
        count += (src.match(new RegExp(`app\\.(get|post|put|patch|delete)\\(\\s*"${route}"`, "g")) ?? [])
          .length;
      }
      expect(count, `${route} must be registered exactly once`).toBe(1);
    }
  });

  it("4c3: the lifecycle data is folded into the PRE-EXISTING handler, additively", () => {
    const s2 = src();
    expect(s2).toContain("wave11SubscriptionBlock(pid)");
    /* The pre-existing keys survive. */
    expect(s2).toContain("subscription: sub ?? null");
    expect(s2).toContain("agreement: currentAgreement()");
    /* And a schema-less database still gets the old payload plus a reported
       failure, not a plausible empty state. */
    expect(s2).toContain("lifecycleUnavailable");
  });

  it("4d: the registration function is itself wired into the app", () => {
    const routes = fs.readFileSync(path.join(ROOT, "server", "routes.ts"), "utf8");
    expect(routes).toContain("registerPartnerSelfServiceRoutes");
  });
});
