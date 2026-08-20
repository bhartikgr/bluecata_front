/**
 * WAVE 69 · V-1 (owner ruling R58, row 1) — THE ROUND-TERMS REFUSAL REACHES THE DOM.
 *
 * ── THE DEFECT, IN TWO LAYERS ───────────────────────────────────────────────
 * 1. `Rounds.tsx` had `onError: () => toast({ title: "Save failed", variant:
 *    "destructive" })`. The arrow took NO ARGUMENT, so the 543-character Wave 61b
 *    refusal was discarded and the founder saw the two words "Save failed".
 * 2. AND — the layer that makes the obvious fix useless — `queryClient.ts:60-65`
 *    accepts the server's `message` only when `serverMessage.length < 240`. Every
 *    R50 refusal is 424-543 characters, so `ApiError.message` is silently replaced
 *    with "Some of the information was invalid. Please review and try again."
 *    The real text survives ONLY on `ApiError.payload.message`.
 *
 * ── WHY THIS TEST MOCKS `global.fetch` AND NOT `apiRequest` ─────────────────
 * A test that hand-builds `new ApiError(400, LONG, …)` proves nothing: it bypasses
 * the exact defect. By stubbing `fetch` the REAL `apiRequest` → REAL
 * `throwIfResNotOk` runs, so the 240-character gate is genuinely in the path and
 * `ApiError.message` really is the generic sentence. The second assertion in Pole
 * A — that the generic sentence is NOT on screen — is what pins that, and what
 * stops a future refactor regressing to `err.message`.
 *
 * Every expected string is IMPORTED from `@shared/roundMathEngineAdapter` (R21).
 * Nothing is re-typed as a literal: a copy-pasted literal is how the register came
 * to quote three strings that do not exist.
 *
 * POLES
 *   A · a 400 refusal renders VERBATIM and persistently; the generic sentence does not.
 *   B · a 200 success renders NO refusal node (the legitimate path is unchanged).
 *   C · the same text also reaches the DOM through the real `<Toaster/>`.
 *   D · the four previously ungated terms now block Save BEFORE the round-trip,
 *       with the reason beside the field.
 *   E · an UNCAPPED SAFE (cap 0, strike 0 = ABSENT, Wave 61b) is NOT blocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Rounds from "../Rounds";
import { Toaster } from "@/components/ui/toaster";
import { RoleProvider } from "@/lib/role";
import {
  validateMaturityMonths,
  validateExpiryYears,
  validateStrikePrice,
  validateValuationCap,
  type TermValueVerdict,
} from "@shared/roundMathEngineAdapter";

/* `TermValueVerdict` is a DISCRIMINATED UNION — `message` exists only on the
   refusal arm. This narrows it and asserts the arm, so a validator that started
   ACCEPTING the value would fail here loudly instead of silently comparing
   `undefined`. */
function refusalOf(v: TermValueVerdict): string {
  expect(v.ok).toBe(false);
  if (v.ok) throw new Error("expected a refusal, got an accepted value");
  return v.message;
}


/* The generic sentence `queryClient.ts:37`/`:38` substitutes for a long 400. It is
   quoted here ONLY as the thing that must NOT be on screen. */
const GENERIC_400 = "Some of the information was invalid. Please review and try again.";

vi.mock("@/lib/useActiveCompany", () => ({
  useActiveCompanyId: () => "co_w69_v1",
  useActiveCompany: () => ({ id: "co_w69_v1", name: "W69 Co" }),
}));

const NOTE_ROUND = {
  id: "rnd_w69_note",
  company: "co_w69_v1",
  name: "W69 Note",
  type: "seed",
  state: "open",
  targetAmount: 1_000_000,
  raisedAmount: 0,
  preMoney: null,
  postMoney: null,
  pricePerShare: null,
  minTicket: 25_000,
  closeDate: "2026-12-31",
  termsSummary: "",
  instrument: "convertible_note",
  valuationCap: 8_000_000,
  discount: 20,
  interestRate: 5,
  maturityMonths: 24,
  strikePrice: null,
  expiryYears: null,
  mfn: false,
  archivedAt: null,
  createdAt: "2026-01-01",
};

const WARRANT_ROUND = {
  ...NOTE_ROUND,
  id: "rnd_w69_warrant",
  name: "W69 Warrant",
  instrument: "warrant",
  valuationCap: null,
  discount: null,
  interestRate: null,
  maturityMonths: null,
  strikePrice: 1.5,
  expiryYears: 5,
};

const SAFE_UNCAPPED = {
  ...NOTE_ROUND,
  id: "rnd_w69_safe",
  name: "W69 Uncapped SAFE",
  instrument: "safe",
  valuationCap: null, // seeds to 0 = ABSENT (Wave 61b)
  discount: 20,
  interestRate: null,
  maturityMonths: null,
};

type PatchResult = { status: number; body: unknown };
let patchResult: PatchResult = { status: 200, body: { ok: true, eventType: "round.terms_updated" } };
let roundsFixture: unknown[] = [NOTE_ROUND];
let patchBodies: unknown[] = [];

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
  const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    const method = (init?.method ?? "GET").toUpperCase();
    if (u.startsWith("/api/rounds?")) return res(200, roundsFixture);
    if (/\/api\/rounds\/[^/]+\/terms$/.test(u) && method === "PATCH") {
      patchBodies.push(JSON.parse(String(init?.body ?? "{}")));
      return res(patchResult.status, patchResult.body);
    }
    return res(200, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderPage(withToaster = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <Rounds />
        {withToaster && <Toaster />}
      </RoleProvider>
    </QueryClientProvider>,
  );
}

async function openEditDialog(roundId: string) {
  const btn = await screen.findByTestId(`button-edit-${roundId}`);
  fireEvent.click(btn);
  await screen.findByTestId("dialog-edit-terms");
}

