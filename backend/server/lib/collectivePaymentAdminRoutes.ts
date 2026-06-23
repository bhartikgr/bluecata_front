/* v25.34 Collective Payment Model — DB-driven, no in-memory.
 *
 * Admin CRUD for the parallel Collective payment system:
 *   - collective_payment_schedules (the fee catalogue: member / tier / platform)
 *   - collective_payment_entries  (the resolved/charged ledger)
 *   - collective_invoices         (entry groupings)
 *
 * Every read and write hits SQLite via rawDb(); nothing is cached in process
 * memory. All amounts/currencies are supplied by the admin and stored in the DB
 * — there are NO hardcoded fee amounts here. Mounted under /api/admin (the
 * router-level requireAdmin gate in routes.ts protects every endpoint).
 *
 * This is PARALLEL and ADDITIVE to v25.33's partnerFeeAdminRoutes. It does NOT
 * touch collectiveBillingStore.ts (SACRED) or Avi's payment write paths.
 */
import type { Express, Request, Response } from "express";
import crypto from "crypto";
import { rawDb } from "../db/connection";
import { appendAdminAudit } from "../adminPlatformStore";
import { sanitizeErrorMessage } from "./sanitize";

const FEE_KINDS = new Set([
  "membership_dues",
  "event_fee",
  "sponsorship_fee",
  "chapter_dues",
  "late_fee",
]);
const SCOPE_KINDS = new Set(["member", "tier", "platform"]);
const TIERS = new Set(["basic", "standard", "premium"]);
const CADENCES = new Set(["one_time", "monthly", "annual", "quarterly"]);

function actorOf(req: Request): string {
  const ctx = (req as any).userContext;
  return String(ctx?.identity?.email ?? ctx?.userId ?? "admin");
}

function nowIso(): string {
  return new Date().toISOString();
}

