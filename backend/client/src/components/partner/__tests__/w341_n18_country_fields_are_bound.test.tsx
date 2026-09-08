/**
 * WAVE 341 (productgaps2) · N18 — THE TWO COUNTRY FIELDS ARE BOUND TO THE ISO
 * LIST AND A NON-COUNTRY CANNOT BE SAVED. PROVED IN THE DOM.
 * ════════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG. On the partner "Private Portfolio" company profile,
 * `Country code (e.g. US)` (step 2) and `Country of incorporation code`
 * (step 3) were unbound `<Input>`s. Anything typed was stored.
 *
 * WHAT WAS BUILT. The SAME `<Input>` controls, now bound to a `<datalist>` of
 * the 250 ISO-3166 entries in `client/src/lib/profile/data/countries.ts`, plus
 * a hard stop: the Save button is disabled while either field holds a value
 * that is not an ISO code, and an on-screen sentence names the offending field
 * and says what a good value looks like.
 *
 * WHY NOT A CLOSED `<Select>`. See the block comment in the component. A
 * replacement is indistinguishable from a removal to `drop:restyle`, which has
 * no register for it, and re-cutting its baseline is forbidden.
 *
 * HOW THIS FILE REFUSES TO GO VACUOUSLY GREEN.
 *   1. BOTH POLES on every claim. The GOOD case (a real code → no error, Save
 *      enabled) and the BAD case (a non-country → error text, Save disabled)
 *      are both asserted. An assertion that only checked the bad case would
 *      pass on a component that disabled Save unconditionally.
 *   2. A RENDERED CONTROL is proved before any absence is claimed: a sibling
 *      free-text field on the same step is asserted to hold its value, so a
 *      dialog that failed to render cannot pass.
 *   3. THE LIST IS REALLY BOUND, and really is the 250-entry ISO list — the
 *      `<datalist>` the input points at is located BY THE INPUT'S OWN `list`
 *      attribute (not by a hard-coded id) and its option count and contents
 *      are asserted against `COUNTRIES` itself.
 *   4. THE WRONG LIST IS NAMED. `SPV_TOP_JURISDICTION_COUNTRIES` holds country
 *      NAMES, not codes; the assertion records why it is not the list here.
 *   5. NOTHING IS TAKEN OFFLINE: a row already holding an off-list legacy value
 *      still LOADS and still DISPLAYS that exact value.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PartnerPortfolioProfileDialog } from "@/components/partner/PartnerPortfolioProfileDialog";
import { COUNTRIES } from "@/lib/profile/data/countries";
import { SPV_TOP_JURISDICTION_COUNTRIES } from "@shared/spvEngine";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

function mount(profile: Record<string, unknown>) {
  apiRequestMock.mockReset();
  apiRequestMock.mockResolvedValue(
    jsonResponse({ companyId: "co_test", companyName: "Test Co", profile }),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PartnerPortfolioProfileDialog
        companyId="co_test"
        companyName="Test Co"
        canEdit
        open
        onOpenChange={() => {}}
      />
    </QueryClientProvider>,
  );
}

async function goToStep(n: 1 | 2 | 3 | 4) {
  const tab = await screen.findByTestId(`portfolio-step-${n}`);
  fireEvent.click(tab);
  await waitFor(() => expect(screen.getByTestId(`portfolio-step-panel-${n}`)).toBeTruthy());
}

/** The datalist is found through the input's OWN `list` attribute. */
function boundOptions(input: HTMLElement): string[] {
  const listId = input.getAttribute("list");
  expect(listId, "the country input must carry a list= binding").toBeTruthy();
  const dl = document.getElementById(listId as string);
  expect(dl, `no <datalist id="${listId}"> in the document`).toBeTruthy();
  return Array.from((dl as HTMLElement).querySelectorAll("option")).map(
    (o) => (o as HTMLOptionElement).value,
  );
}

const saveBtn = () => screen.getByTestId("portfolio-save") as HTMLButtonElement;

beforeEach(() => apiRequestMock.mockReset());
afterEach(() => cleanup());

