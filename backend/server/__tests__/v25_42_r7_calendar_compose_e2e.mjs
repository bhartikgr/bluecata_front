/* v25.42 R7 — E2E: Calendar compose modal → POST /api/collective/announcements
 * with an event marker ("[Event] " title prefix). Chapter-admin guarded server-side.
 *   0. unauthenticated POST → 401/403 (fail-closed)
 *   1. non-admin member POST → 403 not_chapter_admin (guard enforced)
 *   2. platform admin POST → 200/201 (creates the event-flagged announcement)
 *   3. v25.42 round-2 (Blocker 3): an event created by CalendarComposeSheet
 *      ("[Event] " title prefix) is classified as an event by the same
 *      classifier the UpcomingMeetingsCard fallback uses, and therefore
 *      appears in that fallback list (and its display title is prefix-stripped).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { setup, recorder } from "./v25_42_helpers.mjs";
// Dependency-free classifier shared by CalendarComposeSheet + UpcomingMeetingsCard.
import { isEventAnnouncement, stripEventPrefix, EVENT_TITLE_PREFIX } from "../../client/src/components/collective/widgets/eventClassifier.ts";

let h;
const { results, record } = recorder();

function eventBody(chapterId) {
  return { title: "[Event] Chapter mixer", body: "Join us for the quarterly mixer.", priority: "normal", audience: "all", chapter_id: chapterId };
}

beforeAll(async () => { h = await setup("r7"); }, 60_000);
afterAll(async () => { await h.teardown(); });

describe("v25.42 R7 calendar compose (announcements POST) — E2E", () => {
  it("0. unauthenticated POST → 401/403", async () => {
    const res = await h.reqNoAuth("POST", "/api/collective/announcements");
    record("unauth blocked", [401, 403].includes(res.status), `status ${res.status}`);
    expect([401, 403]).toContain(res.status);
  });

  it("1. non-admin member POST → 403 not_chapter_admin", async () => {
    const res = await h.req("POST", "/api/collective/announcements", { body: eventBody(h.ids.CHAPTER), userId: h.ids.MEMBER, confirm: true });
    record("member 403", res.status === 403, `status ${res.status}`);
    expect(res.status).toBe(403);
  });

  it("2. platform admin POST → success", async () => {
    const res = await h.req("POST", "/api/collective/announcements", { body: eventBody(h.ids.CHAPTER), userId: h.ids.ADMIN, confirm: true });
    record("admin create ok", res.status === 200 || res.status === 201, `status ${res.status} ${JSON.stringify(res.body)?.slice(0,100)}`);
    expect([200, 201]).toContain(res.status);
  });

  it("3. event from CalendarComposeSheet appears in UpcomingMeetingsCard fallback", async () => {
    // Mirror EXACTLY what CalendarComposeSheet POSTs: an "[Event] "-prefixed title.
    const eventTitle = `${EVENT_TITLE_PREFIX}Quarterly chapter mixer`;
    const createRes = await h.req("POST", "/api/collective/announcements", {
      body: { title: eventTitle, body: "Join us.", priority: "normal", audience: "all", chapter_id: h.ids.CHAPTER },
      userId: h.ids.ADMIN,
      confirm: true,
    });
    record("compose-style create ok", [200, 201].includes(createRes.status), `status ${createRes.status}`);
    expect([200, 201]).toContain(createRes.status);

    // Read announcements back the way UpcomingMeetingsCard does (filter=active).
    const listRes = await h.req("GET", `/api/collective/announcements?chapter_id=${encodeURIComponent(h.ids.CHAPTER)}&filter=active`, { userId: h.ids.ADMIN });
    record("announcements list 200", listRes.status === 200, `status ${listRes.status}`);
    expect(listRes.status).toBe(200);
    const announcements = listRes.body?.announcements ?? [];

    // The created event must be classified as an event by the shared classifier.
    const mine = announcements.find((a) => a.title === eventTitle);
    record("created event present in list", Boolean(mine), mine ? mine.title : "NOT FOUND");
    expect(mine).toBeTruthy();
    record("classified as event", isEventAnnouncement(mine), JSON.stringify({ title: mine?.title, event: mine?.event }));
    expect(isEventAnnouncement(mine)).toBe(true);

    // The UpcomingMeetingsCard fallback is exactly: announcements.filter(isEventAnnouncement).
    const fallback = announcements.filter(isEventAnnouncement);
    const inFallback = fallback.some((a) => a.title === eventTitle);
    record("appears in UpcomingMeetingsCard fallback", inFallback, `fallback size ${fallback.length}`);
    expect(inFallback).toBe(true);

    // The display title hides the storage-only "[Event] " marker.
    record("display title prefix-stripped", stripEventPrefix(eventTitle) === "Quarterly chapter mixer", stripEventPrefix(eventTitle));
    expect(stripEventPrefix(eventTitle)).toBe("Quarterly chapter mixer");
  });

  it("summary", () => {
    const passed = results.filter((r) => r.pass).length;
    // eslint-disable-next-line no-console
    console.log(`\n  v25.42 R7 calendar compose E2E: ${passed}/${results.length} assertions passed`);
    expect(passed).toBe(results.length);
  });
});
