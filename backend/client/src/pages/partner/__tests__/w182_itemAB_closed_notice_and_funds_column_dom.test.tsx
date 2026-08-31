/**
 * WAVE 182 · ITEMS A AND B — RENDERED DOM. WHAT THE GENERAL PARTNER ACTUALLY SEES.
 *
 * WHY A DOM TEST AND NOT ONLY THE ROUTE TESTS. The route tests
 * (server/__tests__/w182_itemA_closed_vehicle_refuses_new_capital.test.ts and
 * .../w182_itemBC_roster_funds_and_carry_configuration.test.ts) prove the server
 * refuses and the payload carries the fact. Neither proves a person is TOLD. R137:
 * a fix that passes tests and never reaches the user has not been made. Every
 * assertion below reads text out of the mounted real page.
 *
 * ITEM A — the vehicle is closed, and the form says so BEFORE anything is typed.
 * On live, this form accepted $50,000 into a closed SPV with no refusal and no
 * warning. §A1 asserts the statement is on screen while the vehicle is closed and
 * names the vehicle; §A2 asserts it is ABSENT (empty) while the vehicle is open, so
 * the notice cannot be a permanent decoration; §A3 asserts the server's refusal
 * reaches the toast in WORDS through the real `apiRequest`/`ApiError`/`<Toaster/>`
 * path, with no ALL-CAPS underscore code anywhere in rendered text (R152 item 3);
 * and §A4 asserts the submit control is NOT disabled — enforcement is the store and
 * the route, and a form whose button vanishes teaches a GP nothing about why.
 *
 * ITEM B — "Committed" is not the same fact as "funds received". §B1 mounts a
 * roster of two LPs, one funds-confirmed and one not, and asserts they are visibly
 * distinguished on the real page while the EXISTING "Committed" status text stays
 * byte-verbatim on BOTH rows (R143.1: a replaced text node scores as removed copy).
 *
 * `global.fetch` is stubbed rather than `@/lib/queryClient`, deliberately, because
 * `throwIfResNotOk` discards a server `message` that does not "look human" — the
 * exact boundary that would silently defeat Item A's refusal copy. The real
 * boundary stays in the path.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerSpvDetail from "../PartnerSpvDetail";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  SPV_CLOSED_TO_NEW_CAPITAL_CODE,
  spvClosedToNewCapitalHeadline,
  spvClosedToNewCapitalSentence,
} from "@shared/spvClosedToNewCapital";

/** R77 / R152 item 3 — an ALL_CAPS_UNDERSCORE token in rendered text is a breach. */
const INTERNAL_CODE_TOKEN = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/;

const SPV_ID = "spv_w182";
const SPV_NAME = "W182 Closed Vehicle";

let spvStatus: "open" | "closed" = "closed";
let rosterSubscribers: Array<Record<string, unknown>> = [];
let writeFailure: { status: number; body?: unknown } | null = null;

function response(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    headers: { get: () => "application/json" },
    text: async () => text,
    json: async () => JSON.parse(text),
    clone: () => response(status, body),
  } as unknown as Response;
}

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      const method = (init?.method ?? "GET").toUpperCase();
      if (method !== "GET") {
        if (writeFailure) return response(writeFailure.status, writeFailure.body ?? {});
        return response(201, { ok: true });
      }
      if (u.includes("lp-roster")) {
        return response(200, {
          spvId: SPV_ID,
          lpVisibility: "gp_only",
          subscribers: rosterSubscribers,
          invites: [],
        });
      }
      if (u.includes("capital-calls")) return response(200, { capitalCalls: [] });
      if (u.includes("distributions")) return response(200, { distributions: [] });
      return response(200, {
        spv: {
          id: SPV_ID,
          name: SPV_NAME,
          jurisdiction: "delaware",
          spvType: "spv",
          targetRaiseMinor: null,
          capMinor: null,
          currency: "USD",
          status: spvStatus,
          revisionHash: "c".repeat(64),
          createdAt: new Date().toISOString(),
          terms: null,
        },
        positions: [],
      });
    }),
  );
}

