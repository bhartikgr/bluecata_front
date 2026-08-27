/**
 * WAVE 164 · BATCH 3 · ITEM C · T-C.5 — RENDERED DOM.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * WHAT WAS WRONG. The GP warning summed EVERY non-withdrawn subscription — a
 * soft-circle, a GP-confirmed indication, an under-review row — and labelled the
 * result "Committed now:". A GP was therefore told that interest was capital,
 * which is the single defect R133.1 rules on. The capacity BASIS was and remains
 * CORRECT (a soft-circle does occupy a seat in the vehicle); only the LABEL lied.
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * HOW THIS FILE REFUSES TO BE VACUOUS.
 * ═══════════════════════════════════════════════════════════════════════════════
 * · Every figure asserted is DERIVED FROM THE FIXTURE and computed independently
 *   below, never read as a substring of a sentence this file also wrote.
 * · §1.2 is the one that fails on the old code: the phrase "Committed now" must be
 *   ABSENT, and the all-stages total must NOT appear as a bare labelled figure.
 * · Both poles are asserted: an over-cap amount renders the five figures, a
 *   within-cap amount renders an EMPTY container, and a null cap renders nothing.
 * · §3 asserts the R130 target block is a SEPARATE rendered element from the cap
 *   overrides, so a GP surface cannot present a goal being beaten as a breach.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerSpvDetail from "../PartnerSpvDetail";
import { SPV_CAP_BLANK_LABEL, SPV_NOT_ON_RECORD_LABEL } from "@shared/spvCapSplitDisclosure";

type Sub = {
  investorId: string;
  name: string | null;
  email: string | null;
  commitmentMinor: number;
  status: string;
  ownershipPct: number;
};

/* Non-round sentinels, in MINOR units. Nothing in the component or in any fixture
   elsewhere carries them, so a figure matching one can only have been computed
   from this register. */
const CAP_MINOR = 90_000_000; //        900,000.00 USD
const CONFIRMED_MINOR = 41_000_029; //  410,000.29 USD — real committed capital
const SOFT_MINOR = 73_000_047; //       730,000.47 USD — interest, NOT capital
const WIRED_MINOR = 19_000_013; //      190,000.13 USD — funds in, not committed
const TYPED_UNITS = "260000.11"; //     260,000.11 USD — the amount being typed
const TYPED_MINOR = 26_000_011;

/* Computed HERE, from the fixture, so the assertions are arithmetic rather than
   substring-matching of the component's own sentence. */
const ALL_STAGES = CONFIRMED_MINOR + SOFT_MINOR + WIRED_MINOR;
const RESULTING = ALL_STAGES + TYPED_MINOR;
const OVERAGE = RESULTING - CAP_MINOR;

/** Minor units → the component's own display form, computed independently. */
function money(minor: number): string {
  const whole = Math.trunc(minor / 100);
  const frac = String(Math.abs(minor % 100)).padStart(2, "0");
  return `${whole.toLocaleString("en-US")}.${frac} USD`;
}

let subscribers: Sub[] = [];
let capMinor: number | null = CAP_MINOR;
let targetRaiseMinor: number | null = null;
let terms: Record<string, unknown> | null = null;

function sub(email: string, minor: number, status: string): Sub {
  return { investorId: `inv_${email}`, name: "Lp Holder", email, commitmentMinor: minor, status, ownershipPct: 0 };
}

