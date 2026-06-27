import io

path = "server/paymentGatewayAdapter.ts"
with io.open(path, "r", encoding="utf-8") as f:
    src = f.read()

anchor = """  app.post("/api/webhooks/payment-gateway/stripe", (req: Request, res: Response) => {
    handleGatewayWebhook("stripe", req, res);
  });

  /**
   * POST /api/webhooks/payment-gateway
   * Idempotent on (intentId, type). Routes events to stores.
   */"""

assert src.count(anchor) == 1, f"anchor count = {src.count(anchor)}"

insert = '''  app.post("/api/webhooks/payment-gateway/stripe", (req: Request, res: Response) => {
    handleGatewayWebhook("stripe", req, res);
  });

  /**
   * v25.45 Bug A - CLIENT-RETURN RECONCILIATION (webhook-independent unlock).
   *
   * POST /api/founder/subscription/reconcile  { paymentIntentId }
   *
   * Root cause of "card charged but platform not unlocked": activation was
   * SOLELY driven by the asynchronous Airwallex payment_intent.succeeded
   * webhook (see handleGatewayWebhook). When that webhook lags or fails
   * (signature mismatch, endpoint unreachable, transient network, or just
   * arrives after the client poll window), the local capavate_subscriptions
   * row stays pending forever and RequireActiveSubscription keeps the founder
   * on the paywall even though Airwallex captured the payment.
   *
   * This endpoint gives the client return-URL path (BillingReturn.tsx) an
   * authoritative way to finalize WITHOUT waiting on the webhook:
   *   1. Resolve the pending row by paymentIntentId (DB-direct, ownership-checked).
   *   2. Ask Airwallex for the AUTHORITATIVE intent status via
   *      retrievePaymentIntent(id) (lib/airwallexGateway.ts).
   *   3. If SUCCEEDED, run the SAME atomic finalize the webhook uses
   *      (getDb().transaction + finalizeWebhookSuccessInTx): activate the row,
   *      set current_period_end, insert the idempotent payment_ledger row, and
   *      create the invoice. Idempotent on the intent_id, so a later webhook
   *      (or a second reconcile) is a safe no-op.
   *
   * This NEVER modifies the webhook (which already works) and writes to the DB
   * only - no in-memory shortcuts. It does not touch any AVI Tier-2 file.
   */
  app.post("/api/founder/subscription/reconcile", requireAuth, async (req: Request, res: Response) => {
    try {
      const ctx = await getUserContext(req);
      if (!ctx?.isAuthed) return res.status(401).json({ ok: false, error: "unauthenticated" });

      const paymentIntentId = String(req.body?.paymentIntentId ?? "").trim();
      if (!paymentIntentId) {
        return res.status(400).json({ ok: false, error: "missing_paymentIntentId" });
      }

      // Resolve the local pending/active row (DB-direct via subscriptionStore).
      const capSub = getCapSubByPaymentIntent(paymentIntentId);
      if (!capSub) return res.status(404).json({ ok: false, error: "not_found" });

      // Tenant isolation: only the owning founder (or an admin) may reconcile.
      if (!ctx.isAdmin && capSub.userId !== ctx.userId) {
        return res.status(403).json({ ok: false, error: "not_owner" });
      }

      // Already finalized by the webhook (or a prior reconcile) - idempotent OK.
      if (capSub.status === "active") {
        return res.json({ ok: true, status: "active", companyId: capSub.companyId, reconciled: false });
      }

      // Ask Airwallex for the AUTHORITATIVE intent status. In stub mode this
      // deterministically returns SUCCEEDED; in test/live it hits the real API.
      const { retrievePaymentIntent } = await import("./lib/airwallexGateway");
      let intentStatus: string;
      try {
        const intent = await retrievePaymentIntent(paymentIntentId);
        intentStatus = String(intent?.status ?? "").trim().toUpperCase();
      } catch (e) {
        log.warn("[reconcile] retrievePaymentIntent failed:", (e as Error).message);
        return res.status(502).json({ ok: false, error: "gateway_unreachable", message: "Could not verify payment status with Airwallex. Please retry." });
      }

      if (intentStatus !== "SUCCEEDED") {
        // Not paid (yet). Report the current local status so the client keeps
        // polling; do NOT activate on anything but an authoritative SUCCEEDED.
        return res.json({ ok: true, status: capSub.status, companyId: capSub.companyId, reconciled: false, gatewayStatus: intentStatus });
      }

      // Authoritative SUCCEEDED - run the SAME atomic finalize the webhook uses.
      // Claim a reconcile-scoped idempotency key inside the transaction so a
      // concurrent webhook for the same intent cannot double-finalize; both the
      // ledger insert (ON CONFLICT intent_id DO NOTHING) and the claim make this
      // safe and repeatable.
      const merchantOrderId = capSub.merchantOrderId ?? null;
      const reconcileKey = webhookKey(paymentIntentId, "reconcile.succeeded");
      const pendingBillingEvents: Array<Record<string, unknown>> = [];
      let didFinalize = false;
      try {
        getDb().transaction((tx: any) => {
          // If a webhook already finalized this intent, the activation will be a
          // no-op (status already active); the claim just prevents duplicate
          // billing events from THIS path.
          const claimed = _claimWebhookKey(reconcileKey);
          if (!claimed) return; // another reconcile already ran

          const activated = activateCapSub(paymentIntentId);
          if (activated) {
            pendingBillingEvents.push({
              kind: "subscription.activated",
              paymentIntentId: activated.paymentIntentId,
              companyId: activated.companyId,
              tierId: activated.tierId,
              userId: activated.userId,
              gateway: "airwallex",
            });
          }
          finalizeWebhookSuccessInTx(tx, { intentId: paymentIntentId, companyId: merchantOrderId, gateway: "airwallex" });
          didFinalize = true;
        });
      } catch (txErr) {
        log.warn("[reconcile] finalize transaction rolled back:", (txErr as Error).message);
        return res.status(500).json({ ok: false, error: "reconcile_finalize_failed" });
      }

      // Emit billing events AFTER commit (post-transaction side-effects).
      for (const evt of pendingBillingEvents) {
        try { emitBillingEvent(evt as any); } catch (e) { log.warn("[reconcile] emitBillingEvent failed:", (e as Error).message); }
      }

      // Re-read the now-finalized row DB-direct for the response.
      const finalRow = getCapSubByPaymentIntent(paymentIntentId);
      return res.json({
        ok: true,
        status: finalRow?.status ?? "active",
        companyId: finalRow?.companyId ?? capSub.companyId,
        currentPeriodEnd: finalRow?.currentPeriodEnd ?? null,
        reconciled: didFinalize,
      });
    } catch (err) {
      log.error("[reconcile] unexpected error:", (err as Error).message);
      return res.status(500).json({ ok: false, error: "server_error" });
    }
  });

  /**
   * POST /api/webhooks/payment-gateway
   * Idempotent on (intentId, type). Routes events to stores.
   */'''

src = src.replace(anchor, insert)
with io.open(path, "w", encoding="utf-8") as f:
    f.write(src)
print("inserted reconcile endpoint OK")
