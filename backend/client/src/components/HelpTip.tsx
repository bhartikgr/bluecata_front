/**
 * Sprint 4 — early-stage-friendly help affordances.
 *
 * `HelpTip` — small (?) icon next to a label that reveals a one-line plain
 * definition on hover. Use for short hovers (Tooltip).
 * `LearnMore` — collapsible disclosure for longer explanations with worked
 * examples + watch-outs. Use under cards / inputs.
 *
 * Voice rules: short, plain, jargon-free, never condescending.
 */
import type { ReactNode } from "react";
import { useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpCircle, ChevronDown } from "lucide-react";

export function HelpTip({
 children,
 side = "top",
 className = "",
 testid,
}: {
 children: ReactNode;
 side?: "top" | "right" | "bottom" | "left";
 className?: string;
 testid?: string;
}) {
 return (
 <Tooltip>
 <TooltipTrigger asChild>
 <button
 type="button"
 tabIndex={-1}
 aria-label="Definition"
 className={`inline-flex align-middle text-muted-foreground/80 hover:text-foreground transition-colors ${className}`}
 data-testid={testid}
 >
 <HelpCircle className="h-3.5 w-3.5" />
 </button>
 </TooltipTrigger>
 <TooltipContent side={side} className="max-w-xs text-xs leading-relaxed">
 {children}
 </TooltipContent>
 </Tooltip>
 );
}

/** Inline label that bundles a Label + adjacent (?) tooltip — common pattern. */
export function LabelWithTip({
 children,
 tip,
 className = "",
}: {
 children: ReactNode;
 tip: ReactNode;
 className?: string;
}) {
 return (
 <span className={`inline-flex items-center gap-1.5 ${className}`}>
 {children}
 <HelpTip>{tip}</HelpTip>
 </span>
 );
}

export function LearnMore({
 label = "Learn more",
 children,
 defaultOpen = false,
 testid,
}: {
 label?: string;
 children: ReactNode;
 defaultOpen?: boolean;
 testid?: string;
}) {
 const [open, setOpen] = useState(defaultOpen);
 return (
 <div className="mt-2" data-testid={testid}>
 <button
 type="button"
 onClick={(e) => {
 e.stopPropagation();
 setOpen((o) => !o);
 }}
 className="inline-flex items-center gap-1 text-[11px] font-medium text-[hsl(0_100%_40%)] hover:underline"
 >
 <ChevronDown className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} />
 {label}
 </button>
 {open && (
 <div className="mt-2 text-xs text-muted-foreground leading-relaxed border-l-2 border-[hsl(0_100%_40%)]/30 pl-3 space-y-2">
 {children}
 </div>
 )}
 </div>
 );
}
