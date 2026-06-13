/**
 * Sprint 19 G — Investor Network Posts feed at /investor/network-posts.
 * Sprint 20 Wave 2 — Added topic filter chips and author filter dropdown (defect 80).
 */
import { useState } from "react";
import { PostsFeed } from "@/components/comms/PostsFeed";
import { PageHeader, PageBody } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const TOPIC_CHIPS = [
  "All", "#dealflow", "#portfolio", "#exits", "#market", "#founders", "#angel", "#spv",
];

const AUTHOR_OPTIONS = [
  { value: "all", label: "All authors" },
  { value: "founders", label: "Founders only" },
  { value: "investors", label: "Investors only" },
  { value: "collective", label: "Collective members" },
];

export default function InvestorNetworkPosts() {
  const [pageSize, setPageSize] = useState(8);
  const [activeTopic, setActiveTopic] = useState("All");
  const [authorFilter, setAuthorFilter] = useState("all");

  return (
    <>
      <PageHeader
        title="Network Posts"
        description="Full feed across your network and company connections."
        breadcrumbs={[{ href: "/investor/dashboard", label: "Workspace" }, { label: "Network Posts" }]}
      />
      <PageBody data-testid="page-network-posts">
        {/* Sprint 20 Wave 2 — topic filter chips */}
        <div className="flex flex-wrap items-center gap-2 mb-4" data-testid="topic-filter-bar">
          {TOPIC_CHIPS.map((topic) => (
            <button
              key={topic}
              onClick={() => setActiveTopic(topic)}
              data-testid={`chip-topic-${topic.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`}
              className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                activeTopic === topic
                  ? "bg-[hsl(184_98%_22%)] text-white border-transparent"
                  : "bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {topic}
            </button>
          ))}
          {/* Sprint 20 Wave 2 — author filter dropdown */}
          <div className="ml-auto">
            <Select value={authorFilter} onValueChange={setAuthorFilter}>
              <SelectTrigger className="h-8 w-44 text-xs" data-testid="select-author-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AUTHOR_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {activeTopic !== "All" && (
          <div className="mb-3 flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              Filtered: {activeTopic}
            </Badge>
            <button
              className="text-xs text-muted-foreground hover:underline"
              onClick={() => setActiveTopic("All")}
            >
              Clear
            </button>
          </div>
        )}
        {/* Sprint 23 Wave B — DEF-033/034: pass topicFilter + authorFilter to PostsFeed */}
        <PostsFeed
          role="investor"
          maxPosts={pageSize}
          onLoadMore={() => setPageSize((n) => n + 8)}
          showLoadMore
          topicFilter={activeTopic !== "All" ? activeTopic : undefined}
          authorFilter={authorFilter !== "all" ? authorFilter : undefined}
        />
      </PageBody>
    </>
  );
}
