/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 347 · ITEM 1 — THE FALSE WATERMARK PROMISE ON THE INVESTOR DATA ROOM.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * THE DEFECT. `client/src/pages/investor/InvitationDetail.tsx`, under the
 * "Files shared with you" heading of the Data Room tab, told an OUTSIDE INVESTOR:
 *
 *     "All access is logged in the company's audit ledger. Watermarked on download."
 *
 * The second sentence was FALSE. Re-measured before the edit, not taken from a
 * prior finding: `fileDownloadHandler` (server/dataroomStore.ts:868-943) returns
 * the stored bytes unmodified — `res.send(bytes)` at :942, with no transformation
 * step anywhere between storage and response. The `watermark` column is written
 * unconditionally `true` on every upload (:759) and is read by nothing that alters
 * a byte. `pdfkit` IS in the tree, but only in server/lib/pdfGenerators.ts, which
 * GENERATES term sheets and cap-table documents and never imports dataroomStore.
 * There is no image compositing dependency. The one CSS watermark overlay lives in
 * a founder preview modal that cannot open, because `setPreviewFile` is called at
 * exactly two places (client/src/pages/founder/Dataroom.tsx:399 and :406) and both
 * pass `null`.
 *
 * WHY IT MATTERED MORE THAN ITS SIZE. This is the screen where a person outside the
 * company decides whether to open a founder's confidential documents. The sentence
 * described a protection they were not receiving, at the exact moment they relied
 * on it.
 *
 * WHAT THIS FILE PROVES, FROM THE MOUNTED PAGE AND ITS RENDERED TEXT — NOT FROM
 * THE SOURCE FILE. The instrument is not the product: a `grep` would prove only
 * that a string left the file, not that the page stopped saying it. Every
 * assertion below reads `container.textContent` of a real render.
 *
 *   1  CONTROL — the harness can see the Data Room tab's copy at all. If this
 *      fails, tests 2-4 are meaningless and their greens must be refused.
 *   2  THE FALSE PROMISE IS GONE — no form of "watermark" appears anywhere in the
 *      rendered Data Room tab, in any casing.
 *   3  THE TRUE STATEMENT IS THERE INSTEAD — this is a SUBSTITUTION, not a hole.
 *      The absence of a lie is not the same as the presence of the truth, so the
 *      replacement is asserted separately from the removal.
 *   4  IT IS NOT A NEW PROMISE — the sentence claims logging and nothing else. The
 *      words that would constitute a NEW security claim (encrypted, protected,
 *      secure, DRM, cannot be copied, expires) are asserted ABSENT. A fix that
 *      swapped one unbacked promise for another would be no fix.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router, Route } from "wouter";
import { RoleProvider } from "@/lib/role";
import { memoryLocation } from "wouter/memory-location";

vi.mock("@/lib/entitlement", () => ({
  useEntitlement: () => ({ data: { tier: "pro", features: {} } }),
}));
vi.mock("@/lib/realtimeSync", () => ({ useRealtimeSync: () => {} }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: () => {} }) }));

afterEach(() => cleanup());

const INV_ID = "inv_w347_item1";

/* Harness copied from rem_item4_render_tests.test.tsx, which is the file that
   established a working mount for this page. Query keys are read off the
   component, not guessed: the invitation must carry `company.id` and `round.id`
   or downstream queries are `enabled: false`. */
function mountInvitation() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity, refetchOnMount: false } },
  });
  qc.setQueryData(["/api/investor/invitations", INV_ID], {
    id: INV_ID,
    status: "accepted",
    state: "accepted",
    company: { id: "co_1", name: "Acme" },
    round: { id: "rd_1", name: "Seed", type: "priced_round", status: "open" },
  });
  /* `?tab=dataroom` is NOT a convenience. The Data Room panel is selected by the
     URL, not by component state: `activeTab = parseTabParam(search)`
     (InvitationDetail.tsx:314, parser at :281-285, `VALID_TABS` at :279). A
     `fireEvent.click` on the Radix trigger was TRIED FIRST and did not open the
     panel — the control below caught it, which is exactly what the control is for.
     Driving the URL is how the page's own tab mechanism works. */
  const { hook } = memoryLocation({ path: `/investor/invitations/${INV_ID}?tab=dataroom` });
  return import("../InvitationDetail").then(({ default: InvitationDetail }) =>
    render(
      <QueryClientProvider client={qc}>
        <RoleProvider>
          <Router hook={hook}>
            <Route path="/investor/invitations/:id" component={InvitationDetail} />
          </Router>
        </RoleProvider>
      </QueryClientProvider>,
    ),
  );
}

