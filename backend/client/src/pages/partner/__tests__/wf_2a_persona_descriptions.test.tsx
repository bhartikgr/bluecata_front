/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * WALKTHROUGH WAVE F · ITEM 2a — THE PERSONA-TOOLS PAGE EXPLAINS ITSELF.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * THE OWNER: "Analyze each functionality and ensure it works dynamically… It
 * requires additional descriptions throughout the page, as I suspect Consortium
 * Partners may be confused about what this section is about."
 *
 * ── THE CLAIM RE-MEASURED BEFORE ANYTHING WAS BUILT ─────────────────────────────
 * "Works dynamically" was already true and is NOT rebuilt here: the page holds no
 * hardcoded persona. It reads one row through `GET /api/partner/me/mfcrm/
 * capability`, resolves the persona from it, and every tool's availability comes
 * from a capability flag on that row. This file proves that by DRIVING THE SEAM —
 * three different capability payloads produce three different pages — rather than
 * by asserting it. A description that appears no matter what the server says is
 * not a description of anything.
 *
 * ── WHAT WAS ACTUALLY MISSING ───────────────────────────────────────────────────
 * Nothing on screen said what the Managed Founder CRM is, that the tool set is
 * decided by an ADMINISTRATOR'S classification rather than by anything the
 * partner chose, or that the on/off chips are the reason a tool refuses. Item 2a
 * adds one intro block answering those three questions, plus a description on
 * every tool section that lacked one.
 *
 * ── THE GUARD CANNOT SEE ANY OF IT ──────────────────────────────────────────────
 * Every sentence item 2a added is new in this wave, so the silent-drop guard —
 * which diffs against a stored baseline — is blind to all of it. It is asserted
 * here by rendered text, because nothing else will.
 *
 * ── COPY MUST BE TRUE IN EVERY BRANCH ───────────────────────────────────────────
 * The intro block is rendered ABOVE the loading, error, unclassified and resolved
 * branches. That is only defensible if it contains nothing that could be false
 * while the capability read is failing, so both halves are tested: it is present
 * on all four branches, and it states no figure, count or status.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import PartnerMfcrmPersonas from "../PartnerMfcrmPersonas";

vi.mock("@/components/partner/PartnerShell", () => ({
  PartnerShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PartnerEmptyState: ({ title, description }: { title?: string; description?: string }) => (
    <div data-testid="empty-state">
      <div>{title}</div>
      <div>{description}</div>
    </div>
  ),
  TierBadge: () => <span />,
  SubRoleBadge: () => <span />,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/partner/useRequirePartnerRole", async () => ({
  ...(await vi.importActual<typeof import("@/lib/partner/useRequirePartnerRole")>(
    "@/lib/partner/useRequirePartnerRole",
  )),
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "p_wf",
      tier: "nexus",
      subRole: "managing_partner",
      identity: { userId: "u_wf", email: "wf@example.com", name: "Northgate Capital Partners" },
    },
  }),
}));

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "200",
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

/* THREE REAL CAPABILITY ROWS, one per persona, with the gate flags on. These are
   the shape `mf_capability_profile` stores; the persona is never chosen by this
   file, only the row is supplied. */
/* THE FIELD NAMES AND THE partnerType VALUES ARE READ FROM THE REAL SHARED
   MODULE, NOT INVENTED. The first version of this file guessed
   "accounting_firm" / "law_firm" and invented flags like `custodyEnabled`;
   `resolvePersona` (mfcrmPersona.ts:233) matches on the exact strings
   "angel_network" / "accounting" / "law", so two of the three fixtures resolved
   to NO persona and the page correctly rendered its unclassified empty state.
   THAT RED WAS THE FIXTURE'S FAULT, NOT THE PAGE'S — a fixture no server value
   can move is the inert mechanism this brief names, and the fix is to make the
   fixture real rather than to loosen the assertion. Every flag below is a
   declared field of `MfcrmCapability` (mfcrmPersona.ts:53-68). */
const CAP_BASE = {
  partnerId: "p_wf",
  classified: true,
  sourcesCapital: false,
  delegatedAgency: false,
  spvWriteAuthority: false,
  advisoryCoseat: false,
  documentCustody: false,
  paysOnBehalf: false,
  attributionTracking: false,
  collectiveFronting: false,
  chapterScoping: false,
  fundAdmin: false,
  updatedAt: "2026-09-01T00:00:00.000Z",
};
const ANGEL = { ...CAP_BASE, partnerType: "angel_network", chapterScoping: true, attributionTracking: true };
const ACCT = { ...CAP_BASE, partnerType: "accounting", paysOnBehalf: true, documentCustody: true, fundAdmin: true };
const LAW = { ...CAP_BASE, partnerType: "law", documentCustody: true, advisoryCoseat: true };

type Mode = "angel" | "acct" | "law" | "unclassified" | "error" | "loading";
let mode: Mode = "angel";

beforeEach(() => {
  mode = "angel";
  apiRequestMock.mockReset();
  apiRequestMock.mockImplementation(async (_m: string, url: string) => {
    if (url === "/api/partner/me/mfcrm/capability") {
      if (mode === "error") throw new Error("capability read failed");
      if (mode === "loading") await new Promise(() => {}); // never resolves
      if (mode === "unclassified") return jsonResponse({ capability: { classified: false } });
      return jsonResponse({
        capability: mode === "angel" ? ANGEL : mode === "acct" ? ACCT : LAW,
      });
    }
    return jsonResponse({});
  });
});
afterEach(() => cleanup());

