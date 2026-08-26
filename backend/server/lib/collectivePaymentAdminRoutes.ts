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
import { decimalStringToMinor } from "./money"; /* WAVE 158 · R119 — no parseFloat on money */

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
  return String(ctx?.identity?.email ?? ctx?.userId ?? "u_unknown_admin");
}

function nowIso(): string {
  return new Date().toISOString();
}

/* ── WAVE 57d · D4 — FAIL-CLOSED ACTOR FOR THE DESTRUCTIVE ROUTE ───────────────
   Same defect and same narrow remedy as server/lib/partnerFeeAdminRoutes.ts:
   `actorOf()` above falls back to the literal `"u_unknown_admin"`, and
   `DELETE /api/admin/collective-payments/schedules/:id` expires a COLLECTIVE FEE
   SCHEDULE — the exact analogue of the partner fee-schedule expiry that
   independent Review 1 named as destructive and financially material. Wave 57c
   had it in the "24 non-destructive" set.

   The resolver preserves `actorOf`'s ordering (`identity.email`, then `userId`)
   so the recorded value for every legitimate call is byte-identical to today; it
   refuses only the case that used to be recorded as `u_unknown_admin`.
   `requireAdmin` on the `/api/admin` prefix always assigns `req.userContext`, so
   the 401 is unreachable under today's mounts. Only the DELETE route is changed;
   switching the shared helper is the sweeping option and is left as a
   recommendation for the authorised 57e sweep. */
