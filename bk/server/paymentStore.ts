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

/** Write-through to durable `payment_ledger` table. */
function persistPaymentEntry(entry: PaymentEntry): void {
  try {
    rawDb().prepare(
      `INSERT INTO payment_ledger (id, intent_id, customer_id, state, entry_json, ts)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         state = excluded.state,
         entry_json = excluded.entry_json`,
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
  const existingId = intentIndex.get(input.intentId);
  if (existingId) {
    const existing = ledger.get(existingId)!;
    return { entry: existing, deduped: true };
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

export function listPayments(filter?: { customerId?: string }): PaymentEntry[] {
  const all = Array.from(ledger.values()).sort((a, b) => b.ts.localeCompare(a.ts));
  return filter?.customerId ? all.filter((p) => p.customerId === filter.customerId) : all;
}

export function getPayment(id: string): PaymentEntry | undefined { return ledger.get(id); }

/** Soft-circle 7-currency display: convert amounts. Demo rates only. */
export function softCircleRates(): Record<string, number> {
  return { USD: 1, CAD: 1.35, GBP: 0.79, EUR: 0.92, SGD: 1.35, HKD: 7.81, CNY: 7.27 };
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
    const r = chargeOrIdempotent(parsed.data);
    res.status(r.deduped ? 200 : 201).json(r.entry);
  });

  app.get("/api/payments/_meta/rates", (_req, res) => {
    res.json({ rates: softCircleRates(), supported: ["USD", "CAD", "GBP", "EUR", "SGD", "HKD", "CNY"] });
  });
}
