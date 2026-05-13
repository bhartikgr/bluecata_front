#!/usr/bin/env python3
"""Patch MessagesPage.tsx to add E2 UI: read-by-N footer, Cmd-K, typing UI."""
from pathlib import Path

p = Path("/home/user/workspace/capavate-app/client/src/components/comms/MessagesPage.tsx")
s = p.read_text()

# 1) Add useRef import.
old1 = 'import { useEffect, useMemo, useState } from "react";'
new1 = 'import { useEffect, useMemo, useRef, useState } from "react";'
assert old1 in s
s = s.replace(old1, new1, 1)

# 2) Add searchInputRef + Cmd-K handler after `const { toast } = useToast();`
old2 = " const { toast } = useToast();\n"
new2 = (
    " const { toast } = useToast();\n"
    " // Sprint 18 Phase 3 E2 — Cmd-K to focus the channel search input.\n"
    " const searchInputRef = useRef<HTMLInputElement | null>(null);\n"
    " useEffect(() => {\n"
    "  const onKey = (e: KeyboardEvent) => {\n"
    '   if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {\n'
    "    e.preventDefault();\n"
    "    searchInputRef.current?.focus();\n"
    "   }\n"
    "  };\n"
    '  window.addEventListener("keydown", onKey);\n'
    '  return () => window.removeEventListener("keydown", onKey);\n'
    " }, []);\n"
)
assert old2 in s
s = s.replace(old2, new2, 1)

# 3) Add ref to search input and update placeholder.
old3 = (
    ' <Input\n'
    ' placeholder="Search conversations..."\n'
    ' value={search}\n'
    ' onChange={(e) => setSearch(e.target.value)}\n'
    ' className="pl-8 h-8 text-sm"\n'
    ' data-testid="input-channel-search"\n'
    ' />'
)
new3 = (
    ' <Input\n'
    ' ref={searchInputRef}\n'
    ' placeholder="Search conversations... (⌘K)"\n'
    ' value={search}\n'
    ' onChange={(e) => setSearch(e.target.value)}\n'
    ' className="pl-8 h-8 text-sm"\n'
    ' data-testid="input-channel-search"\n'
    ' />'
)
assert old3 in s, "Search input block not found"
s = s.replace(old3, new3, 1)

# 4) Add useQuery for read-receipts.
old4 = (
    " const channelDetail = useQuery<{ channel: ChannelView; messages: MessageView[] }>({\n"
    ' queryKey: ["/api/comms/channels", activeId],\n'
    " enabled: !!activeId,\n"
    " });\n"
)
new4 = old4 + (
    " // Sprint 18 Phase 3 E2 — read-receipts for the active channel.\n"
    " const readReceipts = useQuery<{ receipts: Array<{ userId: string; displayName: string; lastReadMessageId: string | null; lastReadAt: string | null }> }>({\n"
    ' queryKey: ["/api/comms/channels", activeId, "read-receipts"],\n'
    " enabled: !!activeId,\n"
    " });\n"
)
assert old4 in s
s = s.replace(old4, new4, 1)

# 5) Add Read-by-N footer just before {/* Composer */}.
marker = " {/* Composer */}\n"
read_footer = (
    " {/* Sprint 18 Phase 3 E2 — read-by-N footer */}\n"
    " {readReceipts.data?.receipts && readReceipts.data.receipts.length > 0 && (\n"
    '  <div className="px-4 py-1.5 border-t border-border bg-muted/30 text-[11px] text-muted-foreground flex items-center gap-2" data-testid="footer-read-by">\n'
    "   <span>Read by</span>\n"
    '   <span className="font-medium text-foreground" data-testid="text-read-by-count">{readReceipts.data.receipts.filter((r) => r.lastReadMessageId).length}</span>\n'
    "   <span>of {readReceipts.data.receipts.length}</span>\n"
    '   <span className="truncate">· {readReceipts.data.receipts.filter((r) => r.lastReadMessageId).map((r) => r.displayName).slice(0, 3).join(", ")}</span>\n'
    "  </div>\n"
    " )}\n"
)
assert marker in s, "Composer marker not found"
s = s.replace(marker, read_footer + marker, 1)

# 6) Wire attach button with toast and "Attach from dataroom" tooltip.
old6 = '<Button variant="ghost" size="sm" data-testid="button-attach"><Paperclip className="h-3.5 w-3.5" /></Button>'
new6 = '<Button variant="ghost" size="sm" data-testid="button-attach" title="Attach from dataroom" onClick={() => toast({ title: "Dataroom picker", description: "Choose a dataroom file to attach (Sprint 19)." })}><Paperclip className="h-3.5 w-3.5" /></Button>'
assert old6 in s
s = s.replace(old6, new6, 1)

p.write_text(s)
print("OK patched MessagesPage.tsx for E2 UI")
