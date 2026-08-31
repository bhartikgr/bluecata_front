/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 212 · THE SIGN-OFF, IN THE REAL WIZARD, IN A REAL DOM.
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE REFUSES TO DO. It does not render a small stand-in component that
 * "represents" step 5, and it does not assert against the shared module in
 * isolation. Handbook §8: a gate proved against a replica is not proved. Every
 * assertion below mounts the ACTUAL `RoundNew` page — the same default export the
 * router mounts — walks the ACTUAL five-step wizard with real events, and reads the
 * ACTUAL rendered nodes.
 *
 * THE ONE THING MOCKED, AND WHY. `fetch` and `useActiveCompany` are stubbed, exactly
 * as the six older wizard-walk tests in this directory stub them, because there is no
 * server in a jsdom test. NOTHING about the attestation is stubbed: the text, the
 * gating, the payload keys and the button's live/inert state are all produced by
 * production code.
 *
 * WHY THE COMPANY MOCK CARRIES A CURRENCY. `defaultCurrency` on the company record
 * seeds `form.currency` (`RoundNew.tsx:529-534`), and step 1 will not advance without
 * a currency. This is the production seeding path, not a bypass — the six older walk
 * tests in this directory predate the currency requirement and are stuck on step 1
 * for that reason (see `build_log/wave212/W212_W80_W92_NOT_A_REGRESSION.md`).
 *
 * THE CENTRAL ASSERTION is the one that makes item B provable: the twelve paragraphs
 * ON SCREEN, joined, are byte-identical to `buildRoundCreationAttestationText()` —
 * which is the same function whose output the server stores and hashes. Screen,
 * stored bytes and digest are therefore one artefact, not three that resemble each
 * other.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import RoundNew from "../RoundNew";
import { Toaster } from "@/components/ui/toaster";
import { RoleProvider } from "@/lib/role";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  buildRoundCreationAttestationText,
  roundCreationAttestationParagraphs,
  ROUND_CREATION_ATTESTATION_BLOCKER,
  RECITAL_ABSENT_FIGURE,
} from "@shared/wave212RoundCreationAttestation";

/* THE KEY ORDER IS NOT RESTATED HERE. It is read out of the production paragraph
   builder, so a paragraph added, removed or reordered in the shared module changes
   what this file walks — it cannot silently stop checking one. */
const PARAGRAPH_KEYS = roundCreationAttestationParagraphs({
  companyName: "probe",
  roundName: "probe",
  pricePerShareRaw: null,
  targetAmountRaw: null,
  currency: "USD",
}).map((p) => p.key);

const COMPANY_NAME = "W212 DOM Co";
const ROUND_NAME = "W212 Series A";
const TARGET = "10000000";
const PRE_MONEY = "30000000";
const FD_SHARES = "13000000";
/* The wizard's own derivation: 30,000,000 / 13,000,000 at six-decimal display
   precision. Written out rather than recomputed, so a change to that derivation
   shows up here as a diff instead of silently agreeing with itself. */
const DERIVED_PRICE = "2.307692";

vi.mock("@/lib/useActiveCompany", () => ({
  useActiveCompanyId: () => "co_w212_dom",
  useActiveCompany: () => ({
    isLoading: false,
    data: {
      company: {
        id: "co_w212_dom",
        companyName: "W212 DOM Co",
        defaultCurrency: "USD",
        billing: { plan: "founder_pro" },
      },
    },
  }),
}));

let createBodies: Array<Record<string, unknown>> = [];

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
      const method = (init?.method ?? "GET").toUpperCase();
      if (u === "/api/rounds" && method === "POST") {
        createBodies.push(JSON.parse(String(init?.body ?? "{}")));
        return res(200, { id: "rnd_w212_dom" });
      }
      if (u.startsWith("/api/rounds/name-availability")) return res(200, { available: true });
      if (u.includes("/securities")) return res(200, []);
      if (u.includes("investor-crm")) return res(200, { contacts: [] });
      return res(200, {});
    }),
  );
}

function renderWizard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <TooltipProvider>
          <RoundNew />
          <Toaster />
        </TooltipProvider>
      </RoleProvider>
    </QueryClientProvider>,
  );
}

