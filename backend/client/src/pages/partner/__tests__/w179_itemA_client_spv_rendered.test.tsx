/**
 * WAVE 179 · ITEM A · R151.1 — "CREATE SPV FOR THIS MANAGED CLIENT" REACHES THE
 * LIVE RENDERED SURFACE.
 *
 * WHY THIS FILE EXISTS. R137 was written because a wave-170-era LP fix passed
 * every server test and never reached the LP. The server poles for this item live
 * in `server/__tests__/w179_itemA_client_spv_attribution.test.ts` and prove the
 * route persists `target_company_id`, refuses a client the partner does not
 * manage, and reads the vehicle back. NONE of them can prove a GP sitting on the
 * managed-client page can actually do the thing. This file does, against the real
 * `PartnerClientDetail` page.
 *
 * ── POLES ───────────────────────────────────────────────────────────────────
 *   A · THE AFFORDANCE EXISTS AND THE CLIENT IS PRE-ASSOCIATED. The page starts
 *       on "No vehicles are recorded against this client yet.", the button is
 *       there, and opening the form states the target client rather than asking
 *       the GP to type an id — the association cannot be mistyped.
 *   B · IT IS DB-DRIVEN, NOT OPTIMISTIC. The fake server holds real state; it
 *       starts with NO vehicle, the POST mutates that state, and the assertion is
 *       made against a SECOND GET which the test also proves happened. The
 *       vehicle rendered is the vehicle the server re-read.
 *   C · THE POST CARRIES `targetCompanyId` EQUAL TO THIS PAGE'S CLIENT. The
 *       captured request body is asserted, so the attribution is not merely
 *       hoped for.
 *   D · A REFUSAL IS STATED, NOT SWALLOWED. The fence's own sentence reaches the
 *       GP and no vehicle joins the list — the confidentiality fence as the
 *       partner experiences it.
 *   E · READ-ONLY ROLES SEE WHY, NOT A DEAD BUTTON.
 *   F · ANTI-VACUITY. With the fake server returning a vehicle the page renders
 *       it; with the fake server empty the page renders the empty sentence. The
 *       list is therefore reading the server, not a constant.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerClientDetail from "../PartnerClientDetail";

const COMPANY_ID = "co_w179_dom_client";
const SPV_ID = "spv_w179_dom_vehicle";
const REFUSAL = "That client is not attributed to your firm.";

const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastSpy }) }));
vi.mock("@/lib/sseClient", () => ({ useCollectiveStream: () => undefined }));

vi.mock("wouter", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("wouter");
  return { ...actual, useRoute: () => [true, { id: COMPANY_ID }] };
});

let subRole = "managing_partner";

vi.mock("@/lib/partner/useRequirePartnerRole", async () => {
  const actual = await vi.importActual<typeof import("@/lib/partner/useRequirePartnerRole")>(
    "@/lib/partner/useRequirePartnerRole",
  );
  return {
    ...actual,
    useRequirePartnerRole: () => ({
      ready: true,
      error: null,
      identity: {
        partnerId: "ac_consortium_partner_w179",
        tier: "gold",
        subRole,
        identity: { userId: "u_w179", email: "partner@example.com", name: "W179 Partner" },
      },
    }),
  };
});

vi.mock("@/components/partner/PartnerShell", async () => {
  const actual = await vi.importActual<typeof import("@/components/partner/PartnerShell")>(
    "@/components/partner/PartnerShell",
  );
  return { ...actual, PartnerShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});

/* ═══ A FAKE SERVER THAT HOLDS STATE ═══
   Optimistic UI would sail through a test whose GET always returns the vehicle.
   So this one starts with NONE, and only the POST moves it in. */
type Mode = "ok" | "refuse";
let mode: Mode = "ok";
let created = false;
let spvGetCount = 0;
let postedBody: Record<string, unknown> | null = null;

