/**
 * W-V44 ADMIN CONSOLIDATION — canonical fee hubs.
 *
 * The admin had 12 scattered fee/subscription/commission pages across three
 * product lines, which made it unclear where each "source of truth" lived. This
 * component renders ONE canonical hub per product line (Capavate / Collective /
 * Partner Fees), grouping the existing pages as cards with a plain-language
 * description of (a) what each page controls and (b) where in the FRONT-END that
 * value is displayed.
 *
 * IMPORTANT — nothing is removed. Every underlying page keeps its own route and
 * full functionality; the hub is an additive navigation + documentation layer.
 * The cards deep-link to the existing pages. No functionality is dropped.
 */
import { Link } from "wouter";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowRight } from "lucide-react";

export interface FeeHubEntry {
  href: string;
  title: string;
  /** What this admin page controls (the setting / source of truth). */
  controls: string;
  /** Where in the front-end the configured value is displayed. */
  shownIn: string;
  /** Optional badge, e.g. "Source of truth" or "Reporting". */
  badge?: string;
}

export interface FeeHubProps {
  title: string;
  intro: string;
  breadcrumbLabel: string;
  entries: FeeHubEntry[];
}

export default function FeeHub({ title, intro, breadcrumbLabel, entries }: FeeHubProps) {
  return (
    <>
      <PageHeader
        title={title}
        description={intro}
        breadcrumbs={[{ href: "/admin/dashboard", label: "Admin" }, { label: breadcrumbLabel }]}
      />
      <PageBody>
        <div className="grid gap-3 md:grid-cols-2" data-testid="fee-hub-grid">
          {entries.map((e) => (
            <Link key={e.href} href={e.href} data-testid={`fee-hub-card-${e.href}`}>
              <Card className="h-full cursor-pointer transition hover:border-primary/60 hover:shadow-sm">
                <CardContent className="p-5 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold">{e.title}</h3>
                    <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </div>
                  {e.badge && (
                    <span className="inline-block rounded bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                      {e.badge}
                    </span>
                  )}
                  <p className="text-sm text-muted-foreground">
                    <strong className="text-foreground">Controls:</strong> {e.controls}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    <strong className="text-foreground">Shows in front-end:</strong> {e.shownIn}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </PageBody>
    </>
  );
}

/* ============================================================================
 * The three canonical hubs. Each is a thin wrapper supplying its entries.
 * ==========================================================================*/

export function CapavateFeesHub() {
  return (
    <FeeHub
      title="Capavate Fees"
      breadcrumbLabel="Capavate Fees"
      intro="The single place to manage all Capavate (founder-facing) pricing and payments. Each card is the source of truth for its setting; changes here flow dynamically to the founder-facing app. Nothing is hardcoded."
      entries={[
        {
          href: "/admin/pricing",
          title: "Pricing & Billing",
          badge: "Source of truth",
          controls: "Founder subscription plans/prices and billing configuration for the Capavate product.",
          shownIn: "Founder Billing & Settings pages, and the founder paywall / subscribe flow.",
        },
        {
          href: "/admin/pricing-models",
          title: "Pricing Models",
          controls: "The pricing model definitions (how founder plans are structured/derived).",
          shownIn: "Drives the plan options presented on the founder subscribe / pricing surfaces.",
        },
        {
          href: "/admin/payments",
          title: "Payments",
          badge: "Reporting",
          controls: "Founder payment records and payment status (via the payment gateway).",
          shownIn: "Founder Billing history; underpins receipts and paid-status gating.",
        },
      ]}
    />
  );
}

export function CollectiveFeesHub() {
  return (
    <FeeHub
      title="Collective Fees"
      breadcrumbLabel="Collective Fees"
      intro="The single place to manage all Collective (member-facing) fees, subscriptions, and their reporting. Each card is the source of truth for its setting; changes flow dynamically to the Collective member surfaces. Nothing is hardcoded."
      entries={[
        {
          href: "/admin/application-fee",
          title: "Application Fee",
          badge: "Source of truth",
          controls: "The one-time Collective membership application fee amount.",
          shownIn: "The Collective application / apply-to-join flow checkout.",
        },
        {
          href: "/admin/platform-fees",
          title: "Platform Fees",
          badge: "Source of truth",
          controls: "Collective platform fee configuration applied to members.",
          shownIn: "Collective member billing and any platform-fee line items shown to members.",
        },
        {
          href: "/admin/collective-subscriptions",
          title: "Collective Subscriptions",
          badge: "Source of truth",
          controls: "Collective member subscription packages / tiers and their prices.",
          shownIn: "The Collective member subscribe page and membership pricing displays.",
        },
        {
          href: "/admin/collective-payment-schedules",
          title: "Payment Schedules",
          controls: "Scheduled Collective payments / installment configuration.",
          shownIn: "Member payment schedule displays and upcoming-charge messaging.",
        },
        {
          href: "/admin/collective-payment-pl",
          title: "Collective P&L",
          badge: "Reporting",
          controls: "Aggregated Collective revenue/cost reporting (read-only ledger view).",
          shownIn: "Internal reporting only — not shown to members.",
        },
      ]}
    />
  );
}

export function PartnerFeesHub() {
  return (
    <FeeHub
      title="Partner Fees"
      breadcrumbLabel="Partner Fees"
      intro="The single place to manage all Consortium Partner pricing, commissions, and reporting. The BASE subscription price per tier (e.g. Catalyst = $499/mo) is set on 'Partner Subscription Tiers' (Platform Fees -> Consortium tab) and is the source of truth the public pricing page + partner dashboard read. Per-partner overrides (individual discounts, seat allowances) are set on each partner's detail page. Commission % is set on Commission Rates. Everything is DB-driven and dynamic; nothing is hardcoded."
      entries={[
        {
          href: "/admin/platform-fees",
          title: "Partner Subscription Tiers (Catalyst/Builder/…)",
          badge: "Source of truth",
          controls: "The BASE monthly subscription price for each partner tier (Catalyst, Builder, Amplifier, Nexus, Founding Member). Edited on the 'Consortium' tab. This is where e.g. the Catalyst $499/mo price lives — fully DB-driven and admin-editable.",
          shownIn: "Public /consortium/pricing page (advertised == charged) AND the partner dashboard 'Your subscription' + billing tier quote.",
        },
        {
          href: "/admin/partner-fees",
          title: "Partner Fee Schedules (overrides + SPV fees)",
          badge: "Overrides",
          controls: "Optional fee OVERRIDES per tier or platform default (e.g. discounts) + SPV deployment fees. These only OVERRIDE the base tier price above; per-partner discounts are set on the partner's detail page.",
          shownIn: "A partner's own checkout when an override applies (public /consortium/pricing stays tier-based).",
        },
        {
          href: "/admin/commission-rates",
          title: "Commission Rates",
          badge: "Source of truth",
          controls: "Per-tier commission % (catalyst 2%, builder 3%, etc.). Commission ONLY — the subscription price lives on Partner Subscription Tiers above.",
          shownIn: "Partner dashboard 'Plan & quota' commission line and commission calculations.",
        },
        {
          href: "/admin/partner-pl",
          title: "Partner P&L",
          badge: "Reporting",
          controls: "Aggregated partner commission/subscription revenue reporting (read-only).",
          shownIn: "Internal reporting only — not shown to partners.",
        },
      ]}
    />
  );
}
