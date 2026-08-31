/**
 * WAVE 189 · ITEM B · R159.6 clause 3 — THE LP IS TOLD, PROVEN ON RENDERED DOM.
 *
 * The brief: *"Tell the LP. The LP must be able to see that their conversation is
 * visible to the partner firm rather than one individual. Plain language, on the
 * surface where they read the thread."*
 *
 * A predicate that widens access is not the deliverable on its own — the owner was
 * explicit that *"the disclosure is what makes it investor-grade; without it this is
 * a privacy change made silently."* So this file renders the actual component and
 * reads the actual text out of the DOM, rather than asserting on the constants (which
 * `wave189_itemB_lp_thread_firm_visibility.test.ts` already does).
 *
 * THE THREE STATES ARE ALL PROVEN, because the wrong one appearing is the defect:
 *   · visible:true  → the notice renders, naming the firm-level reach AND its limits.
 *   · visible:false → NOTHING renders. A privacy notice that is untrue for this
 *                     reader is worse than no notice at all.
 *   · read failure  → a STATED read-failure, never a reassuring blank that would
 *                     leave an LP believing a conversation is private when the page
 *                     merely failed to find out.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  LP_THREAD_FIRM_VISIBILITY_HEADLINE,
  LP_THREAD_FIRM_VISIBILITY_BODY,
  LP_THREAD_FIRM_VISIBILITY_UNNAMED_FIRM,
} from "@shared/lpThreadFirmVisibilityCopy";

/* The component reads its payload through `apiRequest`, so the transport is mocked
   and NOTHING ELSE is. The component under test is the real one. */
const mockApiRequest = vi.fn();
vi.mock("@/lib/queryClient", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

import { LpThreadFirmVisibilityNotice } from "@/components/comms/LpThreadFirmVisibilityNotice";

afterEach(() => {
  cleanup();
  mockApiRequest.mockReset();
});

function renderWith(impl: () => unknown) {
  mockApiRequest.mockImplementation(impl as any);
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <LpThreadFirmVisibilityNotice />
    </QueryClientProvider>,
  );
}

const ok = (body: unknown) => async () => ({ json: async () => body });