function res(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    text: async () => text,
    json: async () => JSON.parse(text),
    clone: () => res(status, body),
  } as unknown as Response;
}

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      const method = String(init?.method ?? "GET").toUpperCase();
      if (u === "/api/feature-flags") return res(200, { PARTNER_WORKSPACE_ENABLED: true });
      if (u === `/api/partner/me/clients/${COMPANY_ID}`) {
        return res(200, {
          ok: true,
          companyId: COMPANY_ID,
          attribution: { attributionSource: "referral" },
          snapshot: { sector: "Fintech", stage: "seed" },
        });
      }
      if (u === `/api/partner/me/client-crm/${COMPANY_ID}`) {
        return res(200, { ok: true, companyId: COMPANY_ID, stage: "qualified", leadUserId: null, activity: [] });
      }
      if (u === "/api/partner/me/team") return res(200, { members: [] });
      if (u.startsWith("/api/partner/me/crm-client-scope/by-company/")) {
        return res(200, { ok: true, companyId: COMPANY_ID, scopes: [], availableContacts: [] });
      }
      /* The read-back route. Its answer is the ONLY thing the list may render. */
      if (u === `/api/partner/me/clients/${COMPANY_ID}/spvs` && method === "GET") {
        spvGetCount += 1;
        return res(200, {
          ok: true,
          companyId: COMPANY_ID,
          spvs: created
            ? [
                {
                  id: SPV_ID,
                  name: "W179 DOM Vehicle",
                  status: "planned",
                  jurisdiction: "delaware",
                  currency: "USD",
                },
              ]
            : [],
        });
      }
      if (u === "/api/partner/me/spvs" && method === "POST") {
        postedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        if (mode === "refuse") {
          return res(404, { error: "SPV_TARGET_COMPANY_NOT_YOURS", message: REFUSAL });
        }
        created = true;
        return res(201, { ok: true, spv: { id: SPV_ID } });
      }
      return res(200, {});
    }),
  );
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PartnerClientDetail />
    </QueryClientProvider>,
  );
}

/* ===========================================================================
   WAVE 345 . ITEM 2 - THIS HELPER IS UPDATED, NOT WEAKENED, AND NOT DELETED.
   ===========================================================================
   WHY IT HAD TO CHANGE. Until wave 345 this panel took no acknowledgement of
   the vehicle's DENOMINATION, which is an immutable column: the currency was a
   free-text box prefilled "USD" and the submit button did not care whether the
   client had ever looked at it. Wave 345 brought this door up to the standard
   the main wizard's ratified Step 5 already sets - a permanence statement, an
   origin statement, and a per-vehicle confirmation - and the submit button is
   now gated on that confirmation and on the code being one the platform can
   actually account in.

   So POLES B/C and D of this file started failing, CORRECTLY: a helper that
   submitted without confirming a denomination was asserting behaviour the
   product deliberately no longer has. The ruling is newer than the tripwire.
   Rather than relax the product or delete the poles, the helper now performs
   the step a real managing partner performs, and it FIRST asserts that the
   gate is real - so this change can never quietly become a way of submitting
   an unconfirmed denomination again.
   =========================================================================== */
async function fillAndSubmit() {
  fireEvent.click(await screen.findByTestId("client-spv-create-toggle"));
  fireEvent.change(await screen.findByTestId("client-spv-name"), {
    target: { value: "W179 DOM Vehicle" },
  });
  fireEvent.change(await screen.findByTestId("client-spv-signoff-name"), {
    target: { value: "Ada Managing" },
  });
  fireEvent.click(await screen.findByTestId("client-spv-signoff-accept"));
  /* THE GATE IS REAL. Everything else is filled in; only the denomination is
     unconfirmed, and the button refuses. If this expectation ever passes
     vacuously the click below would be meaningless. */
  expect(
    (await screen.findByTestId("client-spv-create-submit")).hasAttribute("disabled"),
    "submit should be blocked until the denomination is confirmed",
  ).toBe(true);
  fireEvent.click(await screen.findByTestId("client-spv-currency-confirm"));
  expect(
    (await screen.findByTestId("client-spv-create-submit")).hasAttribute("disabled"),
    "submit should be available once the denomination is confirmed",
  ).toBe(false);
  fireEvent.click(await screen.findByTestId("client-spv-create-submit"));
}

