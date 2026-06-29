/**
 * v25.45.4 — Canonical plan resolver (B-2 / H-1 / M-1 single-source-of-truth fix).
 *
 * ROOT CAUSE (live QA, June 27, 2026):
 *   The founder plan badge (top-bar), company switcher, rounds plan-gate, and
 *   in-wizard "Go to Subscribe" CTA all read `billing.plan` off
 *   /api/founder/companies + /api/founder/active-company. Those routes projected
 *   billing via multiCompanyStore.mergeBillingFromSubscription, which called the
 *   LEGACY subscriptionsStore.getSubscription() (the old `subscriptions` table).
 *   The CANONICAL hosted-checkout state lives in `capavate_subscriptions`
 *   (subscriptionStore.ts, plural rows per company, active-row-wins) and is what
 *   the authoritative GET /api/founder/subscription projects via
 *   paymentGatewayAdapter.projectCanonicalSubscription. The two sources diverged:
 *   canonical said founder_pro/active, legacy said founder_free — so every badge
 *   read "FREE" for a paid founder.
 *
 * FIX: this module is the ONE canonical plan-tier projection. Both
 *   paymentGatewayAdapter.projectCanonicalSubscription AND
 *   multiCompanyStore.mergeBillingFromSubscription now resolve the founder plan
 *   tier from `capavate_subscriptions` through here, so all four surfaces agree.
 *
 * It deliberately has NO dependency on multiCompanyStore or paymentGatewayAdapter
 * to avoid the circular-import bugs that have bitten this tree before. It depends
 * only on subscriptionStore (canonical row reader) + pricingTiersStore (tier->slug).
 */
import { listForCompany, type CapavateSubscription } from "../subscriptionStore";
import * as pricingTiers from "../pricingTiersStore";
import { log } from "./logger";

export type CanonicalPlanSlug =
  | "founder_free"
  | "founder_pro"
  | "founder_scale"
  | "founder_enterprise";

export type CanonicalPlanStatus = "active" | "past_due" | "pending_payment";

export interface CanonicalPlanResult {
  plan: CanonicalPlanSlug;
  status: CanonicalPlanStatus;
  /** The chosen capavate_subscriptions row, for callers that want more detail. */
  chosen: CapavateSubscription;
}

/**
 * Resolve the canonical plan + status for a company directly from
 * `capavate_subscriptions`. Most-recent ACTIVE row wins; otherwise the
 * most-recently-created row. Returns null when the company has no canonical
 * subscription rows at all (true free / legacy company) — callers must then
 * fall back to whatever legacy default they used before (Founder Free).
 *
 * Tier 8 #60 — robust against the known live DB shape: 28+ pending rows + one
 * active row. The active-wins sort guarantees the active plan is chosen even
 * when buried under many pending rows (this is exactly the bug that produced a
 * stale "FREE" badge for a paid founder).
 */
export function resolveCanonicalPlan(companyId: string): CanonicalPlanResult | null {
  if (!companyId) return null;
  let rows: CapavateSubscription[];
  try {
    rows = listForCompany(companyId); // DB-direct over capavate_subscriptions
  } catch (err) {
    log.warn("[canonicalPlanResolver] canonical read failed:", (err as Error).message);
    return null;
  }
  if (!rows.length) return null;

  const byNewest = (a: CapavateSubscription, b: CapavateSubscription) =>
    (b.activatedAt ?? b.createdAt).localeCompare(a.activatedAt ?? a.createdAt);
  const active = rows.filter((r) => r.status === "active").sort(byNewest);
  const chosen = active[0] ?? [...rows].sort(byNewest)[0];
  if (!chosen) return null;

  let plan: CanonicalPlanSlug = "founder_pro";
  try {
    const tier = pricingTiers.getById(chosen.tierId);
    const slug = (tier?.id ?? chosen.tierId ?? "").toLowerCase();
    if (slug.includes("free")) plan = "founder_free";
    else if (slug.includes("scale")) plan = "founder_scale";
    else if (slug.includes("enter")) plan = "founder_enterprise";
    else plan = "founder_pro";
  } catch {
    /* default plan */
  }

  const status: CanonicalPlanStatus =
    chosen.status === "active" ? "active"
    : chosen.status === "failed" ? "past_due"
    : "pending_payment";

  return { plan, status, chosen };
}

/** Map a canonical plan slug to the human "Founder X" label used by the
 *  legacy FounderCompanyMembership.billing.plan field + the top-bar badge. */
export function planSlugToLabel(
  slug: CanonicalPlanSlug,
): "Founder Free" | "Founder Pro" | "Founder Scale" {
  switch (slug) {
    case "founder_pro":
      return "Founder Pro";
    case "founder_scale":
      return "Founder Scale";
    case "founder_enterprise":
      return "Founder Scale"; // legacy 3-label shape collapses enterprise->scale
    case "founder_free":
    default:
      return "Founder Free";
  }
}
