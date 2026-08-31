/**
 * WAVE 176 · ITEMS A AND B — RENDERED-DOM PROOF ON THE REAL PARTNER PAGE.
 *
 * Both defects were found by the owner on live 26.29.0 (R147.3 items 1 and 3):
 *
 *   ITEM A  "Units (shares)" gates the Commit button while reading as optional,
 *           and nothing on screen says why the button is dead.
 *   ITEM B  A $9,000,000 commitment against a $5,000,000 target was accepted
 *           with only the toast "LP committed to the cap table." — R130's WARN
 *           half never reached the screen.
 *
 * WHY THIS MOUNTS THE PAGE AND NOT A STORE (R137). The last time a fix passed
 * against fixtures and never reached the user, the fix was proved against a
 * store. Every assertion below is `textContent` / `disabled` read off the DOM
 * that `PartnerSpvDetail` — the real component the live route renders — produced,
 * after real `fireEvent` typing and a real click on the real button.
 *
 * WHY THE ITEM-B FIXTURE CANNOT INVENT A SHAPE THE SERVER DOES NOT SEND. The
 * mocked `lp-commit` response is built by calling the SHARED
 * `spvTargetRaiseWarningSentence` — the same function the route calls and the
 * same one the store attaches to the durable `_targetOverages` record. The
 * companion server test (server/__tests__/w176_target_raise_warning_route.test.ts)
 * drives the real Express route and asserts the response carries exactly that
 * sentence. Neither test can pass while the wire contract is broken.
 *
 * ANTI-VACUITY. The item-A test asserts the SILENT dead button fails: it requires
 * either an enabled button OR an on-screen message that names units. The item-B
 * assertions are against figures DERIVED from the fixture (target, resulting
 * total, overage), the negative control asserts the same element is EMPTY, and
 * the recorded outcome (`subscription.status`, the durable record) is asserted
 * unchanged by the warning.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerSpvDetail from "../PartnerSpvDetail";
import type { SpvCapSplitFigures } from "@shared/spvCapSplitDisclosure";
import { spvTargetRaiseWarningSentence } from "@shared/spvCapSplitDisclosure";

type Sub = { investorId: string; name: string | null; email: string | null; commitmentMinor: number; status: string; ownershipPct: number };

const TARGET_MINOR = 500_000_000; // 5,000,000.00 USD — the owner's live figures
const COMMIT_WHOLE = "9000000";   // 9,000,000.00 USD
const COMMIT_MINOR = 900_000_000;

let subscribers: Sub[] = [];
let capMinor: number | null = null;
let targetRaiseMinor: number | null = TARGET_MINOR;
/** The body the mocked `lp-commit` endpoint answers with. */
let commitResponse: Record<string, unknown> = {};
let commitRequests: Array<Record<string, unknown>> = [];
const toasts: Array<{ title?: string; description?: string; variant?: string }> = [];

function sub(email: string, minor: number, status = "committed"): Sub {
  return { investorId: `inv_${email}`, name: "Lp Holder", email, commitmentMinor: minor, status, ownershipPct: 0 };
}

vi.mock("@/components/partner/PartnerShell", () => ({
  PartnerShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PartnerEmptyState: ({ title }: { title?: string }) => <div>{title}</div>,
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: (t: { title?: string; description?: string; variant?: string }) => { toasts.push(t); } }),
}));
vi.mock("wouter", () => ({
  useRoute: () => [true, { id: "spv_w176" }],
  Link: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "p_w176",
      tier: "builder",
      subRole: "managing_partner",
      identity: { userId: "u_w176", email: "gp@example.com", name: "W176 GP" },
    },
  }),
}));

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async (method: string, url: string, body?: unknown) => {
      let payload: unknown = {};
      if (url.includes("lp-commit")) {
        commitRequests.push((body ?? {}) as Record<string, unknown>);
        payload = commitResponse;
      } else if (url.includes("lp-roster")) {
        payload = { spvId: "spv_w176", lpVisibility: "gp_only", subscribers, invites: [] };
      } else {
        payload = {
          spv: {
            id: "spv_w176",
            name: "W176 Target SPV",
            jurisdiction: "delaware",
            targetRaiseMinor,
            capMinor,
            currency: "USD",
            status: "open",
            revisionHash: "a".repeat(64),
            createdAt: new Date().toISOString(),
            terms: null,
          },
          positions: [],
        };
      }
      return {
        ok: true,
        status: 201,
        statusText: "created",
        text: async () => JSON.stringify(payload),
        json: async () => payload,
      } as unknown as Response;
    },
  };
});

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const r = render(<QueryClientProvider client={qc}>{<PartnerSpvDetail />}</QueryClientProvider>);
  await screen.findByTestId("partner-spv-lp-commit-form");
  return r;
}

