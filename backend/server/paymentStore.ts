/**
 * Sprint 14 D2 — PaymentSurface backing store.
 *
 * Unified payment ledger for:
 *   - Collective $1,200/yr membership
 *   - Capavate founder subscriptions ($0/$249/$749)
 *   - Per-company billing
 *   - Soft-circle 7-currency display surfaces (no charge — display only)
 *   - Refunds, prorations, coupons (`?cp=` referral)
 *
 * Idempotent intent IDs (no double charges); all entries hash-chained.
 * Reconciles to cent via Decimal.js.
 */
import type { Express, Request, Response } from "express";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import Decimal from "decimal.js";
import { HashChain, registerChain } from "./lib/hashChain";
import { withTrace } from "./lib/trace";
import { emitSync } from "./sprint10Telemetry";
// v24.4.1 — RAM→DB migration. Note: this is the legacy v14 payment ledger,
// which is separate from subscriptionsStore (v23 hash-chained subscription
// orders) and the v24.2 Airwallex-backed subscriptionStore. All three coexist
// for backwards-compat; this migration ensures the legacy ledger survives
// restart for any code still calling it.
import { rawDb } from "./db/connection";
import { log } from "./lib/logger";

export const PAYMENT_KINDS = [
  "collective_membership",
  "founder_subscription",
  "company_billing",
  "refund",
  "proration",
] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export const PAYMENT_STATES = ["pending", "succeeded", "failed", "requires_3ds", "refunded", "demo"] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

export interface PaymentEntry {
  id: string;
  intentId: string;
  kind: PaymentKind;
  amountCents: number;
  currency: string;
  state: PaymentState;
  customerId: string;
  description: string;
  couponCode?: string;
  discountCents?: number;
  ts: string;
  /** Demo invoice id triggered to emailStore. */
  invoiceId?: string;
}

const ledger = new Map<string, PaymentEntry>();
const intentIndex = new Map<string, string>(); // intentId → entryId

/** Write-through to durable `payment_ledger` table.
 *
 * v25.32 final — `ON CONFLICT(intent_id) DO NOTHING`. The prior
 * `DO UPDATE SET state, entry_json` could overwrite the winner row's
 * `entry_json` with the loser's payload — the durable row's primary `id`
 * would stay as the winner's id while `entry_json.id` would be the loser's,
 * creating row-id / JSON-id divergence and breaking `getPayment(loserId)`.
 * Now we INSERT-OR-NOTHING: the first concurrent insert wins; subsequent
 * losers are no-ops at the DB layer. `chargeOrIdempotent` reads back from
 * the DB by `intent_id` so the loser callers still see the winner's data
 * — no in-memory authority, no id divergence.
 */
function persistPaymentEntry(entry: PaymentEntry): void {
  try {
    rawDb().prepare(
      `INSERT INTO payment_ledger (id, intent_id, customer_id, state, entry_json, ts)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(intent_id) DO NOTHING`,
    ).run(entry.id, entry.intentId, entry.customerId, entry.state, JSON.stringify(entry), entry.ts);
  } catch (err) {
    log.warn("[paymentStore] write-through failed:", (err as Error).message);
  }
}

/** v24.4.1 — rebuild both Maps from durable rows on boot. */
export async function hydratePaymentStore(): Promise<void> {
  try {
    const rows = rawDb()
      .prepare(`SELECT id, intent_id, entry_json FROM payment_ledger`)
      .all() as Array<{ id: string; intent_id: string; entry_json: string }>;
    ledger.clear();
    intentIndex.clear();
    for (const r of rows) {
      try {
        const entry = JSON.parse(r.entry_json) as PaymentEntry;
        ledger.set(r.id, entry);
        intentIndex.set(r.intent_id, r.id);
      } catch (parseErr) {
        log.warn(`[hydrate] paymentStore: skipping ${r.id} — ${(parseErr as Error).message}`);
      }
    }
    if (rows.length > 0) {
      log.info(`[hydrate] paymentStore: ${rows.length} entries loaded`);
    }
  } catch (err) {
    log.warn("[hydrate] paymentStore: DB read failed:", (err as Error).message);
  }
}
export const paymentChain = registerChain(new HashChain<{
  id: string; intentId: string; kind: PaymentKind; amountCents: number; state: PaymentState; ts: string;
}>("payments"));

export const paymentChargeSchema = z.object({
  intentId: z.string().min(1),
  kind: z.enum(PAYMENT_KINDS),
  amountCents: z.number().int(),
  currency: z.string().length(3),
  customerId: z.string().min(1),
  description: z.string().min(1),
  couponCode: z.string().optional(),
  /** Force outcome for demo / test flows. */
  forceState: z.enum(["succeeded", "failed", "requires_3ds", "demo"]).default("demo"),
});

