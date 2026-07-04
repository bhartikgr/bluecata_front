/**
 * v25.49 Phase-3B — Consortium Partner Posts (network feed) page.
 *
 * Reuses the shared comms PostsFeed component + the /api/comms/posts endpoint —
 * NO parallel posts backend. `basePath` keeps post-detail navigation + share
 * links inside the partner shell rather than bouncing to /investor/posts/:id.
 * Post visibility is enforced server-side (session-scoped author/audience
 * gating), so the feed is fail-closed for the partner persona.
 */
import { PostsFeed } from "@/components/comms/PostsFeed";
import { PartnerShell } from "@/components/partner/PartnerShell";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";

export default function PartnerPosts() {
  const role = useRequirePartnerRole();
  if (!role.ready || !role.identity) return null;
  const me = role.identity;
  return (
    <PartnerShell title="Posts" tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}>
      <PostsFeed role="investor" basePath="/collective/partner" />
    </PartnerShell>
  );
}
