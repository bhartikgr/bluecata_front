/**
 * WAVE 288 — WHAT A PARTNER ACTUALLY READS ON THE TAX-FORMS PAGE.
 *
 * THE GAP, AS MEASURED (not as the preflight described it). Band 15 §8.2 claimed a
 * case-insensitive search for not-tax-advice phrasing returns "exactly one hit in
 * the whole silo". It does not. `client/src` holds four non-test files containing
 * the string "tax advice", and the RENDERED census is different again from the grep
 * census — two of those four hits are inside code comments, while two files that
 * render a not-tax-advice disclaimer do not contain the string at all because they
 * render it from `shared/spvEngine.ts`. The full re-measurement is in
 * `build_log/wave288/W288_BUILD.md`.
 *
 * What survives the re-measurement is the gap itself: `PartnerTaxForm.tsx` is a
 * partner-facing tax surface that names four specific forms and says the platform
 * collects "the appropriate" one, and it carried NO disclaimer of any kind. This
 * wave appends one paragraph. It changes no number, no value and no existing
 * sentence.
 *
 * WHY THIS FILE IS NOT VACUOUS
 * ----------------------------
 *  1. PLACEMENT IS POSITIONAL, NEVER "present on the page". The new paragraph is
 *     asserted to be the LAST ELEMENT CHILD of the pre-existing explainer block,
 *     and to FOLLOW the pre-existing paragraph by `compareDocumentPosition`. A
 *     sentence that drifted to the bottom of the page, or above the explainer,
 *     would pass a "page contains" test and fail these.
 *  2. EVERY QUERY IS SCOPED to the `partner-taxform-explainer` container. An
 *     unscoped DOM query is one of the known inert-proof mechanisms.
 *  3. THE WORDING IS ASSERTED BYTE-VERBATIM AGAINST THE OTHER SURFACE'S SOURCE,
 *     read off disk from `components/partner/SpvK1Panel.tsx`, which this fix does
 *     not touch. So this cannot pass by agreeing with itself: if either surface
 *     drifts, the two stop matching and this goes red.
 *  4. THE FIXTURE IS MOVED, not asserted constant. The disclaimer is required in
 *     the normal branch, in the 403 (non-managing-partner) branch, in the
 *     empty-forms branch and with forms on file — because the block sits OUTSIDE
 *     the `isForbidden` gate and must not become conditional. And it is required
 *     ABSENT in the not-ready branch, where the whole page returns null: copy that
 *     outlived its subject would be a second falsehood.
 *  5. PRECONDITIONS ARE ASSERTED FIRST, and they are anchored on things the fix
 *     does not touch — the explainer container, its two pre-existing sentences
 *     byte for byte with no normalising call inside the equality, and the four
 *     form names from `FORM_TYPES`. A page that failed to render cannot pass as a
 *     proof, and a reworded original fails.
 *  6. THE CONTROL AND THE SUBJECT ARE SEPARABLE. Deleting the appended paragraph
 *     must take the positional assertions red while the four-form assertion and
 *     the pre-existing-copy assertion stay green. That is the disarm recorded in
 *     `build_log/wave288/disarms/`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerTaxForm from "../PartnerTaxForm";

/* ── the sentence, read off the OTHER surface's source, not retyped ───────────
   `SpvK1Panel.tsx` is the platform's existing not-tax-advice wording and is NOT
   touched by this wave. Reading it from disk is what makes this test a
   verbatim-reuse proof rather than a self-agreeing string comparison. */
const REPO = join(__dirname, "..", "..", "..", "..", "..");
const K1_SOURCE = join(REPO, "client", "src", "components", "partner", "SpvK1Panel.tsx");
const TAXFORM_SOURCE = join(REPO, "client", "src", "pages", "partner", "PartnerTaxForm.tsx");

const REUSED_SENTENCE = "These statements are a reporting aid, not tax advice.";

/* The two pre-existing sentences, byte for byte. Neither may be reworded. */
const EXISTING_HEADLINE = "Tax compliance for commission & fee payouts.";
const EXISTING_BODY =
  "We collect the appropriate tax form before remitting any commission or SPV-fee payout. " +
  "Your tax identification number is hashed on submission and never stored in clear text.";

/* From `PartnerTaxForm.tsx:39` — the control. The fix does not touch it. */
const FORM_TYPES = ["W-9", "W-8BEN", "W-8BEN-E", "T4A"];

/* Fixture dials. Every test below moves one of these and asserts the DOM follows. */
let roleReady = true;
let listStatus = 200;
let formsFixture: Array<Record<string, unknown>> = [];