/* The copy under test sits inside `<TabsContent value="dataroom">`
   (InvitationDetail.tsx:1388). Radix does not mount the children of an INACTIVE
   tab panel, so asserting an absence without activating the tab would produce a
   GREEN THAT MEANS NOTHING — the string would be missing because the whole panel
   is missing. The panel is opened via the URL (see `mountInvitation`), and test 1
   proves it really opened before any absence below is trusted. */
async function openDataroomTab(container: HTMLElement): Promise<string> {
  await waitFor(() => {
    const el = container.querySelector('[data-testid="tab-dataroom"]');
    expect(el, "the Data Room tab trigger did not render").toBeTruthy();
  });
  /* Wait on the tab's OWN intro line — a sibling of the sentence under test,
     inside the same panel, and untouched by this wave. Its presence is what makes
     the panel's rendered text trustworthy. */
  await waitFor(() =>
    expect(
      container.textContent ?? "",
      "the Data Room panel did not mount after activating the tab",
    ).toContain("Sensitive documents the founder is sharing for diligence"),
  );
  return container.textContent ?? "";
}

describe("W347 · ITEM 1 — the investor data room no longer promises a watermark", () => {
  /* ─────────────────────────────────────────────────────────────────────────
     1 · CONTROL. RUN FIRST, AND FAIL LOUDLY IF THE HARNESS IS INERT.
     An assertion that a string is ABSENT passes trivially against an empty
     render. Before trusting any absence below, this proves the harness reaches
     the Data Room panel and can read copy inside it. `Files shared with you` is
     the CardTitle immediately above the sentence under test — the nearest
     possible anchor. */
  it("CONTROL — the Data Room panel mounts and its copy is readable", async () => {
    const { container } = await mountInvitation();
    const text = await openDataroomTab(container);
    expect(text.length, "the panel rendered no text at all").toBeGreaterThan(50);
    expect(text, "the CONTROL anchor is missing — every absence below would be a false green").toContain(
      "Files shared with you",
    );
    expect(text).toContain("All access is logged in the company's audit ledger.");
  });

  /* ─────────────────────────────────────────────────────────────────────────
     2 · THE REMOVAL. Case-insensitive and stem-level, so "Watermarked",
     "watermark", "WATERMARK" and "watermarking" are all caught. */
  it("says NOTHING about watermarks anywhere in the rendered panel", async () => {
    const { container } = await mountInvitation();
    const text = await openDataroomTab(container);
    expect(
      /watermark/i.test(text),
      `the rendered Data Room panel still mentions a watermark. Rendered text was:\n${text}`,
    ).toBe(false);
    expect(text).not.toContain("Watermarked on download");
  });

  /* ─────────────────────────────────────────────────────────────────────────
     3 · THE SUBSTITUTION. Removing the lie is half the fix; the brief required
     saying what is TRUE instead. Asserted as the exact sentence, because the
     wording is the deliverable. The claim it makes is backed at
     server/dataroomStore.ts:905-907, where `auditActor = ctx.identity.name` and
     `auditActorId = ctx.userId` are written by `logEvent` with action "view" or
     "download", on the same handler that serves the bytes. */
  it("states the protection that DOES exist, in the same sentence slot", async () => {
    const { container } = await mountInvitation();
    const text = await openDataroomTab(container);
    expect(text).toContain("Every view and download is recorded with your name.");
    /* The sibling intro line the screen already used for this register is
       untouched — the true copy was not moved or duplicated away. */
    expect(text).toContain("Every view is logged.");
  });

  /* ─────────────────────────────────────────────────────────────────────────
     4 · NO NEW PROMISE. The failure mode of a copy fix is replacing one
     unbacked security claim with another. None of these words is backed by any
     mechanism in this codebase, so none of them may appear. */
  it("makes no NEW security claim the platform cannot keep", async () => {
    const { container } = await mountInvitation();
    const text = await openDataroomTab(container);
    for (const forbidden of [
      /encrypt/i,
      /\bDRM\b/,
      /cannot be copied/i,
      /copy[- ]protect/i,
      /tamper[- ]proof/i,
      /expires? after/i,
      /screenshot/i,
    ]) {
      expect(
        forbidden.test(text),
        `the replacement copy introduced an unbacked security claim matching ${forbidden}`,
      ).toBe(false);
    }
  });
});