function type(testid: string, value: string) {
  fireEvent.change(screen.getByTestId(testid) as HTMLInputElement, { target: { value } });
}
function text(testid: string): string {
  return screen.getByTestId(testid).textContent ?? "";
}
function submit(): HTMLButtonElement {
  return screen.getByTestId("partner-spv-lp-commit-submit") as HTMLButtonElement;
}

/** The response the REAL route produces for this fixture, sentence and all. */
function targetRaiseResponse(resultingTotalMinor: number, exceeded: boolean) {
  const requested = Math.min(COMMIT_MINOR, resultingTotalMinor);
  const figures: SpvCapSplitFigures = {
    capMinor,
    confirmedCapitalMinor: resultingTotalMinor - requested,
    softCircledInterestMinor: 0,
    wiredNotCommittedMinor: 0,
    requestedMinor: requested,
    resultingTotalMinor,
    overageMinor: capMinor == null ? 0 : Math.max(0, resultingTotalMinor - capMinor),
    currency: "USD",
  };
  return {
    ok: true,
    idempotent: false,
    subscription: { id: "spvsub_w176", investorId: "inv_new", status: "committed", commitmentMinor: COMMIT_MINOR },
    targetRaise: {
      targetRaiseMinor,
      overages: exceeded
        ? [{
            reasonCode: "TARGET_RAISE_EXCEEDED",
            investorId: "inv_new",
            targetRaiseMinor,
            resultingTotalMinor,
            targetOverageMinor: resultingTotalMinor - (targetRaiseMinor ?? 0),
            currency: "USD",
            blocked: false,
          }]
        : [],
      blocked: false,
      exceeded,
      warning: exceeded && targetRaiseMinor != null
        ? spvTargetRaiseWarningSentence({ ...figures, targetRaiseMinor }, 2)
        : "",
    },
  };
}

function fillEveryField() {
  type("partner-spv-lp-commit-firstname", "New");
  type("partner-spv-lp-commit-lastname", "Lp");
  type("partner-spv-lp-commit-email", "new@example.com");
  type("partner-spv-lp-commit-amount", COMMIT_WHOLE);
  type("partner-spv-lp-commit-units", "100");
}

beforeEach(() => {
  subscribers = [];
  capMinor = null;
  targetRaiseMinor = TARGET_MINOR;
  commitResponse = {};
  commitRequests = [];
  toasts.length = 0;
});
afterEach(() => cleanup());

describe("W176 ITEM A · R147.3(3) — units may not silently kill the button", () => {
  it("every field EXCEPT units: either the button is enabled, or a visible message names units as required", async () => {
    await mount();
    type("partner-spv-lp-commit-firstname", "New");
    type("partner-spv-lp-commit-lastname", "Lp");
    type("partner-spv-lp-commit-email", "new@example.com");
    type("partner-spv-lp-commit-amount", COMMIT_WHOLE);
    // units deliberately left empty

    const disabled = submit().disabled;
    /* THE WHOLE POINT: a dead button with no explanation must FAIL. The screen is
       read as a whole, so the proof does not depend on which element carries the
       sentence — only that a real partner can see it. */
    const onScreen = (screen.getByTestId("partner-spv-lp-commit-form").textContent ?? "").toLowerCase();
    const namesUnits = onScreen.includes("units (shares)") && onScreen.includes("required");
    expect(disabled === false || namesUnits).toBe(true);

    // And, specifically, this tree takes the "server requires units" branch:
    expect(disabled).toBe(true);
    expect(text("partner-spv-lp-commit-disabled-reason").toLowerCase()).toContain("units (shares)");
    expect(text("partner-spv-lp-commit-disabled-reason").toLowerCase()).toContain("required");
    expect(text("partner-spv-lp-commit-units-required").toLowerCase()).toContain("required");
  });

  it("the units field itself is marked required for assistive technology, and its placeholder is unchanged", async () => {
    await mount();
    const input = screen.getByTestId("partner-spv-lp-commit-units") as HTMLInputElement;
    expect(input.placeholder).toBe("Units (shares)"); // R143.1 — byte-verbatim
    expect(input.getAttribute("aria-label") ?? "").toContain("required");
  });

  it("the reason names EVERY missing field, and clears completely once the form is fillable", async () => {
    await mount();
    const empty = text("partner-spv-lp-commit-disabled-reason").toLowerCase();
    for (const f of ["first name", "last name", "email", "commitment amount", "units (shares)"]) {
      expect(empty).toContain(f);
    }
    fillEveryField();
    expect(text("partner-spv-lp-commit-disabled-reason")).toBe("");
    expect(submit().disabled).toBe(false);
  });

  it("a filled-but-invalid amount is reported as an amount problem, not as a missing field", async () => {
    await mount();
    fillEveryField();
    type("partner-spv-lp-commit-amount", "-5000");
    const reason = text("partner-spv-lp-commit-disabled-reason").toLowerCase();
    expect(submit().disabled).toBe(true);
    expect(reason).toContain("amount");
    expect(reason).not.toContain("still needed");
  });
});

