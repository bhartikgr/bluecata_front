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
import { Link } from "wouter";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { HelpCircle, ChevronDown, ArrowRight } from "lucide-react";

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

/**
 * v25.45.4 C-1 (choice a) — contextual (?) tooltip that ALSO carries a
 * "Learn more →" deep-link into the founder glossary. Fixes LIVE-10: the bare
 * glossary link was visually ambiguous with no contextual label. Every (?)
 * icon now shows a one-line plain definition on hover/focus and links to the
 * exact glossary term anchor (`/founder/glossary#term-<Term-With-Dashes>`,
 * matching the anchor ids rendered by the founder Glossary page).
 *
 * `glossarySlug` is the glossary anchor WITHOUT the leading `#` (e.g.
 * "term-Team-members"). Pass the same slug the glossary page generates:
 * `term-${term.replace(/\s+/g, "-")}`.
 */
export function HelpTipWithGlossary({
 children,
 glossarySlug,
 side = "top",
 className = "",
 testid,
}: {
 children: ReactNode;
 glossarySlug: string;
 side?: "top" | "right" | "bottom" | "left";
 className?: string;
 testid?: string;
}) {
 return (
 <Tooltip>
 <TooltipTrigger asChild>
 <button
 type="button"
 aria-label="Definition and glossary link"
 className={`inline-flex align-middle text-muted-foreground/80 hover:text-foreground transition-colors ${className}`}
 data-testid={testid}
 >
 <HelpCircle className="h-3.5 w-3.5" />
 </button>
 </TooltipTrigger>
 <TooltipContent side={side} className="max-w-xs text-xs leading-relaxed space-y-1.5">
 <div>{children}</div>
 <Link
 href={`/founder/glossary#${glossarySlug}`}
 className="inline-flex items-center gap-1 font-medium text-[#cc0001] hover:underline"
 data-testid={testid ? `${testid}-learn-more` : undefined}
 >
 Learn more <ArrowRight className="h-3 w-3" />
 </Link>
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
