/**
 * v25.42 round-2 (Blocker 3) — shared, dependency-free event classifier.
 *
 * CalendarComposeSheet persists a chapter "event" by prefixing the
 * announcement title with EVENT_TITLE_PREFIX ("[Event] "), because the server
 * announcements schema has no `event` column and never returns one. The
 * UpcomingMeetingsCard fallback classifies announcements as events using the
 * same prefix. This module is intentionally free of React/UI imports so it can
 * be unit-tested directly (see v25_42_r7_calendar_compose_e2e.mjs) and reused
 * by both the widget and the compose sheet without coupling.
 */
export const EVENT_TITLE_PREFIX = "[Event] ";

export interface EventClassifiable {
  title?: string;
  event?: boolean;
}

/** True when an announcement should be surfaced as a chapter event. */
export function isEventAnnouncement(a: EventClassifiable): boolean {
  return Boolean(a.event) || (a.title?.startsWith("[Event]") ?? false);
}

/** Strip the storage-only "[Event] " marker before showing a title to users. */
export function stripEventPrefix(title?: string): string {
  return (title ?? "").replace(/^\[Event\]\s*/, "");
}
