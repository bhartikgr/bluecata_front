/**
 * Sprint 9 — Investor Messages page (split-pane).
 * Replaces the Sprint-7 basic Messages page with the full comms surface.
 *
 * Defect 10: Replace hardcoded userId with session identity from useEntitlement().
 *
 * Sprint 21 Wave F — Investor-side parity verification:
 *  1. Thread deeplink (?thread=X): handled by MessagesPage via URL params ✓
 *  2. Channel filters (All/Starred/DMs/Cap-Table/Soft-Circle/…): handled in MessagesPage ✓
 *  3. Optimistic send (onMutate): handled in MessagesPage ✓
 *  4. Read receipts: handled in MessagesPage ✓
 *  5. @mention autocomplete from /api/comms/users: handled in MessagesPage ✓
 *  6. File attachment (dataroom picker): handled in MessagesPage ✓
 *  7. Cmd-K search: handled in MessagesPage ✓
 *  8. MoreHorizontal context menu (Mute/Archive/Pin): handled in MessagesPage ✓
 *  9. Bell notifications include thread ID: seed data at /investor/messages?thread=X ✓
 * 10. ?contactId= DM resolution: handled in MessagesPage ✓
 * 11. Typing indicator debounced POST: handled in MessagesPage ✓
 * 12. ?roundId= for Founder Q&A: handled in MessagesPage via soft_circle resolution ✓
 *
 * Investor-specific label fix:
 *  - MessagesWidget title "Messages from founders" — set in MessagesWidget (basePath check) ✓
 *  - Cap-Table channel shows the company name (e.g. "<Company> — Cap Table") from live data ✓
 *  - Soft-Circle channel shows the round name (e.g. "<Round> — Soft-Circle") from live data ✓
 *  - Investors only see channels they're participants in (server-side channelIsVisibleToViewer) ✓
 *
 * dataroom file picker: MessagesPage queries /api/founder/dataroom/files which the server
 * aliases to investor-accessible files. No investor-specific override needed.
 */
import { MessagesPage } from "@/components/comms/MessagesPage";
import { CommsTiersTabs } from "@/components/comms/CommsTiersTabs";
import { useEntitlement } from "@/lib/entitlement";

export default function Messages() {
  // DEF-004: derive userId from session cookie; block if not yet resolved.
  const { data: entCtx, isLoading } = useEntitlement();
  const userId = entCtx?.userId;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!userId) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
        Sign in to view messages.
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <CommsTiersTabs userId={userId} />
      <MessagesPage role="investor" />
    </div>
  );
}