describe("W341 N18 §1 — the address country field is BOUND to the ISO list", () => {
  it("§1a the control is still an <Input> and it is bound to all 250 ISO codes", async () => {
    mount({ address: { street: "1 Main St", countryCode: "US" } });
    await goToStep(2);

    /* CONTROL: the dialog really rendered and a sibling free-text field on the
       SAME step still holds its value. Nothing below is measured on a blank page. */
    const street = await screen.findByTestId("pf-address-street");
    expect((street as HTMLInputElement).value).toBe("1 Main St");
    expect(street.tagName.toLowerCase()).toBe("input");
    /* ... and that sibling is NOT bound — so "bound" below means something. */
    expect(street.getAttribute("list")).toBeNull();

    const country = screen.getByTestId("pf-address-country") as HTMLInputElement;
    expect(country.tagName.toLowerCase()).toBe("input");
    expect(country.value).toBe("US");

    const opts = boundOptions(country);
    expect(opts.length).toBe(COUNTRIES.length);
    expect(opts.length).toBe(250);
    expect(opts).toContain("US");
    expect(opts).toContain("CA");
    /* name-set diff, both sides non-empty by construction */
    const missing = COUNTRIES.map((c) => c.code).filter((c) => !opts.includes(c));
    expect(missing).toEqual([]);
    const extra = opts.filter((o) => !COUNTRIES.some((c) => c.code === o));
    expect(extra).toEqual([]);
  });

  it("§1b a real code is accepted: NO error sentence, Save ENABLED", async () => {
    mount({ address: { street: "1 Main St", countryCode: "US" } });
    await goToStep(2);
    await screen.findByTestId("pf-address-street");
    expect(screen.queryByTestId("pf-address-country-error")).toBeNull();
    expect(saveBtn().disabled).toBe(false);
  });

  it("§1c a non-country is REFUSED: named on screen, Save DISABLED", async () => {
    mount({ address: { street: "1 Main St", countryCode: "US" } });
    await goToStep(2);
    const country = (await screen.findByTestId("pf-address-country")) as HTMLInputElement;
    expect(saveBtn().disabled).toBe(false); // pole 1

    fireEvent.change(country, { target: { value: "Amerika" } });
    await waitFor(() => expect(screen.getByTestId("pf-address-country-error")).toBeTruthy());

    const msg = screen.getByTestId("pf-address-country-error").textContent ?? "";
    expect(msg).toContain("Amerika");
    expect(msg).toContain("Country");
    expect(msg).toContain("is not a country we recognise");
    expect(msg).toContain("two-letter ISO code");
    expect(saveBtn().disabled).toBe(true); // pole 2

    /* NEVER COLOUR ALONE: the refusal carries a non-colour cue. */
    expect(screen.getByTestId("pf-address-country-error").getAttribute("role")).toBe("alert");
    expect(country.getAttribute("aria-invalid")).toBe("true");
  });

  it("§1d lower case is not silently accepted, and fixing it clears the block", async () => {
    mount({ address: { street: "1 Main St" } });
    await goToStep(2);
    const country = (await screen.findByTestId("pf-address-country")) as HTMLInputElement;
    fireEvent.change(country, { target: { value: "us" } });
    await waitFor(() => expect(saveBtn().disabled).toBe(true));
    fireEvent.change(country, { target: { value: "US" } });
    await waitFor(() => expect(saveBtn().disabled).toBe(false));
    expect(screen.queryByTestId("pf-address-country-error")).toBeNull();
  });

  it("§1e blank stays legal — the field is optional and Save is not blocked", async () => {
    mount({ address: { street: "no country here" } });
    await goToStep(2);
    const street = await screen.findByTestId("pf-address-street");
    expect((street as HTMLInputElement).value).toBe("no country here");
    expect((screen.getByTestId("pf-address-country") as HTMLInputElement).value).toBe("");
    expect(screen.queryByTestId("pf-address-country-error")).toBeNull();
    expect(saveBtn().disabled).toBe(false);
  });
});

describe("W341 N18 §2 — the country of incorporation field is BOUND", () => {
  it("§2a bound to the same 250-entry list, and its own datalist", async () => {
    mount({ legal: { legalEntityName: "Acme Ltd", countryOfIncorporationCode: "GB" } });
    await goToStep(3);
    const name = await screen.findByTestId("pf-legal-name");
    expect((name as HTMLInputElement).value).toBe("Acme Ltd");

    const country = screen.getByTestId("pf-legal-country") as HTMLInputElement;
    expect(country.tagName.toLowerCase()).toBe("input");
    expect(country.value).toBe("GB");
    expect(boundOptions(country).length).toBe(250);
    expect(screen.queryByTestId("pf-legal-country-error")).toBeNull();
    expect(saveBtn().disabled).toBe(false);
  });

  it("§2b a non-country blocks the save and names THIS field", async () => {
    mount({ legal: { legalEntityName: "Acme Ltd", countryOfIncorporationCode: "GB" } });
    await goToStep(3);
    const country = (await screen.findByTestId("pf-legal-country")) as HTMLInputElement;
    expect(saveBtn().disabled).toBe(false);
    fireEvent.change(country, { target: { value: "U.K." } });
    await waitFor(() => expect(saveBtn().disabled).toBe(true));
    const msg = screen.getByTestId("pf-legal-country-error").textContent ?? "";
    expect(msg).toContain("Country of incorporation");
    expect(msg).toContain("U.K.");
  });
});

describe("W341 N18 §3 — nothing already recorded is taken offline", () => {
  it("§3a a legacy off-list value still LOADS and is still DISPLAYED", async () => {
    mount({ address: { street: "9 Old Rd", countryCode: "Amerika" } });
    await goToStep(2);
    const street = await screen.findByTestId("pf-address-street");
    expect((street as HTMLInputElement).value).toBe("9 Old Rd");
    /* The value is not dropped, not blanked, not rewritten. */
    expect((screen.getByTestId("pf-address-country") as HTMLInputElement).value).toBe("Amerika");
    /* It IS flagged, and it does block a save until the partner fixes it. */
    expect(screen.getByTestId("pf-address-country-error")).toBeTruthy();
    expect(saveBtn().disabled).toBe(true);
  });
});

describe("W341 N18 §4 — the SPV wizard's list is the WRONG list, recorded", () => {
  it("§4a it holds country NAMES, not the ISO codes these two fields store", () => {
    expect(SPV_TOP_JURISDICTION_COUNTRIES.length).toBeLessThan(COUNTRIES.length);
    /* Every entry is longer than 2 characters — i.e. none of them is a code. */
    const codeShaped = SPV_TOP_JURISDICTION_COUNTRIES.filter((c) => /^[A-Z]{2}$/.test(c));
    expect(codeShaped).toEqual([]);
    expect(SPV_TOP_JURISDICTION_COUNTRIES).toContain("United States");
    /* And COUNTRIES really is code-shaped. */
    expect(COUNTRIES.every((c) => /^[A-Z]{2}$/.test(c.code))).toBe(true);
  });
});
