/**
 * client/src/components/comms/InvestorReachabilityNotice.tsx
 *
 * WAVE 190 · ITEM E — DISCLOSE THAT INVESTORS ARE REACHABLE.
 *
 * WHAT WAVE 185 FOUND. An investor can open a direct message with ANY other
 * investor by raw id. `canDM` (`server/messagingPolicy.ts`, "Mode A") allows
 * investor-to-investor direct messages unconditionally; the protection is that
 * the other party's NAME IS MASKED until there is a relationship, not that
 * contact is refused. Pre-existing behaviour, not introduced by wave 185, and now
 * asserted in a test as known design
 * (`server/__tests__/wave185_itemE_illegitimate_reach_attempts.test.ts`).
 *
 * THE OWNER'S DECISION, TAKEN UNDER DELEGATION: LEAVE THE BEHAVIOUR, ADD THE
 * DISCLOSURE. The reasoning, recorded here because it is the load-bearing part:
 * an investor network whose members can reach each other is a legitimate product,
 * and global practice is that reachability is a STATED feature rather than a
 * surprise. Refusing unconnected direct messages would be a materially larger
 * behaviour change to make while the owner is away — it would silently break
 * introductions that members may already rely on. The defect is therefore not
 * that members are reachable; it is that nobody told them.
 *
 * ══ THIS COMPONENT CHANGES NO REACH. ══
 * It renders text. It calls no API, sends no message, reads no policy and gates
 * nothing. `canDM`, `messagingPolicy.ts`, `messagingStore.ts` (SACRED) and every
 * masking rule are untouched, so exactly the same people are reachable before and
 * after this wave. That is asserted by a negative control.
 *
 * ══ WHY A NEW FILE RATHER THAN EDITING `MessagingAudienceNotice.tsx`. ══
 * R143.1: literals stay byte-verbatim and new copy is APPENDED as a static
 * sibling. Wrapping or renaming the existing notice would rewrite every
 * `at=MessagingAudienceNotice:…` positional ancestor path in the guard's panel
 * inventory, which the drop detector reads as removals. A new sibling component
 * adds paths and removes none.
 *
 * MONEY. No amount, no fee, no currency, no arithmetic.
 */
import { Users } from "lucide-react";

export function InvestorReachabilityNotice({ className }: { className?: string }) {
  return (
    <div
      className={`flex items-start gap-2 px-2 py-1.5 rounded bg-muted/50 border border-border text-[11px] text-muted-foreground ${className ?? ""}`}
      data-testid="investor-reachability-notice"
    >
      <Users className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <span>
        Other members of this network can start a conversation with you here, and you can start one with
        them. Your name stays private until you and the other member have a relationship on Capavate &mdash;
        until then each of you sees the other as an anonymous member. Nothing you have not sent is shared.
      </span>
    </div>
  );
}

export default InvestorReachabilityNotice;
