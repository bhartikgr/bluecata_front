/**
 * server/lib/wave190PaymentGatewayRoutes.ts
 *
 * WAVE 190 · ITEM D · R157.2 — ONE READ-ONLY ROUTE FOR THE GATEWAY TRUTH SURFACE.
 *
 * Mirrors `GET /api/admin/bridge/mode` (`server/lib/wave15Routes.ts:291`), which
 * R157.4 names as the pattern to copy: admin-gated, GET only, returns the
 * disclosure object and nothing else.
 *
 * A SEPARATE FILE RATHER THAN A LINE IN `wave15Routes.ts`, deliberately: four
 * waves are live in this tree and `wave15Routes.ts` sits next to the Collective
 * bridge surfaces that wave 187 is moving. A new file cannot collide with another
 * wave's edit, and it keeps the payment-gateway surface findable.
 *
 * ══ NO CREDENTIAL VALUE CAN LEAVE THROUGH THIS ROUTE. ══
 * The handler serialises exactly what `paymentGatewayDisclosure()` returns, and
 * that object has no field capable of carrying a value — see that module's
 * header. The handler adds nothing of its own, reads no environment variable
 * itself, and its error path returns a fixed string rather than the caught error,
 * so a thrown message cannot become an exfiltration path either.
 *
 * READ-ONLY. GET only. No POST, PATCH or DELETE is registered here, so this
 * surface cannot change gateway configuration even by accident. No charge is
 * created and no gateway is contacted.
 */
import type { Express, Request, Response } from "express";
import { requireAdmin } from "./authMiddleware";
import { log } from "./logger";
import { paymentGatewayDisclosure } from "./wave190PaymentGatewayDisclosure";

export function registerWave190PaymentGatewayRoutes(app: Express): void {
  /* ══ ITEM D — payment-gateway PRESENCE disclosure (read-only) ═══════════ */
  app.get("/api/admin/payment-gateway/disclosure", requireAdmin, (_req: Request, res: Response) => {
    try {
      res.json({ ok: true, disclosure: paymentGatewayDisclosure() });
    } catch (err) {
      /* The caught error is logged, NOT returned. `paymentGatewayDisclosure`
         never puts a credential in an error, but returning a caught message to a
         client on a route about credentials is a habit worth not having. */
      log.error(`[w190-gateway-routes] disclosure failed: ${String(err)}`);
      res.status(500).json({ ok: false, error: "PAYMENT_GATEWAY_DISCLOSURE_UNAVAILABLE" });
    }
  });
}
