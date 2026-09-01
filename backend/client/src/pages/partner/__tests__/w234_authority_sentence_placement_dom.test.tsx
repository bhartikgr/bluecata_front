/**
 * WAVE 234 — THE AUTHORITY SENTENCE, WHERE THE FIELD IT EXPLAINS IS READ.
 *
 * WHAT THIS WAVE IS. A PLACEMENT fix. The band document cited the wrong constant.
 * Verified before building: the six labelled fields already exist, the sentence
 * already exists (`SPV_ON_BEHALF_GATE_COPY.AUTHORITY_ARTIFACT_REQUIRED`), and its
 * predicate already exists (`localSpvOnBehalfBlockers`). Nothing is authored. One
 * sibling is appended after the `<dl>` so the sentence sits beside the em-dash it
 * explains, instead of only further down the page inside `SpvOnBehalfPanel`.
 *
 * WHY THIS IS NOT A REPLICA. The real page module's DEFAULT EXPORT is mounted and
 * the detail view is reached through the real `useRoute` match, so the real
 * `ManagedFounderDetail` (which is NOT exported and cannot be mounted directly)
 * renders. The only doubles are the transport, the shell, the toast and the role
 * hook — the same doubles the pre-existing suite for this page uses
 * (`PartnerManagedFounders.createEngagement.test.tsx`). Nothing in the code under
 * test is re-implemented here.
 *
 * ANTI-VACUITY — every assertion has an opposite pole, and the poles are reached by
 * MOVING THE FIXTURE rather than by asserting a constant:
 *
 *   1. Mode A + no artifact          → note PRESENT.
 *      artifact present              → note ABSENT.        (fixture moved)
 *      Mode B + no artifact          → note ABSENT.        (fixture moved, Mode B excluded)
 *   2. The rendered text is compared BYTE FOR BYTE to the exported constant, with
 *      NO normalising call — no `.trim()`, no `.toLowerCase()`, no whitespace
 *      collapse — so rendering a paraphrase or the WRONG constant
 *      (`MF_ERROR_COPY.AUTHORITY_ARTIFACT_REQUIRED`, different wording) fails.
 *   3. PLACEMENT is asserted structurally: the note is a FOLLOWING SIBLING of the
 *      `<dl>`, is NOT inside it, and the `<dl>` still holds exactly six pairs. A
 *      seventh cell, or the note landing before the grid, fails.
 *   4. NO FINGERPRINT IS SURFACED: in the populated pole the note is absent, and in
 *      the absent pole the only thing rendered is the sentence. Asserted both ways.
 *   5. NOTHING IS GATED and NOTHING IS REMOVED: the pre-existing blocker list and
 *      the on-behalf panel still render in the same fixture, and the six field
 *      labels and their values are unchanged.
 *
 * EVERY DOM QUERY IS SCOPED to the `mf-detail` container — an unscoped query is one
 * of the nine known inert-proof mechanisms, and this page renders the same sentence
 * in two places by design, so an unscoped query would prove nothing about placement.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerManagedFounders from "../PartnerManagedFounders";
import { SPV_ON_BEHALF_GATE_COPY, localSpvOnBehalfBlockers } from "../PartnerManagedFounders";

const ENGAGEMENT_ID = "mfe_w234";
const COMPANY_ID = "co_w234";

/* The three fixture dials. Each test moves one and asserts the DOM follows. */
let engagementMode: "A" | "B" = "A";
let authorityArtifactRef: string | null = null;
let authorityExpiresAt: string | null = null;
let subRole = "managing_partner";

function engagementFixture() {
  return {
    id: ENGAGEMENT_ID,
    companyId: COMPANY_ID,
    mode: engagementMode,
    status: "ACTIVE",
    authorityArtifactRef,
    authorityExpiresAt,
    trialExpiresAt: null,
    chapterId: null,
    matterId: null,
    createdAt: "2026-08-01T00:00:00.000Z",
  };
}

