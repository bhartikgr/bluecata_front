/**
 * WAVE 345 · CONSENTADDRESS — THE FOUR REQUIRED ELEMENTS, IN THE RENDERED DOM.
 *
 * ── WHY THIS FILE EXISTS AT ALL ────────────────────────────────────────────
 * The server test proves the request the server SERVES is complete. That is not
 * the same claim as "the person saw it". A field can be present in a payload and
 * absent from the screen; wave 344 shipped this component with no test that ever
 * mounted it, and its own handoff called that the largest remaining gap.
 *
 * So this file mounts the REAL component and asserts RENDERED TEXT — the actual
 * strings in the actual DOM — for each of the four things the regulator requires
 * the consent request to carry:
 *
 *   1. the purposes,
 *   2. the identity of who is asking,
 *   3. the mailing address, verbatim, line for line, in the owner's order,
 *   4. a statement that the permission can be withdrawn.
 *
 * ── THE WORDING IS NOT WRITTEN HERE, IT IS TAKEN FROM THE SERVER ───────────
 * The payload the mocked network returns is built by calling the SHIPPED
 * `buildDisclosure()` from `server/marketingConsentStore.ts`, with the address
 * read out of the real `.env` file. Nothing about the sentence is retyped in this
 * file. If the server composed it differently, this test renders the different
 * thing and the assertions below — which are written against the OWNER'S address
 * and the four required elements, not against the server's output — go red.
 *
 * ── THE ONE THING THAT IS FAKED ────────────────────────────────────────────
 * Only the network. `apiRequest` is replaced so the component's single read can
 * be answered. Every string asserted below is rendered by the real component.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

/** The address the owner ruled, stated independently of the configuration. */
const OWNER_ADDRESS = [
  "BluePrint Catalyst Limited",
  "First Canadian Place",
  "100 King Street West, Suite 5700",
  "Toronto, ON  M5X 1C7",
  "Canada",
  "",
  "BluePrint Catalyst Limited",
  "Level 20, One IFC",
  "No. 1 Harbour View Street",
  "Central, Hong Kong",
].join("\n");
const OWNER_IDENTITY = "BluePrint Catalyst Limited";

const REPO = path.resolve(__dirname, "..", "..", "..", "..");
const ENV_ON_DISK = dotenv.parse(fs.readFileSync(path.join(REPO, ".env")));
process.env.MARKETING_CONSENT_MAILING_ADDRESS =
  ENV_ON_DISK.MARKETING_CONSENT_MAILING_ADDRESS ?? "";
process.env.MARKETING_CONSENT_REQUESTER_IDENTITY =
  ENV_ON_DISK.MARKETING_CONSENT_REQUESTER_IDENTITY ?? "";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

/** What the mocked network answers with. Filled in `beforeAll` from the SHIPPED
 *  server builder — never hand-written. */
const served: { payload: Record<string, unknown> } = { payload: {} };

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient: QC } = await import("@tanstack/react-query");
  return {
    queryClient: new QC({ defaultOptions: { queries: { retry: false } } }),
    apiRequest: async () => ({ json: async () => served.payload }),
  };
});

import { MarketingConsentChoice } from "@/components/MarketingConsentChoice";
import { buildDisclosure } from "../../../../server/marketingConsentStore";

/** Exactly the shape the two GET routes return. */
function payloadFromServer(): Record<string, unknown> {
  const a = buildDisclosure();
  return {
    ok: true,
    available: a.available,
    reason: a.reason ?? null,
    disclosure: a.disclosure ?? null,
    checked: false,
    decision: null,
    decidedAt: null,
    serviceMessagesAlwaysDelivered: true,
  };
}

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MarketingConsentChoice channel="signup" deferSubmission />
    </QueryClientProvider>,
  );
}

beforeAll(() => {
  served.payload = payloadFromServer();
});
afterEach(() => cleanup());

