/**
 * Sprint 14 D3 — Auto-tier badge (Pattern 11).
 *
 * Watch / Qualified / Featured / Priority — driven by engagement score on
 * a contact card. Color via `tierColors` design token.
 */
import { tierColors, type Tier } from "@/lib/design-tokens";

export function AutoTierBadge({ tier, testId }: { tier: Tier; testId?: string }) {
  const label = tier.charAt(0).toUpperCase() + tier.slice(1);
  const bg = tierColors[tier];
  return (
    <span
      data-testid={testId ?? `auto-tier-${tier}`}
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
      style={{ background: bg }}
      aria-label={`Auto-tier: ${label}`}
    >
      {label}
    </span>
  );
}