describe("wave 189 · item B — the LP-facing disclosure on rendered DOM", () => {
  it("visible:true → the notice renders with the headline and the full body", async () => {
    renderWith(ok({ visible: true, firmNames: [] }));
    await waitFor(() => expect(screen.getByTestId("lp-firm-visibility-notice")).toBeTruthy());
    expect(screen.getByTestId("lp-firm-visibility-headline").textContent)
      .toBe(LP_THREAD_FIRM_VISIBILITY_HEADLINE);
    expect(screen.getByTestId("lp-firm-visibility-body").textContent)
      .toBe(LP_THREAD_FIRM_VISIBILITY_BODY);
  });

  it("the rendered text says the conversation is the FIRM's, not one person's", async () => {
    renderWith(ok({ visible: true, firmNames: [] }));
    await waitFor(() => expect(screen.getByTestId("lp-firm-visibility-notice")).toBeTruthy());
    const text = screen.getByTestId("lp-firm-visibility-notice").textContent ?? "";
    expect(text).toContain("visible to the firm, not just one person");
    expect(text).toContain("Active members of that firm's team can read this conversation");
  });

  it("the rendered text states the LIMITS — not another firm, not a founder, not another investor", async () => {
    renderWith(ok({ visible: true, firmNames: [] }));
    await waitFor(() => expect(screen.getByTestId("lp-firm-visibility-notice")).toBeTruthy());
    const text = screen.getByTestId("lp-firm-visibility-notice").textContent ?? "";
    expect(text).toContain("not another partner firm");
    expect(text).toContain("not a founder");
    expect(text).toContain("not another investor");
    expect(text).toContain("left the firm's team loses access");
  });

  it("with NO firm name on file it renders the stated fallback, never a blank", async () => {
    renderWith(ok({ visible: true, firmNames: [] }));
    await waitFor(() => expect(screen.getByTestId("lp-firm-visibility-firm")).toBeTruthy());
    expect(screen.getByTestId("lp-firm-visibility-firm").textContent)
      .toBe(LP_THREAD_FIRM_VISIBILITY_UNNAMED_FIRM);
  });

  it("with a firm name on file it names the firm", async () => {
    renderWith(ok({ visible: true, firmNames: ["Keiretsu Forum Canada"] }));
    await waitFor(() => expect(screen.getByTestId("lp-firm-visibility-firm")).toBeTruthy());
    expect(screen.getByTestId("lp-firm-visibility-firm").textContent)
      .toBe("Keiretsu Forum Canada");
  });

  it("visible:false → NOTHING renders. An untrue privacy notice is worse than none", async () => {
    renderWith(ok({ visible: false, firmNames: [] }));
    /* The query has to settle before absence means anything, so a settled sibling
       state is awaited first: the read-failure node must also be absent. */
    await waitFor(() =>
      expect(mockApiRequest).toHaveBeenCalledWith("GET", "/api/messages/lp-firm-visibility"),
    );
    await waitFor(() => {
      expect(screen.queryByTestId("lp-firm-visibility-notice")).toBeNull();
      expect(screen.queryByTestId("lp-firm-visibility-unavailable")).toBeNull();
    });
  });

  it("a FAILED read renders a stated read-failure, never a reassuring blank", async () => {
    renderWith(async () => {
      throw new Error("w189 transport down");
    });
    await waitFor(() =>
      expect(screen.getByTestId("lp-firm-visibility-unavailable")).toBeTruthy(),
    );
    const text = screen.getByTestId("lp-firm-visibility-unavailable").textContent ?? "";
    expect(text).toContain("could not check who is able to read your conversations");
    expect(text).toContain("read failure");
    /* AND IT DOES NOT CLAIM PRIVACY IT CANNOT VOUCH FOR. */
    expect(text).toContain("not a statement that your messages are private to one person");
  });

  it("a MALFORMED 200 is routed into the same stated read-failure rather than crashing the page", async () => {
    for (const junk of [{}, { visible: "yes" }, { visible: true }, { firmNames: [] }, null]) {
      cleanup();
      mockApiRequest.mockReset();
      renderWith(ok(junk));
      await waitFor(() =>
        expect(screen.getByTestId("lp-firm-visibility-unavailable")).toBeTruthy(),
      );
    }
  });

  it("renders NO all-caps underscore code and no table or field name on screen", async () => {
    renderWith(ok({ visible: true, firmNames: [] }));
    await waitFor(() => expect(screen.getByTestId("lp-firm-visibility-notice")).toBeTruthy());
    const text = screen.getByTestId("lp-firm-visibility-notice").textContent ?? "";
    expect(text).not.toMatch(/[A-Z]{3,}_[A-Z_]{2,}/);
    expect(text).not.toMatch(/partner_team_members|participantUserIds|removed_at|thread_id/);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   THE MOUNT. A component nobody renders discloses nothing, so the mount on the
   surface where the LP actually reads their thread is asserted structurally.
   ════════════════════════════════════════════════════════════════════════════ */
describe("wave 189 · item B — the disclosure is MOUNTED where the LP reads the thread", () => {
  it("investor/Messages.tsx imports and renders it, as an ADDITIVE SIBLING", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("client/src/pages/investor/Messages.tsx", "utf8");
    const stripped = src
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    /* Verify the stripper actually stripped, per the standing rule. */
    expect(stripped.length).toBeLessThan(src.length);
    expect(stripped).not.toContain("ADDITIVE SIBLING at the end");

    expect(stripped).toContain("LpThreadFirmVisibilityNotice");
    expect(stripped).toContain("<LpThreadFirmVisibilityNotice");
    /* AND THE PRE-EXISTING SIBLING IS STILL THERE — R143.1: nothing was replaced. */
    expect(stripped).toContain("<MessagingAudienceNotice");
    expect(stripped).toContain("<MessagesPage role=\"investor\" hideHeader />");
  });
});
