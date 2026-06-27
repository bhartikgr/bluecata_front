/**
 * Sprint 9 — Cap-Table Channel + Soft-Circle Channel access cards.
 *
 * Mirror the Collective Overview-tab pattern — surfaced near the bottom of
 * Company Detail / Round Detail pages.
 *
 * Visibility:
 * - CapTableChannelCard renders only if the viewer is a member.
 * - SoftCircleChannelCard renders only if there's an active channel AND
 * the viewer is a member.
 */

import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { MessageCircle, ArrowUpRight, ShieldCheck, AlertTriangle, Lock, Briefcase, Users2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ANONYMOUS_LABEL } from "@/lib/comms/visibility";

interface ChannelAccessResp {
 exists: boolean;
 isMember?: boolean;
 channel?: {
 id: string; displayTitle: string; displaySubtitle: string;
 metadata: Record<string, unknown>;
 };
 lastMessages?: Array<{
 id: string; body: string; createdAt: string; authorLabel: string; authorIsAnonymous: boolean;
 }>;
 visibleMemberCount?: number;
 totalMemberCount?: number;
 memberCount?: number;
}

export function CapTableChannelCard({
 companyId, basePath,
}: { companyId: string; basePath: "/founder/messages" | "/investor/messages" }) {
 const q = useQuery<ChannelAccessResp>({ queryKey: ["/api/comms/cap-table", companyId] });
 if (q.isLoading) return <Skeleton className="h-40 w-full" />;
 const data = q.data;
 if (!data?.exists || !data.isMember) return null;
 const ch = data.channel;
 if (!ch) return null;
 return (
 <Card data-testid="card-cap-table-channel">
 <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
 <div className="flex items-center gap-2 min-w-0">
 <Briefcase className="h-4 w-4 text-[hsl(0_100%_40%)] shrink-0" />
 <CardTitle className="text-base truncate flex items-center gap-1.5"><MessageCircle className="h-4 w-4 shrink-0" /> Cap Table Channel</CardTitle>
 </div>
 <Badge variant="secondary" className="text-[10px]">
 {data.visibleMemberCount ?? data.totalMemberCount} visible {((data.visibleMemberCount ?? 0) === 1) ? "member" : "members"}
 </Badge>
 </CardHeader>
 <CardContent className="space-y-3">
 <div className="rounded-md border border-[hsl(0_100%_40%)]/20 bg-[hsl(0_100%_40%)]/5 px-3 py-2 text-xs flex items-start gap-2">
 <ShieldCheck className="h-3.5 w-3.5 mt-0.5 text-[hsl(0_100%_40%)] shrink-0" />
 <div>
 This channel is visible to the founder + cap-table holders who opted into co-member visibility.
 Holders without screen names appear as <span className="italic">[Anonymous Holder]</span> and cannot post.
 </div>
 </div>
 <ul className="space-y-2.5">
 {(data.lastMessages ?? []).map((m) => (
 <li key={m.id} className="text-xs flex items-start gap-2.5" data-testid={`ct-preview-${m.id}`}>
 <Avatar className="h-7 w-7 shrink-0">
 <AvatarFallback className={`text-[10px] ${m.authorIsAnonymous ? "bg-muted text-muted-foreground" : "bg-secondary"}`}>
 {m.authorIsAnonymous ? <Lock className="h-3 w-3" /> : m.authorLabel.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()}
 </AvatarFallback>
 </Avatar>
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-1.5">
 <span className={`font-medium ${m.authorIsAnonymous ? "italic text-muted-foreground" : ""}`}>{m.authorLabel}</span>
 <span className="text-muted-foreground">· {new Date(m.createdAt).toLocaleDateString()}</span>
 </div>
 <p className="text-muted-foreground line-clamp-2">{m.body}</p>
 </div>
 </li>
 ))}
 {(data.lastMessages ?? []).length === 0 && (
 <li className="text-xs text-muted-foreground italic">No messages yet.</li>
 )}
 </ul>
 <Link href={`${basePath}?channel=${encodeURIComponent(ch.id)}`}>
 <Button variant="outline" size="sm" className="w-full" data-testid="button-open-cap-table-channel">
 <MessageCircle className="h-3.5 w-3.5 mr-2" /> Open channel
 <ArrowUpRight className="h-3 w-3 ml-1" />
 </Button>
 </Link>
 </CardContent>
 </Card>
 );
}

export function SoftCircleChannelCard({
 roundId, roundName, basePath,
}: { roundId: string; roundName?: string; basePath: "/founder/messages" | "/investor/messages" }) {
 const q = useQuery<ChannelAccessResp>({ queryKey: ["/api/comms/soft-circle", roundId] });
 if (q.isLoading) return <Skeleton className="h-40 w-full" />;
 const data = q.data;
 if (!data?.exists || !data.isMember) return null;
 const ch = data.channel;
 if (!ch) return null;
 return (
 <Card data-testid="card-soft-circle-channel">
 <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
 <div className="flex items-center gap-2 min-w-0">
 <Users2 className="h-4 w-4 text-amber-700 shrink-0" />
 <CardTitle className="text-base truncate flex items-center gap-1.5"><Users2 className="h-4 w-4 shrink-0" /> Soft-Circle Channel: {roundName ?? ch.metadata?.roundName ?? "Round"}</CardTitle>
 </div>
 <Badge variant="secondary" className="text-[10px]">
 {(data.memberCount ?? 0) - 1} soft-circler{(data.memberCount ?? 0) - 1 === 1 ? "" : "s"} + founder
 </Badge>
 </CardHeader>
 <CardContent className="space-y-3">
 <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs flex items-start gap-2">
 <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-amber-700 shrink-0" />
 <div>
 Soft-circlers can communicate privately with the founder + each other.
 Channel access updates automatically when you sign, withdraw, or the round closes.
 </div>
 </div>
 <ul className="space-y-2.5">
 {(data.lastMessages ?? []).map((m) => (
 <li key={m.id} className="text-xs flex items-start gap-2.5" data-testid={`sc-preview-${m.id}`}>
 <Avatar className="h-7 w-7 shrink-0">
 <AvatarFallback className={`text-[10px] ${m.authorIsAnonymous ? "bg-muted text-muted-foreground" : "bg-secondary"}`}>
 {m.authorIsAnonymous ? <Lock className="h-3 w-3" /> : m.authorLabel.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()}
 </AvatarFallback>
 </Avatar>
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-1.5">
 <span className={`font-medium ${m.authorIsAnonymous ? "italic text-muted-foreground" : ""}`}>{m.authorLabel}</span>
 <span className="text-muted-foreground">· {new Date(m.createdAt).toLocaleDateString()}</span>
 </div>
 <p className="text-muted-foreground line-clamp-2">{m.body}</p>
 </div>
 </li>
 ))}
 {(data.lastMessages ?? []).length === 0 && (
 <li className="text-xs text-muted-foreground italic">No messages yet.</li>
 )}
 </ul>
 <Link href={`${basePath}?channel=${encodeURIComponent(ch.id)}`}>
 <Button variant="outline" size="sm" className="w-full" data-testid="button-open-soft-circle-channel">
 <MessageCircle className="h-3.5 w-3.5 mr-2" /> Open channel
 <ArrowUpRight className="h-3 w-3 ml-1" />
 </Button>
 </Link>
 </CardContent>
 </Card>
 );
}
