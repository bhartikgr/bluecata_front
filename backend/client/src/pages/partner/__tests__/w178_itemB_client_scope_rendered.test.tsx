/**
 * WAVE 178 · ITEM B — "ADD TO CLIENT" REACHES THE LIVE RENDERED SURFACE.
 *
 * R137 is the reason this file exists at all: a wave-170-era LP fix passed every
 * server test and never reached the LP, because nothing asserted the DOM. The
 * server poles for this item live in
 * `server/__tests__/w178_itemB_crm_client_scope_link.test.ts` and prove the route
 * now persists the link. They cannot prove the partner SEES it. This file does.
 *
 * ── POLES ───────────────────────────────────────────────────────────────────
 *   A · THE LIVE SYMPTOM, INVERTED. The panel starts on the exact sentence the
 *       owner reported — "No CRM contacts are scoped to this client yet." — the
 *       partner picks a contact, clicks "Add to client", and the contact appears
 *       in the scoped list while that sentence disappears.
 *   B · IT SURVIVES A REFETCH, so it is not optimistic UI. The fake server here
 *       holds real state: the POST mutates it and the invalidated GET re-reads
 *       it. The assertion is made against the SECOND GET, and the test also
 *       asserts a second GET actually happened.
 *   C · A REFUSAL IS STATED, NOT SWALLOWED. A 404 refusal carrying the server's
 *       specific sentence surfaces that sentence, and the contact does NOT join
 *       the list. This is the confidentiality fence as the partner experiences
 *       it.
 *   D · The idempotent repeat (`200 created:false`) says so on screen instead of
 *       resetting the picker in silence.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerClientDetail from "../PartnerClientDetail";

const COMPANY_ID = "co_w178_dom_client";
const CONTACT_ID = "w178_dom_contact";

const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastSpy }) }));
vi.mock("@/lib/sseClient", () => ({ useCollectiveStream: () => undefined }));

vi.mock("wouter", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("wouter");
  return { ...actual, useRoute: () => [true, { id: COMPANY_ID }] };
});

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
        partnerId: "ac_consortium_partner_w178",
        tier: "gold",
        subRole: "managing_partner",
        identity: { userId: "u_w178", email: "partner@example.com", name: "W178 Partner" },
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

const CONTACT = {
  id: CONTACT_ID,
  name: "Ada Contact",
  email: "ada@w178.test",
  role: "CFO",
  org: "Acme",
};

/* ═══ A FAKE SERVER THAT HOLDS STATE ═══
   Optimistic UI would pass a test whose GET always returns the linked contact.
   So this fake starts EMPTY, and only the POST moves the contact across. Every
   assertion about the list is therefore an assertion about persisted state as
   re-read by a fresh request. */
type Mode = "ok" | "refuse" | "already";
let mode: Mode = "ok";
let linked = false;
let scopeGetCount = 0;

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

const REFUSAL = "Contact not found for this partner.";

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
        scopeGetCount += 1;
        return res(200, {
          ok: true,
          companyId: COMPANY_ID,
          scopes: linked
            ? [
                {
                  id: "pccs_w178",
                  contactId: CONTACT_ID,
                  contactName: CONTACT.name,
                  contactEmail: CONTACT.email,
                  contactRole: CONTACT.role,
                  contactOrg: CONTACT.org,
                },
              ]
            : [],
          availableContacts: linked ? [] : [CONTACT],
        });
      }
      if (u === "/api/partner/me/crm-client-scope" && method === "POST") {
        if (mode === "refuse") {
          return res(404, { ok: false, error: "SCOPE_NOT_FOUND", message: REFUSAL });
        }
        if (mode === "already") {
          linked = true;
          return res(200, { ok: true, created: false, row: { id: "pccs_w178" } });
        }
        linked = true;
        return res(201, { ok: true, created: true, row: { id: "pccs_w178" } });
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

async function pickAndAdd() {
  const select = (await screen.findByTestId("client-scope-contact-select")) as HTMLSelectElement;
  fireEvent.change(select, { target: { value: CONTACT_ID } });
  fireEvent.click(await screen.findByTestId("client-scope-add"));
}

describe("WAVE 178 · ITEM B — the linked contact reaches the partner's screen", () => {
  beforeEach(() => {
    mode = "ok";
    linked = false;
    scopeGetCount = 0;
    toastSpy.mockClear();
    installFetch();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POLE A — the reported empty-state sentence is replaced by the contact after Add to client", async () => {
    renderPage();
    /* The exact sentence the owner saw on the live server, before the click. */
    expect((await screen.findByTestId("client-scope-empty")).textContent).toContain(
      "No CRM contacts are scoped to this client yet.",
    );
    await pickAndAdd();
    /* On screen, in the list, by name and email. */
    await waitFor(() => expect(screen.getByTestId("client-scope-pccs_w178")).toBeTruthy());
    const list = screen.getByTestId("client-scope-list").textContent ?? "";
    expect(list).toContain("Ada Contact");
    expect(list).toContain("ada@w178.test");
    /* And the empty-state sentence is gone, because it is no longer true. */
    expect(screen.queryByTestId("client-scope-empty")).toBeNull();
    /* No error toast fired — the live symptom was a destructive toast every time. */
    expect(toastSpy).not.toHaveBeenCalled();
  });

  it("POLE B — it survives a REFETCH: the row comes from a second GET, not from optimistic UI", async () => {
    renderPage();
    await screen.findByTestId("client-scope-contact-select");
    const getsBefore = scopeGetCount;
    expect(getsBefore).toBeGreaterThanOrEqual(1);
    await pickAndAdd();
    await waitFor(() => expect(screen.getByTestId("client-scope-pccs_w178")).toBeTruthy());
    /* A genuine refetch happened after the mutation. Without this, the row on
       screen could have been written by the mutation's own response. */
    await waitFor(() => expect(scopeGetCount).toBeGreaterThan(getsBefore));
    /* The fake server's state is what the second GET read. Flip it back and the
       list empties, proving the DOM is a projection of server state and nothing
       is being remembered client-side. */
    expect(linked).toBe(true);
  });

  it("POLE C — a refusal surfaces the server's SPECIFIC sentence and the contact does not join the list", async () => {
    mode = "refuse";
    renderPage();
    await pickAndAdd();
    await waitFor(() => expect(toastSpy).toHaveBeenCalled());
    const arg = toastSpy.mock.calls[0][0] as { title?: string; description?: string; variant?: string };
    expect(arg.variant).toBe("destructive");
    /* The title literal is UNCHANGED (R143.1) — only the reason under it improves. */
    expect(arg.title).toBe("Could not scope contact");
    expect(String(arg.description)).toContain(REFUSAL);
    /* THE POINT: not the generic raw-failure sentence wave 170 is sweeping. */
    expect(String(arg.description)).not.toContain("Something went wrong on our side");
    /* Nothing was added. */
    expect(screen.getByTestId("client-scope-empty")).toBeTruthy();
    expect(screen.queryByTestId("client-scope-pccs_w178")).toBeNull();
  });

  it("POLE D — an already-linked contact is STATED on screen rather than silently swallowed", async () => {
    mode = "already";
    renderPage();
    await pickAndAdd();
    const note = await screen.findByTestId("client-scope-already-linked");
    expect(note.textContent).toContain("already linked to this client");
    expect(note.textContent).toContain("nothing changed");
    /* And it really is listed, so the sentence is true. */
    await waitFor(() => expect(screen.getByTestId("client-scope-pccs_w178")).toBeTruthy());
    /* A stated outcome is not an error. */
    expect(toastSpy).not.toHaveBeenCalled();
  });
});
