import pathlib, re
p = pathlib.Path("client/src/components/comms/MessagesPage.tsx")
src = p.read_text()

old1 = '''  const [location] = useLocation();
  const initialChannel = useMemo(() => {
    const u = new URL(window.location.href);
    return u.searchParams.get("channel") || u.hash.match(/[?&]channel=([^&]+)/)?.[1] || null;
  }, [location]);'''

# Try matching with flexible leading spaces
def loose(s):
    parts = s.split('\n')
    return r'(?ms)' + r'\n'.join(r' *' + re.escape(line.lstrip()) for line in parts)

new1 = '''  const [location] = useLocation();
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
  }, [location]);'''

m = re.search(loose(old1), src)
assert m, "old1 not found"
src = src[:m.start()] + new1 + src[m.end():]

old2 = '  const [activeId, setActiveId] = useState<string | null>(null);\n  const [filter, setFilter] = useState<FilterTab>("all");'
m2 = re.search(loose(old2), src)
assert m2, "old2 not found"
new2 = '  const [activeId, setActiveId] = useState<string | null>(null);\n  const [filter, setFilter] = useState<FilterTab>(initialFilter ?? "all");'
src = src[:m2.start()] + new2 + src[m2.end():]

old3 = '''  // Pick initial channel.
  useEffect(() => {
    if (activeId) return;
    if (!channels.data || channels.data.length === 0) return;
    const list = channels.data.filter((c) => c.kind !== "network" && c.kind !== "company_followers");
    const wanted = initialChannel && list.find((c) => c.id === initialChannel);
    setActiveId((wanted ?? list[0]).id);
  }, [channels.data, activeId, initialChannel]);'''

new3 = '''  // Pick initial channel. If `?thread=` or `?channel=` is supplied we ALWAYS
  // honour it on (re)mount even if `activeId` was already set — the dashboard
  // preview-row click should always re-select the requested thread.
  useEffect(() => {
    if (!channels.data || channels.data.length === 0) return;
    const list = channels.data.filter((c) => c.kind !== "network" && c.kind !== "company_followers");
    if (initialChannel) {
      const wanted = list.find((c) => c.id === initialChannel);
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
  }, [activeId]);'''

m3 = re.search(loose(old3), src)
assert m3, "old3 not found"
src = src[:m3.start()] + new3 + src[m3.end():]

p.write_text(src)
print("patched MessagesPage")