function requireActorOrRefuse(req: Request, res: Response): string | null {
  const ctx = (req as any).userContext;
  const actor = String(ctx?.identity?.email ?? ctx?.userId ?? "");
  if (!actor) {
    res.status(401).json({ ok: false, error: "missing_identity", code: "missing_identity" });
    return null;
  }
  return actor;
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
      /* WAVE 158 · R119 — see the block below. */
      amountMajor?: string;
      intentionalZero?: boolean;
      intentionalZeroReason?: string;
    };
    if (!b?.feeKind || !FEE_KINDS.has(b.feeKind)) return res.status(400).json({ ok: false, error: "bad_fee_kind" });
    const scopeKind = b.scopeKind && SCOPE_KINDS.has(b.scopeKind) ? b.scopeKind : "platform";

    /* ══ WAVE 158 · R119 — A BLANK AMOUNT IS REFUSED, NEVER READ AS ZERO ═════
       The client used to do `parseFloat(form.amountMajor || "0")`, so submitting
       the form with the amount box untouched created a real, audited $0.00 price
       and reported "Schedule created". That is the likely origin of the five
       $0.00 rows verified live under R120.4.

       Two things change here, both refusals — no existing caller loses a
       capability:
         1. `amountMajor` (a DECIMAL STRING) is now accepted and scaled by
            `decimalStringToMinor` from server/lib/money.ts, which is ISO-4217
            exponent-aware: JPY/KRW (0-decimal) and BHD/KWD (3-decimal) are handled
            correctly and half-units are REJECTED rather than rounded. The old
            integer `amountMinor` contract still works, unchanged, for every
            existing caller.
         2. A ZERO price must be DELIBERATE: `intentionalZero` with a written
            reason. An unflagged zero is refused rather than stored, because a
            zero nobody attested to is indistinguishable from a blank box. */
    const currencyForScale =
      b.currency && typeof b.currency === "string" ? b.currency.toUpperCase() : "USD";
    let amountMinor: number;
    if (typeof b.amountMajor === "string") {
      const typed = b.amountMajor.trim();
      if (typed === "") {
        return res.status(400).json({
          ok: false,
          error: "amount_required",
          message:
            "Enter the amount for this schedule. It was left blank, so nothing was created — a blank amount is not read as zero. If this fee really is free, say so with the free-of-charge option and write why.",
        });
      }
      try {
        const scaled = decimalStringToMinor(typed, currencyForScale, "amount");
        /* `BigInt(0)`, not `0n`: this tree's tsconfig target is below ES2020 and a
           bigint LITERAL is a type error there (TS2737). */
        if (scaled < BigInt(0)) {
          return res.status(400).json({
            ok: false,
            error: "amount_negative",
            message: "The amount cannot be negative. Nothing was created.",
          });
        }
        amountMinor = Number(scaled);
        if (!Number.isSafeInteger(amountMinor)) {
          return res.status(400).json({
            ok: false,
            error: "amount_too_large",
            message: "That amount is too large to store. Nothing was created.",
          });
        }
      } catch (err) {
        const code = (err as Error).message || "";
        return res.status(400).json({
          ok: false,
          error: "amount_invalid",
          message: /PRECISION_UNSUPPORTED/.test(code)
            ? `That amount has more decimal places than ${currencyForScale} uses, and it will not be rounded for you. Nothing was created.`
            : "That amount could not be read as a number. Enter it in the usual way, for example 1500 or 1500.00. Nothing was created.",
        });
      }
    } else if (typeof b.amountMinor === "number" && Number.isInteger(b.amountMinor) && b.amountMinor >= 0) {
      amountMinor = b.amountMinor;
    } else {
      return res.status(400).json({ ok: false, error: "amountMinor must be a non-negative integer (minor units)" });
    }

    const zeroReason = String(b.intentionalZeroReason ?? "").trim();
    const zeroAttested = b.intentionalZero === true && zeroReason.length > 0;
    if (amountMinor === 0 && !zeroAttested) {
      return res.status(400).json({
        ok: false,
        error: "zero_not_attested",
        message:
          "A price of zero has to be deliberate. Tick the free-of-charge option and write why this fee is free, or enter an amount. Nothing was created.",
      });
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
      /* The four intentional-zero columns arrived in wave 152 (migration 0200 /
         applyWave152PricingSchema). They are written only when the table actually
         has them, because an older database that has not run that migration must
         still be able to create a PRICED schedule — it simply cannot record an
         attested zero, and the refusal above is what protects it. */
      const cols = rawDb()
        .prepare(`PRAGMA table_info(collective_payment_schedules)`)
        .all() as { name: string }[];
      const hasZeroFlags = cols.some((c) => String(c.name) === "intentional_zero");
      if (hasZeroFlags) {
        rawDb().prepare(
          `INSERT INTO collective_payment_schedules
            (id, scope_kind, member_id, tier, chapter_id, fee_kind, amount_minor, currency, cadence, effective_from, effective_to, created_at, updated_at, created_by,
             intentional_zero, intentional_zero_reason, intentional_zero_by, intentional_zero_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          id, scopeKind, memberId, tier, chapterId, b.feeKind, amountMinor, currency, cadence, effFrom, effTo, now, now, actorOf(req),
          zeroAttested ? 1 : 0,
          zeroAttested ? zeroReason : null,
          zeroAttested ? actorOf(req) : null,
          zeroAttested ? now : null,
        );
      } else {
        rawDb().prepare(
          `INSERT INTO collective_payment_schedules
            (id, scope_kind, member_id, tier, chapter_id, fee_kind, amount_minor, currency, cadence, effective_from, effective_to, created_at, updated_at, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(id, scopeKind, memberId, tier, chapterId, b.feeKind, amountMinor, currency, cadence, effFrom, effTo, now, now, actorOf(req));
      }
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
    /* ══ WAVE 159 · R126.1 / R120.3 — THE PATCH DOOR WAVE 158 LEFT OPEN ═══════
       Wave 158 hardened the CREATE path (blank refused, zero must be attested with
       a reason) and left this one validating only "non-negative integer". The
       independent review proved with live HTTP that the SHIPPING Edit control on
       `AdminFeesConsolidated.tsx` could therefore:

         · `PATCH {"amountMinor":0}` -> 200, minting a FRESH UNATTESTED ZERO price
           after wave 158 shipped, straight past `zero_not_attested`;
         · rewrite `10000` to `999999` IN PLACE, row count unchanged — the price a
           member was recorded as being charged, silently replaced, with no
           superseding row and nothing left to reconstruct the old one from.

       R120.3 exists to forbid exactly the second one. The owner's instruction is
       that an admin must NEVER be able to change what a member was recorded as
       being charged, and that refusal with clear guidance is preferred to inventing
       a new supersede-on-PATCH mechanism.

       So: this route no longer writes `amount_minor` AT ALL. A price is superseded,
       never overwritten — end the current schedule (which keeps it on the record,
       `effective_to`) and create a new one at the new price. That is the model the
       UI already offers, and it leaves the charge history intact.

       Note the checks below are deliberately free of `Number()`/`parseFloat` on the
       money value: presence is tested by key, zero by strict equality, and a typed
       major string by regex. Coercing the very field we are refusing would be the
       original defect in miniature. */
    const hasAmountMinorKey = Object.prototype.hasOwnProperty.call(req.body ?? {}, "amountMinor");
    const hasAmountMajorKey = Object.prototype.hasOwnProperty.call(req.body ?? {}, "amountMajor");
    if (hasAmountMinorKey || hasAmountMajorKey) {
      const rawMinor = (req.body as Record<string, unknown>).amountMinor;
      const rawMajor = (req.body as Record<string, unknown>).amountMajor;

      /* 1 — a blank or missing amount is REFUSED, never coerced to zero. This is
             the same rule as the create path (R119); it must not be weaker here. */
      const minorBlank =
        hasAmountMinorKey &&
        (rawMinor === null || rawMinor === undefined || (typeof rawMinor === "string" && rawMinor.trim() === ""));
      const majorBlank =
        hasAmountMajorKey &&
        (rawMajor === null || rawMajor === undefined || (typeof rawMajor === "string" && String(rawMajor).trim() === ""));
      if (minorBlank || majorBlank) {
        return res.status(400).json({
          ok: false,
          error: "amount_required",
          message:
            "No amount was entered, and a blank amount is never read as zero. Nothing was changed. Leave the amount alone to edit only the cadence or the dates.",
        });
      }

      /* 2 — a zero is REFUSED here outright. Making something free is a decision
             that has to be recorded with a reason, and that only exists on the
             create path. Naming that route is the whole point of R77. */
      const isZeroMinor = rawMinor === 0;
      const isZeroMajor = typeof rawMajor === "string" && /^\s*[+-]?0+(?:\.0+)?\s*$/.test(rawMajor);
      if (isZeroMinor || isZeroMajor) {
        return res.status(400).json({
          ok: false,
          error: "zero_not_attested",
          message:
            "A price cannot be set to zero by editing an existing schedule. Nothing was changed. If this fee really is free, end this schedule and create a new one marked free of charge, where the reason is recorded permanently.",
        });
      }

      /* 3 — any other amount is an IN-PLACE REWRITE OF HISTORY. Refused, with the
             route that does the right thing named in plain words. */
      return res.status(400).json({
        ok: false,
        error: "amount_change_refused",
        message:
          "The amount on a schedule cannot be changed. Nothing was changed. Prices are superseded, not overwritten: end this schedule, then create a new one at the new amount. What a member was already recorded as being charged stays on the record.",
      });
    }

    /* A currency change silently reinterprets the recorded amount (the same 250000
       is $2,500.00 or ¥250,000), so it belongs to the same refusal. A no-op repeat
       of the stored code is fine. */
    if (b.currency !== undefined && String(b.currency).toUpperCase() !== String(existing.currency ?? "").toUpperCase()) {
      return res.status(400).json({
        ok: false,
        error: "currency_change_refused",
        message:
          "The currency on a schedule cannot be changed, because it changes what the recorded amount means. Nothing was changed. End this schedule and create a new one in the correct currency.",
      });
    }
    if (b.cadence !== undefined && !CADENCES.has(b.cadence)) return res.status(400).json({ ok: false, error: "bad_cadence" });
    const next = {
      /* W159 — `amount_minor` is NOT in this object and NOT in the UPDATE below.
         There is no code path from this route to a written amount. */
      currency: existing.currency,
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
         SET cadence = ?, effective_from = ?, effective_to = ?, updated_at = ?
       WHERE id = ?`
    ).run(next.cadence, next.effective_from, next.effective_to, nowIso(), id);
    appendAdminAudit(actorOf(req), `collective_payment_schedule:${id}`, "collective_payment_schedule.updated", { id, ...b });
    res.json({ ok: true });
  });

  /* ---- Expire (soft-delete) a schedule by setting effective_to = now ---- */
  app.delete("/api/admin/collective-payments/schedules/:id", (req: Request, res: Response) => {
    const id = req.params.id;
    const existing = rawDb().prepare(`SELECT id FROM collective_payment_schedules WHERE id = ?`).get(id);
    if (!existing) return res.status(404).json({ ok: false, error: "not_found" });
    /* WAVE 57d D4 — bound actor, fail closed BEFORE the expiry write. */
    const expireActorId = requireActorOrRefuse(req, res);
    if (!expireActorId) return;
    rawDb().prepare(`UPDATE collective_payment_schedules SET effective_to = ?, updated_at = ? WHERE id = ?`).run(nowIso(), nowIso(), id);
    appendAdminAudit(expireActorId, `collective_payment_schedule:${id}`, "collective_payment_schedule.expired", { id });
    /* WAVE 158 · R120.2 — say what actually happened. This route sets
       `effective_to` and nothing else; there is no DELETE statement against
       `collective_payment_schedules` anywhere in the server. The old UI called it
       an undoable deletion, which was inaccurate about the data. */
    res.json({
      ok: true,
      message:
        "The schedule has ended. The record is kept for history — it is not deleted — and it simply stops applying to new charges from now on.",
    });
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