vi.mock("@/components/partner/PartnerShell", () => ({
  PartnerShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PartnerEmptyState: ({ title }: { title?: string }) => <div data-testid="empty-state">{title}</div>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

/* The detail route is ALWAYS matched here: this wave only concerns the detail view. */
vi.mock("wouter", () => ({
  useRoute: () => [true, { id: ENGAGEMENT_ID }],
  Link: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "p_w234",
      tier: "builder",
      subRole,
      identity: { userId: "u_w234", email: "w234@example.com", name: "W234 Partner" },
    },
  }),
}));

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
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
  engagementMode = "A";
  authorityArtifactRef = null;
  authorityExpiresAt = null;
  subRole = "managing_partner";
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (method: string, url: string) => {
    if (url === "/api/partner/me/mfcrm/capability") {
      return jsonResponse(200, {
        capability: {
          partnerId: "p_w234",
          partnerType: "angel_network",
          classified: true,
          delegatedAgency: true,
          advisoryCoseat: true,
          sourcesCapital: true,
          updatedAt: "2026-08-01T00:00:00.000Z",
        },
      });
    }
    if (url === "/api/partner/me/mfcrm/dashboard") {
      return jsonResponse(200, {
        classified: true,
        partnerType: "angel_network",
        engagements: { total: 1, active: 1, modeA: 1, modeB: 0, lapsed: 0 },
        openCrossoverFlags: 0,
        queuedPushes: 0,
      });
    }
    if (url === "/api/partner/me/mfcrm/engagements" && method === "GET") {
      return jsonResponse(200, { engagements: [engagementFixture()] });
    }
    if (url === "/api/partner/me/portfolio") {
      return jsonResponse(200, { portfolio: [{ companyId: COMPANY_ID, companyName: "W234 Co" }] });
    }
    if (url === `/api/partner/me/mfcrm/engagements/${ENGAGEMENT_ID}`) {
      return jsonResponse(200, { engagement: engagementFixture(), trial: null });
    }
    if (url === `/api/partner/me/mfcrm/engagements/${ENGAGEMENT_ID}/events`) {
      return jsonResponse(200, { events: [] });
    }
    if (url.startsWith("/api/partner/me/mfcrm/layers/")) {
      return jsonResponse(200, { layers: [] });
    }
    if (url.startsWith("/api/partner/me/mfcrm/spv-on-behalf")) {
      return jsonResponse(200, { vehicles: [] });
    }
    if (url.startsWith("/api/partner/me/mfcrm/handovers")) {
      return jsonResponse(200, { handovers: [] });
    }
    throw new Error(`unexpected request ${method} ${url}`);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderDetail(): Promise<HTMLElement> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PartnerManagedFounders />
    </QueryClientProvider>,
  );
  /* The real detail component, reached through the real route match. */
  return screen.findByTestId("mf-detail");
}

/** The `<dl>` of six labelled fields the preflight identified. Scoped, never global. */
function detailGrid(detail: HTMLElement): HTMLElement {
  const dl = detail.querySelector("dl");
  if (!dl) throw new Error("the six-field <dl> is missing — the page shape changed");
  return dl as HTMLElement;
}

describe("W234 §1 — the sentence appears where the field it explains is read", () => {
  it("Mode A with NO authority artifact → the note renders inside mf-detail", async () => {
    const detail = await renderDetail();
    const note = await waitFor(() => {
      const n = detail.querySelector('[data-testid="mf-detail-authority-note"]');
      if (!n) throw new Error("note not rendered");
      return n as HTMLElement;
    });
    expect(note.textContent).toBeTruthy();
  });

  it("the rendered text is BYTE-IDENTICAL to the exported constant — no normalising call", async () => {
    const detail = await renderDetail();
    const note = await waitFor(() => {
      const n = detail.querySelector('[data-testid="mf-detail-authority-note"]');
      if (!n) throw new Error("note not rendered");
      return n as HTMLElement;
    });
    /* Raw `textContent`, compared with `toBe`. No `.trim()`, no `.toLowerCase()`,
       no whitespace collapse — a normalising call inside an equality assertion is
       one of the nine known inert-proof mechanisms. */
    expect(note.textContent).toBe(SPV_ON_BEHALF_GATE_COPY.AUTHORITY_ARTIFACT_REQUIRED);
  });

  it("it is the RIGHT constant — not MF_ERROR_COPY's differently-worded sibling", async () => {
    const detail = await renderDetail();
    const note = await waitFor(() => {
      const n = detail.querySelector('[data-testid="mf-detail-authority-note"]');
      if (!n) throw new Error("note not rendered");
      return n as HTMLElement;
    });
    /* The band document pointed at MF_ERROR_COPY.AUTHORITY_ARTIFACT_REQUIRED, which
       reads "Mode A requires a reference to the signed authority artifact that
       grants your firm delegated agency." That is about CREATING an engagement, not
       reading one. Asserting its distinctive phrase is absent pins the correction. */
    expect(note.textContent).toContain("has no signed authority artifact on record");
    expect(note.textContent).not.toContain("Mode A requires a reference");
    /* And the two constants really are different strings, so the assertion above is
       not vacuously true. */
    expect(SPV_ON_BEHALF_GATE_COPY.AUTHORITY_ARTIFACT_REQUIRED).not.toContain(
      "Mode A requires a reference",
    );
  });
});

