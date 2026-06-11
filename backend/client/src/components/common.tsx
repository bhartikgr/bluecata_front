import { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
 icon: Icon,
 title,
 description,
 action,
}: {
 icon: LucideIcon;
 title: string;
 description?: string;
 action?: { label: string; onClick: () => void; testid?: string };
}) {
 return (
 <div className="flex flex-col items-center justify-center text-center py-16 px-6 border border-dashed border-border rounded-lg bg-card/40">
 <div className="h-12 w-12 rounded-full bg-secondary flex items-center justify-center mb-4">
 <Icon className="h-6 w-6 text-muted-foreground" />
 </div>
 <h3 className="text-base font-semibold mb-1">{title}</h3>
 {description && <p className="text-sm text-muted-foreground max-w-md mb-4">{description}</p>}
 {action && (
 <Button onClick={action.onClick} data-testid={action.testid}>{action.label}</Button>
 )}
 </div>
 );
}

const STATE_COLORS: Record<string, string> = {
 // invitation
 pending: "bg-amber-100 text-amber-900 border-amber-300/50",
 viewed: "bg-blue-100 text-blue-900 border-blue-300/50",
 accepted: "bg-emerald-100 text-emerald-900 border-emerald-300/50",
 declined: "bg-rose-100 text-rose-900 border-rose-300/50",
 expired: "bg-zinc-200 text-zinc-700 border-zinc-300/50",
 revoked: "bg-zinc-300 text-zinc-800 border-zinc-400/50",
 // Sprint 10: Your Decision 10-state machine
 soft_circled: "bg-cyan-100 text-cyan-900 border-cyan-300/50",
 signed: "bg-emerald-100 text-emerald-900 border-emerald-300/50",
 funded: "bg-emerald-200 text-emerald-900 border-emerald-400/50",
 // round
 draft: "bg-zinc-200 text-zinc-700 border-zinc-300/50",
 terms_set: "bg-violet-100 text-violet-900 border-violet-300/50",
 soft_circle_open: "bg-cyan-100 text-cyan-900 border-cyan-300/50",
 signing_open: "bg-emerald-100 text-emerald-900 border-emerald-300/50",
 closed: "bg-zinc-300 text-zinc-800 border-zinc-400/50",
 // soft circle
 intent: "bg-amber-100 text-amber-900 border-amber-300/50",
 confirmed: "bg-blue-100 text-blue-900 border-blue-300/50",
 // v24.4.2 Bug H — "wired" is the funded-but-not-yet-committed state
 wired: "bg-violet-100 text-violet-900 border-violet-300/50",
 committed: "bg-emerald-100 text-emerald-900 border-emerald-300/50",
 // crm
 active: "bg-emerald-100 text-emerald-900 border-emerald-300/50",
 invited: "bg-blue-100 text-blue-900 border-blue-300/50",
 // report
 sent: "bg-emerald-100 text-emerald-900 border-emerald-300/50",
};

export function StateBadge({ state }: { state: string }) {
 const cls = STATE_COLORS[state] ?? "bg-zinc-200 text-zinc-700 border-zinc-300/50";
 const label = state.replace(/_/g, " ");
 return (
 <Badge variant="outline" className={cn("font-medium border capitalize text-[11px]", cls)}>
 {label}
 </Badge>
 );
}

export function Stat({
 label,
 value,
 hint,
 trend,
 icon: Icon,
 testid,
}: {
 label: string;
 value: ReactNode;
 hint?: string;
 trend?: "up" | "down" | "flat";
 icon?: LucideIcon;
 testid?: string;
}) {
 return (
 <div className="rounded-lg border border-card-border bg-card p-4 flex flex-col gap-1" data-testid={testid}>
 <div className="flex items-center justify-between">
 <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
 {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
 </div>
 <div className="text-2xl font-semibold tracking-tight">{value}</div>
 {hint && (
 <div className={cn(
 "text-xs",
 trend === "up" && "text-emerald-700 ",
 trend === "down" && "text-rose-700 ",
 (!trend || trend === "flat") && "text-muted-foreground",
 )}>{hint}</div>
 )}
 </div>
 );
}