/** Walk the REAL wizard, steps 1 → 5, on a priced preferred round. */
async function walkToReview(opts: { priced?: boolean } = {}): Promise<void> {
  const priced = opts.priced !== false;
  fireEvent.change(await screen.findByTestId("input-round-name"), { target: { value: ROUND_NAME } });
  if (priced) {
    fireEvent.click(screen.getByTestId("round-category-priced"));
    fireEvent.click(await screen.findByTestId("instrument-preferred"));
    fireEvent.click(screen.getByTestId("button-next"));
    fireEvent.change(await screen.findByTestId("input-pre"), { target: { value: PRE_MONEY } });
    fireEvent.change(screen.getByTestId("input-target"), { target: { value: TARGET } });
    fireEvent.change(screen.getByTestId("input-shares"), { target: { value: "4000000" } });
    fireEvent.change(screen.getByTestId("input-fd-pre-money-shares"), { target: { value: FD_SHARES } });
  } else {
    fireEvent.click(screen.getByTestId("round-category-unpriced"));
    fireEvent.click(await screen.findByTestId("instrument-safe_post"));
    fireEvent.click(screen.getByTestId("button-next"));
    fireEvent.change(await screen.findByTestId("input-target"), { target: { value: TARGET } });
    fireEvent.change(screen.getByTestId("input-cap"), { target: { value: "8000000" } });
  }
  fireEvent.click(screen.getByTestId("button-next"));
  fireEvent.change(await screen.findByTestId("input-open"), { target: { value: "2026-09-01" } });
  fireEvent.change(screen.getByTestId("input-close"), { target: { value: "2026-12-31" } });
  fireEvent.click(screen.getByTestId("button-next"));
  await screen.findByTestId("step-investors");
  fireEvent.click(screen.getByTestId("button-next"));
  await screen.findByTestId("button-create");
}

const createButton = () => screen.getByTestId("button-create") as HTMLButtonElement;

/**
 * The twelve paragraphs AS THE FOUNDER SEES THEM, in render order.
 *
 * NO `.trim()`. It used to trim each paragraph, and the disarm harness caught that:
 * mutation 14 made the wizard append a trailing space to every paragraph — a real
 * divergence between the screen and the bytes the server stores and hashes — and D5
 * stayed GREEN, because the trim quietly erased exactly the difference the test
 * exists to detect. The comparison is byte-for-byte on `textContent` now. Each
 * paragraph node has the string as its ONLY child, so `textContent` is the string
 * and nothing else.
 */
function onScreenText(): string {
  return PARAGRAPH_KEYS.map(
    (key) => screen.getByTestId(`round-attestation-p-${key}`).textContent ?? "",
  ).join("\n\n");
}

