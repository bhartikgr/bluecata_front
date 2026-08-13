/**
 * v25.49 Phase-3B — Consortium Partner Posts (network feed) page.
 *
 * Reuses the shared comms PostsFeed component + the /api/comms/posts endpoint —
 * NO parallel posts backend. `basePath` keeps post-detail navigation + share
 * links inside the partner shell rather than bouncing to /investor/posts/:id.
 * Post visibility is enforced server-side (session-scoped author/audience
 * gating), so the feed is fail-closed for the partner persona.
 *
 * WAVE 19 FE-12 — THE PARTNER POST-DETAIL DEEPLINK.
 *
 * Measured at source before any edit: App.tsx registered BOTH
 * `/collective/partner/posts` and `/collective/partner/posts/:id` to this same
 * component, and this component rendered only the FEED. `PostsFeed` navigates a
 * clicked post to `${postsBase}/posts/${id}` (PostsFeed.tsx:532) and copies that
 * exact URL on share (`:523`, `:649`) — so on the partner surface every post
 * click and every shared partner link round-tripped back to the list with the
 * `:id` silently discarded. No error, no refusal, just the wrong page: a silent
 * drop of a capability that is shipped and working for founder and investor.
 *
 * WIRING, NOT BUILDING. `client/src/pages/PostDetail.tsx` already implements the
 * whole surface — header, body, reaction strip, reaction history, comment thread
 * with one-level replies, composer — against `/api/comms/posts/:id`, whose
 * visibility gating is server-side and persona-agnostic. The only thing stopping
 * it being mounted here was that its `useRoute` pattern was hard-coded to
 * `/${role}/posts/:id`; that is now an additive `routePattern` prop whose default
 * is the exact prior expression, so the founder and investor mounts are
 * behaviour-identical.
 *
 * The ROUTE TABLE IS UNCHANGED — the branch lives here instead. Repointing the
 * `:id` route at a new component was tried first and the silent-drop guard
 * rejected it, correctly: a route TARGET signature is the (path, component)
 * pair, so that edit read as `REMOVED route TARGET
 * /collective/partner/posts/:id | target=PartnerPosts`. Restored verbatim rather
 * than allow-listed.
 *
 * `role="investor"` is what this page already passed to `PostsFeed`, so the
 * read/write contract the detail view speaks is the one this surface already had.
 *
 * No money is rendered on this surface — a post carries a body, an author and
 * counts, with no amount field anywhere — so there is no minor-unit conversion
 * here to get wrong. The proving suite fences that absence rather than leaving
 * it implicit.
 */
import { Link, useRoute } from "wouter";
import { ChevronLeft } from "lucide-react";
import { PostsFeed } from "@/components/comms/PostsFeed";
import PostDetail from "@/pages/PostDetail";
import { PartnerShell } from "@/components/partner/PartnerShell";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";

/** Origin-relative prefix the partner shell owns. Single source for both the
 *  feed's `basePath` and the detail view's share URL, so they cannot drift. */
export const PARTNER_POSTS_BASE = "/collective/partner";
export const PARTNER_POSTS_LIST_PATH = `${PARTNER_POSTS_BASE}/posts`;
export const PARTNER_POST_DETAIL_ROUTE = `${PARTNER_POSTS_BASE}/posts/:id`;

export default function PartnerPosts() {
  const role = useRequirePartnerRole();
  /* Hooks must run unconditionally — this is read before the readiness bail. */
  const [isDetail, detailParams] = useRoute<{ id: string }>(PARTNER_POST_DETAIL_ROUTE);
  if (!role.ready || !role.identity) return null;
  const me = role.identity;

  /* WAVE 19 FE-12 — a `:id` in the URL means the reader asked for ONE post.
     Guarded on a non-empty id so `/collective/partner/posts/` (trailing slash,
     which wouter matches with an empty param) falls back to the feed rather
     than rendering a detail page for the empty string. */
  if (isDetail && (detailParams?.id ?? "").length > 0) {
    return (
      <PartnerShell title="Post" tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}>
        {/* Partner-shell breadcrumb, added as a SIBLING of the shared page
            rather than by parameterising PostDetail's own literal label — see
            the GUARD NOTE in PostDetail.tsx. */}
        <div className="mb-3 text-xs">
          <Link
            href={PARTNER_POSTS_LIST_PATH}
            className="inline-flex items-center gap-1 text-muted-foreground hover:underline"
            data-testid="link-back-partner-posts"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Back to Posts
          </Link>
        </div>
        <PostDetail
          role="investor"
          routePattern={PARTNER_POST_DETAIL_ROUTE}
          backHref={PARTNER_POSTS_LIST_PATH}
          shareBase={PARTNER_POSTS_BASE}
        />
      </PartnerShell>
    );
  }

  return (
    <PartnerShell title="Posts" tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}>
      <PostsFeed role="investor" basePath={PARTNER_POSTS_BASE} />
    </PartnerShell>
  );
}
