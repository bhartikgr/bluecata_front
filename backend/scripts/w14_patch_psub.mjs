/**
 * scripts/w14_patch_psub.mjs — WAVE 14 / CP-PROMO-19 + CP-SUB-05.
 *
 * Applies the grandfathered-supersession fix to the LIVE partner checkout
 * writer. Written as a script only because the anchor text contains characters
 * the interactive editor could not transport; the resulting source is reviewed
 * and committed normally. Idempotent: re-running is a no-op.
 */
import fs from "node:fs";

const file = "server/lib/partnerSubscriptionStore.ts";
let src = fs.readFileSync(file, "utf8");
const before = src;

/* 1 — import the shared supersession helper. */
const importAnchor = `import { quotePartnerSubscription } from "./partnerBillingStore";`;
if (!src.includes("supersedeGrandfatheredForInsert")) {
  if (!src.includes(importAnchor)) throw new Error("import anchor not found");
  src = src.replace(
    importAnchor,
    `import {\n  quotePartnerSubscription,\n  supersedeGrandfatheredForInsert,\n} from "./partnerBillingStore";`,
  );
}

/* 2 — carry the flag onto the checkout quote type. */
const quoteTypeAnchor = `  computedVia: "partner_override" | "consortium_pricing_advertised";
}`;
if (!src.includes("supersedesGrandfathered: boolean;")) {
  if (!src.includes(quoteTypeAnchor)) throw new Error("quote type anchor not found");
  src = src.replace(
    quoteTypeAnchor,
    `  computedVia: "partner_override" | "consortium_pricing_advertised";
  /**
   * WAVE 14 / CP-PROMO-19 — does the applied promotion SUPERSEDE a grandfathered
   * free tier? Surfaced on the quote so the charge path can act on it before it
   * mints a payment intent. See the note on SubscriptionQuote in
   * ./partnerBillingStore for why this could not stay inside the other writer.
   */
  supersedesGrandfathered: boolean;
  /** The promotion id behind the discount, or null. */
  promotionId: string | null;
}`,
  );
}

/* 3 — populate it in the one amount producer. */
const producerAnchor = `    computedVia: isOverride ? "partner_override" : "consortium_pricing_advertised",
  };`;
if (!src.includes("supersedesGrandfathered: q.supersedesGrandfathered")) {
  if (!src.includes(producerAnchor)) throw new Error("producer anchor not found");
  src = src.replace(
    producerAnchor,
    `    computedVia: isOverride ? "partner_override" : "consortium_pricing_advertised",
    supersedesGrandfathered: q.supersedesGrandfathered,
    promotionId: q.promotionId,
  };`,
  );
}

/* 4 — THE FIX. Before minting the intent, deal with a grandfathered row. */
const guardAnchor = `  const existingActive = getActiveForSubject(input.subjectKind, input.subjectId);`;
if (!src.includes("PARTNER_SUBSCRIPTION_GRANDFATHERED")) {
  if (!src.includes(guardAnchor)) throw new Error("guard anchor not found");
  src = src.replace(
    guardAnchor,
    `  /* ── WAVE 14 / CP-PROMO-19 — THE SECOND PATH, AND A LIVE MONEY DEFECT. ──
     \`uq_psub_one_live\` (migration 0169) is a partial UNIQUE index over
     status IN ('pending','active','past_due','grace','grandfathered'). But
     \`getActiveForSubject\` below only looks at ('active','grace','past_due'),
     so a partner sitting on a GRANDFATHERED row passed every guard in this
     function, had a payment intent minted, had the sacred pending-subscription
     row written — and only THEN hit a raw SQLITE_CONSTRAINT on the INSERT
     below. The money had moved and no subscription existed.

     Wave 5's supersession logic lived in partnerBillingStore.createSubscription,
     which has NO ROUTE CALLER, so it never ran on this path. Both writers now
     call the same helper.

     Two outcomes, both explicit:
       · the applied promotion supersedes  -> the grandfathered row is moved to
         'superseded' in the SAME transaction as the INSERT (below), so the
         unique index is satisfied and the supersession is auditable;
       · it does not                       -> a 409 the client can render,
         BEFORE any charge, instead of a 500 after one. */
  const grandfathered = getGrandfatheredForSubject(input.subjectKind, input.subjectId);
  if (grandfathered && !quote.supersedesGrandfathered) {
    throw new PartnerCheckoutError(
      "PARTNER_SUBSCRIPTION_GRANDFATHERED",
      "This partner holds a grandfathered plan. Only a promotion marked as superseding a grandfathered tier may replace it; otherwise use the plan-change endpoint.",
      409,
    );
  }

  const existingActive = getActiveForSubject(input.subjectKind, input.subjectId);`,
  );
}