describe("WAVE 212 · the round-creation sign-off in the real RoundNew wizard", () => {
  beforeEach(() => {
    createBodies = [];
    installFetch();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /* ═══════════════════════════════════════════════════════════════════════════
     THE CONTROL IS INERT UNTIL THE FOUNDER HAS ACTUALLY SIGNED.
     ═══════════════════════════════════════════════════════════════════════════ */
  it("D1 · the Create button is inert on arrival, and the blocker says why", async () => {
    renderWizard();
    await walkToReview();

    expect(screen.getByTestId("round-creation-attestation")).toBeTruthy();
    expect(createButton().disabled).toBe(true);
    expect(screen.getByTestId("round-attestation-blocker").textContent).toBe(
      ROUND_CREATION_ATTESTATION_BLOCKER,
    );

    /* And clicking it sends nothing — inert, not merely styled as inert. */
    fireEvent.click(createButton());
    await new Promise((r) => setTimeout(r, 50));
    expect(createBodies.length).toBe(0);
  });

  it("D2 · a name ALONE does not arm it, and a tick ALONE does not arm it", async () => {
    renderWizard();
    await walkToReview();
    const name = screen.getByTestId("input-round-attestation-legalname");
    const tick = screen.getByTestId("checkbox-round-attestation-accept");

    fireEvent.change(name, { target: { value: "Ada Lovelace" } });
    await waitFor(() => expect(createButton().disabled).toBe(true));
    expect(screen.getByTestId("round-attestation-blocker")).toBeTruthy();

    fireEvent.change(name, { target: { value: "" } });
    fireEvent.click(tick);
    await waitFor(() => expect(createButton().disabled).toBe(true));
    expect(screen.getByTestId("round-attestation-blocker")).toBeTruthy();
  });

  it("D3 · whitespace is not a signature", async () => {
    renderWizard();
    await walkToReview();
    fireEvent.click(screen.getByTestId("checkbox-round-attestation-accept"));
    fireEvent.change(screen.getByTestId("input-round-attestation-legalname"), {
      target: { value: "   \t  " },
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(createButton().disabled).toBe(true);
  });

  it("D4 · both together arm it, the blocker disappears, and untyping the name disarms it again", async () => {
    renderWizard();
    await walkToReview();
    fireEvent.change(screen.getByTestId("input-round-attestation-legalname"), {
      target: { value: "Ada Lovelace" },
    });
    fireEvent.click(screen.getByTestId("checkbox-round-attestation-accept"));

    await waitFor(() => expect(createButton().disabled).toBe(false));
    expect(screen.queryByTestId("round-attestation-blocker")).toBeNull();

    /* THE GATE IS NOT ONE-WAY. A founder who clears the field is un-signed. */
    fireEvent.change(screen.getByTestId("input-round-attestation-legalname"), { target: { value: "" } });
    await waitFor(() => expect(createButton().disabled).toBe(true));
    expect(screen.getByTestId("round-attestation-blocker")).toBeTruthy();
  });

  /* ═══════════════════════════════════════════════════════════════════════════
     THE TEXT ON SCREEN IS THE TEXT THAT GETS STORED AND HASHED.
     ═══════════════════════════════════════════════════════════════════════════ */
  it("D5 · all twelve paragraphs are present, and the on-screen text IS buildRoundCreationAttestationText()", async () => {
    renderWizard();
    await walkToReview();

    for (const key of PARAGRAPH_KEYS) {
      const node = screen.getByTestId(`round-attestation-p-${key}`);
      expect((node.textContent ?? "").trim().length, `paragraph ${key} must not be empty`).toBeGreaterThan(0);
    }
    expect(PARAGRAPH_KEYS.length).toBe(12);

    const expected = buildRoundCreationAttestationText({
      companyName: COMPANY_NAME,
      roundName: ROUND_NAME,
      pricePerShareRaw: DERIVED_PRICE,
      targetAmountRaw: TARGET,
      currency: "USD",
    });
    /* BYTE-IDENTICAL. If a future edit changes the wording in the page instead of in
       the shared module, the stored text and the screen diverge and this fails. */
    expect(onScreenText()).toBe(expected);
    /* Cross-check the same bytes against the paragraph builder the server uses. */
    expect(onScreenText()).toBe(
      roundCreationAttestationParagraphs({
        companyName: COMPANY_NAME,
        roundName: ROUND_NAME,
        pricePerShareRaw: DERIVED_PRICE,
        targetAmountRaw: TARGET,
        currency: "USD",
      })
        .map((p) => p.text)
        .join("\n\n"),
    );
  });

  it("D6 · the recital carries THIS round's own facts, and the price the wizard actually holds", async () => {
    renderWizard();
    await walkToReview();

    expect(screen.getByTestId("round-attestation-p-recital-company").textContent).toContain(COMPANY_NAME);
    expect(screen.getByTestId("round-attestation-p-recital-round-name").textContent).toContain(ROUND_NAME);
    expect(screen.getByTestId("round-attestation-p-recital-target-amount").textContent).toContain(TARGET);

    /* ON A PRICED ROUND THE PRICE IS DERIVED, NOT TYPED. The wizard computes
       pre-money / FD pre-money shares and writes it into the form, and THAT is the
       value POSTed. The recital must therefore recite the derived figure — the exact
       string the server will receive and store — and the heading must not claim the
       founder entered it. 30,000,000 / 13,000,000 = 2.307692 at the wizard's own
       six-decimal display precision (`derivedPricePerShare`). */
    const price = screen.getByTestId("round-attestation-p-recital-price-per-share").textContent ?? "";
    expect(price).toContain("2.307692");
    expect(price).not.toContain("$");
    expect(screen.getByTestId("round-attestation-p-recital-heading").textContent).not.toContain(
      "as you entered it",
    );

    /* NO CURRENCY SYMBOL AND NO CONVERSION anywhere in the recited figures: the
       currency is named once, in its own sentence. */
    const target = screen.getByTestId("round-attestation-p-recital-target-amount").textContent ?? "";
    expect(target).not.toContain("$");
    expect(screen.getByTestId("round-attestation-p-statement-2").textContent).toContain("USD");
  });

  it("D7 · retyping the round name re-recites it live — the text is generated, not frozen", async () => {
    renderWizard();
    await walkToReview();
    const before = screen.getByTestId("round-attestation-p-recital-round-name").textContent ?? "";
    expect(before).toContain(ROUND_NAME);

    fireEvent.click(screen.getByTestId("button-prev"));
    fireEvent.click(screen.getByTestId("button-prev"));
    fireEvent.click(screen.getByTestId("button-prev"));
    fireEvent.click(screen.getByTestId("button-prev"));
    fireEvent.change(await screen.findByTestId("input-round-name"), { target: { value: "W212 Renamed" } });
    for (let i = 0; i < 4; i += 1) fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("button-create");

    const after = screen.getByTestId("round-attestation-p-recital-round-name").textContent ?? "";
    expect(after).toContain("W212 Renamed");
    expect(after).not.toContain(ROUND_NAME);
  });

  it("D8 · the word that claims a check the platform does not perform is absent from the whole block", async () => {
    renderWizard();
    await walkToReview();
    const block = screen.getByTestId("round-creation-attestation").textContent ?? "";
    expect(block).toContain("does not verify");
    expect(/verified|verifies|verification/i.test(block)).toBe(false);
  });

  /* ═══════════════════════════════════════════════════════════════════════════
     WHAT ACTUALLY LEAVES THE BROWSER.
     ═══════════════════════════════════════════════════════════════════════════ */
  it("D9 · the signature and the assent are in the POST body, and nothing else about them is", async () => {
    renderWizard();
    await walkToReview();
    fireEvent.change(screen.getByTestId("input-round-attestation-legalname"), {
      target: { value: "Ada Lovelace" },
    });
    fireEvent.click(screen.getByTestId("checkbox-round-attestation-accept"));
    await waitFor(() => expect(createButton().disabled).toBe(false));
    fireEvent.click(createButton());
    await waitFor(() => expect(createBodies.length).toBe(1));

    const body = createBodies[0];
    expect(body.creationAttestationSignedName).toBe("Ada Lovelace");
    expect(body.creationAttestationAccepted).toBe(true);

    /* THE BROWSER DOES NOT GET TO ASSERT WHEN, FROM WHERE, OR IN WHAT WORDS.
       Those four facts are the server's own observations (R187.1 / R192.3), so the
       client must not even offer them — an offered value is a value someone can
       later mistake for evidence. */
    for (const forbidden of [
      "creationAttestationSignedAt",
      "creationAttestationIp",
      "creationAttestationUserAgent",
      "creationAttestationText",
      "creationAttestationTextSha256",
      "creationAttestationVersion",
    ]) {
      expect(forbidden in body, `${forbidden} must not be client-supplied`).toBe(false);
    }
  });

  it("D10 · an unpriced round is signed off too, and recites the figures ITS instrument collects", async () => {
    renderWizard();
    await walkToReview({ priced: false });

    expect(screen.getByTestId("round-attestation-p-recital-target-amount").textContent).toContain(TARGET);

    /* A SAFE HAS NO PRICE PER SHARE, and the platform holds none. This is the pole
       that matters for R143.4: the line says so IN WORDS. A `0` here would tell a
       founder they are signing off a zero price. */
    const price = screen.getByTestId("round-attestation-p-recital-price-per-share").textContent ?? "";
    expect(price).toContain(RECITAL_ABSENT_FIGURE);
    expect(price).not.toMatch(/\b0\b/);

    fireEvent.change(screen.getByTestId("input-round-attestation-legalname"), {
      target: { value: "Grace Hopper" },
    });
    fireEvent.click(screen.getByTestId("checkbox-round-attestation-accept"));
    await waitFor(() => expect(createButton().disabled).toBe(false));
    fireEvent.click(createButton());
    await waitFor(() => expect(createBodies.length).toBe(1));
    expect(createBodies[0].creationAttestationSignedName).toBe("Grace Hopper");
    expect(createBodies[0].creationAttestationAccepted).toBe(true);
  });

  /* ═══════════════════════════════════════════════════════════════════════════
     "DO NOT BLOCK ANYTHING ELSE" — the earlier steps are untouched.
     ═══════════════════════════════════════════════════════════════════════════ */
  it("D11 · steps 1 to 4 carry no sign-off and their Continue button is unaffected", async () => {
    renderWizard();
    await screen.findByTestId("input-round-name");
    expect(screen.queryByTestId("round-creation-attestation")).toBeNull();
    fireEvent.change(screen.getByTestId("input-round-name"), { target: { value: ROUND_NAME } });
    fireEvent.click(screen.getByTestId("round-category-priced"));
    fireEvent.click(await screen.findByTestId("instrument-preferred"));

    /* Step 1's Continue is live on currency alone, exactly as before this wave. */
    expect((screen.getByTestId("button-next") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("input-pre");
    expect(screen.queryByTestId("round-creation-attestation")).toBeNull();
    expect(screen.queryByTestId("round-attestation-blocker")).toBeNull();
  });
});
