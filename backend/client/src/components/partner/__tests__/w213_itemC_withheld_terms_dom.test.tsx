/**
 * WAVE 213 · ITEM C — the one genuinely withheld term in the tree, fixed.
 *
 * The sentence at `server/lib/lock1Provenance.ts` ends "ask your Capavate contact
 * and it will be issued to you". Item C.3: where the term genuinely lives in the
 * signed Consortium Partner Agreement — which is competent, signed, enforced
 * fail-closed and must not be modified — the fix is to LINK to it and QUOTE the
 * relevant clause, not to restate it in words that could diverge from the signed
 * text.
 *
 * WHAT THIS FILE HAS TO PROVE, and why each is a separate failure mode:
 *   1. the quote is BYTE-IDENTICAL to the signed agreement (a paraphrase would be
 *      the exact defect Item C.3 forbids, and would pass a "is there a quote"
 *      test);
 *   2. the link goes to the route where the whole agreement can be read (a quote
 *      with no route is still a deferral);
 *   3. the withheld sentence is STILL RENDERED (R195.5 — nothing is deleted; and
 *      `wave33_pipe10_lock_notice_render` must keep passing);
 *   4. it renders on the SUPPLIED branch too — the confidentiality clause governs
 *      a partner-sourced soft circle whether or not an administrator typed a
 *      bespoke notice;
 *   5. it does NOT render when the section cannot be located (no heading over an
 *      empty quote).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

import Lock1NoticePanel from "../Lock1NoticePanel";
import {
  PUBLISH_CLAUSE_AGREEMENT_PATH,
  consortiumAgreementSection,
} from "@shared/wave213PublishGoverningClause";
import { CONSORTIUM_AGREEMENT_TEXT } from "@shared/consortiumAgreement";

/** The withheld sentence, exactly as the route emits it. Retained, not deleted. */
const CLIENT_NOT_SUPPLIED =
  "Capavate does not reproduce the governing clause on this screen. The provenance rule stated above is in force and is applied to every partner-sourced soft circle recorded on this platform. If you need the governing wording for your files, ask your Capavate contact and it will be issued to you.";

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <Lock1NoticePanel />
    </QueryClientProvider>,
  );
}
function respond(body: unknown) {
  apiRequestMock.mockResolvedValue({ json: async () => body });
}

beforeEach(() => apiRequestMock.mockReset());
afterEach(() => cleanup());

describe("Item C — the deferred term is now quoted and linked on the screen that defers it", () => {
  it("C-1 the quote is byte-identical to the signed agreement, not a restatement", async () => {
    respond({ supplied: false, text: null, clientCopy: CLIENT_NOT_SUPPLIED, setAt: null });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("lock1-agreement-clause-quote")).toBeTruthy());
    const rendered = screen.getByTestId("lock1-agreement-clause-quote").textContent ?? "";
    expect(rendered.length).toBeGreaterThan(80);
    /* THE assertion of this file: what the partner reads is a slice of the signed
       instrument, so it cannot drift from it. */
    expect(CONSORTIUM_AGREEMENT_TEXT).toContain(rendered);
    expect(rendered).toBe(consortiumAgreementSection());
    expect(rendered).toContain("7.1 The Partner will treat LP personal data");
  });

  it("C-2 the partner can open the whole agreement from here", async () => {
    respond({ supplied: false, text: null, clientCopy: CLIENT_NOT_SUPPLIED, setAt: null });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("lock1-agreement-clause-link")).toBeTruthy());
    const link = screen.getByTestId("lock1-agreement-clause-link") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(PUBLISH_CLAUSE_AGREEMENT_PATH);
    expect((link.textContent ?? "").length).toBeGreaterThan(10);
  });

  it("C-3 NO-DROP (R195.5) — the withheld sentence is still rendered, unedited", async () => {
    respond({ supplied: false, text: null, clientCopy: CLIENT_NOT_SUPPLIED, setAt: null });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("lock1-notice-not-supplied")).toBeTruthy());
    /* Verbatim. Not shortened, not softened, not replaced by the quote. */
    expect(screen.getByTestId("lock1-notice-not-supplied").textContent).toBe(CLIENT_NOT_SUPPLIED);
  });

  it("C-4 the clause is shown on the SUPPLIED branch too — the duty does not depend on a typed notice", async () => {
    respond({ supplied: true, text: "Owner-supplied lock wording.", clientCopy: null, setAt: "2026-01-02" });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("lock1-notice-text")).toBeTruthy());
    expect(screen.getByTestId("lock1-agreement-clause-quote")).toBeTruthy();
    /* NO-DROP — the owner's own wording is untouched beside it. */
    expect(screen.getByTestId("lock1-notice-text").textContent).toBe("Owner-supplied lock wording.");
  });

  /* THE READ-FAILURE BRANCH is deliberately NOT re-asserted here. It is already
     pinned by `wave33_pipe10_lock_notice_render.test.tsx` ("a read failure is NOT
     the same as an unsupplied wording"), which still passes 6/6 after this wave —
     that is the evidence, and duplicating it in a second file would add no
     coverage while giving two places for the same pin to rot. */
});
