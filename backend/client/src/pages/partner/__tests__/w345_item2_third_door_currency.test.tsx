/**
 * WAVE 345 · ITEM 2 — THE THIRD SPV CREATION DOOR NOW MEETS THE FIRST DOOR'S
 * STANDARD FOR A PERMANENT DENOMINATION.
 *
 * WHAT WAS MEASURED BEFORE BUILDING (premises re-checked, not inherited):
 *   · Jurisdiction on `/collective/partner/clients/:id` → "Create SPV for this
 *     client" WAS already a proper 16-option `<select>`. CONFIRMED.
 *   · The denomination WAS a free-text `<Input>` prefilled "USD", with no
 *     permanence statement, no origin statement and no confirmation. CONFIRMED.
 *   · The creation itself was NOT unvalidated: the server resolves the code
 *     against `currency_ref` (167 active rows) and refuses an unknown one. So
 *     this was a DISCLOSURE and USABILITY gap, and it is not overstated here.
 *
 * ── POLES ───────────────────────────────────────────────────────────────────
 *   0A · INSTRUMENT VALIDATION. The harness can see a control that exists and
 *        cannot see one that does not. Run FIRST, so a later "found it" is
 *        meaningful.
 *   0B · MANUFACTURED-GREEN CONTROL. An attempt to prove the OPPOSITE of the
 *        build (that an unrecognised code can still be submitted) must FAIL.
 *   1  · THE CONTROL IS BOUND TO A PICK-LIST, and the list is located through
 *        the input's OWN `list` attribute — not by a hard-coded id. The list
 *        carries the platform's existing ISO 4217 vocabulary, and the `<Input>`
 *        itself is STILL AN INPUT with its original `data-testid` (nothing was
 *        replaced, so no drop guard has anything to report).
 *   2  · THE RATIFIED STEP 5 COPY IS PRESENT, VERBATIM, on this door.
 *   3  · THE CONFIRMATION IS A REAL GATE: unconfirmed ⇒ submit blocked and no
 *        POST leaves the page; confirmed ⇒ it goes.
 *   4  · CHANGING THE CODE WITHDRAWS THE CONFIRMATION.
 *   5  · AN UNRECOGNISED CODE IS NAMED ON SCREEN AND CANNOT BE SUBMITTED.
 *   6  · A BLANK DENOMINATION IS NAMED ON SCREEN AND CANNOT BE SUBMITTED — the
 *        platform never falls back to US dollars.
 *   7  · THE POSTED BODY carries the confirmed code as typed. No conversion, no
 *        substitution, nothing invented.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerClientDetail from "../PartnerClientDetail";
import { ALL_CURRENCY_CODES } from "@/lib/currencyOptions";

const COMPANY_ID = "co_w345_third_door";

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
        partnerId: "ac_consortium_partner_w345",
        tier: "gold",
        subRole: "managing_partner",
        identity: { userId: "u_w345", email: "partner@example.com", name: "W345 Partner" },
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

let postedBody: Record<string, unknown> | null = null;
let postCount = 0;

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
        return res(200, { ok: true, companyId: COMPANY_ID, attribution: {}, snapshot: {} });
      }
      if (u === `/api/partner/me/client-crm/${COMPANY_ID}`) {
        return res(200, { ok: true, companyId: COMPANY_ID, stage: "qualified", leadUserId: null, activity: [] });
      }
      if (u === "/api/partner/me/team") return res(200, { members: [] });
      if (u.startsWith("/api/partner/me/crm-client-scope/by-company/")) {
        return res(200, { ok: true, companyId: COMPANY_ID, scopes: [], availableContacts: [] });
      }
      if (u === `/api/partner/me/clients/${COMPANY_ID}/spvs` && method === "GET") {
        return res(200, { ok: true, companyId: COMPANY_ID, spvs: [] });
      }
      if (u === "/api/partner/me/spvs" && method === "POST") {
        postCount += 1;
        postedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return res(201, { ok: true, spv: { id: "spv_w345_third_door" } });
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

/** Open the panel and fill everything EXCEPT the denomination confirmation. */
async function openAndFill() {
  fireEvent.click(await screen.findByTestId("client-spv-create-toggle"));
  fireEvent.change(await screen.findByTestId("client-spv-name"), { target: { value: "W345 Third Door" } });
  fireEvent.change(await screen.findByTestId("client-spv-signoff-name"), { target: { value: "Ada Managing" } });
  fireEvent.click(await screen.findByTestId("client-spv-signoff-accept"));
}

function submitDisabled(): boolean {
  return screen.getByTestId("client-spv-create-submit").hasAttribute("disabled");
}