describe("W234 §2 — PLACEMENT: one appended sibling, not a seventh field", () => {
  it("the note is a FOLLOWING SIBLING of the <dl>, and is NOT inside it", async () => {
    const detail = await renderDetail();
    await waitFor(() => {
      if (!detail.querySelector('[data-testid="mf-detail-authority-note"]')) throw new Error("wait");
    });
    const dl = detailGrid(detail);
    const note = detail.querySelector('[data-testid="mf-detail-authority-note"]') as HTMLElement;

    // Not a descendant of the definition list — so it is not a seventh cell.
    expect(dl.contains(note)).toBe(false);
    // Same parent as the <dl>: a true sibling.
    expect(note.parentElement).toBe(dl.parentElement);
    // AFTER it, not before. DOCUMENT_POSITION_FOLLOWING === 4.
    // eslint-disable-next-line no-bitwise
    expect(dl.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the six labelled fields are untouched — still exactly six pairs, same labels", async () => {
    const detail = await renderDetail();
    const dl = detailGrid(detail);
    const dts = Array.from(dl.querySelectorAll("dt")).map((n) => n.textContent);
    const dds = dl.querySelectorAll("dd");
    expect(dts).toEqual([
      "Authority artifact",
      "Authority expires",
      "Trial expires",
      "Chapter",
      "Matter",
      "Created",
    ]);
    expect(dds.length).toBe(6);
  });

  it("the note sits ABOVE the on-behalf panel, so it is read with the fields", async () => {
    const detail = await renderDetail();
    await waitFor(() => {
      if (!detail.querySelector('[data-testid="mf-detail-authority-note"]')) throw new Error("wait");
    });
    const note = detail.querySelector('[data-testid="mf-detail-authority-note"]') as HTMLElement;
    const panelBlocked = detail.querySelector('[data-testid="mf-sob-blocked"]');
    /* The pre-existing rendering of the same sentence is still there (nothing was
       moved or removed — R195.5), and the new one comes first in reading order. */
    expect(panelBlocked).not.toBeNull();
    // eslint-disable-next-line no-bitwise
    expect(
      note.compareDocumentPosition(panelBlocked as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("W234 §3 — the opposite poles, reached by MOVING THE FIXTURE", () => {
  it("artifact PRESENT → the note is ABSENT (and no fingerprint is surfaced)", async () => {
    authorityArtifactRef = "AUTH-W234-PRESENT";
    const detail = await renderDetail();
    // The field itself renders its value, as it always did.
    await waitFor(() => {
      const dl = detailGrid(detail);
      if (!dl.textContent?.includes("AUTH-W234-PRESENT")) throw new Error("wait for value");
    });
    // ...and this wave adds nothing when there is nothing missing.
    expect(detail.querySelector('[data-testid="mf-detail-authority-note"]')).toBeNull();
  });

  it("Mode B (co-seat) with no artifact → the note is ABSENT — Mode B is EXCLUDED", async () => {
    engagementMode = "B";
    authorityArtifactRef = null;
    const detail = await renderDetail();
    // Wait for the detail body to have actually rendered, so this is not a race.
    await waitFor(() => {
      if (!detailGrid(detail).querySelector("dd")) throw new Error("wait");
    });
    expect(detail.querySelector('[data-testid="mf-detail-authority-note"]')).toBeNull();
    /* Positive control for the same render: Mode B produces its OWN blocker copy in
       the panel below, so the page is definitely populated and the absence above is
       a real exclusion, not an empty page. */
    await waitFor(() => {
      const blocked = detail.querySelector('[data-testid="mf-sob-blocked"]');
      if (!blocked) throw new Error("wait for panel");
      expect(blocked.textContent).toContain("Mode B (advisory co-seat)");
    });
  });

  it("the flag tracks the fixture in BOTH directions within one suite", async () => {
    // Absent → present.
    let detail = await renderDetail();
    await waitFor(() => {
      if (!detail.querySelector('[data-testid="mf-detail-authority-note"]')) throw new Error("wait");
    });
    expect(detail.querySelector('[data-testid="mf-detail-authority-note"]')).not.toBeNull();

    cleanup();
    authorityArtifactRef = "AUTH-W234-NOW-RECORDED";
    detail = await renderDetail();
    await waitFor(() => {
      if (!detailGrid(detail).textContent?.includes("AUTH-W234-NOW-RECORDED")) throw new Error("wait");
    });
    expect(detail.querySelector('[data-testid="mf-detail-authority-note"]')).toBeNull();
  });
});

describe("W234 §4 — the predicate is the EXISTING one, not a new rule", () => {
  it("localSpvOnBehalfBlockers is what decides, and it already existed", () => {
    const base = {
      id: ENGAGEMENT_ID,
      companyId: COMPANY_ID,
      status: "ACTIVE",
      authorityExpiresAt: null,
      trialExpiresAt: null,
      chapterId: null,
      matterId: null,
      createdAt: "2026-08-01T00:00:00.000Z",
    };
    const missingA = localSpvOnBehalfBlockers({
      ...base,
      mode: "A",
      authorityArtifactRef: null,
    } as never);
    const presentA = localSpvOnBehalfBlockers({
      ...base,
      mode: "A",
      authorityArtifactRef: "AUTH-1",
    } as never);
    expect(missingA).toContain(SPV_ON_BEHALF_GATE_COPY.AUTHORITY_ARTIFACT_REQUIRED);
    expect(presentA).not.toContain(SPV_ON_BEHALF_GATE_COPY.AUTHORITY_ARTIFACT_REQUIRED);
    /* A whitespace-only reference counts as absent — the existing helper's own rule
       (`!e.authorityArtifactRef.trim()`), asserted so this wave cannot be credited
       with a rule it did not write, and cannot silently diverge from it either. */
    expect(
      localSpvOnBehalfBlockers({ ...base, mode: "A", authorityArtifactRef: "   " } as never),
    ).toContain(SPV_ON_BEHALF_GATE_COPY.AUTHORITY_ARTIFACT_REQUIRED);
  });

  it("a whitespace-only reference renders the note over the REAL page too", async () => {
    authorityArtifactRef = "   ";
    const detail = await renderDetail();
    await waitFor(() => {
      if (!detail.querySelector('[data-testid="mf-detail-authority-note"]')) throw new Error("wait");
    });
    expect(
      (detail.querySelector('[data-testid="mf-detail-authority-note"]') as HTMLElement).textContent,
    ).toBe(SPV_ON_BEHALF_GATE_COPY.AUTHORITY_ARTIFACT_REQUIRED);
  });
});

describe("W234 §5 — nothing gated, nothing removed, nothing claimed", () => {
  it("no control was hidden, disabled or removed by this wave", async () => {
    const detail = await renderDetail();
    await waitFor(() => {
      if (!detail.querySelector('[data-testid="mf-detail-authority-note"]')) throw new Error("wait");
    });
    /* The pre-existing panel, its blocker list and the back link all still render.
       The note is text; it gates nothing (R190.10) and removes nothing (R195.5). */
    /* The back link is asserted by its TEXT, not its testid. `Link` is doubled by
       the `wouter` mock as `<span>{children}</span>`, which passes the children
       through but drops the `data-testid` — so a testid query here would fail for a
       harness reason and prove nothing about the page. Found by running it. */
    expect(detail.textContent).toContain("Back to Managed Founders");
    expect(detail.querySelector('[data-testid="mf-sob-blocked"]')).not.toBeNull();
    expect(detail.querySelectorAll('[data-testid="mf-sob-blocker"]').length).toBeGreaterThan(0);
    // No new disabled control appeared anywhere in the detail view.
    const disabled = Array.from(detail.querySelectorAll("button,input,select,textarea")).filter(
      (el) => (el as HTMLButtonElement).disabled === true,
    );
    expect(disabled.length).toBe(0);
  });

  it("the note claims no check and says nothing about any person", async () => {
    const detail = await renderDetail();
    await waitFor(() => {
      if (!detail.querySelector('[data-testid="mf-detail-authority-note"]')) throw new Error("wait");
    });
    const text = (detail.querySelector('[data-testid="mf-detail-authority-note"]') as HTMLElement)
      .textContent as string;
    for (const forbidden of ["verified", "Verified", "confirmed", "validated", "we checked"]) {
      expect(text.includes(forbidden), forbidden).toBe(false);
    }
    /* It renders no figure and no money: no digit, no currency sign, no percent. */
    expect(/[0-9$€£%]/.test(text)).toBe(false);
  });

  it("the note is not a PANEL tag — appending it renumbers no sibling panel", async () => {
    const detail = await renderDetail();
    await waitFor(() => {
      if (!detail.querySelector('[data-testid="mf-detail-authority-note"]')) throw new Error("wait");
    });
    const note = detail.querySelector('[data-testid="mf-detail-authority-note"]') as HTMLElement;
    /* The guard's PANEL_TAGS are Card*/ /* Table*, TabsContent, Dialog*, Sheet*,
       Accordion*, form, section, aside, nav, table, thead, tbody, tr, th, td.
       `div` is not among them, which is why this insertion moves no panel index. */
    expect(note.tagName).toBe("DIV");
    const panelish = ["FORM", "SECTION", "ASIDE", "NAV", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD"];
    expect(panelish.includes(note.tagName)).toBe(false);
  });
});