/* Hoisted: `vi.mock` factories are lifted above every top-level binding, so the
   error class the module factory returns must be created inside `vi.hoisted`. */
const H = vi.hoisted(() => {
  class FakeApiError extends Error {
    status: number;
    constructor(status: number) {
      super(`api ${status}`);
      this.status = status;
    }
  }
  return { FakeApiError };
});
const FakeApiError = H.FakeApiError;

vi.mock("@/components/partner/PartnerShell", () => ({
  PartnerShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PartnerEmptyState: ({ title }: { title?: string }) => <div data-testid="empty-state">{title}</div>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

/* Radix only mounts `SelectContent` when the trigger is open. The four form
   names are real rendered options on this page; flattening the primitive is the
   only way to read them in jsdom without driving a popover, and it changes
   nothing about the subject under test. */
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectContent: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectValue: () => <span />,
}));

vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () =>
    roleReady
      ? {
          ready: true,
          error: null,
          identity: {
            partnerId: "p_w288",
            tier: "builder",
            subRole: "managing_partner",
            identity: { userId: "u_w288", email: "w288@example.com", name: "W288 Partner" },
          },
        }
      : { ready: false, error: null, identity: null },
}));

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: (...args: unknown[]) => apiRequestMock(...args),
    ApiError: H.FakeApiError,
  };
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  roleReady = true;
  listStatus = 200;
  formsFixture = [];
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (_method: string, _url: string) => {
    if (listStatus !== 200) throw new FakeApiError(listStatus);
    return jsonResponse(200, { ok: true, forms: formsFixture });
  });
});

afterEach(() => cleanup());

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PartnerTaxForm />
    </QueryClientProvider>,
  );
}

/** The explainer container, scoped. Every DOM read below goes through this. */
async function explainer(): Promise<HTMLElement> {
  return await waitFor(() => screen.getByTestId("partner-taxform-explainer"));
}

/* ══ §0 · PRECONDITIONS — asserted before anything is concluded ═════════════ */

describe("W288 §0 — preconditions, anchored on what the fix does not touch", () => {
  it("P1 the reused sentence really is the wording on the OTHER tax surface", () => {
    const k1 = readFileSync(K1_SOURCE, "utf8");
    const flattened = k1.replace(/\s+/g, " ");
    expect(flattened).toContain(REUSED_SENTENCE);
  });

  it("P2 the explainer container renders, with BOTH pre-existing sentences intact", async () => {
    mount();
    const box = await explainer();
    /* No normalising call inside the equality for the headline — it is a whole
       text node of its own, so it can be compared exactly. */
    const paragraphs = Array.from(box.querySelectorAll("p"));
    /* NOTE: this precondition deliberately does NOT assert a paragraph COUNT.
       It is a control that must survive the disarm — see §3 of
       `build_log/wave288/W288_TESTS.md`. The count lives in §1 (S0) instead. */
    expect(paragraphs.length).toBeGreaterThanOrEqual(2);
    expect(paragraphs[0].textContent).toBe(EXISTING_HEADLINE);
    /* The body sentence is authored across two source lines, so JSX collapses
       its whitespace; the assertion is on the collapsed form of the RENDERED
       text against a string assembled here, and any reword still fails. */
    expect((paragraphs[1].textContent ?? "").replace(/\s+/g, " ").trim()).toBe(EXISTING_BODY);
  });

  it("P3 the four form names still render — the control for every disarm", async () => {
    mount();
    await explainer();
    for (const t of FORM_TYPES) {
      expect(screen.getAllByText(t).length).toBeGreaterThan(0);
    }
  });

  it("P4 the page source carries the sentence exactly once, and it is not in a comment", () => {
    const src = readFileSync(TAXFORM_SOURCE, "utf8");
    const lines = src.split("\n");
    const hits = lines
      .map((l, i) => ({ n: i + 1, l }))
      .filter((x) => x.l.includes("tax advice"));
    /* One hit only. A wave whose own explanatory comment contained the phrase
       would inflate its own grep — that trap is recorded at R260 and this
       assertion is what refuses it. */
    expect(hits.length).toBe(1);
    /* And that one hit is inside a JSX text node, not a `/* … *\/` comment. */
    expect(hits[0].l.trimStart().startsWith("*")).toBe(false);
    expect(hits[0].l).not.toContain("/*");
  });
});

/* ══ §1 · THE SUBJECT — placement, not presence ════════════════════════════ */