/* 5 — wrap the INSERT + supersession in one transaction. */
const insertAnchor = `  const id = \`psub_\${randomUUID()}\`;
  const ts = nowIso();
  db()
    .prepare(
      \`INSERT INTO partner_subscription`;
if (!src.includes("w14SupersedeThenInsert")) {
  if (!src.includes(insertAnchor)) throw new Error("insert anchor not found");
  src = src.replace(
    insertAnchor,
    `  const id = \`psub_\${randomUUID()}\`;
  const ts = nowIso();
  /* ONE TRANSACTION. The supersession and the insert must be atomic or the
     partial unique index has a window in which the partner has no live row. */
  const w14SupersedeThenInsert = db().transaction(() => {
    if (grandfathered) {
      const supersededId = supersedeGrandfatheredForInsert(db(), input.subjectId, id, ts);
      if (supersededId) {
        appendSubscriptionEvent({
          subscriptionId: supersededId,
          eventKind: "superseded_by_promotion",
          fromStatus: "grandfathered",
          toStatus: "superseded",
          detail: {
            supersededBy: id,
            promotionId: quote.promotionId,
            discountCode: quote.discountCode,
            item: "CP-PROMO-19",
          },
          actor: input.actorUserId,
        });
      }
    }
  db()
    .prepare(
      \`INSERT INTO partner_subscription`,
  );
}

/* 5b — close the transaction wrapper right after the INSERT .run(...) call. */
const runTailAnchor = `      ts,
      input.actorUserId,
    );
  appendSubscriptionEvent({
    subscriptionId: id,
    eventKind: "checkout_started",`;
if (!src.includes("w14SupersedeThenInsert();")) {
  if (!src.includes(runTailAnchor)) throw new Error("run tail anchor not found");
  src = src.replace(
    runTailAnchor,
    `      ts,
      input.actorUserId,
    );
  });
  w14SupersedeThenInsert();
  appendSubscriptionEvent({
    subscriptionId: id,
    eventKind: "checkout_started",`,
  );
}

/* 6 — the lookup the guard needs. Placed beside getActiveForSubject so the two
   status sets are read together and cannot drift apart again unnoticed. */
const lookupAnchor = `export function setStatus(`;
if (!src.includes("export function getGrandfatheredForSubject")) {
  if (!src.includes(lookupAnchor)) throw new Error("lookup anchor not found");
  src = src.replace(
    lookupAnchor,
    `/**
 * WAVE 14 / CP-PROMO-19 — the status \`getActiveForSubject\` deliberately omits.
 *
 * 'grandfathered' is NOT an active paying subscription, so excluding it from
 * \`getActiveForSubject\` is correct. It IS in the \`uq_psub_one_live\` index,
 * because it is an entitlement. That asymmetry is exactly what let a checkout
 * proceed to the gateway and then fail on INSERT. This function makes the
 * missing half of the pair explicit and greppable.
 */
export function getGrandfatheredForSubject(
  subjectKind: SubjectKind,
  subjectId: string,
): PartnerSubscriptionRow | null {
  const r = db()
    .prepare(
      \`SELECT * FROM partner_subscription
        WHERE subject_kind=? AND subject_id=? AND status='grandfathered'
        ORDER BY created_at DESC, id DESC LIMIT 1\`,
    )
    .get(subjectKind, subjectId);
  return r ? mapRow(r) : null;
}

export function setStatus(`,
  );
}

if (src === before) {
  console.log("w14_patch_psub: already applied, no change");
} else {
  fs.writeFileSync(file, src);
  console.log("w14_patch_psub: applied");
}