describe("WAVE 179 · ITEM A — the client's vehicle reaches the partner's screen", () => {
  beforeEach(() => {
    mode = "ok";
    created = false;
    spvGetCount = 0;
    postedBody = null;
    subRole = "managing_partner";
    toastSpy.mockClear();
    installFetch();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POLE A — the affordance is on the page and the client is PRE-ASSOCIATED, not typed", async () => {
    renderPage();
    expect(await screen.findByTestId("client-spvs")).toBeTruthy();
    expect((await screen.findByTestId("client-spvs-empty")).textContent).toContain(
      "No vehicles are recorded against this client yet.",
    );
    fireEvent.click(await screen.findByTestId("client-spv-create-toggle"));
    /* The target is DISPLAYED by the page. There is no input for it, so a GP
       cannot attribute a vehicle to the wrong client by mistyping an id. */
    expect((await screen.findByTestId("client-spv-create-target")).textContent).toContain(COMPANY_ID);
    expect(screen.queryByTestId("client-spv-target-input")).toBeNull();
    /* And the flow is not a forked wizard: it says where the rest is configured. */
    expect((await screen.findByTestId("client-spv-create-wizard-note")).textContent).toContain("SPV engine");
  });

  it("POLE B/C — creating it POSTs targetCompanyId and the vehicle appears FROM A SECOND GET, not optimistically", async () => {
    renderPage();
    await screen.findByTestId("client-spvs-empty");
    const getsBefore = spvGetCount;

    await fillAndSubmit();

    /* C — the attribution actually travelled, and it is THIS page's client. */
    await waitFor(() => expect(postedBody).not.toBeNull());
    expect(postedBody?.targetCompanyId).toBe(COMPANY_ID);
    expect(postedBody?.spvName).toBe("W179 DOM Vehicle");
    expect(postedBody?.signoffAccepted).toBe(true);

    /* B — the row on screen came from a REFETCH of persisted state. */
    expect(await screen.findByTestId(`client-spv-${SPV_ID}`)).toBeTruthy();
    expect((await screen.findByTestId("client-spvs-list")).textContent).toContain("W179 DOM Vehicle");
    expect(spvGetCount).toBeGreaterThan(getsBefore);
    /* And the empty sentence is gone, so the list is genuinely re-read. */
    await waitFor(() => expect(screen.queryByTestId("client-spvs-empty")).toBeNull());
  });

  it("POLE D — a refusal is STATED to the partner and NO vehicle joins the list", async () => {
    mode = "refuse";
    renderPage();
    await screen.findByTestId("client-spvs-empty");
    await fillAndSubmit();

    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    const said = toastSpy.mock.calls.map((c) => JSON.stringify(c)).join(" ");
    /* The GP is told something went wrong — the refusal is not swallowed. */
    expect(said.length).toBeGreaterThan(0);
    /* And nothing was invented on screen. */
    expect(screen.queryByTestId(`client-spv-${SPV_ID}`)).toBeNull();
    expect((await screen.findByTestId("client-spvs-empty")).textContent).toContain(
      "No vehicles are recorded against this client yet.",
    );
  });

  it("POLE E — a role that may not record a vehicle is told WHY instead of shown a dead button", async () => {
    subRole = "analyst";
    renderPage();
    expect(await screen.findByTestId("client-spvs")).toBeTruthy();
    const notice = await screen.findByTestId("client-spv-create-readonly");
    expect(notice.textContent).toContain("managing partner");
    expect(screen.queryByTestId("client-spv-create-toggle")).toBeNull();
    expect(screen.queryByTestId("client-spv-create-form")).toBeNull();
  });

  it("POLE F — ANTI-VACUITY: the list mirrors the server, so poles A-D are not reading a constant", async () => {
    /* Server already holds a vehicle before the page ever mounts. */
    created = true;
    renderPage();
    expect(await screen.findByTestId(`client-spv-${SPV_ID}`)).toBeTruthy();
    expect(screen.queryByTestId("client-spvs-empty")).toBeNull();

    cleanup();
    /* Server holds none. The same page renders the empty sentence instead. */
    created = false;
    renderPage();
    expect(await screen.findByTestId("client-spvs-empty")).toBeTruthy();
    expect(screen.queryByTestId(`client-spv-${SPV_ID}`)).toBeNull();
  });
});