export function calcCouponDiscountCents(amountCents: number, code?: string): number {
  if (!code) return 0;
  // Demo coupon table — referral codes via `?cp=` give 10%, "FOUNDER20" = 20%.
  const map: Record<string, number> = { CP10: 0.10, FOUNDER20: 0.20, COLLECTIVE5: 0.05 };
  const pct = map[code.toUpperCase()] ?? 0;
  // Cent-perfect via Decimal.js
  return new Decimal(amountCents).mul(pct).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

export function chargeOrIdempotent(input: z.infer<typeof paymentChargeSchema>): { entry: PaymentEntry; deduped: boolean } {
  // v25.32 deep — DB-authoritative idempotency. Query payment_ledger by
  // intent_id FIRST; only fall back to mint if no row exists. Avi's in-memory
  // ledger/intentIndex Maps still receive write-through writes (so his tests
  // pass and downstream emitters work), but they are NO LONGER consulted on the
  // read side. The durable `payment_ledger` table (UNIQUE intent_id) is the
  // single source of truth for the dedup decision.
  try {
    const row = rawDb().prepare(
      `SELECT entry_json FROM payment_ledger WHERE intent_id = ?`,
    ).get(input.intentId) as { entry_json: string } | undefined;
    if (row) {
      const existing = JSON.parse(row.entry_json) as PaymentEntry;
      // Refresh the write-through cache for downstream readers (write-through
      // pattern preserved; the cache is a side-effect, not authority).
      ledger.set(existing.id, existing);
      intentIndex.set(existing.intentId, existing.id);
      return { entry: existing, deduped: true };
    }
  } catch (e) {
    // v25.32 Item 28 — FAIL CLOSED. Previously this swallowed the error and
    // continued to mint, relying on the UNIQUE(intent_id) constraint to catch
    // a dupe. But if the durable idempotency pre-check itself cannot run, we
    // cannot safely assert this intent has not already been charged — minting
    // anyway risks a duplicate charge/ledger attempt. Throw so the caller
    // surfaces an error instead of taking money under dedup uncertainty.
    log.warn("[paymentStore] DB idempotency check failed — failing closed:", (e as Error).message);
    throw new Error("PAYMENT_IDEMPOTENCY_PRECHECK_FAILED");
  }
  return withTrace(`payment.${input.kind}`, "1.0.0", "US", () => {
    const id = `pay_${randomBytes(6).toString("hex")}`;
    const discountCents = calcCouponDiscountCents(input.amountCents, input.couponCode);
    const netCents = new Decimal(input.amountCents).minus(discountCents).toNumber();
    const entry: PaymentEntry = {
      id,
      intentId: input.intentId,
      kind: input.kind,
      amountCents: netCents,
      currency: input.currency,
      state: input.forceState,
      customerId: input.customerId,
      description: input.description,
      couponCode: input.couponCode,
      discountCents: discountCents > 0 ? discountCents : undefined,
      ts: new Date().toISOString(),
      invoiceId: `inv_${randomBytes(4).toString("hex")}`,
    };
    ledger.set(id, entry);
    intentIndex.set(input.intentId, id);
    persistPaymentEntry(entry);
    /* v25.32 final — since persistPaymentEntry now uses ON CONFLICT DO NOTHING,
     * a concurrent caller may have won the race. Re-read the durable row by
     * intent_id to confirm we are returning the canonical winner and not a
     * losing local mint. If a different entry exists, refresh the cache to it
     * and report deduped=true so the caller knows. */
    try {
      const finalRow = rawDb().prepare(
        `SELECT entry_json FROM payment_ledger WHERE intent_id = ?`,
      ).get(entry.intentId) as { entry_json: string } | undefined;
      if (finalRow) {
        const canonical = JSON.parse(finalRow.entry_json) as PaymentEntry;
        if (canonical.id !== entry.id) {
          // We lost the race; the canonical row belongs to another worker.
          // Refresh our in-memory cache to point at the canonical entry so
          // downstream emits use consistent ids, then return deduped.
          ledger.delete(entry.id);
          ledger.set(canonical.id, canonical);
          intentIndex.set(canonical.intentId, canonical.id);
          return { entry: canonical, deduped: true };
        }
      }
    } catch (e) {
      log.warn("[paymentStore] DB read-after-insert check failed:", (e as Error).message);
      // Continue with the local entry; the chain/emit below are best-effort.
    }
    paymentChain.append({ id, intentId: entry.intentId, kind: entry.kind, amountCents: entry.amountCents, state: entry.state, ts: entry.ts });
    emitSync({
      eventType: "payment_charged",
      aggregateId: entry.customerId,
      aggregateKind: "investor",
      payload: { id, kind: entry.kind, state: entry.state, amountCents: entry.amountCents, currency: entry.currency, invoiceId: entry.invoiceId },
      actorUserId: entry.customerId,
    });
    return { entry, deduped: false };
  });
}

// v25.32 P1b — READS ARE NOW DB-DIRECT (no in-memory state).
// Per the standing rule "nothing in memory; all DB-driven", listPayments and
// getPayment now SELECT from the durable `payment_ledger` table and
// deserialize `entry_json`, instead of reading the module-scope `ledger` Map.
// The `ledger` / `intentIndex` Maps remain ONLY as Avi's write-through cache
// for `chargeOrIdempotent` (kept byte-identical) and are no longer consulted
// on any read path. The SQLite table is the single source of truth for reads.
function rowsToEntries(rows: Array<{ entry_json: string }>): PaymentEntry[] {
  const out: PaymentEntry[] = [];
  for (const r of rows) {
    try {
      out.push(JSON.parse(r.entry_json) as PaymentEntry);
    } catch (parseErr) {
      log.warn(`[paymentStore] listPayments: skipping malformed entry_json — ${(parseErr as Error).message}`);
    }
  }
  return out;
}

export function listPayments(filter?: { customerId?: string }): PaymentEntry[] {
  try {
    let rows: Array<{ entry_json: string }>;
    if (filter?.customerId) {
      rows = rawDb()
        .prepare(`SELECT entry_json FROM payment_ledger WHERE customer_id = ? ORDER BY ts DESC`)
        .all(filter.customerId) as Array<{ entry_json: string }>;
    } else {
      rows = rawDb()
        .prepare(`SELECT entry_json FROM payment_ledger ORDER BY ts DESC`)
        .all() as Array<{ entry_json: string }>;
    }
    return rowsToEntries(rows);
  } catch (err) {
    log.warn("[paymentStore] listPayments DB read failed:", (err as Error).message);
    return [];
  }
}

export function getPayment(id: string): PaymentEntry | undefined {
  try {
    const row = rawDb()
      .prepare(`SELECT entry_json FROM payment_ledger WHERE id = ? LIMIT 1`)
      .get(id) as { entry_json: string } | undefined;
    if (!row) return undefined;
    return JSON.parse(row.entry_json) as PaymentEntry;
  } catch (err) {
    log.warn("[paymentStore] getPayment DB read failed:", (err as Error).message);
    return undefined;
  }
}

/** Soft-circle 7-currency display: convert amounts.
 *
 * v25.32 final — reads from the `fx_rates` DB table (Ozan's rule:
 * "no hardcoded values that should come from DB/admin"). Defaults are
 * seeded on first boot via INSERT OR IGNORE in server/db/connection.ts;
 * admin can override per-currency rates without code changes. If the DB
 * read fails we return the well-known USD-only fallback (USD=1) rather
 * than throwing — this preserves Avi's existing zero-config tests that
 * call this function before the seed has run.
 */
export function softCircleRates(): Record<string, number> {
  try {
    const rows = rawDb()
      .prepare(`SELECT currency_code, rate FROM fx_rates`)
      .all() as Array<{ currency_code: string; rate: number }>;
    if (rows.length === 0) return { USD: 1 };
    const out: Record<string, number> = {};
    for (const r of rows) out[r.currency_code] = r.rate;
    if (!out.USD) out.USD = 1; // USD is the base; defensively pin it.
    return out;
  } catch (err) {
    log.warn("[paymentStore.softCircleRates] DB read failed:", (err as Error).message);
    return { USD: 1 };
  }
}

export function __clearPayments(): void {
  ledger.clear();
  intentIndex.clear();
  paymentChain.__clear();
  try { rawDb().prepare(`DELETE FROM payment_ledger`).run(); } catch { /* table may not exist in tests */ }
}

export function registerPaymentRoutes(app: Express): void {
  app.get("/api/payments", (req: Request, res: Response) => {
    const customerId = req.query.customerId ? String(req.query.customerId) : undefined;
    res.json({ items: listPayments({ customerId }) });
  });

  app.get("/api/payments/:id", (req: Request, res: Response) => {
    const p = getPayment(req.params.id);
    if (!p) return res.status(404).json({ error: "not_found" });
    res.json(p);
  });

  app.post("/api/payments/charge", (req: Request, res: Response) => {
    const parsed = paymentChargeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
    // v25.32 Item 28 — chargeOrIdempotent now FAILS CLOSED (throws) if the DB
    // idempotency pre-check cannot run. Surface that as a 503 rather than an
    // unhandled rejection so the caller can retry instead of double-charging.
    try {
      const r = chargeOrIdempotent(parsed.data);
      res.status(r.deduped ? 200 : 201).json(r.entry);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === "PAYMENT_IDEMPOTENCY_PRECHECK_FAILED") {
        return res.status(503).json({ error: "idempotency_precheck_failed", message: "Could not verify payment idempotency; please retry." });
      }
      log.warn("[paymentStore] /api/payments/charge failed:", msg);
      return res.status(500).json({ error: "charge_failed" });
    }
  });

  app.get("/api/payments/_meta/rates", (_req, res) => {
    res.json({ rates: softCircleRates(), supported: ["USD", "CAD", "GBP", "EUR", "SGD", "HKD", "CNY"] });
  });

  /* v25.32 final — DB-direct read from payment_ledger (+ capavate_subscriptions);
   * never reads from in-memory state */
  /**
   * v25.32 P1h / A4 — GET /api/admin/payments?since=&limit=&offset=&state=
   *
   * A4: enriched with plan + periodEnd + paymentDate. Sourcing (reinforced
   * rule 5): plan/periodEnd parsed INLINE from durable payment_ledger.entry_json,
   * falling back to the durable capavate_subscriptions row (tier_id /
   * current_period_end) keyed on payment_intent_id; paymentDate from the
   * succeeded entry_json.ts else capavate_subscriptions.activated_at. Values are
   * never read from the in-memory `ledger` Map and never synthesized.
   *
   * Unified admin payment-ledger view. Reads ONLY from the durable
   * `payment_ledger` SQLite table (DB-only — no in-memory state). Returns
   * paginated rows with: id, intentId, customerId, amount, currency, state,
   * kind, ts. Auth: /api/admin/* is guarded by requireAdmin in
   * applyRouteGuards.ts, so no per-route middleware is needed here.
   */
  app.get("/api/admin/payments", (req: Request, res: Response) => {
    const since = req.query.since ? String(req.query.since) : undefined;
    const stateFilter = req.query.state ? String(req.query.state) : undefined;
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "100"), 10) || 100, 1), 500);
    const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);

    // v25.32 Item 30 — validate filters BEFORE building SQL parameters. `state`
    // must be one of the known PaymentState enum values; `since` must parse as
    // an ISO date. Reject with 400 rather than silently passing arbitrary
    // strings into the prepared statement.
    // Source the allowed set from the canonical PAYMENT_STATES enum so this
    // validator never drifts from the type.
    const VALID_STATES = new Set<string>(PAYMENT_STATES);
    if (stateFilter !== undefined && !VALID_STATES.has(stateFilter)) {
      return res.status(400).json({ ok: false, error: "invalid_state", message: `state must be one of: ${PAYMENT_STATES.join(", ")}` });
    }
    /* v25.32 burndown — item 30: tighten `since` to a STRICT ISO-8601 prefix
       with CALENDAR-VALID date. Date.parse alone accepts loose locale formats
       and silently normalizes invalid calendar dates like 2026-02-30 to a
       different day. Require an ISO-8601 date (YYYY-MM-DD) optionally followed
       by a time component, THEN sanity-check by re-formatting the parsed
       Date back to YYYY-MM-DD and confirming the y/m/d round-trips.
       Source: paymentStore.ts:373. Additive: rejects malformed input with 400;
       valid ISO is unchanged.

       v25.32.1 hardening (GPT-5.5 verifier): the previous Date.parse-only
       check let 2026-02-30 through because Date.parse rolls it to 2026-03-02.
       Compare the round-trip y/m/d to the input y/m/d to reject it. */
    const ISO_SINCE_RE = /^(\d{4})-(\d{2})-(\d{2})([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;
    if (since !== undefined) {
      const m = ISO_SINCE_RE.exec(since);
      if (!m) {
        return res.status(400).json({ ok: false, error: "invalid_since", message: "since must be an ISO-8601 date (YYYY-MM-DD) or date-time string" });
      }
      const parsed = Date.parse(since);
      if (Number.isNaN(parsed)) {
        return res.status(400).json({ ok: false, error: "invalid_since", message: "since must be an ISO-8601 date (YYYY-MM-DD) or date-time string" });
      }
      // Reject calendar-invalid dates (e.g. 2026-02-30) by comparing the
      // round-tripped y/m/d back to the original capture groups.
      const d = new Date(parsed);
      const yyyy = String(d.getUTCFullYear()).padStart(4, "0");
      const mm   = String(d.getUTCMonth() + 1).padStart(2, "0");
      const dd   = String(d.getUTCDate()).padStart(2, "0");
      if (yyyy !== m[1] || mm !== m[2] || dd !== m[3]) {
        return res.status(400).json({ ok: false, error: "invalid_since", message: "since must be a calendar-valid ISO-8601 date (YYYY-MM-DD)" });
      }
    }

    try {
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (since) { clauses.push("ts >= ?"); params.push(since); }
      if (stateFilter) { clauses.push("state = ?"); params.push(stateFilter); }
      const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

      const totalRow = rawDb()
        .prepare(`SELECT COUNT(*) AS n FROM payment_ledger ${where}`)
        .get(...params) as { n: number };

      const rows = rawDb()
        .prepare(
          `SELECT entry_json FROM payment_ledger ${where} ORDER BY ts DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset) as Array<{ entry_json: string }>;

      // v25.32 A4 — parse entry_json INLINE (not via rowsToEntries, which narrows
      // to the typed PaymentEntry shape and would drop the additive plan/periodEnd
      // keys carried by subscription-charge entries).
      type RawEntry = {
        id?: string; intentId?: string; customerId?: string;
        amountCents?: number; currency?: string; state?: string;
        kind?: string; ts?: string; plan?: string; periodEnd?: string;
      };
      const parsed: RawEntry[] = [];
      for (const r of rows) {
        try { parsed.push(JSON.parse(r.entry_json) as RawEntry); }
        catch (parseErr) {
          log.warn(`[paymentStore] /api/admin/payments: skipping malformed entry_json — ${(parseErr as Error).message}`);
        }
      }

      // v25.32 A4 — durable fallback: capavate_subscriptions rows for the
      // intent_ids on THIS page only (one batched DB-direct query). This is the
      // ONLY source for plan/periodEnd/paymentDate besides entry_json — NEVER the
      // in-memory `ledger` Map (reinforced rule 5).
      const intentIds = Array.from(
        new Set(parsed.map((e) => e.intentId).filter((x): x is string => !!x)),
      );
      const subByIntent = new Map<
        string,
        { tier_id: string; current_period_end: string | null; activated_at: string | null }
      >();
      if (intentIds.length > 0) {
        try {
          const placeholders = intentIds.map(() => "?").join(",");
          const subRows = rawDb()
            .prepare(
              `SELECT payment_intent_id, tier_id, current_period_end, activated_at
                 FROM capavate_subscriptions
                WHERE payment_intent_id IN (${placeholders})`,
            )
            .all(...intentIds) as Array<{
              payment_intent_id: string; tier_id: string;
              current_period_end: string | null; activated_at: string | null;
            }>;
          for (const s of subRows) {
            subByIntent.set(s.payment_intent_id, {
              tier_id: s.tier_id,
              current_period_end: s.current_period_end ?? null,
              activated_at: s.activated_at ?? null,
            });
          }
        } catch (subErr) {
          // capavate_subscriptions is created lazily; absence is non-fatal —
          // entries simply fall back to entry_json-only values.
          log.warn(`[paymentStore] /api/admin/payments: capavate_subscriptions lookup failed (non-fatal) — ${(subErr as Error).message}`);
        }
      }

      const items = parsed.map((e) => {
        const sub = e.intentId ? subByIntent.get(e.intentId) : undefined;
        // No synthesis: null when neither durable source carries the field.
        const plan = e.plan ?? sub?.tier_id ?? null;
        const periodEnd = e.periodEnd ?? sub?.current_period_end ?? null;
        // payment_date: timestamp of the SUCCEEDED payment. Prefer the ledger
        // entry ts when the entry recorded a successful state; else the durable
        // subscription activation time. Null when neither is known.
        const paymentDate =
          e.state === "succeeded" && e.ts ? e.ts : (sub?.activated_at ?? null);
        return {
          id: e.id,
          intentId: e.intentId,
          customerId: e.customerId,
          amount: e.amountCents,
          currency: e.currency,
          state: e.state,
          kind: e.kind,
          ts: e.ts,
          plan,
          periodEnd,
          paymentDate,
        };
      });

      res.json({
        ok: true,
        items,
        total: totalRow?.n ?? items.length,
        limit,
        offset,
      });
    } catch (err) {
      log.warn("[paymentStore] /api/admin/payments query failed:", (err as Error).message);
      res.status(500).json({ ok: false, error: "payments_query_failed" });
    }
  });
}