vi.mock("@/components/partner/PartnerShell", () => ({
  PartnerShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PartnerEmptyState: ({ title }: { title?: string }) => <div>{title}</div>,
}));
vi.mock("wouter", () => ({
  useRoute: () => [true, { id: SPV_ID }],
  Link: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "p_w182",
      tier: "builder",
      subRole: "managing_partner",
      identity: { userId: "u_w182", email: "gp@example.com", name: "W182 GP" },
    },
  }),
}));
vi.mock("@/lib/sseClient", () => ({ useSse: () => {}, sseSubscribe: () => () => {} }));

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const r = render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <PartnerSpvDetail />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  await screen.findByTestId("partner-spv-lp-commit-form");
  return r;
}

function type(testid: string, value: string) {
  fireEvent.change(screen.getByTestId(testid) as HTMLInputElement, { target: { value } });
}

async function submitCommit(amount = "50000") {
  type("partner-spv-lp-commit-firstname", "Postclose");
  type("partner-spv-lp-commit-lastname", "Tester");
  type("partner-spv-lp-commit-email", "postclose@example.com");
  type("partner-spv-lp-commit-units", "10");
  type("partner-spv-lp-commit-amount", amount);
  fireEvent.click(screen.getByTestId("partner-spv-lp-commit-submit"));
}

/* One toast, identified by a marker unique to this scenario: `use-toast`'s store is
   module-global and survives cleanup(), so reading the whole viewport would let
   another test's toast satisfy an assertion here. */
async function toastTextContaining(marker: string): Promise<string> {
  return await waitFor(
    () => {
      const nodes = Array.from(document.querySelectorAll("li, [role='status'], [data-radix-collection-item]"));
      const hit = nodes.find((n) => (n.textContent ?? "").includes(marker));
      if (!hit) {
        const viewport = Array.from(document.querySelectorAll("li, [role='status']"))
          .map((n) => n.textContent ?? "")
          .join(" | ");
        throw new Error(`no toast containing "${marker}" — viewport shows: ${viewport}`);
      }
      return hit.textContent ?? "";
    },
    { timeout: 4000 },
  );
}

