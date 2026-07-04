/**
 * v25.49 Phase-3B — Consortium Partner Messages page.
 *
 * Reuses the shared comms MessagesPage component + the session-scoped
 * /api/comms/channels feed — NO parallel messaging backend. Visibility is
 * enforced server-side by channelIsVisibleToViewer (a partner only ever sees
 * channels they participate in / derive membership for), so a partner can never
 * read another partner's or another tenant's private threads. `hideHeader`
 * suppresses the shared component's investor/founder breadcrumb; PartnerShell
 * supplies the on-brand "Messages" header instead.
 */
import { MessagesPage } from "@/components/comms/MessagesPage";
import { PartnerShell } from "@/components/partner/PartnerShell";
import { useRequirePartnerRole } from "@/lib/partner/useRequirePartnerRole";

export default function PartnerMessages() {
  const role = useRequirePartnerRole();
  if (!role.ready || !role.identity) return null;
  const me = role.identity;
  return (
    <PartnerShell title="Messages" tier={me.tier} subRole={me.subRole} partnerName={me.identity.name}>
      <MessagesPage role="investor" hideHeader />
    </PartnerShell>
  );
}
