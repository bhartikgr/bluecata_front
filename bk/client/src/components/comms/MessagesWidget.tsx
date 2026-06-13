import { asArray } from "@/lib/safeArray";
/**
 * Sprint 9 — Messages-from-Shareholders dashboard widget.
 *
 * Mirrors the live capavate.com pattern:
 * - Header: "Messages from Shareholders" + refresh icon
 * - Filter tabs: All / ★ Starred (count) / ↓ Newest
 * - Thread list with avatar + resolved-name + role badge + timestamp + unread
 * - "View All Messages" CTA
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { MessageSquare, Star, ArrowDownNarrowWide, RefreshCw, ArrowUpRight, Lock, Users2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { queryClient } from "@/lib/queryClient";
import { timeAgo } from "@/lib/format";
import { ANONYMOUS_LABEL } from "@/lib/comms/visibility";

type ChannelView = {
 id: string;
 kind: "dm" | "cap_table" | "soft_circle" | "company_followers" | "network";
 displayTitle: string;
 displaySubtitle: string;
 lastMessage?: { id: string; preview: string; senderLabel: string; ts: string };
 unread: number;
 starred: boolean;
 kindBadge: string;
 participantUserIds: string[];
};

type Filter = "all" | "starred" | "newest";

export function MessagesWidget({ basePath }: { basePath: "/founder/messages" | "/investor/messages" }) {
 const [filter, setFilter] = useState<Filter>("all");
 const [, navigate] = useLocation();
 const channels = useQuery<ChannelView[]>({ queryKey: ["/api/comms/channels"] });
 // Sprint 20 Wave 2 — role-derived title (defect 51)
 const isInvestor = basePath === "/investor/messages";
 const widgetTitle = isInvestor ? "Messages from founders" : "Messages from cap-table members";

 const visible = useMemo(() => {
 const data = channels.data ?? [];
 // Hide network + company_followers — those go to the posts feed.
 const conv = data.filter((c) => c.kind !== "network" && c.kind !== "company_followers");
 if (filter === "starred") return conv.filter((c) => c.starred);
 return [...conv].sort((a, b) => (b.lastMessage?.ts ?? "").localeCompare(a.lastMessage?.ts ?? ""));
 }, [channels.data, filter]);

 const starredCount = asArray(channels.data).filter((c) => c.starred).length;
 const totalUnread = visible.reduce((s, c) => s + (c.unread ?? 0), 0);

 return (
 <Card data-testid="widget-messages">
 <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
 <div className="flex items-center gap-2 min-w-0">
 <MessageSquare className="h-4 w-4 text-[hsl(184_98%_22%)] shrink-0" />
 {/* Sprint 20 Wave 2 — role-aware title (defect 51) */}
 <CardTitle className="text-base truncate">{widgetTitle}</CardTitle>
 {totalUnread > 0 && (
 <Badge className="h-4 px-1.5 text-[10px] bg-[hsl(var(--highlight))]" data-testid="badge-total-unread">
 {totalUnread}
 </Badge>
 )}
 </div>
 <Button
 variant="ghost"
 size="icon"
 className="h-7 w-7"
 onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/comms/channels"] })}
 aria-label="Refresh"
 data-testid="button-refresh-messages"
 >
 <RefreshCw className="h-3.5 w-3.5" />
 </Button>
 </CardHeader>
 <CardContent className="space-y-3">
 {/* Filter tabs */}
 <div className="flex items-center gap-1 text-xs border-b border-border pb-2">
 <FilterChip active={filter === "all"} onClick={() => setFilter("all")} label="All" testid="filter-all" />
 <FilterChip
 active={filter === "starred"}
 onClick={() => setFilter("starred")}
 label={
 <span className="inline-flex items-center gap-1">
 <Star className="h-3 w-3" /> Starred
 <span className="text-muted-foreground">({starredCount})</span>
 </span>
 }
 testid="filter-starred"
 />
 <FilterChip
 active={filter === "newest"}
 onClick={() => setFilter("newest")}
 label={
 <span className="inline-flex items-center gap-1">
 <ArrowDownNarrowWide className="h-3 w-3" /> Newest
 </span>
 }
 testid="filter-newest"
 />
 </div>

 {/* Thread list */}
 {channels.isLoading && <Skeleton className="h-24 w-full" />}
 {!channels.isLoading && visible.length === 0 && (
 <div className="text-sm text-muted-foreground py-6 text-center">
 No conversations yet.
 </div>
 )}
 <ul className="-mx-3 divide-y divide-border/60">
 {visible.slice(0, 5).map((ch) => {
 const senderLabel = ch.lastMessage?.senderLabel ?? "(no messages)";
 const isAnon = senderLabel === ANONYMOUS_LABEL;
 const initials = isAnon ? "??" : senderLabel.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
 return (
 <li key={ch.id}>
 <button
     type="button"
     onClick={() => {
       // Sprint 20 Wave 2 — removed duplicate ?channel= param (defect 52)
       navigate(`${basePath}?thread=${encodeURIComponent(ch.id)}`);
     }}
     className="w-full text-left px-3 py-2.5 hover-elevate flex items-start gap-3"
     data-testid={`thread-preview-${ch.id}`}
   >
 <Avatar className="h-9 w-9 shrink-0">
 <AvatarFallback className={`text-xs ${isAnon ? "bg-muted text-muted-foreground" : "bg-secondary"}`}>
 {isAnon ? <Lock className="h-3.5 w-3.5" /> : initials}
 </AvatarFallback>
 </Avatar>
 <div className="flex-1 min-w-0">
 <div className="flex items-center justify-between gap-2">
 <span className={`text-sm font-medium truncate ${isAnon ? "italic text-muted-foreground" : ""}`}>
 {ch.kind === "dm" ? ch.displayTitle : senderLabel + " in " + ch.displayTitle}
 </span>
 <span className="text-[10px] text-muted-foreground whitespace-nowrap">
 {ch.lastMessage ? timeAgo(ch.lastMessage.ts) : timeAgo(ch.kindBadge)}
 </span>
 </div>
 <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
 <ChannelKindBadge kind={ch.kind} />
 {ch.starred && <Star className="h-3 w-3 fill-amber-400 stroke-amber-500" />}
 {ch.unread > 0 && (
 <Badge className="h-4 px-1.5 text-[10px] bg-[hsl(var(--highlight))]">
 {ch.unread}
 </Badge>
 )}
 </div>
 <p className="text-xs text-muted-foreground truncate mt-1">
 {ch.lastMessage?.preview ?? "No messages yet."}
 </p>
 </div>
 </button>
              </li>
 );
 })}
 </ul>
 <div className="pt-2">
 {/* Sprint 20 Wave 2 — use ?sort=recent (defect 53) */}
 <Link href={`${basePath}?sort=recent`}>
 <Button variant="outline" size="sm" className="w-full" data-testid="button-view-all-messages">
 <Users2 className="h-3.5 w-3.5 mr-2" /> View all messages
 <ArrowUpRight className="h-3 w-3 ml-1" />
 </Button>
 </Link>
 </div>
 </CardContent>
 </Card>
 );
}

function FilterChip({
 active, onClick, label, testid,
}: { active: boolean; onClick: () => void; label: React.ReactNode; testid: string }) {
 return (
 <button
 onClick={onClick}
 data-testid={testid}
 className={`px-2 py-1 rounded-md transition-colors ${
 active ? "bg-secondary text-foreground font-medium" : "text-muted-foreground hover-elevate"
 }`}
 >
 {label}
 </button>
 );
}

function ChannelKindBadge({ kind }: { kind: ChannelView["kind"] }) {
 const map: Record<ChannelView["kind"], { label: string; cls: string }> = {
 dm: { label: "DM", cls: "bg-secondary text-secondary-foreground" },
 cap_table: { label: "Cap Table", cls: "bg-[hsl(184_98%_22%)]/10 text-[hsl(184_98%_22%)] " },
 soft_circle: { label: "Soft-Circle", cls: "bg-amber-500/10 text-amber-700 " },
 company_followers: { label: "Followers", cls: "bg-secondary" },
 network: { label: "Network", cls: "bg-secondary" },
 };
 const m = map[kind];
 return (
 <span className={`text-[10px] h-4 px-1.5 rounded-full inline-flex items-center font-medium ${m.cls}`}>
 {m.label}
 </span>
 );
}
