import { asArray } from "@/lib/safeArray";
/**
 * Sprint 9 — Full Messages page (split-pane).
 *
 * Layout
 * Left (320px): channel list (search + filter tabs + channel-kind badges).
 * Right : selected channel header + banner + messages + composer.
 *
 * Used by /founder/messages and /investor/messages.
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
 Search, Send, Paperclip, Smile, Star, Reply, MessageCircle,
 Lock, Users2, Heart, Briefcase, Hash, MoreHorizontal, Archive, BellOff, Pin, FileText,
 RefreshCw, Filter as FilterIcon, ShieldCheck, AlertTriangle, CornerDownRight,
} from "lucide-react";
import {
 Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
 DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageBody, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ANONYMOUS_LABEL } from "@/lib/comms/visibility";
import { useEntitlement } from "@/lib/entitlement";
// useRole is not used directly — role comes from props.

type ChannelKind = "dm" | "cap_table" | "soft_circle" | "company_followers" | "network";

interface ChannelView {
 id: string;
 kind: ChannelKind;
 companyId?: string;
 roundId?: string;
 participantUserIds: string[];
 displayTitle: string;
 displaySubtitle: string;
 lastMessage?: { id: string; preview: string; senderLabel: string; ts: string };
 unread: number;
 starred: boolean;
 kindBadge: string;
 metadata: Record<string, unknown>;
}

interface MessageView {
 id: string;
 channelId: string;
 authorUserId: string;
 body: string;
 createdAt: string;
 editedAt?: string;
 starredByUserIds: string[];
 reactions: Array<{ emoji: string; userIds: string[] }>;
 replyToMessageId?: string;
 readByUserIds: string[];
 authorLabel: string;
 authorIsAnonymous: boolean;
 authorRoleBadge: string;
}

type FilterTab = "all" | "starred" | "newest" | "dms" | "cap_table" | "soft_circle";

const FILTER_LABELS: Record<FilterTab, string> = {
 all: "All",
 starred: "Starred",
 newest: "Newest",
 dms: "DMs",
 cap_table: "Cap Table",
 soft_circle: "Soft-Circle",
};

export function MessagesPage({ role }: { role: "founder" | "investor" }) {
  const [location] = useLocation();
  // Sprint 18 Phase 3 B5 — also read `thread` query param. The hash-router
  // strips the query, so look at both window.location.search AND the hash
  // fragment after the route path. Accept either `thread` or `channel`.
  const initialChannel = useMemo(() => {
    const u = new URL(window.location.href);
    const fromSearch = u.searchParams.get("thread") ?? u.searchParams.get("channel");
    const fromHash =
      u.hash.match(/[?&]thread=([^&]+)/)?.[1] ?? u.hash.match(/[?&]channel=([^&]+)/)?.[1];
    return fromSearch ?? fromHash ?? null;
  }, [location]);

  // Sprint 18 Phase 3 B6 — also read `filter` so the inbox auto-applies the
  // user's last-active filter when navigated from the dashboard CTA.
  const initialFilter = useMemo<FilterTab | null>(() => {
    const u = new URL(window.location.href);
    const raw = u.searchParams.get("filter")
      ?? u.hash.match(/[?&]filter=([^&]+)/)?.[1]
      ?? null;
    if (!raw || raw === "last") return null;
    const allowed: FilterTab[] = ["all", "starred", "newest", "dms", "cap_table", "soft_circle"];
    return (allowed as string[]).includes(raw) ? (raw as FilterTab) : null;
  }, [location]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>(initialFilter ?? "all");
 const [search, setSearch] = useState("");
 const [draft, setDraft] = useState("");
 const [replyTo, setReplyTo] = useState<MessageView | null>(null);
 const [attachDialog, setAttachDialog] = useState(false);
 const [attachment, setAttachment] = useState<{ fileId: string; name: string } | null>(null);
 const { toast } = useToast();
 // role comes from prop (see component signature) — do not redeclare via useRole().
 // Sprint 18 Phase 3 E2 — Cmd-K to focus the channel search input.
 const searchInputRef = useRef<HTMLInputElement | null>(null);
 // v25.13 NH4 — guard against duplicate DM-start POSTs across location changes.
 const dmStartedForRef = useRef<string | null>(null);
 useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
   if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    searchInputRef.current?.focus();
   }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
 }, []);

 const channels = useQuery<ChannelView[]>({ queryKey: ["/api/comms/channels"] });
 const me = useQuery<{ id: string; legalName: string }>({ queryKey: ["/api/comms/me"] });
 // Sprint 22 Wave 1 — DEF-006 fix: use entitlement context as primary identity source.
 const { data: entCtx } = useEntitlement();
 const dataroomFiles = useQuery<Array<{ fileId: string; name: string; kind: string }>>({ queryKey: ["/api/founder/dataroom/files"], enabled: attachDialog });

  // Sprint 19 D / Sprint 22 Wave 1 — Read contactId OR targetUserId param and open/create DM.
  // DEF-016 fix: targetUserId takes priority over contactId (which was a CRM-local ID, not a platform userId).
  useEffect(() => {
    if (!channels.data) return;
    const u = new URL(window.location.href);
    const targetUserId = u.searchParams.get("targetUserId")
      ?? u.hash.match(/[?&]targetUserId=([^&]+)/)?.[1]
      ?? null;
    const contactId = u.searchParams.get("contactId")
      ?? u.hash.match(/[?&]contactId=([^&]+)/)?.[1]
      ?? null;
    // Prefer targetUserId (platform userId) over contactId (may be a CRM-local ID).
    const dmTarget = targetUserId ?? contactId;
    if (!dmTarget) return;
    // v25.13 NH4 — don't re-issue POST /dm/start for the same target when
    // unrelated location changes (hash/search tweaks) fire this effect.
    if (dmStartedForRef.current === dmTarget) return;
    dmStartedForRef.current = dmTarget;
    apiRequest("POST", "/api/comms/dm/start", { targetUserId: dmTarget })
      .then((r) => r.json())
      .then((data: { ok: boolean; channelId: string }) => {
        if (data.ok && data.channelId) {
          queryClient.invalidateQueries({ queryKey: ["/api/comms/channels"] });
          setActiveId(data.channelId);
        }
      })
      .catch(() => {
        toast({ title: "Could not open DM", description: "Failed to start a direct message with this contact.", variant: "destructive" });
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  // Sprint 19 D — Read fileRef param and pre-populate composer.
  useEffect(() => {
    const u = new URL(window.location.href);
    const fileRef = u.searchParams.get("fileRef")
      ?? u.hash.match(/[?&]fileRef=([^&]+)/)?.[1]
      ?? null;
    if (fileRef) {
      setDraft((d) => d || `[File reference: ${fileRef}]`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  // Pick initial channel. If `?thread=` or `?channel=` is supplied we ALWAYS
  // honour it on (re)mount even if `activeId` was already set — the dashboard
  // preview-row click should always re-select the requested thread.
  useEffect(() => {
    if (!channels.data || channels.data.length === 0) return;
    const list = channels.data.filter((c) => c.kind !== "network" && c.kind !== "company_followers");
    if (initialChannel) {
      // B2 — support synthetic shorthand `cap_table` + companyId in the query.
      // Resolve to the actual cap-table channel for the given company.
      let resolved: ChannelView | undefined;
      if (initialChannel === "cap_table") {
        const u = new URL(window.location.href);
        const cid = u.searchParams.get("companyId")
          ?? u.hash.match(/[?&]companyId=([^&]+)/)?.[1]
          ?? null;
        resolved = list.find((c) => c.kind === "cap_table" && (cid == null || c.companyId === cid));
      } else if (initialChannel === "soft_circle") {
        const u = new URL(window.location.href);
        const rid = u.searchParams.get("roundId")
          ?? u.hash.match(/[?&]roundId=([^&]+)/)?.[1]
          ?? null;
        resolved = list.find((c) => c.kind === "soft_circle" && (rid == null || c.roundId === rid));
      } else {
        resolved = list.find((c) => c.id === initialChannel);
      }
      const wanted = resolved;
      if (wanted && wanted.id !== activeId) {
        setActiveId(wanted.id);
        setTimeout(() => {
          document.querySelector('[data-testid="pane-messages"]')?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 50);
        return;
      }
    }
    if (!activeId) setActiveId(list[0]?.id ?? null);
  }, [channels.data, activeId, initialChannel]);

  // B5 — mark thread as read on selection so unread counters reset.
  useEffect(() => {
    if (!activeId) return;
    apiRequest("POST", `/api/comms/channels/${encodeURIComponent(activeId)}/read`)
      .then(() => queryClient.invalidateQueries({ queryKey: ["/api/comms/channels"] }))
      .catch(() => {});
  }, [activeId]);

 const filteredList = useMemo(() => {
 const data = asArray(channels.data).filter((c) => c.kind !== "network" && c.kind !== "company_followers");
 let result = data;
 if (filter === "starred") result = result.filter((c) => c.starred);
 if (filter === "dms") result = result.filter((c) => c.kind === "dm");
 if (filter === "cap_table") result = result.filter((c) => c.kind === "cap_table");
 if (filter === "soft_circle") result = result.filter((c) => c.kind === "soft_circle");
 if (search.trim()) {
 const q = search.toLowerCase();
 result = result.filter((c) =>
 c.displayTitle.toLowerCase().includes(q) ||
 (c.lastMessage?.preview ?? "").toLowerCase().includes(q),
 );
 }
 // Sprint 19 D Fix — remove || true so sort only applies for "newest" tab.
 if (filter === "newest") {
 result = [...result].sort((a, b) => (b.lastMessage?.ts ?? "").localeCompare(a.lastMessage?.ts ?? ""));
 }
 return result;
 }, [channels.data, filter, search]);

 const channelDetail = useQuery<{ channel: ChannelView; messages: MessageView[] }>({
 queryKey: ["/api/comms/channels", activeId],
 enabled: !!activeId,
 });
 // Sprint 18 Phase 3 E2 — read-receipts for the active channel.
 const readReceipts = useQuery<{ receipts: Array<{ userId: string; displayName: string; lastReadMessageId: string | null; lastReadAt: string | null }> }>({
 queryKey: ["/api/comms/channels", activeId, "read-receipts"],
 enabled: !!activeId,
 });

 // Sprint 19 D — Debounced typing indicator.
 const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
 const sendTyping = useCallback(() => {
   if (!activeId) return;
   if (typingTimeout.current) clearTimeout(typingTimeout.current);
   typingTimeout.current = setTimeout(() => {
     apiRequest("POST", `/api/comms/channels/${encodeURIComponent(activeId)}/typing`).catch(() => {});
   }, 500);
 }, [activeId]);

 const sendMessage = useMutation({
 mutationFn: async () => {
 if (!activeId || !draft.trim()) return;
 const res = await apiRequest("POST", `/api/comms/channels/${encodeURIComponent(activeId)}/messages`, {
 body: draft.trim(),
 replyToMessageId: replyTo?.id,
 attachments: attachment ? [attachment] : undefined,
 });
 return res.json();
 },
 onMutate: async () => {
   // Sprint 19 D — Optimistic send: append temp message immediately.
   if (!activeId || !draft.trim()) return;
   await queryClient.cancelQueries({ queryKey: ["/api/comms/channels", activeId] });
   const prev = queryClient.getQueryData<{ channel: ChannelView; messages: MessageView[] }>(["/api/comms/channels", activeId]);
   // Sprint 22 Wave 1 — DEF-006 fix: use entitlement context as primary identity, not hardcoded fallback.
   const currentMeId = entCtx?.userId ?? me.data?.id ?? "";
   const tempMsg: MessageView = {
     id: `_temp_${Date.now()}`,
     channelId: activeId,
     authorUserId: currentMeId,
     body: draft.trim(),
     createdAt: new Date().toISOString(),
     starredByUserIds: [],
     reactions: [],
     readByUserIds: [currentMeId],
     authorLabel: me.data?.legalName ?? "You",
     authorIsAnonymous: false,
     authorRoleBadge: role === "founder" ? "Founder" : "Investor",
   };
   if (prev) {
     queryClient.setQueryData(["/api/comms/channels", activeId], {
       ...prev,
       messages: [...prev.messages, tempMsg],
     });
   }
   const savedDraft = draft;
   setDraft("");
   setReplyTo(null);
   setAttachment(null);
   return { prev, savedDraft };
 },
 onSuccess: () => {
 queryClient.invalidateQueries({ queryKey: ["/api/comms/channels", activeId] });
 queryClient.invalidateQueries({ queryKey: ["/api/comms/channels"] });
 },
 onError: (e: Error, _v, ctx: any) => {
   // Rollback and restore draft.
   if (ctx?.prev) queryClient.setQueryData(["/api/comms/channels", activeId], ctx.prev);
   if (ctx?.savedDraft) setDraft(ctx.savedDraft);
   toast({ title: "Send failed", description: e.message, variant: "destructive" });
 },
 });

 const starMsg = useMutation({
 mutationFn: async ({ id, on }: { id: string; on: boolean }) =>
 apiRequest(on ? "POST" : "DELETE", `/api/comms/messages/${encodeURIComponent(id)}/star`),
 onSuccess: () => {
 queryClient.invalidateQueries({ queryKey: ["/api/comms/channels", activeId] });
 queryClient.invalidateQueries({ queryKey: ["/api/comms/channels"] });
 },
 });
 const reactMsg = useMutation({
 mutationFn: async ({ id, emoji }: { id: string; emoji: string }) =>
 apiRequest("POST", `/api/comms/messages/${encodeURIComponent(id)}/reactions`, { emoji }),
 onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/comms/channels", activeId] }),
 });

 const active = channelDetail.data?.channel;
 const msgs = channelDetail.data?.messages ?? [];
 // Sprint 22 Wave 1 — DEF-006 fix: use entitlement context as primary identity source.
 const meId = entCtx?.userId ?? me.data?.id ?? "";

 return (
 <>
 <PageHeader
 title="Messages"
 description="Direct messages, cap-table channels, and soft-circle channels — all in one place."
 breadcrumbs={[{ href: role === "founder" ? "/founder/dashboard" : "/investor/dashboard", label: "Workspace" }, { label: "Messages" }]}
 />
 <PageBody>
 <Card>
 <CardContent className="p-0">
 <div className="grid md:grid-cols-[320px_1fr] min-h-[640px]">
 {/* Left pane */}
 <div className="border-r border-border flex flex-col" data-testid="pane-channels">
 <div className="p-3 border-b border-border space-y-2">
 <div className="relative">
 <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
 <Input
 ref={searchInputRef}
 placeholder="Search conversations... (⌘K)"
 value={search}
 onChange={(e) => setSearch(e.target.value)}
 className="pl-8 h-8 text-sm"
 data-testid="input-channel-search"
 />
 </div>
 <div className="flex items-center gap-1 text-[11px] flex-wrap">
 {(Object.keys(FILTER_LABELS) as FilterTab[]).map((k) => (
 <button
 key={k}
 onClick={() => setFilter(k)}
 data-testid={`filter-${k}`}
 className={`px-2 py-0.5 rounded-md transition-colors ${
 filter === k ? "bg-secondary text-foreground font-medium" : "text-muted-foreground hover-elevate"
 }`}
 >
 {FILTER_LABELS[k]}
 </button>
 ))}
 </div>
 </div>
 <div className="overflow-auto flex-1">
 {channels.isLoading && <div className="p-3"><Skeleton className="h-32 w-full" /></div>}
 {!channels.isLoading && filteredList.length === 0 && (
 <div className="p-6 text-center text-sm text-muted-foreground" data-testid="empty-channels">
 No conversations yet.
 <div className="mt-3 text-xs">
 {role === "founder"
 ? "Invite investors to a round to start communicating."
 : "Soft-circle a round or accept an invitation to enter cap-table channels."}
 </div>
 </div>
 )}
 {filteredList.map((c) => {
 const on = c.id === activeId;
 const isAnon = (c.lastMessage?.senderLabel ?? "") === ANONYMOUS_LABEL;
 const initials = c.displayTitle.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
 return (
 <button
 key={c.id}
 onClick={() => { setActiveId(c.id); setReplyTo(null); }}
 data-testid={`channel-row-${c.id}`}
 className={`w-full text-left p-3 border-b border-border/60 transition-colors ${on ? "bg-secondary" : "hover-elevate"}`}
 >
 <div className="flex items-start gap-3">
 <Avatar className="h-9 w-9 shrink-0">
 <AvatarFallback className={`text-xs ${c.kind === "cap_table" ? "bg-[hsl(0_100%_40%)]/15 text-[hsl(0_100%_40%)]" : c.kind === "soft_circle" ? "bg-amber-500/15 text-amber-700" : "bg-secondary"}`}>
 {c.kind === "cap_table" ? <Briefcase className="h-3.5 w-3.5" /> :
 c.kind === "soft_circle" ? <Users2 className="h-3.5 w-3.5" /> :
 isAnon ? <Lock className="h-3.5 w-3.5" /> : initials}
 </AvatarFallback>
 </Avatar>
 <div className="flex-1 min-w-0">
 <div className="flex items-center justify-between gap-2">
 <span className="text-sm font-medium truncate">{c.displayTitle}</span>
 <span className="text-[10px] text-muted-foreground whitespace-nowrap">
 {c.lastMessage ? new Date(c.lastMessage.ts).toLocaleDateString() : ""}
 </span>
 </div>
 <p className="text-xs text-muted-foreground truncate mt-0.5">
 {c.lastMessage?.preview ?? "(no messages)"}
 </p>
 <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
 <ChannelKindBadge kind={c.kind} />
 {c.starred && <Star className="h-3 w-3 fill-amber-400 stroke-amber-500" />}
 {c.unread > 0 && <Badge className="h-4 px-1.5 text-[10px] bg-[hsl(var(--highlight))]">{c.unread}</Badge>}
 </div>
 </div>
 </div>
 </button>
 );
 })}
 </div>
 </div>

 {/* Right pane */}
 <div className="flex flex-col min-h-[640px]" data-testid="pane-messages">
 {!active && (
 <div className="flex-1 flex items-center justify-center p-12 text-center">
 <div>
 <MessageCircle className="h-10 w-10 mx-auto text-muted-foreground/40 mb-3" />
 <div className="text-sm font-medium">Select a conversation</div>
 <div className="text-xs text-muted-foreground mt-1">Choose a thread on the left to view it here.</div>
 </div>
 </div>
 )}
 {active && (
 <>
 {/* Header */}
 <div className="p-4 border-b border-border flex items-center gap-3">
 <Avatar className="h-10 w-10 shrink-0">
 <AvatarFallback className={`text-sm ${active.kind === "cap_table" ? "bg-[hsl(0_100%_40%)]/15 text-[hsl(0_100%_40%)]" : active.kind === "soft_circle" ? "bg-amber-500/15 text-amber-700" : "bg-secondary"}`}>
 {active.kind === "cap_table" ? <Briefcase className="h-4 w-4" /> :
 active.kind === "soft_circle" ? <Users2 className="h-4 w-4" /> :
 active.displayTitle.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase()}
 </AvatarFallback>
 </Avatar>
 <div className="flex-1 min-w-0">
 <div className="font-semibold text-sm truncate flex items-center gap-2">
 {active.displayTitle}
 <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 ">
 <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Online
 </span>
 </div>
 <div className="text-xs text-muted-foreground">{active.displaySubtitle}</div>
 </div>
 <Button
 variant="ghost"
 size="icon"
 className="h-8 w-8"
 onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/comms/channels", active.id] })}
 aria-label="Refresh thread"
 data-testid="button-refresh-thread"
 >
 <RefreshCw className="h-3.5 w-3.5" />
 </Button>
 {/* Sprint 19 D — Thread context menu: Mute, Archive, Pin */}
 <DropdownMenu>
 <DropdownMenuTrigger asChild>
 <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Thread options" data-testid="button-thread-menu">
 <MoreHorizontal className="h-3.5 w-3.5" />
 </Button>
 </DropdownMenuTrigger>
 <DropdownMenuContent align="end">
 <DropdownMenuItem onClick={() => {
 apiRequest("POST", `/api/comms/channels/${encodeURIComponent(active.id)}/mute`)
 .then(() => { toast({ title: "Notifications muted" }); queryClient.invalidateQueries({ queryKey: ["/api/comms/channels"] }); })
 .catch(() => {});
 }}>
 <BellOff className="h-3.5 w-3.5 mr-2" /> Mute notifications
 </DropdownMenuItem>
 <DropdownMenuItem onClick={() => {
 apiRequest("POST", `/api/comms/channels/${encodeURIComponent(active.id)}/archive`)
 .then(() => { toast({ title: "Thread archived" }); queryClient.invalidateQueries({ queryKey: ["/api/comms/channels"] }); setActiveId(null); })
 .catch(() => {});
 }}>
 <Archive className="h-3.5 w-3.5 mr-2" /> Archive thread
 </DropdownMenuItem>
 <DropdownMenuItem onClick={() => {
 apiRequest("POST", `/api/comms/channels/${encodeURIComponent(active.id)}/pin`)
 .then(() => { toast({ title: "Thread pinned" }); queryClient.invalidateQueries({ queryKey: ["/api/comms/channels"] }); })
 .catch(() => {});
 }}>
 <Pin className="h-3.5 w-3.5 mr-2" /> Pin thread
 </DropdownMenuItem>
 </DropdownMenuContent>
 </DropdownMenu>
 </div>

 {/* Channel-kind context banner */}
 <ContextBanner channel={active} />

 {/* Messages */}
 <div className="flex-1 overflow-auto p-4 space-y-3 bg-muted/20" data-testid="messages-list">
 {channelDetail.isLoading && <Skeleton className="h-24 w-full" />}
 {!channelDetail.isLoading && msgs.length === 0 && (
 <div className="text-sm text-muted-foreground text-center py-12">
 No messages yet. Be the first to say hi.
 </div>
 )}
 {msgs.map((m, i) => {
 const me = m.authorUserId === meId;
 const dayChange = i === 0 || new Date(m.createdAt).toDateString() !== new Date(msgs[i - 1].createdAt).toDateString();
 const replyTarget = m.replyToMessageId ? msgs.find((x) => x.id === m.replyToMessageId) : undefined;
 return (
 <div key={m.id} data-testid={`msg-${m.id}`}>
 {dayChange && (
 <div className="text-[11px] text-muted-foreground text-center my-3">
 {new Date(m.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
 </div>
 )}
 <div className={`flex ${me ? "justify-end" : "justify-start"} group`}>
 <div className={`max-w-[75%] ${me ? "items-end" : "items-start"} flex flex-col gap-1`}>
 {replyTarget && (
 <div className="text-[10px] text-muted-foreground inline-flex items-center gap-1 px-2 py-1 rounded bg-muted">
 <CornerDownRight className="h-3 w-3" />
 Replying to <span className="italic">{replyTarget.authorLabel}</span>: <span className="truncate max-w-[180px]">{replyTarget.body}</span>
 </div>
 )}
 <div className={`rounded-lg px-3 py-2 text-sm ${me ? "bg-primary text-primary-foreground" : "bg-card border border-border"}`}>
 <div className={`text-[10px] mb-1 flex items-center gap-1.5 flex-wrap ${me ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
 <span className={`font-medium ${m.authorIsAnonymous ? "italic" : ""}`}>{m.authorLabel}</span>
 <span>·</span>
 <span>{new Date(m.createdAt).toLocaleString()}</span>
 {!me && (
 <Badge variant="secondary" className="h-3.5 px-1 text-[9px]">{m.authorRoleBadge}</Badge>
 )}
 {me && m.readByUserIds.length > 1 && (
 <span title="Read by recipient" className="text-emerald-200">✓✓</span>
 )}
 {me && m.readByUserIds.length <= 1 && <span>✓</span>}
 </div>
 <div className="leading-relaxed whitespace-pre-wrap">{m.body}</div>
 {m.editedAt && <div className="text-[10px] mt-1 italic opacity-70">edited</div>}
 </div>
 {/* Reactions */}
 {m.reactions.length > 0 && (
 <div className="flex gap-1 flex-wrap">
 {m.reactions.map((r) => (
 <button
 key={r.emoji}
 onClick={() => reactMsg.mutate({ id: m.id, emoji: r.emoji })}
 className="px-1.5 h-5 rounded-full bg-secondary text-[11px] inline-flex items-center gap-1 hover-elevate"
 data-testid={`reaction-${m.id}-${r.emoji}`}
 >
 <span>{r.emoji}</span>
 <span>{r.userIds.length}</span>
 </button>
 ))}
 </div>
 )}
 {/* Hover actions */}
 <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[11px] text-muted-foreground">
 <button onClick={() => starMsg.mutate({ id: m.id, on: !m.starredByUserIds.includes(meId) })} data-testid={`button-star-${m.id}`}>
 <Star className={`h-3 w-3 ${m.starredByUserIds.includes(meId) ? "fill-amber-400 stroke-amber-500" : ""}`} />
 </button>
 <button onClick={() => reactMsg.mutate({ id: m.id, emoji: "👍" })} data-testid={`button-react-${m.id}`}>👍</button>
 <button onClick={() => reactMsg.mutate({ id: m.id, emoji: "❤️" })}>❤️</button>
 <button onClick={() => setReplyTo(m)} data-testid={`button-reply-${m.id}`}>
 <Reply className="h-3 w-3" />
 </button>
 </div>
 </div>
 </div>
 </div>
 );
 })}
 </div>

 {/* Sprint 18 Phase 3 E2 — read-by-N footer */}
 {readReceipts.data?.receipts && readReceipts.data.receipts.length > 0 && (
  <div className="px-4 py-1.5 border-t border-border bg-muted/30 text-[11px] text-muted-foreground flex items-center gap-2" data-testid="footer-read-by">
   <span>Read by</span>
   <span className="font-medium text-foreground" data-testid="text-read-by-count">{readReceipts.data.receipts.filter((r) => r.lastReadMessageId).length}</span>
   <span>of {readReceipts.data.receipts.length}</span>
   <span className="truncate">· {readReceipts.data.receipts.filter((r) => r.lastReadMessageId).map((r) => r.displayName).slice(0, 3).join(", ")}</span>
  </div>
 )}
 {/* Composer */}
 <div className="p-3 border-t border-border space-y-2">
 {replyTo && (
 <div className="text-[11px] flex items-center gap-2 px-2 py-1.5 rounded bg-muted">
 <CornerDownRight className="h-3 w-3" />
 Replying to <span className="italic">{replyTo.authorLabel}</span>:
 <span className="truncate flex-1">{replyTo.body}</span>
 <button className="text-muted-foreground hover-elevate px-1" onClick={() => setReplyTo(null)} data-testid="button-cancel-reply">×</button>
 </div>
 )}
 <Textarea
 value={draft}
 onChange={(e) => { setDraft(e.target.value); sendTyping(); }}
 placeholder={`Message ${active.displayTitle}...`}
 rows={2}
 className="resize-none"
 data-testid="input-message"
 onKeyDown={(e) => {
 if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
 e.preventDefault();
 if (draft.trim()) sendMessage.mutate();
 }
 }}
 />
 <div className="flex items-center justify-between gap-2">
 <div className="flex items-center gap-1">
 <Button variant="ghost" size="sm" data-testid="button-emoji"><Smile className="h-3.5 w-3.5" /></Button>
 <Button variant="ghost" size="sm" data-testid="button-attach" title="Attach from dataroom" onClick={() => setAttachDialog(true)} className={attachment ? "text-[hsl(0_100%_40%)]" : ""}>
 <Paperclip className="h-3.5 w-3.5" />
 {attachment && <span className="ml-1 text-[10px] truncate max-w-[80px]">{attachment.name}</span>}
 </Button>
 </div>
 <Button
 size="sm"
 onClick={() => sendMessage.mutate()}
 disabled={!draft.trim() || sendMessage.isPending}
 className="bg-[hsl(0_100%_40%)] hover:bg-[hsl(0_100%_32%)] text-white"
 data-testid="button-send"
 >
 <Send className="h-3.5 w-3.5 mr-1.5" /> Send
 </Button>
 </div>
 </div>
 </>
 )}
 </div>
 </div>
 </CardContent>
 </Card>
 </PageBody>

 {/* Sprint 19 D — Dataroom file attachment picker dialog */}
 <Dialog open={attachDialog} onOpenChange={setAttachDialog}>
 <DialogContent>
 <DialogHeader>
 <DialogTitle className="flex items-center gap-2"><FileText className="h-4 w-4" /> Attach a dataroom file</DialogTitle>
 </DialogHeader>
 <div className="space-y-2 max-h-64 overflow-y-auto">
 {dataroomFiles.isLoading && <Skeleton className="h-16 w-full" />}
 {!dataroomFiles.isLoading && (dataroomFiles.data ?? []).length === 0 && (
 <div className="text-sm text-muted-foreground text-center py-4">No dataroom files found.</div>
 )}
 {(dataroomFiles.data ?? []).map((f) => (
 <button
 key={f.fileId}
 className="w-full text-left px-3 py-2 rounded-md border border-border hover:bg-secondary text-sm flex items-center gap-2"
 data-testid={`file-picker-${f.fileId}`}
 onClick={() => {
 setAttachment({ fileId: f.fileId, name: f.name });
 setAttachDialog(false);
 toast({ title: "File attached", description: f.name });
 }}
 >
 <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
 <span className="truncate">{f.name}</span>
 </button>
 ))}
 </div>
 <DialogFooter>
 <Button variant="outline" onClick={() => setAttachDialog(false)}>Cancel</Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 </>
 );
}

function ChannelKindBadge({ kind }: { kind: ChannelKind }) {
 const map: Record<ChannelKind, { label: string; cls: string }> = {
 dm: { label: "DM", cls: "bg-secondary text-secondary-foreground" },
 cap_table: { label: "Cap Table", cls: "bg-[hsl(0_100%_40%)]/10 text-[hsl(0_100%_40%)] " },
 soft_circle: { label: "Soft-Circle", cls: "bg-amber-500/10 text-amber-700 " },
 company_followers: { label: "Followers", cls: "bg-secondary" },
 network: { label: "Network", cls: "bg-secondary" },
 };
 const m = map[kind];
 return <span className={`text-[10px] h-4 px-1.5 rounded-full inline-flex items-center font-medium ${m.cls}`}>{m.label}</span>;
}

function ContextBanner({ channel }: { channel: ChannelView }) {
 if (channel.kind === "cap_table") {
 const visibleMembers = (channel.metadata?.visibleMemberCount as number) ?? channel.participantUserIds.length;
 return (
 <div className="px-4 py-2.5 bg-[hsl(0_100%_40%)]/5 border-b border-border text-xs flex items-start gap-2" data-testid="banner-cap-table">
 <ShieldCheck className="h-3.5 w-3.5 mt-0.5 text-[hsl(0_100%_40%)] shrink-0" />
 <div>
 <span className="font-medium">Cap Table Channel for {String(channel.metadata?.title ?? "this company").replace("— Cap Table", "").trim()}</span>
 {" — visible to founder + "}
 <span className="font-medium">{visibleMembers}</span>
 {" visible holders. Holders without a screen name appear as [Anonymous Holder] and cannot post."}
 </div>
 </div>
 );
 }
 if (channel.kind === "soft_circle") {
 return (
 <div className="px-4 py-2.5 bg-amber-500/5 border-b border-border text-xs flex items-start gap-2" data-testid="banner-soft-circle">
 <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-amber-700 shrink-0" />
 <div>
 <span className="font-medium">Soft-Circle Channel: {String(channel.metadata?.roundName ?? "this round")}</span>
 {" — you're in this channel because you soft-circled the round. Once you sign or withdraw, your access updates accordingly."}
 </div>
 </div>
 );
 }
 if (channel.kind === "dm") {
 return (
 <div className="px-4 py-2.5 bg-secondary/40 border-b border-border text-xs flex items-start gap-2" data-testid="banner-dm">
 <Hash className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
 <div>
 <span className="font-medium">Direct message</span>
 {" — both parties opted into co-member visibility on a shared cap table or Collective chapter."}
 </div>
 </div>
 );
 }
 return null;
}