describe("WAVE 69 · V-1 — the round-terms refusal is rendered, not discarded", () => {
  beforeEach(() => {
    roundsFixture = [NOTE_ROUND];
    patchResult = { status: 200, body: { ok: true, eventType: "round.terms_updated" } };
    patchBodies = [];
    installFetch();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POLE A — a 400 refusal renders VERBATIM inline, and the generic 240-char substitute does NOT", async () => {
    const MESSAGE = refusalOf(validateMaturityMonths(20260707));
    /* The precondition for this whole wave, asserted rather than assumed: the
       refusal is longer than the boundary's 240-character ceiling, so
       `ApiError.message` cannot carry it. */
    expect(MESSAGE.length).toBeGreaterThanOrEqual(240);

    patchResult = { status: 400, body: { ok: false, error: "invalid_maturityMonths", message: MESSAGE } };
    renderPage();
    await openEditDialog(NOTE_ROUND.id);

    fireEvent.click(screen.getByTestId("button-save-terms"));

    const node = await screen.findByTestId("edit-save-server-refusal");
    expect(node.textContent).toBe(MESSAGE);
    /* THE ASSERTION THAT PINS THE BOUNDARY DEFECT. If a future edit reads
       `err.message` instead of `err.payload.message`, this is what fails. */
    expect(screen.queryByText(GENERIC_400)).toBeNull();
    /* Persistent, not a 10-second toast: still in the DOM after the mutation settles. */
    await waitFor(() => expect(screen.getByTestId("edit-save-server-refusal")).toBeTruthy());
  });

  it("POLE B — a 200 success renders NO refusal node (the legitimate path is unchanged)", async () => {
    renderPage();
    await openEditDialog(NOTE_ROUND.id);
    expect(screen.queryByTestId("edit-save-server-refusal")).toBeNull();
    fireEvent.click(screen.getByTestId("button-save-terms"));
    await waitFor(() => expect(patchBodies.length).toBe(1));
    expect(screen.queryByTestId("edit-save-server-refusal")).toBeNull();
  });

  it("POLE C — the same refusal also reaches the DOM through the REAL <Toaster/>", async () => {
    const MESSAGE = refusalOf(validateMaturityMonths(20260707));
    patchResult = { status: 400, body: { ok: false, error: "invalid_maturityMonths", message: MESSAGE } };
    renderPage(true);
    await openEditDialog(NOTE_ROUND.id);
    fireEvent.click(screen.getByTestId("button-save-terms"));
    /* The un-mocked `use-toast` store + the real Toaster. `getAllByText` because
       the inline panel carries the same sentence — both are the point. */
    await waitFor(() => expect(screen.getAllByText(MESSAGE).length).toBeGreaterThanOrEqual(2));
  });

  it("POLE D1 — maturityMonths: an 8-digit date is refused BEFORE the round-trip, beside the field", async () => {
    renderPage();
    await openEditDialog(NOTE_ROUND.id);
    fireEvent.change(screen.getByTestId("input-maturity-months"), { target: { value: "20260707" } });
    const node = await screen.findByTestId("edit-maturity-months-invalid");
    expect(node.textContent).toBe(refusalOf(validateMaturityMonths(20260707)));
    expect((screen.getByTestId("button-save-terms") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("edit-save-blocked-term-range")).toBeTruthy();
    /* Nothing was sent. The founder is not made to wait for a server round-trip
       to learn something the shared validator already knows. */
    expect(patchBodies.length).toBe(0);
  });

  it("POLE D2 — valuationCap out of range is refused beside the field", async () => {
    renderPage();
    await openEditDialog(NOTE_ROUND.id);
    fireEvent.change(screen.getByTestId("input-valuation-cap"), { target: { value: "9999999999999" } });
    const node = await screen.findByTestId("edit-valuation-cap-invalid");
    expect(node.textContent).toBe(refusalOf(validateValuationCap(9999999999999)));
    expect((screen.getByTestId("button-save-terms") as HTMLButtonElement).disabled).toBe(true);
  });

  it("POLE D3 — strikePrice and expiryYears are refused beside their own fields", async () => {
    roundsFixture = [WARRANT_ROUND];
    renderPage();
    await openEditDialog(WARRANT_ROUND.id);
    fireEvent.change(screen.getByTestId("input-expiry-years"), { target: { value: "20260707" } });
    expect((await screen.findByTestId("edit-expiry-years-invalid")).textContent).toBe(
      refusalOf(validateExpiryYears(20260707)),
    );
    fireEvent.change(screen.getByTestId("input-strike-price"), { target: { value: "99999999999" } });
    expect((await screen.findByTestId("edit-strike-price-invalid")).textContent).toBe(
      refusalOf(validateStrikePrice(99999999999)),
    );
    expect((screen.getByTestId("button-save-terms") as HTMLButtonElement).disabled).toBe(true);
  });

  it("POLE E — an UNCAPPED SAFE (cap 0 = ABSENT) is NOT blocked: the Wave 61b regression stays fixed", async () => {
    roundsFixture = [SAFE_UNCAPPED];
    renderPage();
    await openEditDialog(SAFE_UNCAPPED.id);
    /* `0` means ABSENT here, not invalid. If the `> 0` guard were dropped, this
       button would be disabled and every uncapped SAFE would be unsaveable. */
    expect(screen.queryByTestId("edit-valuation-cap-invalid")).toBeNull();
    expect((screen.getByTestId("button-save-terms") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("button-save-terms"));
    await waitFor(() => expect(patchBodies.length).toBe(1));
    /* And it still omits the fabricated zero from the wire (Wave 61b). */
    expect(Object.prototype.hasOwnProperty.call(patchBodies[0] as object, "valuationCap")).toBe(false);
  });
});