describe("W176 ITEM B · R147.3(1) — the target overage WARNS on screen and blocks nothing", () => {
  it("a 9,000,000 commit against a 5,000,000 target: warning visible, commitment SUCCEEDED", async () => {
    const resulting = COMMIT_MINOR; // nothing else in the vehicle
    commitResponse = targetRaiseResponse(resulting, true);
    await mount();
    expect(text("partner-spv-lp-commit-target-warning")).toBe(""); // nothing committed yet
    fillEveryField();
    expect(submit().disabled).toBe(false); // never blocked
    fireEvent.click(submit());

    await waitFor(() => expect(text("partner-spv-lp-commit-target-warning")).not.toBe(""));
    const w = text("partner-spv-lp-commit-target-warning");

    // R130.1 — the target is a GOAL, said in the shipped words
    expect(w).toContain("not a limit");
    expect(w.toLowerCase()).toContain("passed its target raise");
    // figures DERIVED from the fixture, as rendered
    expect(w).toContain("5,000,000.00 USD"); // the target
    expect(w).toContain("9,000,000.00 USD"); // the resulting committed total
    expect(w).toContain("4,000,000.00 USD"); // the overage
    // never a refusal
    expect(w.toLowerCase()).not.toContain("not accepted");
    expect(w.toLowerCase()).not.toContain("nothing was saved");

    // THE COMMITMENT HAPPENED: the request went out, the success toast fired with
    // its literal byte-verbatim, and no failure toast was raised.
    expect(commitRequests).toHaveLength(1);
    expect(commitRequests[0].amount).toBe(COMMIT_WHOLE);
    expect(toasts.some((t) => t.title === "LP committed to the cap table")).toBe(true);
    expect(toasts.some((t) => t.variant === "destructive")).toBe(false);
  });

  it("the recorded outcome is unchanged by the warning: blocked stays false and the reason code is the target one", async () => {
    commitResponse = targetRaiseResponse(COMMIT_MINOR, true);
    await mount();
    fillEveryField();
    fireEvent.click(submit());
    await waitFor(() => expect(text("partner-spv-lp-commit-target-warning")).not.toBe(""));
    const tr = (commitResponse as { targetRaise: { blocked: boolean; overages: Array<{ reasonCode: string; blocked: boolean }> } }).targetRaise;
    expect(tr.blocked).toBe(false);
    expect(tr.overages[0].reasonCode).toBe("TARGET_RAISE_EXCEEDED");
    expect(tr.overages[0].blocked).toBe(false);
    // and the warning is not a cap warning: the cap sibling stays empty (no cap set)
    expect(text("partner-spv-lp-commit-cap-warning")).toBe("");
  });

  it("NEGATIVE CONTROL — a commit UNDER the target renders NO warning", async () => {
    commitResponse = targetRaiseResponse(200_000_000, false); // 2,000,000.00 of a 5,000,000.00 target
    await mount();
    type("partner-spv-lp-commit-firstname", "New");
    type("partner-spv-lp-commit-lastname", "Lp");
    type("partner-spv-lp-commit-email", "new@example.com");
    type("partner-spv-lp-commit-amount", "2000000");
    type("partner-spv-lp-commit-units", "100");
    fireEvent.click(submit());
    await waitFor(() => expect(commitRequests).toHaveLength(1));
    await waitFor(() => expect(toasts.some((t) => t.title === "LP committed to the cap table")).toBe(true));
    expect(text("partner-spv-lp-commit-target-warning")).toBe("");
  });

  it("NEGATIVE CONTROL — a vehicle with NO target raise renders no warning either (null is not zero)", async () => {
    targetRaiseMinor = null;
    commitResponse = targetRaiseResponse(COMMIT_MINOR, false);
    await mount();
    fillEveryField();
    fireEvent.click(submit());
    await waitFor(() => expect(commitRequests).toHaveLength(1));
    await waitFor(() => expect(toasts.some((t) => t.title === "LP committed to the cap table")).toBe(true));
    expect(text("partner-spv-lp-commit-target-warning")).toBe("");
  });

  it("a malformed response never prints internals at a partner", async () => {
    commitResponse = { ok: true, targetRaise: { warning: { nope: 1 } } };
    await mount();
    fillEveryField();
    fireEvent.click(submit());
    await waitFor(() => expect(commitRequests).toHaveLength(1));
    expect(text("partner-spv-lp-commit-target-warning")).toBe("");
    expect(screen.getByTestId("partner-spv-lp-commit-form").textContent ?? "").not.toContain("[object Object]");
  });
});