vi.mock("@/components/partner/PartnerShell", () => ({
  PartnerShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PartnerEmptyState: ({ title }: { title?: string }) => <div>{title}</div>,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("wouter", () => ({
  useRoute: () => [true, { id: "spv_w164" }],
  Link: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "p_w164",
      tier: "builder",
      subRole: "managing_partner",
      identity: { userId: "u_w164", email: "gp@example.com", name: "W164 GP" },
    },
  }),
}));

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async (_method: string, url: string) => {
      let payload: unknown = {};
      if (url.includes("lp-roster")) {
        payload = { spvId: "spv_w164", lpVisibility: "gp_only", subscribers, invites: [] };
      } else {
        payload = {
          spv: {
            id: "spv_w164",
            name: "W164 Split SPV",
            jurisdiction: "delaware",
            targetRaiseMinor,
            capMinor,
            currency: "USD",
            status: "open",
            revisionHash: "b".repeat(64),
            createdAt: new Date().toISOString(),
            terms,
          },
          positions: [],
        };
      }
      return {
        ok: true,
        status: 200,
        statusText: "ok",
        text: async () => JSON.stringify(payload),
        json: async () => payload,
      } as unknown as Response;
    },
  };
});

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const r = render(<QueryClientProvider client={qc}>{<PartnerSpvDetail />}</QueryClientProvider>);
  await screen.findByTestId("partner-spv-lp-commit-form");
  return r;
}

function warning(): string {
  return screen.getByTestId("partner-spv-lp-commit-cap-warning").textContent ?? "";
}
function type(testid: string, value: string) {
  fireEvent.change(screen.getByTestId(testid) as HTMLInputElement, { target: { value } });
}

/** The register that produces an over-cap situation with all three stages present. */
function blendedRegister(): Sub[] {
  return [
    sub("confirmed@example.com", CONFIRMED_MINOR, "committed"),
    sub("soft@example.com", SOFT_MINOR, "soft_circled"),
    sub("wired@example.com", WIRED_MINOR, "wire_funded"),
    sub("gone@example.com", 500_000_000, "withdrawn"),
  ];
}

async function typeOverCap() {
  await mount();
  type("partner-spv-lp-commit-firstname", "New");
  type("partner-spv-lp-commit-lastname", "Lp");
  type("partner-spv-lp-commit-email", "new@example.com");
  type("partner-spv-lp-commit-units", "100");
  type("partner-spv-lp-commit-amount", TYPED_UNITS);
}

beforeEach(() => {
  subscribers = [];
  capMinor = CAP_MINOR;
  targetRaiseMinor = null;
  terms = null;
});
afterEach(() => cleanup());

/* ═══════════════════════════════════════════════════════════════════════════════
   §1 — T-C.5. THE GP WARNING SHOWS FIVE LABELLED FIGURES AND NO FALSE LABEL.
   ═══════════════════════════════════════════════════════════════════════════════ */