export function registerCollectivePaymentAdminRoutes(app: Express): void {
  /* ---- List the Collective fee catalogue (optionally filtered) ---- */
  app.get("/api/admin/collective-payments/schedules", (req: Request, res: Response) => {
    const feeKind = String(req.query.feeKind || "");
    const scopeKind = String(req.query.scopeKind || "");
    const includeExpired = String(req.query.includeExpired || "") === "true";
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (feeKind) { clauses.push("fee_kind = ?"); params.push(feeKind); }
    if (scopeKind) { clauses.push("scope_kind = ?"); params.push(scopeKind); }
    if (!includeExpired) { clauses.push("(effective_to IS NULL OR effective_to > ?)"); params.push(nowIso()); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = rawDb()
      .prepare(`SELECT * FROM collective_payment_schedules ${where} ORDER BY fee_kind, scope_kind, effective_from DESC`)
      .all(...params);
    res.json({ ok: true, schedules: rows, total: (rows as unknown[]).length });
  });

  /* ---- Create a new Collective fee schedule row ---- */
  app.post("/api/admin/collective-payments/schedules", (req: Request, res: Response) => {
    const b = req.body as {
      scopeKind?: string; memberId?: string | null; tier?: string | null; chapterId?: string | null;
      feeKind?: string; amountMinor?: number; currency?: string; cadence?: string;
      effectiveFrom?: string; effectiveTo?: string | null;
    };
    if (!b?.feeKind || !FEE_KINDS.has(b.feeKind)) return res.status(400).json({ ok: false, error: "bad_fee_kind" });
    const scopeKind = b.scopeKind && SCOPE_KINDS.has(b.scopeKind) ? b.scopeKind : "platform";
    if (typeof b.amountMinor !== "number" || !Number.isInteger(b.amountMinor) || b.amountMinor < 0) {
      return res.status(400).json({ ok: false, error: "amountMinor must be a non-negative integer (minor units)" });
    }
    if (scopeKind === "member" && !b.memberId) return res.status(400).json({ ok: false, error: "memberId required for scope_kind=member" });
    if (scopeKind === "tier" && (!b.tier || !TIERS.has(b.tier))) return res.status(400).json({ ok: false, error: "valid tier required for scope_kind=tier" });
    const id = `cps_${crypto.randomBytes(6).toString("hex")}`;
    const now = nowIso();
    const memberId = scopeKind === "member" ? b.memberId! : null;
    const tier = scopeKind === "tier" ? b.tier! : null;
    const chapterId = b.chapterId && typeof b.chapterId === "string" ? b.chapterId : null;
    const currency = b.currency && typeof b.currency === "string" ? b.currency : "USD";
    const cadence = b.cadence && CADENCES.has(b.cadence) ? b.cadence : "one_time";
    const effFrom = b.effectiveFrom && typeof b.effectiveFrom === "string" ? b.effectiveFrom : now;
    const effTo = b.effectiveTo && typeof b.effectiveTo === "string" ? b.effectiveTo : null;
    // v25.34 (CONCERN 5): NULL-aware duplicate pre-check. SQLite treats NULLs as
    // DISTINCT in UNIQUE indexes, so a UNIQUE on the scope columns does NOT block
    // duplicate platform-default rows (member_id/tier/chapter_id all NULL). Guard
    // at the app layer by matching the same scope+fee_kind+effective_from using
    // SQLite's null-safe `IS` operator (which compares NULLs as equal). All
    // values are parameter-bound.
    const dup = rawDb().prepare(
      `SELECT id FROM collective_payment_schedules
        WHERE scope_kind = ?
          AND fee_kind = ?
          AND effective_from = ?
          AND member_id IS ?
          AND tier IS ?
          AND chapter_id IS ?
        LIMIT 1`,
    ).get(scopeKind, b.feeKind, effFrom, memberId, tier, chapterId) as { id: string } | undefined;
    if (dup) {
      return res.status(409).json({ ok: false, error: "duplicate_schedule", message: "A schedule for this scope/fee-kind/effective-from already exists.", existingId: dup.id });
    }
    try {
      rawDb().prepare(
        `INSERT INTO collective_payment_schedules
          (id, scope_kind, member_id, tier, chapter_id, fee_kind, amount_minor, currency, cadence, effective_from, effective_to, created_at, updated_at, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, scopeKind, memberId, tier, chapterId, b.feeKind, b.amountMinor, currency, cadence, effFrom, effTo, now, now, actorOf(req));
    } catch (err) {
      const msg = (err as Error).message || "";
      if (/UNIQUE/i.test(msg)) return res.status(409).json({ ok: false, error: "duplicate_schedule", message: "A schedule for this scope/fee-kind/window already exists." });
      return res.status(500).json({ ok: false, error: "insert_failed", message: sanitizeErrorMessage(err) });
    }
    appendAdminAudit(actorOf(req), `collective_payment_schedule:${id}`, "collective_payment_schedule.created", { id, ...b });
    res.json({ ok: true, id });
  });

  /* ---- Update an existing schedule row ---- */
  app.patch("/api/admin/collective-payments/schedules/:id", (req: Request, res: Response) => {
    const id = req.params.id;
    const existing = rawDb().prepare(`SELECT * FROM collective_payment_schedules WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
    if (!existing) return res.status(404).json({ ok: false, error: "not_found" });
    const b = req.body as {
      amountMinor?: number; currency?: string; cadence?: string;
      effectiveFrom?: string; effectiveTo?: string | null;
    };
    if (b.amountMinor !== undefined && (!Number.isInteger(b.amountMinor) || b.amountMinor < 0)) {
      return res.status(400).json({ ok: false, error: "amountMinor must be a non-negative integer (minor units)" });
    }
    if (b.cadence !== undefined && !CADENCES.has(b.cadence)) return res.status(400).json({ ok: false, error: "bad_cadence" });
    const next = {
      amount_minor: b.amountMinor !== undefined ? b.amountMinor : existing.amount_minor,
      currency: b.currency !== undefined ? b.currency : existing.currency,
      cadence: b.cadence !== undefined ? b.cadence : existing.cadence,
      effective_from: b.effectiveFrom !== undefined ? b.effectiveFrom : existing.effective_from,
      effective_to: b.effectiveTo !== undefined ? b.effectiveTo : existing.effective_to,
    };
    /* v25.34 fix-2 — NULL-aware duplicate pre-check on PATCH path, matching
     * the POST guard. Without this, an admin could rename effective_from on
     * a row and silently create a second row that collides with another
     * existing row on (scope_kind, member_id, tier, chapter_id, fee_kind,
     * effective_from) — SQLite's UNIQUE treats NULLs as distinct so the
     * database itself won't reject it. Returns 409 with existingId. */
    if (b.effectiveFrom !== undefined && b.effectiveFrom !== existing.effective_from) {
      const dup = rawDb().prepare(
        `SELECT id FROM collective_payment_schedules
           WHERE id <> ?
             AND scope_kind = ?
             AND member_id IS ?
             AND tier IS ?
             AND chapter_id IS ?
             AND fee_kind = ?
             AND effective_from = ?`
      ).get(
        id,
        existing.scope_kind,
        existing.member_id ?? null,
        existing.tier ?? null,
        existing.chapter_id ?? null,
        existing.fee_kind,
        next.effective_from,
      ) as { id: string } | undefined;
      if (dup) {
        return res.status(409).json({ ok: false, error: "duplicate_schedule", existingId: dup.id });
      }
    }
    rawDb().prepare(
      `UPDATE collective_payment_schedules
         SET amount_minor = ?, currency = ?, cadence = ?, effective_from = ?, effective_to = ?, updated_at = ?
       WHERE id = ?`
    ).run(next.amount_minor, next.currency, next.cadence, next.effective_from, next.effective_to, nowIso(), id);
    appendAdminAudit(actorOf(req), `collective_payment_schedule:${id}`, "collective_payment_schedule.updated", { id, ...b });
    res.json({ ok: true });
  });

  /* ---- Expire (soft-delete) a schedule by setting effective_to = now ---- */
  app.delete("/api/admin/collective-payments/schedules/:id", (req: Request, res: Response) => {
    const id = req.params.id;
    const existing = rawDb().prepare(`SELECT id FROM collective_payment_schedules WHERE id = ?`).get(id);
    if (!existing) return res.status(404).json({ ok: false, error: "not_found" });
    rawDb().prepare(`UPDATE collective_payment_schedules SET effective_to = ?, updated_at = ? WHERE id = ?`).run(nowIso(), nowIso(), id);
    appendAdminAudit(actorOf(req), `collective_payment_schedule:${id}`, "collective_payment_schedule.expired", { id });
    res.json({ ok: true });
  });

  /* ---- Collective P&L: aggregate collective_payment_entries by member + kind,
   *      grouped by currency (multi-currency aware, unlike v25.33's admin PL). ---- */
  app.get("/api/admin/collective-payments/pl", (req: Request, res: Response) => {
    const memberId = String(req.query.memberId || "");
    const status = String(req.query.status || "");
    const entryKind = String(req.query.entryKind || "");
    const clauses: string[] = ["deleted_at IS NULL"];
    const params: unknown[] = [];
    if (memberId) { clauses.push("member_id = ?"); params.push(memberId); }
    if (status && status !== "all") { clauses.push("status = ?"); params.push(status); }
    if (entryKind) { clauses.push("entry_kind = ?"); params.push(entryKind); }
    const where = `WHERE ${clauses.join(" AND ")}`;
    const entries = rawDb()
      .prepare(`SELECT id, member_id AS memberId, chapter_id AS chapterId, entry_kind AS entryKind,
                       amount_minor AS amountMinor, currency, status, schedule_id AS scheduleId,
                       invoice_id AS invoiceId, computed_via AS computedVia, description, period,
                       created_at AS createdAt, paid_at AS paidAt
                FROM collective_payment_entries ${where} ORDER BY created_at DESC`)
      .all(...params) as any[];
    // Multi-currency totals by status, grouped by currency.
    const byCurrency: Record<string, { pending: number; paid: number; invoiced: number; all: number }> = {};
    for (const e of entries) {
      const cur = e.currency || "USD";
      const bucket = byCurrency[cur] || (byCurrency[cur] = { pending: 0, paid: 0, invoiced: 0, all: 0 });
      const amt = e.amountMinor || 0;
      bucket.all += amt;
      if (e.status === "paid") bucket.paid += amt;
      else if (e.status === "invoiced") bucket.invoiced += amt;
      else if (e.status === "pending") bucket.pending += amt;
    }
    res.json({ ok: true, entries, byCurrency, total: entries.length });
  });

  /* ---- Mark a Collective payment entry as paid (manual reconciliation) ---- */
  app.post("/api/admin/collective-payments/pl/:entryId/mark-paid", (req: Request, res: Response) => {
    const entryId = req.params.entryId;
    const existing = rawDb().prepare(`SELECT id, status FROM collective_payment_entries WHERE id = ?`).get(entryId) as { id: string; status: string } | undefined;
    if (!existing) return res.status(404).json({ ok: false, error: "not_found" });
    if (existing.status === "paid") return res.json({ ok: true, alreadyPaid: true });
    rawDb().prepare(`UPDATE collective_payment_entries SET status = 'paid', paid_at = ?, updated_at = ? WHERE id = ?`).run(nowIso(), nowIso(), entryId);
    appendAdminAudit(actorOf(req), `collective_payment_entry:${entryId}`, "collective_payment_entry.marked_paid", { entryId });
    res.json({ ok: true });
  });

  /* ---- Create a ledger entry for a member (admin-driven; quote-only model so
   *      this records an owed amount, it does NOT charge a card). ---- */
  app.post("/api/admin/collective-payments/entries", (req: Request, res: Response) => {
    const b = req.body as {
      memberId?: string; chapterId?: string | null; entryKind?: string;
      amountMinor?: number; currency?: string; description?: string; period?: string;
      scheduleId?: string | null; computedVia?: string | null;
      idempotencyKey?: string | null; idempotency_key?: string | null;
    };
    if (!b?.memberId) return res.status(400).json({ ok: false, error: "memberId_required" });
    if (b.entryKind && !FEE_KINDS.has(b.entryKind)) return res.status(400).json({ ok: false, error: "bad_entry_kind" });
    if (typeof b.amountMinor !== "number" || !Number.isInteger(b.amountMinor) || b.amountMinor < 0) {
      return res.status(400).json({ ok: false, error: "amountMinor must be a non-negative integer (minor units)" });
    }
    // v25.34 (CONCERN 4): optional idempotency_key. Accept either camelCase or
    // snake_case from the client. When supplied, a retry / double-click must NOT
    // create a second cpe_* row — we return the existing one instead.
    const rawIdem = b.idempotencyKey ?? b.idempotency_key ?? null;
    const idempotencyKey = typeof rawIdem === "string" && rawIdem.trim().length > 0 ? rawIdem.trim() : null;
    if (idempotencyKey) {
      // Pre-check: if a row with this key already exists, return it (200 OK).
      const existing = rawDb()
        .prepare(`SELECT id FROM collective_payment_entries WHERE idempotency_key = ?`)
        .get(idempotencyKey) as { id: string } | undefined;
      if (existing) {
        return res.json({ ok: true, id: existing.id, idempotent: true });
      }
    }
    const id = `cpe_${crypto.randomBytes(6).toString("hex")}`;
    const now = nowIso();
    try {
      rawDb().prepare(
        `INSERT INTO collective_payment_entries
          (id, tenant_id, member_id, chapter_id, entry_kind, amount_minor, currency, status, schedule_id, computed_via, description, period, idempotency_key, created_at, updated_at)
         VALUES (?, 'tenant_platform', ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id, b.memberId, b.chapterId ?? null, b.entryKind ?? "membership_dues", b.amountMinor,
        b.currency || "USD", b.scheduleId ?? null, b.computedVia ?? null, b.description ?? null, b.period ?? null, idempotencyKey, now, now,
      );
    } catch (err) {
      // v25.34 (CONCERN 4): if the UNIQUE(idempotency_key) constraint tripped on
      // a concurrent insert, treat it as idempotent and return the winning row.
      const msg = (err as Error).message || "";
      if (idempotencyKey && /UNIQUE/i.test(msg)) {
        const existing = rawDb()
          .prepare(`SELECT id FROM collective_payment_entries WHERE idempotency_key = ?`)
          .get(idempotencyKey) as { id: string } | undefined;
        if (existing) return res.json({ ok: true, id: existing.id, idempotent: true });
      }
      return res.status(500).json({ ok: false, error: "insert_failed", message: sanitizeErrorMessage(err) });
    }
    appendAdminAudit(actorOf(req), `collective_payment_entry:${id}`, "collective_payment_entry.created", { id, ...b });
    res.json({ ok: true, id });
  });

  /* ---- List invoices (optionally by member/status) ---- */
  app.get("/api/admin/collective-payments/invoices", (req: Request, res: Response) => {
    const memberId = String(req.query.memberId || "");
    const status = String(req.query.status || "");
    const clauses: string[] = ["deleted_at IS NULL"];
    const params: unknown[] = [];
    if (memberId) { clauses.push("member_id = ?"); params.push(memberId); }
    if (status && status !== "all") { clauses.push("status = ?"); params.push(status); }
    const rows = rawDb()
      .prepare(`SELECT * FROM collective_invoices WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`)
      .all(...params);
    res.json({ ok: true, invoices: rows, total: (rows as unknown[]).length });
  });
}