/* ══════════════════════════════════════════════════════════════════════════
   0 — CONTROLS FIRST.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W345 render §0 · controls", () => {
  it("CONTROL: the server actually produced an available request to render", () => {
    // PRECONDITION. Without this, every "the box is not there" result below could
    // be a green produced by a broken builder rather than by a real state.
    expect(served.payload.available).toBe(true);
    expect(served.payload.disclosure).toBeTruthy();
  });

  it("CONTROL: a WRONG address does NOT appear in the rendered DOM — this test can go red", async () => {
    mount();
    const el = await screen.findByTestId("marketing-consent-wording");
    const rendered = el.textContent ?? "";
    expect(rendered.length).toBeGreaterThan(200); // precondition: something rendered
    expect(rendered).not.toContain("200 Bay Street");
    expect(rendered).not.toContain("Toronto, ON M5X 1C7"); // ONE space — not the owner's
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   1 — THE FOUR REQUIRED ELEMENTS, ASSERTED AS RENDERED TEXT.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W345 render §1 · all four required elements appear on the screen", () => {
  it("THE BOX RENDERS AT ALL — the checkbox and the wording are both in the DOM", async () => {
    mount();
    expect(await screen.findByTestId("marketing-consent-block")).toBeTruthy();
    expect(screen.getByTestId("checkbox-marketing-consent")).toBeTruthy();
    expect(screen.queryByTestId("marketing-consent-unavailable")).toBeNull();
  });

  it("ELEMENT 1 of 4 — THE PURPOSES are rendered", async () => {
    mount();
    const rendered = (await screen.findByTestId("marketing-consent-wording")).textContent ?? "";
    expect(rendered.length).toBeGreaterThan(200); // precondition
    expect(rendered).toContain(
      "occasional marketing emails about new features, upcoming events, and news about the platform",
    );
  });

  it("ELEMENT 2 of 4 — WHO IS ASKING is rendered", async () => {
    mount();
    const rendered = (await screen.findByTestId("marketing-consent-wording")).textContent ?? "";
    expect(rendered.length).toBeGreaterThan(200); // precondition
    expect(rendered).toContain(`This request is made by ${OWNER_IDENTITY}.`);
  });

  it("ELEMENT 3 of 4 — THE MAILING ADDRESS is rendered VERBATIM, line for line, in order", async () => {
    mount();
    const el = await screen.findByTestId("marketing-consent-wording");
    const rendered = el.textContent ?? "";
    expect(rendered.length).toBeGreaterThan(200); // precondition

    // The whole block, contiguously, including the owner's double space.
    expect(rendered).toContain(OWNER_ADDRESS);
    // Line by line, so a failure names which line went missing.
    for (const line of OWNER_ADDRESS.split("\n").filter((l) => l.trim() !== "")) {
      expect(rendered).toContain(line);
    }
    // Toronto primary, Hong Kong BENEATH it — the owner's ruling on order.
    expect(rendered.indexOf("Central, Hong Kong")).toBeGreaterThan(
      rendered.indexOf("Toronto, ON  M5X 1C7"),
    );
    // AND IT IS RENDERED AS LINES. HTML collapses newlines by default, which
    // would turn a two-part postal address into one run-on line: the right
    // characters, the wrong address. The line breaks are in the text node and the
    // element is told to honour them.
    expect(rendered.split("\n").length).toBeGreaterThan(8);
    expect(el.className).toContain("whitespace-pre-line");
  });

  it("ELEMENT 3 also renders the 60-DAY VALIDITY statement", async () => {
    mount();
    const rendered = (await screen.findByTestId("marketing-consent-wording")).textContent ?? "";
    expect(rendered).toContain("stays valid for at least 60 days after any message we send you");
  });

  it("ELEMENT 4 of 4 — THAT PERMISSION CAN BE WITHDRAWN is rendered", async () => {
    mount();
    const rendered = (await screen.findByTestId("marketing-consent-wording")).textContent ?? "";
    expect(rendered.length).toBeGreaterThan(200); // precondition
    expect(rendered).toContain(
      "You can withdraw this permission at any time from your account settings, in one step.",
    );
  });

  it("the wording is NOT behind a 'learn more' — all four are in one visible element", async () => {
    mount();
    const rendered = (await screen.findByTestId("marketing-consent-wording")).textContent ?? "";
    // One element carrying all four, rather than four things a person must click
    // to find. This is the difference between a request and a footnote.
    const limbs = [
      "occasional marketing emails about new features",
      `This request is made by ${OWNER_IDENTITY}.`,
      OWNER_ADDRESS,
      "You can withdraw this permission at any time",
    ];
    for (const limb of limbs) expect(rendered).toContain(limb);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2 — IT IS STILL UNTICKED, OPTIONAL, AND NO HARDER TO DECLINE.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W345 render §2 · unticked, optional, separate", () => {
  it("THE BOX ARRIVES UNTICKED and is NOT a required field", async () => {
    mount();
    const box = (await screen.findByTestId("checkbox-marketing-consent")) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box.required).toBe(false);
    expect(box.type).toBe("checkbox");
    expect(box.hasAttribute("aria-required")).toBe(false);
  });

  it("the screen SAYS it is optional, in words, next to the box", async () => {
    mount();
    const label = (await screen.findByTestId("marketing-consent-label")).textContent ?? "";
    expect(label).toContain("This is optional.");
    const note = (await screen.findByTestId("marketing-consent-optional-note")).textContent ?? "";
    expect(note).toContain("Leaving this unticked is fine");
    // Declining is doing nothing. There is no second step and nothing that argues.
    expect(note).not.toMatch(/are you sure|miss out|confirm/i);
  });

  it("the wording tells the person their ACCOUNT MESSAGES are not affected either way", async () => {
    mount();
    const rendered = (await screen.findByTestId("marketing-consent-wording")).textContent ?? "";
    expect(rendered).toContain(
      "messages we have to send you about your account and its security are not affected by this choice",
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3 — THE FAIL-SAFE, PROVED AT THE SCREEN: BLANK ADDRESS → NO BOX.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W345 render §3 · with the address blank, the box does not render", () => {
  it("BLANK ADDRESS: no checkbox, no wording — the box is ABSENT, not empty", async () => {
    const saved = process.env.MARKETING_CONSENT_MAILING_ADDRESS;
    try {
      process.env.MARKETING_CONSENT_MAILING_ADDRESS = "";
      served.payload = payloadFromServer();
      // PRECONDITION: the server really did report unavailable. Otherwise the
      // assertions below would be testing the wrong state and passing anyway.
      expect(served.payload.available).toBe(false);

      mount();
      expect(await screen.findByTestId("marketing-consent-unavailable")).toBeTruthy();
      expect(screen.queryByTestId("marketing-consent-block")).toBeNull();
      expect(screen.queryByTestId("checkbox-marketing-consent")).toBeNull();
      expect(screen.queryByTestId("marketing-consent-wording")).toBeNull();
    } finally {
      process.env.MARKETING_CONSENT_MAILING_ADDRESS = saved;
      expect(process.env.MARKETING_CONSENT_MAILING_ADDRESS).toBe(saved);
      served.payload = payloadFromServer();
    }
  });

  it("BLANK ADDRESS: the person is TOLD, in plain words, rather than shown silence", async () => {
    const saved = process.env.MARKETING_CONSENT_MAILING_ADDRESS;
    try {
      process.env.MARKETING_CONSENT_MAILING_ADDRESS = "";
      served.payload = payloadFromServer();
      mount();
      const msg = (await screen.findByTestId("marketing-consent-unavailable")).textContent ?? "";
      expect(msg).toContain("postal address");
      expect(msg).toContain("no marketing is being sent to anyone");
    } finally {
      process.env.MARKETING_CONSENT_MAILING_ADDRESS = saved;
      expect(process.env.MARKETING_CONSENT_MAILING_ADDRESS).toBe(saved);
      served.payload = payloadFromServer();
    }
  });

  it("CONTROL: the box comes BACK once the address is restored — it is a switch, not an off feature", async () => {
    expect(served.payload.available).toBe(true);
    mount();
    expect(await screen.findByTestId("marketing-consent-block")).toBeTruthy();
    const rendered = (await screen.findByTestId("marketing-consent-wording")).textContent ?? "";
    await waitFor(() => expect(rendered).toContain(OWNER_ADDRESS));
  });
});