function mount(): HTMLElement {
  const root = document.createElement("div");
  root.setAttribute("data-product", "partner");
  document.body.appendChild(root);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PartnerMfcrmPersonas />
    </QueryClientProvider>,
    { container: root },
  );
  return root;
}

async function mountReady(): Promise<HTMLElement> {
  const root = mount();
  await waitFor(() => {
    expect(root.querySelector('[data-testid="mfcrm-persona-intro"]')).not.toBeNull();
  });
  return root;
}

describe("WAVE F · item 2a — the page says what it is, before it says what it can do", () => {
  it("P-1 the three questions a confused partner would ask are all answered on screen", async () => {
    const root = await mountReady();
    const intro = root.querySelector('[data-testid="mfcrm-persona-intro"]')!;
    expect((intro.textContent ?? "").length).toBeGreaterThan(400);

    const heading = root.querySelector('[data-testid="mfcrm-persona-intro-heading"]')!;
    expect(heading.textContent).toBe("Tools built for what your firm does for founders");

    // 1. WHAT IS THIS SECTION?
    const what = root.querySelector('[data-testid="mfcrm-persona-intro-what"]')!.textContent ?? "";
    expect(what).toContain("Managed Founder CRM");
    expect(what).toContain("angel network");
    expect(what).toContain("accounting firm");
    expect(what).toContain("law firm");

    // 2. WHY DO I SEE THESE TOOLS AND NOT OTHERS?
    const cls = root.querySelector('[data-testid="mfcrm-persona-intro-classification"]')!.textContent ?? "";
    expect(cls).toContain("not a setting you choose");
    expect(cls).toContain("classifies your firm");

    // 3. WHY WOULD A TOOL REFUSE ME?
    const gates = root.querySelector('[data-testid="mfcrm-persona-intro-gates"]')!.textContent ?? "";
    expect(gates).toContain("on or off");
    expect(gates).toContain("sub-role");
  });

  it("P-2 THE PAGE IS DYNAMIC — three different capability rows produce three different pages", async () => {
    const seen = new Map<Mode, string>();
    for (const m of ["angel", "acct", "law"] as Mode[]) {
      mode = m;
      const root = await mountReady();
      await waitFor(() => {
        expect(root.querySelector('[data-testid="mfcrm-persona-label"]')).not.toBeNull();
      });
      seen.set(m, root.querySelector('[data-testid="mfcrm-persona-label"]')!.textContent ?? "");
      cleanup();
    }
    expect(seen.size).toBe(3);
    // Three DISTINCT labels — a hardcoded persona would give one repeated string.
    expect(new Set(Array.from(seen.values())).size).toBe(3);
    for (const v of seen.values()) expect(v.length).toBeGreaterThan(0);
  });

  it("P-3 EVERY TOOL SECTION NOW CARRIES A DESCRIPTION — no bare title anywhere", async () => {
    for (const m of ["angel", "acct", "law"] as Mode[]) {
      mode = m;
      const root = await mountReady();
      await waitFor(() => {
        expect(root.querySelector('[data-testid^="mfcrm-"][data-testid*="-"]')).not.toBeNull();
      });
      const sections = Array.from(root.querySelectorAll("section[data-testid]"));
      expect(sections.length, `no tool sections rendered for ${m}`).toBeGreaterThan(0);
      for (const s of sections) {
        const h3 = s.querySelector("h3");
        expect(h3, `section ${s.getAttribute("data-testid")} has no title`).not.toBeNull();
        const p = s.querySelector("p");
        expect(
          p,
          `section "${h3!.textContent}" (${s.getAttribute("data-testid")}) has a title but NO description`,
        ).not.toBeNull();
        expect((p!.textContent ?? "").trim().length).toBeGreaterThan(20);
      }
      cleanup();
    }
  });

  it("P-4 THE INTRO IS TRUE IN EVERY BRANCH — loading, error, unclassified and resolved", async () => {
    for (const m of ["loading", "error", "unclassified", "angel"] as Mode[]) {
      mode = m;
      const root = mount();
      await waitFor(() => {
        expect(
          root.querySelector('[data-testid="mfcrm-persona-intro"]'),
          `the intro is missing on the "${m}" branch`,
        ).not.toBeNull();
      });
      cleanup();
    }
  });

  it("P-5 THE INTRO STATES NO FIGURE, so nothing in it can be false while the read fails", async () => {
    mode = "error";
    const root = mount();
    await waitFor(() => {
      expect(root.querySelector('[data-testid="mfcrm-persona-intro"]')).not.toBeNull();
    });
    const text = root.querySelector('[data-testid="mfcrm-persona-intro"]')!.textContent ?? "";
    expect(text).not.toMatch(/[$€£]/);
    expect(text).not.toMatch(/\b\d+\s*%/);
    expect(text).not.toMatch(/\b\d[\d,.]*\b/);
  });

  it("P-6 NO INTERNAL LANGUAGE — a partner is never shown a table, column or sprint name", async () => {
    const root = await mountReady();
    const text = root.querySelector('[data-testid="mfcrm-persona-intro"]')!.textContent ?? "";
    for (const banned of ["mf_capability_profile", "Sprint", "sprint", "wave", "WAVE", "_enabled", "API", "endpoint"]) {
      expect(text, `internal language leaked to the partner: "${banned}"`).not.toContain(banned);
    }
  });
});