describe("WAVE 345 · ITEM 2 — the third SPV door's denomination", () => {
  beforeEach(() => {
    postedBody = null;
    postCount = 0;
    toastSpy.mockClear();
    installFetch();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("§0A INSTRUMENT — the harness sees a control that exists and does NOT see one that does not", async () => {
    renderPage();
    await openAndFill();
    /* Positive control: a testid that has existed on this panel since wave 179. */
    expect(screen.queryByTestId("client-spv-jurisdiction")).toBeTruthy();
    /* Negative control: a testid nothing in this product defines. */
    expect(screen.queryByTestId("client-spv-currency-this-testid-does-not-exist")).toBeNull();
  });

  it("§0B CONTROL — an attempt to submit an UNRECOGNISED code must FAIL to produce a POST", async () => {
    renderPage();
    await openAndFill();
    fireEvent.change(screen.getByTestId("client-spv-currency"), { target: { value: "NOTACURRENCY123" } });
    /* Try as hard as a client could: tick the confirmation anyway and click. */
    fireEvent.click(screen.getByTestId("client-spv-currency-confirm"));
    fireEvent.click(screen.getByTestId("client-spv-create-submit"));
    await new Promise((r) => setTimeout(r, 50));
    /* THE MANUFACTURED GREEN IS REFUSED. */
    expect(postCount).toBe(0);
    expect(postedBody).toBeNull();
  });

  it("§1 the currency control is an INPUT, keeps its testid, and is BOUND to the platform's ISO list", async () => {
    renderPage();
    await openAndFill();
    const input = screen.getByTestId("client-spv-currency") as HTMLInputElement;
    /* Nothing was REPLACED: it is still an <input>, still the same testid, and
       still carries its original placeholder. A replaced control is externally
       indistinguishable from a removed one and would trip the drop guards. */
    expect(input.tagName).toBe("INPUT");
    expect(input.getAttribute("placeholder")).toBe("Currency, e.g. USD");
    /* The list is found through the INPUT'S OWN `list` attribute, never a
       hard-coded id, so the binding itself is what is proved. */
    const listId = input.getAttribute("list");
    expect(listId, "the currency input must point at a datalist").toBeTruthy();
    const dl = document.getElementById(String(listId)) as HTMLDataListElement | null;
    expect(dl, `no <datalist id="${listId}"> in the document`).toBeTruthy();
    const options = Array.from(dl!.querySelectorAll("option")).map((o) => o.getAttribute("value"));
    /* The vocabulary is the platform's EXISTING one — not a new list invented
       for this panel. Asserted as an exact set equality, both directions. */
    expect(options.length).toBe(ALL_CURRENCY_CODES.length);
    expect(new Set(options)).toEqual(new Set(ALL_CURRENCY_CODES));
    /* And it is a real multi-currency list, not USD plus a token few. */
    expect(options.length).toBeGreaterThanOrEqual(150);
    for (const c of ["USD", "EUR", "GBP", "CAD", "JPY", "SGD"]) expect(options).toContain(c);
  });

  it("§2 the RATIFIED Step 5 copy is on this door, verbatim", async () => {
    renderPage();
    await openAndFill();
    const stmt = (await screen.findByTestId("client-spv-currency-confirm-statement")).textContent ?? "";
    const flat = stmt.replace(/\s+/g, " ").trim();
    expect(flat).toBe(
      "This vehicle will be denominated in USD. Every commitment, fee, distribution and tax form for it will be " +
        "recorded in USD. The denomination cannot be changed after the vehicle is created.",
    );
    /* The origin sentence is the wizard's own exported builder. The default
       jurisdiction is Delaware → United States, for which the platform DOES
       hold a denomination, so the derived-and-matching sentence is expected. */
    const origin = (await screen.findByTestId("client-spv-currency-origin")).textContent ?? "";
    expect(origin.replace(/\s+/g, " ")).toContain("was derived from the jurisdiction you chose (United States)");
    const label = (await screen.findByTestId("client-spv-currency-confirm")).closest("label");
    expect((label?.textContent ?? "").replace(/\s+/g, " ").trim()).toBe(
      "I confirm USD is the correct denomination for this vehicle.",
    );
  });

  it("§2b a jurisdiction the platform holds NO denomination for says so, and does not invent one", async () => {
    renderPage();
    await openAndFill();
    /* "other" is the explicit unknown member of the engine's own enum. */
    fireEvent.change(screen.getByTestId("client-spv-jurisdiction"), { target: { value: "other" } });
    const origin = (await screen.findByTestId("client-spv-currency-origin")).textContent ?? "";
    expect(origin.replace(/\s+/g, " ")).toContain("this platform holds no denomination for");
    expect(origin).toContain("will not invent one");
    /* The code on the form was NOT changed by changing the jurisdiction here. */
    expect((screen.getByTestId("client-spv-currency") as HTMLInputElement).value).toBe("USD");
  });

  it("§3 the confirmation is a REAL gate — no confirmation, no POST; confirmed, it goes", async () => {
    renderPage();
    await openAndFill();
    expect(submitDisabled(), "unconfirmed denomination must block submit").toBe(true);
    fireEvent.click(screen.getByTestId("client-spv-create-submit"));
    await new Promise((r) => setTimeout(r, 50));
    expect(postCount).toBe(0);

    fireEvent.click(screen.getByTestId("client-spv-currency-confirm"));
    expect(submitDisabled()).toBe(false);
    fireEvent.click(screen.getByTestId("client-spv-create-submit"));
    await waitFor(() => expect(postCount).toBe(1));
  });

  it("§4 changing the code WITHDRAWS the confirmation given for the old one", async () => {
    renderPage();
    await openAndFill();
    fireEvent.click(screen.getByTestId("client-spv-currency-confirm"));
    expect((screen.getByTestId("client-spv-currency-confirm") as HTMLInputElement).checked).toBe(true);
    expect(submitDisabled()).toBe(false);
    fireEvent.change(screen.getByTestId("client-spv-currency"), { target: { value: "EUR" } });
    expect((screen.getByTestId("client-spv-currency-confirm") as HTMLInputElement).checked).toBe(false);
    expect(submitDisabled(), "a confirmation for USD is not a confirmation for EUR").toBe(true);
    /* And the sentence now speaks about the NEW code, so what is being
       confirmed is what is on screen. */
    expect((screen.getByTestId("client-spv-currency-confirm-statement")).textContent).toContain("EUR");
  });

  it("§5 an unrecognised code is NAMED on screen and cannot be submitted", async () => {
    renderPage();
    await openAndFill();
    expect(screen.queryByTestId("client-spv-currency-unknown")).toBeNull();
    fireEvent.change(screen.getByTestId("client-spv-currency"), { target: { value: "ZZZ" } });
    const said = (await screen.findByTestId("client-spv-currency-unknown")).textContent ?? "";
    expect(said).toContain("ZZZ");
    expect(said).toContain("does not recognise");
    fireEvent.click(screen.getByTestId("client-spv-currency-confirm"));
    expect(submitDisabled()).toBe(true);
    /* ANTI-VACUITY: a code that IS recognised clears the notice and the gate. */
    fireEvent.change(screen.getByTestId("client-spv-currency"), { target: { value: "GBP" } });
    await waitFor(() => expect(screen.queryByTestId("client-spv-currency-unknown")).toBeNull());
    fireEvent.click(screen.getByTestId("client-spv-currency-confirm"));
    expect(submitDisabled()).toBe(false);
  });

  it("§6 a BLANK denomination is named and refused — no silent fall back to US dollars", async () => {
    renderPage();
    await openAndFill();
    fireEvent.change(screen.getByTestId("client-spv-currency"), { target: { value: "" } });
    const said = (await screen.findByTestId("client-spv-currency-missing")).textContent ?? "";
    expect(said).toContain("needs a denomination");
    expect(said).toContain("will not choose one for you");
    fireEvent.click(screen.getByTestId("client-spv-currency-confirm"));
    expect(submitDisabled()).toBe(true);
    fireEvent.click(screen.getByTestId("client-spv-create-submit"));
    await new Promise((r) => setTimeout(r, 50));
    expect(postCount).toBe(0);
  });

  it("§7 the POSTed body carries the CONFIRMED code, unconverted and unsubstituted", async () => {
    renderPage();
    await openAndFill();
    fireEvent.change(screen.getByTestId("client-spv-currency"), { target: { value: "cad" } });
    /* Lower case is normalised by the control itself, so what the client sees
       and what is sent are the same three characters. */
    expect((screen.getByTestId("client-spv-currency") as HTMLInputElement).value).toBe("CAD");
    fireEvent.click(screen.getByTestId("client-spv-currency-confirm"));
    fireEvent.click(screen.getByTestId("client-spv-create-submit"));
    await waitFor(() => expect(postedBody).not.toBeNull());
    expect(postedBody?.currency).toBe("CAD");
    /* Nothing invented USD anywhere in the payload. */
    expect(JSON.stringify(postedBody)).not.toContain("USD");
  });
});
