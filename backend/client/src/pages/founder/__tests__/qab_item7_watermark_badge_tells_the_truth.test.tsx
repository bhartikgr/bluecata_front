/**
 * ══════════════════════════════════════════════════════════════════════════════
 * QA ITEM 7 — a file badged "Watermarked" opened with no watermark.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * PREMISE RE-MEASURED AND CONFIRMED: watermarking is NOT IMPLEMENTED ON THE
 * BYTES anywhere in this tree. There is no PDF library, no image compositing,
 * no per-viewer stamping. The `watermark` column is a boolean that drives a CSS
 * overlay on the in-app preview and nothing else, and the download route
 * streams the original file. QA'S INFERENCE WAS CORRECT: THE BADGE WAS THE
 * DEFECT — a promise the product does not keep.
 *
 * So this file does NOT assert that a watermark appeared. It asserts that the
 * product STOPPED CLAIMING one, which is the fix that was actually made.
 *
 * THE HAZARD THE SPECIFICATION NAMED: fixing the overlay's paint order makes a
 * mark visible on IMAGE previews and could thereby make the old badge look
 * correct — removing the pressure to fix the PDF and download paths, the two
 * that actually matter. Test 4 is the guard: for a PDF the mark is ABSENT and
 * an explicit statement is rendered instead.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const COMPANY_ID = "co_qab7";

vi.mock("@/lib/useActiveCompany", () => ({
  useActiveCompanyId: () => COMPANY_ID,
  /* Welcome.tsx uses the query-shaped hook; Dataroom.tsx uses the id-only one. */
  useActiveCompany: () => ({ data: { activeCompanyId: COMPANY_ID }, isLoading: false, isError: false, error: null }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("wouter", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("wouter");
  return { ...actual, useLocation: () => ["/founder/dataroom", () => {}], Link: ({ children }: { children?: unknown }) => <span>{children as never}</span> };
});

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

import { RoleProvider } from "@/lib/role";
import Dataroom from "../Dataroom";

const FOLDER = { id: "fld_1", companyId: COMPANY_ID, name: "Legal", parentId: null };

function file(id: string, name: string, mime: string, watermark: boolean) {
  return {
    id, companyId: COMPANY_ID, folderId: FOLDER.id, name,
    sizeBytes: 1000, mime, uploadedAt: "2026-08-01T00:00:00Z",
    uploadedBy: "Founder", uploadedById: "u_f", sha256: `sha_${id}`, watermark,
  };
}

const PDF_MARKED = file("drf_pdf", "Articles of Incorporation.pdf", "application/pdf", true);
const IMG_MARKED = file("drf_img", "Product shot.png", "image/png", true);
const PDF_PLAIN = file("drf_plain", "Notes.pdf", "application/pdf", false);

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

beforeEach(() => {
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (_m: string, url: string) => {
    if (url.startsWith("/api/founder/dataroom/folders")) return jsonResponse([FOLDER]);
    if (url.startsWith("/api/founder/dataroom/files")) return jsonResponse([PDF_MARKED, IMG_MARKED, PDF_PLAIN]);
    if (url.startsWith("/api/founder/dataroom/permissions")) return jsonResponse([]);
    if (url.startsWith("/api/founder/dataroom/events")) return jsonResponse([]);
    if (url.startsWith("/api/founder/dataroom/engagement")) return jsonResponse({});
    if (url.startsWith("/api/founder/investor-crm")) return jsonResponse([]);
    return jsonResponse({});
  });
});
afterEach(() => cleanup());

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <Dataroom />
      </RoleProvider>
    </QueryClientProvider>,
  );
}

const body = () => (document.body.textContent ?? "").replace(/\s+/g, " ");