describe("W288 §1 — the disclaimer is the last child of the explainer, after the promise", () => {
  it("S0 the explainer block carries a THIRD paragraph that was not there before", async () => {
    mount();
    const box = await explainer();
    expect(Array.from(box.querySelectorAll("p")).length).toBe(3);
  });

  it("S1 it renders, scoped inside the explainer container", async () => {
    mount();
    const box = await explainer();
    const note = box.querySelector('[data-testid="partner-taxform-no-advice"]');
    expect(note).not.toBeNull();
    expect(box.contains(note!)).toBe(true);
  });

  it("S2 it is the LAST element child of the explainer block", async () => {
    mount();
    const box = await explainer();
    expect(box.lastElementChild).not.toBeNull();
    expect((box.lastElementChild as HTMLElement).dataset.testid).toBe("partner-taxform-no-advice");
  });

  it("S3 it FOLLOWS the pre-existing explanatory paragraph (compareDocumentPosition)", async () => {
    mount();
    const box = await explainer();
    const paragraphs = Array.from(box.querySelectorAll("p"));
    const existing = paragraphs.find((p) =>
      (p.textContent ?? "").replace(/\s+/g, " ").trim() === EXISTING_BODY,
    );
    expect(existing).toBeDefined();
    const note = box.querySelector('[data-testid="partner-taxform-no-advice"]');
    /* Asserted non-null BEFORE the positional call, so a missing paragraph fails
       as a named assertion rather than as a jsdom TypeError. A red that is a
       crash inside the instrument proves less than a red that names its claim. */
    expect(note).not.toBeNull();
    /* 4 === DOCUMENT_POSITION_FOLLOWING: `note` comes after `existing`. */
    const rel = existing!.compareDocumentPosition(note!);
    expect(rel & Node.DOCUMENT_POSITION_FOLLOWING).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(rel & Node.DOCUMENT_POSITION_PRECEDING).toBe(0);
  });

  it("S4 the rendered text reuses the other surface's sentence verbatim, and opens with it", async () => {
    mount();
    const box = await explainer();
    const note = box.querySelector('[data-testid="partner-taxform-no-advice"]')!;
    const rendered = (note.textContent ?? "").replace(/\s+/g, " ").trim();
    expect(rendered.startsWith(REUSED_SENTENCE)).toBe(true);
  });

  it("S5 it also says, in the same breath, that Capavate does not make the determination", async () => {
    mount();
    const box = await explainer();
    const rendered = (
      box.querySelector('[data-testid="partner-taxform-no-advice"]')!.textContent ?? ""
    )
      .replace(/\s+/g, " ")
      .trim();
    expect(rendered).toContain("Capavate does not determine which tax form applies to you");
    expect(rendered).toContain("tax adviser");
  });
});

/* ══ §2 · THE FIXTURE MOVES — the disclaimer must not become conditional ═══ */

describe("W288 §2 — every branch that can reach the page", () => {
  it("B1 with NO forms on file", async () => {
    formsFixture = [];
    mount();
    const box = await explainer();
    expect(box.querySelector('[data-testid="partner-taxform-no-advice"]')).not.toBeNull();
    await waitFor(() => expect(screen.getByTestId("empty-state")).toBeTruthy());
    /* Still last child after the async list settled. */
    expect((box.lastElementChild as HTMLElement).dataset.testid).toBe("partner-taxform-no-advice");
  });

  it("B2 with forms on file", async () => {
    formsFixture = [
      {
        id: "tf_w288",
        formType: "W-9",
        jurisdiction: "US",
        collectedAt: "2026-01-15",
        expiresAt: "2029-03-31",
        documentUrl: null,
        createdAt: "2026-01-15",
      },
    ];
    mount();
    const box = await explainer();
    await waitFor(() => expect(screen.getByTestId("partner-taxform-table")).toBeTruthy());
    expect(box.querySelector('[data-testid="partner-taxform-no-advice"]')).not.toBeNull();
    expect((box.lastElementChild as HTMLElement).dataset.testid).toBe("partner-taxform-no-advice");
  });

  it("B3 in the 403 branch — a partner REFUSED the page still reads the disclaimer", async () => {
    listStatus = 403;
    mount();
    const box = await explainer();
    await waitFor(() => expect(screen.getByTestId("partner-taxform-forbidden")).toBeTruthy());
    /* The submit card is gone; the disclaimer is not. */
    expect(screen.queryByTestId("partner-taxform-form")).toBeNull();
    expect(box.querySelector('[data-testid="partner-taxform-no-advice"]')).not.toBeNull();
  });

  it("B4 in the not-ready branch the page renders NOTHING, and the sentence is absent WITH it", async () => {
    roleReady = false;
    mount();
    expect(screen.queryByTestId("partner-taxform-explainer")).toBeNull();
    expect(screen.queryByTestId("partner-taxform-no-advice")).toBeNull();
  });
});
