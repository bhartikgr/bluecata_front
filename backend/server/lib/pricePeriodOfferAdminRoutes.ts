// server/lib/pricePeriodOfferAdminRoutes.ts
//
// WAVE 202 · ITEMS A + B · R178.1 / R178.2 — THE ADMIN DOOR.
//
// TWO ROUTES, MOUNTED UNDER /api/admin (the router-level requireAdmin gate in
// routes.ts protects every endpoint here, exactly as it does for
// partnerFeeAdminRoutes.ts):
//
//   GET  /api/admin/price-clarity
//        Every price the platform holds, in plain language, with its audience, its
//        period, its live state and the frontend screens it appears on. Read-only.
//
//   PUT  /api/admin/price-period-offer/:scopeKey
//        The owner's per-price choice: annual, monthly, or both. Optionally an
//        annual amount for a price that has none. Attributed to a named actor.
//
// WHY THE WRITER IS ADMIN-ONLY AND THE PUBLIC ROUTE IS NOT
//   Wave 188 kept its writer admin-only and wave 199 added a read-only public door
//   because the surfaces that must obey the policy include ones a prospective buyer
//   sees before they belong to anything. That split is preserved: nothing here is
//   readable or writable without admin, and the public route
//   (GET /api/price-display-policy) remains read-only.
//
// NOTHING HERE DECIDES A CHARGE
//   These routes write a DISPLAY fact. `monthly_purchasable` /
//   `annual_purchasable` continue to govern what may be bought, and no charge path
//   reads `price_period_offer` (R159.3).
//
// NO LITERAL PRICE, CURRENCY OR CADENCE (R156.2). No arithmetic on money (R156.1).
// Absence is `null` and is tested as `null` (R176.1).
//
// RULING: R178.1, R178.2, R156.1, R156.2, R176.1, R159.3, R158.1.

import type { Express, Request, Response } from "express";
import { appendAdminAudit } from "../adminPlatformStore";
import { buildPriceClarityReport } from "./priceClarity";
import { resolvePricePeriodOffer, writePricePeriodOffer } from "./pricePeriodOffer";

/**
 * The acting administrator, for attribution. R158.1: a value whose origin cannot be
 * read is not configured, so an unattributable write is REFUSED by the store rather
 * than stored anonymously.
 */
function actorOf(req: Request): string {
  const u = (req as unknown as { user?: { id?: string; email?: string } }).user;
  const id = typeof u?.id === "string" ? u.id.trim() : "";
  if (id.length > 0) return id;
  const email = typeof u?.email === "string" ? u.email.trim() : "";
  return email;
}

/** A body flag, read strictly. A missing flag is `false`, never "whatever it was". */
function boolOf(v: unknown): boolean {
  return v === true;
}

/**
 * An amount from an HTTP body. `null`/absent means UNSET and is returned as `null`
 * — it is never coerced to 0 (R143.4) and never compared to 0 to decide whether it
 * is present (R176.1). A non-number is returned as the sentinel `undefined` so the
 * caller can refuse rather than silently treat it as unset.
 */
function amountOf(v: unknown): number | null | undefined {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return v;
  return undefined;
}

export function registerPricePeriodOfferAdminRoutes(app: Express): void {
  app.get("/api/admin/price-clarity", (_req: Request, res: Response) => {
    /* Built from the database on every request. No cache, so the screen cannot
       describe a price the platform no longer holds. */
    res.json({ ok: true, report: buildPriceClarityReport() });
  });

  app.get(
    "/api/admin/price-period-offer/:scopeKey",
    (req: Request, res: Response) => {
      const scopeKey = String(req.params.scopeKey ?? "");
      res.json({ ok: true, offer: resolvePricePeriodOffer(scopeKey) });
    },
  );

  app.put(
    "/api/admin/price-period-offer/:scopeKey",
    (req: Request, res: Response) => {
      const scopeKey = String(req.params.scopeKey ?? "");
      const body = (req.body ?? {}) as Record<string, unknown>;

      const amount = amountOf(body.annualAmountMinor);
      if (amount === undefined) {
        return res.status(400).json({
          ok: false,
          message:
            "The annual price must be a number of cents, or left empty. Nothing was changed.",
        });
      }

      const result = writePricePeriodOffer({
        scopeKey,
        annualOffered: boolOf(body.annualOffered),
        monthlyOffered: boolOf(body.monthlyOffered),
        annualAmountMinor: amount,
        annualCurrency:
          typeof body.annualCurrency === "string" ? body.annualCurrency : null,
        updatedBy: actorOf(req),
        notes: typeof body.notes === "string" ? body.notes : null,
      });

      if (!result.ok) {
        /* The store's refusal is already inside the 240-character gate, so it
           reaches the screen instead of being replaced by "something went wrong". */
        return res.status(400).json({ ok: false, message: result.refusal });
      }

      /* A pricing-display decision is an owner decision, so it is auditable. The
         audit records the CHOICE, never a derived figure. Best-effort: an audit
         failure must not undo a saved choice. */
      try {
        appendAdminAudit(actorOf(req), scopeKey, "price_period_offer.set", {
          annualOffered: result.offer.annualOffered,
          monthlyOffered: result.offer.monthlyOffered,
          annualDerivation: result.offer.annualDerivation,
          annualCurrency: result.offer.annualCurrency,
          /* The amount is recorded as-is; it is not converted or derived. */
          annualAmountMinor: result.offer.annualAmountMinor,
        });
      } catch {
        /* Deliberately swallowed. See above. */
      }

      res.json({ ok: true, offer: result.offer });
    },
  );
}