describe("QA ITEM 7 · the badge stops promising something the product does not do", () => {
  it("1 · CONTROL — the file list really rendered all three fixtures", async () => {
    mount();
    await waitFor(() => expect(screen.getByText("Articles of Incorporation.pdf")).toBeTruthy(), { timeout: 8000 });
    expect(screen.getByText("Product shot.png")).toBeTruthy();
    expect(screen.getByText("Notes.pdf")).toBeTruthy();
  });

  it("2 · THE WORD \"WATERMARKED\" IS GONE from the list, and the badge names what really happens", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId(`badge-preview-marked-${PDF_MARKED.id}`)).toBeTruthy(), { timeout: 8000 });
    const badge = (screen.getByTestId(`badge-preview-marked-${PDF_MARKED.id}`).textContent ?? "").trim();
    expect(badge).toContain("Preview marked");
    expect(badge).toContain("file not modified");
    expect(badge).not.toContain("Watermarked");
    /* Nothing anywhere on the page claims watermarking any more \u2014 the page
       description said "Drag-drop upload with watermarking" too. */
    expect(body()).not.toContain("Watermarked");
    expect(body()).not.toContain("watermarking");
  });

  it("3 · a file WITHOUT the flag gets no badge \u2014 the badge is not hardcoded", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId(`badge-preview-marked-${PDF_MARKED.id}`)).toBeTruthy(), { timeout: 8000 });
    /* Without this pole, a badge printed on every row would pass test 2. */
    expect(screen.queryByTestId(`badge-preview-marked-${PDF_PLAIN.id}`)).toBeNull();
  });

  /* ────────────────────────────────────────────────────────────────────────
   * PREMISE FAILURE, FOUND WHILE TESTING — REPORTED, NOT EXPLAINED AWAY.
   *
   * The specification analysed the overlay at Dataroom.tsx:317–330 and gave
   * three reasons it was invisible (paint order, 10% opacity, and the fact
   * that an <iframe> cannot be marked from the parent document). There is a
   * FOURTH reason it did not find, and it dominates the other three:
   *
   *     `setPreviewFile` IS NEVER CALLED WITH A FILE. `previewFile` is
   *     initialised to null at :46 and the only two calls in the file both set
   *     it back to null (:316 and :323). THE ENTIRE PREVIEW MODAL, INCLUDING
   *     THE OVERLAY, IS UNREACHABLE. It cannot render for any user.
   *
   * The eye button instead calls `window.open` on the raw download URL, which
   * opens the ORIGINAL BYTES in a new browser tab with no mark of any kind.
   *
   * This STRENGTHENS QA's verdict rather than weakening it: not only is there
   * no byte-level watermarking, the only in-app mark the tree contains cannot
   * be displayed at all. It also means the specification's step-4 hazard —
   * "fixing the paint order makes the badge look correct" — cannot occur here.
   *
   * WIRING THE PREVIEW MODAL UP IS A PRODUCT CHANGE, NOT A DEFECT FIX, AND IS
   * OUT OF SCOPE. STOP AND REPORT. The paint-order and opacity corrections
   * were still made so the code is right if the modal is ever wired, but they
   * are UNPROVEN BY RENDER and are recorded as such.
   * ──────────────────────────────────────────────────────────────────────── */

  it("4 · THE PREVIEW MODAL IS UNREACHABLE — proven from the rendered page", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId(`button-view-${PDF_MARKED.id}`)).toBeTruthy(), { timeout: 8000 });
    /* PRECONDITION: the row and its button really rendered, so a null result
       below means "absent", not "never mounted". */
    expect(screen.getByTestId(`row-file-${PDF_MARKED.id}`)).toBeTruthy();
    expect(screen.queryByTestId("preview-overlay")).toBeNull();
    fireEvent.click(screen.getByTestId(`button-view-${PDF_MARKED.id}`));
    await new Promise((r) => setTimeout(r, 50));
    /* Still absent after the click. Nothing opens it. */
    expect(screen.queryByTestId("preview-overlay")).toBeNull();
    expect(screen.queryByTestId("watermark-overlay")).toBeNull();
    expect(screen.queryByTestId("text-pdf-not-marked")).toBeNull();
  });

  it("5 · WHAT THE USER ACTUALLY GETS is the unmodified file, opened in a new tab", async () => {
    const opened: string[] = [];
    vi.stubGlobal("open", (url: string) => { opened.push(url); return null; });
    try {
      mount();
      await waitFor(() => expect(screen.getByTestId(`button-view-${PDF_MARKED.id}`)).toBeTruthy(), { timeout: 8000 });
      fireEvent.click(screen.getByTestId(`button-view-${PDF_MARKED.id}`));
      expect(opened.length).toBe(1);
      /* The plain download route. No marking parameter, no per-viewer token,
         nothing that could produce a stamped copy — which is the whole of QA's
         finding, now asserted rather than asserted about. */
      expect(opened[0]).toBe(`/api/founder/dataroom/files/${PDF_MARKED.id}/download?disposition=inline`);
      expect(opened[0]).not.toContain("watermark");
      expect(opened[0]).not.toContain("viewer");
      /* And the download button next to it goes to the same untouched route. */
      /* CORRECTED AFTER MEASURING THE DOM: the Button uses `asChild`, so the
         test id lands ON the anchor, not on a wrapper containing one. */
      const dl = screen.getByTestId(`button-download-${PDF_MARKED.id}`);
      expect(dl.tagName.toLowerCase()).toBe("a");
      expect(dl.getAttribute("href")).toBe(`/api/founder/dataroom/files/${PDF_MARKED.id}/download`);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * THE MOST IMPORTANT OF THE THREE COPY CORRECTIONS.
 * Welcome.tsx:63 told every new founder, on the onboarding screen:
 *   "Watermarked previews — Dataroom files are watermarked per-viewer. No raw
 *    downloads unless you explicitly allow them."
 * NEITHER CLAUSE WAS TRUE. There is no per-viewer identity anywhere in the mark
 * (only fixed text and today's date), and the download route serves the
 * original bytes. This is the sentence a paying client would quote back.
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("QA ITEM 7 · the founder onboarding screen stops promising watermarking", () => {
  /* The page shows ONE tip at a time and rotates every 8s, so the corrected
     tip is the THIRD in the list. The clock is driven forward deliberately to
     bring it on screen rather than asserting against the source array. */
  async function mountWelcome() {
    const { default: Welcome } = await import("../Welcome");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    /* Seed the identity query so the page passes its loading gate; without
       this the body reads "Loading welcome page" and every text assertion
       below would pass or fail vacuously. THE SILENT EMPTY. */
    qc.setQueryData(["/api/auth/me"], { id: "u_f", role: "founder", displayName: "Founder" });
    qc.setQueryData(["/api/founder/welcome"], {});
    return render(<QueryClientProvider client={qc}><RoleProvider><Welcome /></RoleProvider></QueryClientProvider>);
  }

  it("6 · CONTROL — the page is past its loading gate and a tip is on screen", async () => {
    await mountWelcome();
    await waitFor(() => expect(screen.getByTestId("page-welcome")).toBeTruthy(), { timeout: 8000 });
    const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");
    expect(text()).not.toContain("Loading welcome page");
    /* The first tip, untouched by this change, proves the rotator renders. */
    expect(text()).toContain("Dual-engine math gate");
  });

  it("7 · THE UNTRUE PROMISE IS GONE and a true capability took its place", async () => {
    /* ═══════════════════════════════════════════════════════════════════════
       THIS TEST WAS VACUOUS AND HAS BEEN MADE TO ASSERT.
       ═══════════════════════════════════════════════════════════════════════
       WHAT WAS WRONG: the page shows ONE tip at a time and advances it on an
       8-second `setInterval` (Welcome.tsx:201). The previous version of this
       loop called `fireEvent.click(page-welcome)` eight times and re-read the
       text after each click. Clicking does not advance the rotator, so the
       loop read THE SAME FIRST TIP eight times over. The watermark claim was
       the THIRD tip. The assertions therefore never once looked at the tip
       they were written to police: the test could not fail, whatever the page
       said. Its `seen.every(t => t.length > 100)` precondition passed too,
       because the page was indeed rendered — just never rotated.

       WHAT IT DOES NOW: it drives the real interval with fake timers and
       asserts that it actually SAW EVERY DISTINCT TIP — `distinct.size` is
       compared to `TIPS.length`, so if the rotation ever stops working this
       test goes red instead of quietly re-reading tip one. Only then are the
       forbidden strings meaningful. */
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await mountWelcome();
      await waitFor(() => expect(screen.getByTestId("page-welcome")).toBeTruthy(), { timeout: 8000 });
      const { TIPS } = await import("../Welcome");
      const titleNow = () =>
        (document.querySelector('[data-testid="bento-tile-tips"]')?.textContent ?? "").replace(/\s+/g, " ");

      const distinct = new Set<string>();
      for (let n = 0; n < TIPS.length; n += 1) {
        const shown = titleNow();
        /* PRECONDITION, per tick: the tile is on screen and is not empty. */
        expect(shown.length, "the tips tile rendered nothing on tick " + n).toBeGreaterThan(20);
        distinct.add(shown);

        /* The claim must be absent from EVERY tip, including the third. */
        expect(shown).not.toContain("Watermarked previews");
        expect(shown).not.toContain("watermarked per-viewer");
        expect(shown).not.toContain("No raw downloads");

        await act(async () => {
          vi.advanceTimersByTime(8000);
        });
      }

      /* THE ASSERTION THAT MAKES THIS TEST REAL. Eight identical reads used to
         satisfy the old loop; here they cannot. */
      expect(
        distinct.size,
        `the rotator did not advance — saw ${distinct.size} distinct tip(s) across ${TIPS.length} ticks`,
      ).toBe(TIPS.length);

      /* And the tip that replaced the untrue one is the one actually shipped. */
      const replaced = TIPS.find((t) => t.title === "Dataroom access control");
      expect(replaced).toBeTruthy();
      expect(replaced!.body).toContain("audit trail");
      expect(TIPS.some((t) => /watermark/i.test(t.title) || /watermark/i.test(t.body))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