beforeEach(() => {
  spvStatus = "closed";
  rosterSubscribers = [];
  writeFailure = null;
  installFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("W182 ITEM A · DOM — a closed vehicle says so on the commit form", () => {
  it("§A1 the notice is on screen while the vehicle is closed, names the vehicle, and carries no code", async () => {
    await mount();
    const notice = await screen.findByTestId("partner-spv-lp-commit-closed-notice");
    const text = notice.textContent ?? "";
    expect(text).toContain(SPV_NAME);
    expect(text.toLowerCase()).toContain("closed to new limited partners");
    /* The two facts that keep the refusal from being a dead end. */
    expect(text.toLowerCase()).toContain("confirmed");
    expect(text.toLowerCase()).toContain("rolling close");
    expect(text).not.toMatch(INTERNAL_CODE_TOKEN);
  });

  it("§A2 the SAME element is empty while the vehicle is OPEN", async () => {
    /* The negative control is an assertion about this element rather than about an
       absent one: an always-rendered node cannot drift into a permanent warning,
       and no sibling shape moves between the two states. */
    spvStatus = "open";
    await mount();
    const notice = await screen.findByTestId("partner-spv-lp-commit-closed-notice");
    expect((notice.textContent ?? "").trim()).toBe("");
  });

  it("§A3 the server's 409 refusal reaches the GP as words, not as a code", async () => {
    writeFailure = {
      status: 409,
      body: {
        error: SPV_CLOSED_TO_NEW_CAPITAL_CODE,
        message: spvClosedToNewCapitalHeadline(SPV_NAME),
        guidance: spvClosedToNewCapitalSentence({ spvName: SPV_NAME, reason: "new_limited_partner" }),
        closedToNewLps: { reason: "new_limited_partner" },
      },
    };
    await mount();
    await submitCommit();
    const text = await toastTextContaining(SPV_NAME);
    expect(text.toLowerCase()).toContain("closed to new limited partners");
    /* THE POINT OF R152 ITEM 3: the machine code travelled in `error` for support,
       and NONE of it reached the screen. */
    expect(text).not.toContain(SPV_CLOSED_TO_NEW_CAPITAL_CODE);
    expect(text).not.toMatch(INTERNAL_CODE_TOKEN);
  });

  it("§A4 the submit control is NOT disabled by the closed state", async () => {
    /* Deliberate. A disabled button is not enforcement — the store and the route
       are — and disabling it would remove the surface on which the refusal is
       explained, leaving a GP with a dead control and no reason. */
    await mount();
    const button = screen.getByTestId("partner-spv-lp-commit-submit") as HTMLButtonElement;
    type("partner-spv-lp-commit-firstname", "Postclose");
    type("partner-spv-lp-commit-lastname", "Tester");
    type("partner-spv-lp-commit-email", "postclose@example.com");
    type("partner-spv-lp-commit-units", "10");
    type("partner-spv-lp-commit-amount", "50000");
    expect(button.disabled).toBe(false);
  });
});

describe("W182 ITEM B · DOM — a promise and received funds are visibly different", () => {
  it("§B1 two LPs are distinguished on the real roster, and 'Committed' survives on both", async () => {
    rosterSubscribers = [
      {
        investorId: "lp_confirmed", name: "Connie Confirmed", email: "connie@example.com",
        commitmentMinor: 300_000_00, status: "committed", ownershipPct: 0.6, fundsConfirmed: true,
      },
      {
        investorId: "lp_awaiting", name: "Aaron Awaiting", email: "aaron@example.com",
        commitmentMinor: 150_000_00, status: "committed", ownershipPct: 0.4, fundsConfirmed: false,
      },
    ];
    await mount();
    await screen.findByTestId("partner-spv-lp-roster-table");

    const confirmedCell = screen.getByTestId("partner-spv-lp-funds-lp_confirmed");
    const awaitingCell = screen.getByTestId("partner-spv-lp-funds-lp_awaiting");
    expect(confirmedCell.textContent).toBe("Funds confirmed");
    expect(awaitingCell.textContent).toBe("Funds not yet confirmed");
    /* VISIBLY DIFFERENT — the whole defect was that these two rows read the same. */
    expect(confirmedCell.textContent).not.toBe(awaitingCell.textContent);

    /* R143.1 — the EXISTING status literal is byte-verbatim on BOTH rows. The fix
       adds a fact; it renames nothing. */
    const confirmedRow = screen.getByTestId("partner-spv-lp-sub-lp_confirmed");
    const awaitingRow = screen.getByTestId("partner-spv-lp-sub-lp_awaiting");
    expect(confirmedRow.textContent).toContain("Committed");
    expect(awaitingRow.textContent).toContain("Committed");

    /* The funds statement is a SEPARATE element from the status literal, so
       "Committed" is still independently readable and nothing was renamed. The
       status cell is the funds statement's parent — the sibling relationship the
       silent-drop guard requires, asserted on the rendered tree rather than
       assumed from source. */
    expect(confirmedCell.parentElement!.tagName).toBe("TD");
    expect(confirmedCell.parentElement!.childNodes[0]!.textContent).toBe("Committed");

    /* And the existing header the GP reads is still there. */
    expect(screen.getByTestId("partner-spv-lp-roster-table").textContent).toContain("Status");
  });

  it("§B2 a payload with NO fundsConfirmed key reads \"Funds not yet confirmed\", never blank and never \"Funds confirmed\"", async () => {
    /* A cached body from before this wave is not evidence that funds arrived. */
    rosterSubscribers = [
      {
        investorId: "lp_legacy", name: "Lee Legacy", email: "lee@example.com",
        commitmentMinor: 100_000_00, status: "committed", ownershipPct: 1,
      },
    ];
    await mount();
    await screen.findByTestId("partner-spv-lp-roster-table");
    const cell = screen.getByTestId("partner-spv-lp-funds-lp_legacy");
    expect(cell.textContent).toBe("Funds not yet confirmed");
    expect(cell.textContent).not.toBe("");
  });
});
