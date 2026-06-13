/**
 * Sprint 18 Phase 3 — B4 Full Network Posts feed at /founder/network-posts.
 *
 * Page chrome:
 *   - Page header (title + description)
 *   - "Back to dashboard" link
 *   - Filter chips (Newest / Featured / Following) at the top
 *   - Composer is the FIRST thing under the header so it is unmissable
 *   - Load-more pagination (chunks of 8)
 *   - Re-uses <PostsFeed /> in a "headless" mode where it owns the rendering
 */
import { useState } from "react";
import { PostsFeed } from "@/components/comms/PostsFeed";
import { PageHeader, PageBody } from "@/components/AppShell";

export default function FounderNetworkPosts() {
  const [pageSize, setPageSize] = useState(8);
  return (
    <>
      <PageHeader
        title="Network Posts"
        description="Full feed across your network and company followers."
        breadcrumbs={[{ href: "/founder/dashboard", label: "Workspace" }, { label: "Network Posts" }]}
      />
      <PageBody data-testid="page-network-posts">
        <PostsFeed
          role="founder"
          maxPosts={pageSize}
          onLoadMore={() => setPageSize((n) => n + 8)}
          showLoadMore
        />
      </PageBody>
    </>
  );
}