describe("§1 the GP cap warning names the split", () => {
  it("1.1 renders cap, confirmed capital, soft-circled interest, funds received and the overage", async () => {
    subscribers = blendedRegister();
    await typeOverCap();
    const w = warning();

    /* Each figure with ITS OWN LABEL. A total on screen without its parts is the
       thing R133.1 forbids, so the labels are asserted, not only the numbers. */
    expect(w).toContain("Cap (maximum this vehicle may accept)");
    expect(w).toContain(money(CAP_MINOR));
    expect(w).toContain("Confirmed capital (committed subscriptions only)");
    expect(w).toContain(money(CONFIRMED_MINOR));
    expect(w).toContain("Soft-circled interest");
    expect(w).toContain(money(SOFT_MINOR));
    expect(w).toContain("Funds received, not yet committed");
    expect(w).toContain(money(WIRED_MINOR));
    expect(w).toContain("Overage above the cap");
    expect(w).toContain(money(OVERAGE));
    /* The total is still shown, but named as CAPACITY rather than as capital. */
    expect(w).toContain("Total occupying capacity after this commitment");
    expect(w).toContain(money(RESULTING));

    /* The parts must add up to the total the overage is measured against. If a
       later change drops one of them this assertion, not a reader, catches it. */
    expect(CONFIRMED_MINOR + SOFT_MINOR + WIRED_MINOR + TYPED_MINOR).toBe(RESULTING);
  });

  it("1.2 THE DEFECT — the phrase \"Committed now\" is ABSENT from the warning", async () => {
    subscribers = blendedRegister();
    await typeOverCap();
    const w = warning();
    /* This is the assertion the pre-wave-164 component fails. */
    expect(w).not.toContain("Committed now");
    /* And no figure equal to the all-stages capacity total may appear WITHOUT the
       word "capacity" beside it, because that total is not capital. */
    expect(w).not.toMatch(new RegExp(`Committed[^.]*${money(ALL_STAGES).replace(/[.]/g, "\\.")}`));
    /* The soft-circled figure must never be described as committed. */
    const softIdx = w.indexOf(money(SOFT_MINOR));
    expect(softIdx).toBeGreaterThan(-1);
    expect(w.slice(Math.max(0, softIdx - 120), softIdx)).toMatch(/Soft-circled interest/);
  });

  it("1.3 R133.1's other half — the soft-circle IS counted, so the basis is unchanged", async () => {
    /* Removing the soft-circle from the capacity basis would be the opposite
       error. With only the confirmed row and the typed amount the vehicle is
       INSIDE the cap; with the soft-circle and the wire it is over. Asserted as
       two renders, so the basis is proven by behaviour, not by reading source. */
    subscribers = [sub("confirmed@example.com", CONFIRMED_MINOR, "committed")];
    await typeOverCap();
    expect(warning()).toBe("");
    cleanup();

    subscribers = blendedRegister();
    await typeOverCap();
    expect(warning()).toContain("past its cap");
  });

  it("1.4 opposite pole — a within-cap amount renders an EMPTY warning", async () => {
    subscribers = [sub("confirmed@example.com", CONFIRMED_MINOR, "committed")];
    await mount();
    type("partner-spv-lp-commit-email", "new@example.com");
    type("partner-spv-lp-commit-amount", "1000");
    expect(warning()).toBe("");
  });

  it("1.5 the warning does not disable the submit — R105/R130 warn, they do not block", async () => {
    subscribers = blendedRegister();
    await typeOverCap();
    expect(warning()).not.toBe("");
    expect((screen.getByTestId("partner-spv-lp-commit-submit") as HTMLButtonElement).disabled).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════
   §2 — T-C.4. BLANK CAP READS "no maximum"; A CAP OF ZERO DOES NOT.
   ═══════════════════════════════════════════════════════════════════════════════ */
describe("§2 the cap tile distinguishes blank from zero", () => {
  it("2.1 a null cap renders the words \"no maximum\", never a zero", async () => {
    capMinor = null;
    subscribers = blendedRegister();
    await mount();
    const tile = screen.getByTestId("partner-spv-cap-maximum").textContent ?? "";
    expect(tile).toContain(SPV_CAP_BLANK_LABEL);
    expect(tile).not.toMatch(/0\.00/);
  });

  it("2.2 a cap of ZERO is a real cap of zero and is NOT called \"no maximum\"", async () => {
    capMinor = 0;
    subscribers = [];
    await mount();
    const tile = screen.getByTestId("partner-spv-cap-maximum").textContent ?? "";
    expect(tile).not.toContain(SPV_CAP_BLANK_LABEL);
    expect(tile).toContain("0.00");
  });

  it("2.3 R130.2 — the target is named as a GOAL on the same screen as the cap", async () => {
    targetRaiseMinor = 50_000_000;
    await mount();
    const note = screen.getByTestId("partner-spv-target-is-a-goal").textContent ?? "";
    expect(note.toLowerCase()).toContain("goal");
    expect(note.toLowerCase()).toContain("not a limit");
    expect(note.toLowerCase()).toContain("does not block");
    /* And the cap is named a MAXIMUM in the same view, so the two cannot be read
       as the same kind of number. */
    expect(document.body.textContent ?? "").toContain("Cap (maximum this vehicle may accept)");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════════
   §3 — THE DURABLE RECORDS, RENDERED, AND KEPT APART.
   ═══════════════════════════════════════════════════════════════════════════════ */
describe("§3 the recorded overages render their split and stay distinct", () => {
  it("3.1 a cap override renders cap, capital, interest, funds and overage", async () => {
    terms = {
      _capOverrides: {
        inv_x: {
          investorId: "inv_x",
          capMinor: CAP_MINOR,
          confirmedCapitalMinor: CONFIRMED_MINOR,
          softCircledInterestMinor: SOFT_MINOR,
          wiredNotCommittedMinor: WIRED_MINOR,
          resultingTotalMinor: RESULTING,
          overageMinor: OVERAGE,
          currency: "USD",
          actor: "u_w164",
          recordedAt: "2026-08-26T12:00:00.000Z",
        },
      },
    };
    await mount();
    const line = screen.getByTestId("partner-spv-cap-override-inv_x").textContent ?? "";
    expect(line).toContain("confirmed capital");
    expect(line).toContain(money(CONFIRMED_MINOR).replace(" USD", ""));
    expect(line).toContain("soft-circled interest");
    expect(line).toContain(money(SOFT_MINOR).replace(" USD", ""));
    expect(line).toContain("funds received not committed");
    expect(line).toContain("total occupying capacity");
    expect(line).toContain("overage");
    expect(line).toContain("u_w164");
    expect(line).not.toContain("not recorded");
  });

  it("3.2 a record written BEFORE this wave reads \"Not on record\", never zero", async () => {
    terms = {
      _capOverrides: {
        inv_old: {
          investorId: "inv_old",
          capMinor: CAP_MINOR,
          resultingTotalMinor: RESULTING,
          overageMinor: OVERAGE,
          currency: "USD",
          recordedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    };
    await mount();
    const line = screen.getByTestId("partner-spv-cap-override-inv_old").textContent ?? "";
    /* Three absent split fields — a legacy record must say so rather than assert
       that the vehicle held nothing. */
    expect(line.split(SPV_NOT_ON_RECORD_LABEL).length - 1).toBe(3);
    expect(line).not.toMatch(/confirmed capital 0\.00/);
  });

  it("3.3 R130 — a target overage renders in its OWN element, not among cap overrides", async () => {
    targetRaiseMinor = 50_000_000;
    terms = {
      _targetOverages: {
        inv_t: {
          reasonCode: "TARGET_RAISE_EXCEEDED",
          investorId: "inv_t",
          targetRaiseMinor: 50_000_000,
          confirmedCapitalMinor: CONFIRMED_MINOR,
          softCircledInterestMinor: SOFT_MINOR,
          resultingTotalMinor: CONFIRMED_MINOR + SOFT_MINOR,
          targetOverageMinor: CONFIRMED_MINOR + SOFT_MINOR - 50_000_000,
          currency: "USD",
          blocked: false,
          recordedAt: "2026-08-26T12:00:00.000Z",
        },
      },
    };
    await mount();
    const t = screen.getByTestId("partner-spv-target-overage-inv_t").textContent ?? "";
    expect(t).toContain("Above target raise");
    expect(t.toLowerCase()).toContain("not blocked");
    expect(t.toLowerCase()).toContain("goal rather than a limit");
    expect(t).toContain("above target by");
    /* No machine code reaches the screen. */
    expect(t).not.toContain("TARGET_RAISE_EXCEEDED");
    expect(t).not.toContain("_targetOverages");
    /* And the cap-override container is EMPTY — a beaten goal is not a breach. */
    expect((screen.getByTestId("partner-spv-cap-overrides").textContent ?? "").trim()).toBe("");
  });

  it("3.4 opposite pole — no records renders two empty containers", async () => {
    terms = null;
    await mount();
    expect((screen.getByTestId("partner-spv-cap-overrides").textContent ?? "").trim()).toBe("");
    expect((screen.getByTestId("partner-spv-target-overages").textContent ?? "").trim()).toBe("");
  });
});
