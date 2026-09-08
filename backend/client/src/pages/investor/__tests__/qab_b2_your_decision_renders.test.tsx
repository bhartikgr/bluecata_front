/**
 * ══════════════════════════════════════════════════════════════════════════════
 * QA BLOCKER 2 — "myInv is not defined" white-screened the "Your Decision" tab.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * THE DEFECT (re-verified before this file was written, tree v26.50.0):
 *   `myInv` is declared ONCE, at `CompanyDetail.tsx:173`, inside
 *   `InvestorCompanyDetail` (declared at :133). `YourDecisionPanel` is declared at
 *   :591 — a SIBLING function, not a nested one. Lines :898 and :899 read
 *   `myInv?.round` from inside that sibling, where no such binding exists.
 *   `?.` guards a null VALUE; it does nothing for an UNRESOLVED IDENTIFIER, so the
 *   expression threw `ReferenceError: myInv is not defined` during render and React
 *   unmounted the tree — the white screen QA saw on the screen where an investor
 *   decides whether to invest.
 *
 * THE FIX: two identifiers on two adjacent lines. `myInv?` → `inv` — `inv` is the
 * panel's own prop, is the same object, is typed `Inv` and non-nullable at the
 * prop boundary, and is already read on the surrounding lines (:896 reads
 * `inv.minTicket`, :887 reads `inv.round.name`). The `?? "Per round terms"`
 * fallback is retained verbatim.
 *
 * WHY THIS FILE ASSERTS RENDERED TEXT AND NOT THE ABSENCE OF AN ERROR.
 * "No error was thrown" is the weakest possible proof: a panel that never mounts
 * throws nothing either. Every assertion below is on TEXT THE INVESTOR READS,
 * taken from the REAL shipped page module (`../CompanyDetail`, default export,
 * the same module `App.tsx` renders), mounted on the `your-decision` tab.
 *
 * THE INSTRUMENT IS VALIDATED BEFORE IT IS TRUSTED (test 0). React's error
 * boundary-free render surfaces a throw as a rejected render. Test 0 mounts a
 * component that throws the exact `ReferenceError` this defect produced and
 * proves the harness reports it, so a green in tests 1–3 is a green the harness
 * was capable of turning red.
 *
 * POLES
 *   0  CONTROL      — a deliberate ReferenceError IS caught by this harness
 *   1  UPPER        — round.terms PRESENT  → the two recorded values render
 *   2  UPPER        — round.terms ABSENT   → the retained "Per round terms" renders
 *   3  ANCHOR       — the panel really mounted (its own sibling text is present),
 *                     so tests 1–2 are not vacuous passes over an unmounted tab
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { RoleProvider } from "@/lib/role";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

/* The page body sits behind `RequireEntitlement`. That gate is orthogonal to this
   blocker and has its own tests; without bypassing it every assertion here would
   be made against the "Cap-table membership required" fallback and would prove
   nothing about the panel under test. Nothing else about the page is stubbed. */
vi.mock("@/lib/entitlement", async () => {
  const actual = await vi.importActual<typeof import("@/lib/entitlement")>("@/lib/entitlement");
  return {
    ...actual,
    RequireEntitlement: ({ children }: { children: ReactNode }) => <>{children}</>,
    useEntitlement: () => ({ data: undefined, isLoading: false, isError: false }),
  };
});
vi.mock("@/components/AppShell", async () => {
  const actual = await vi.importActual<typeof import("@/components/AppShell")>("@/components/AppShell");
  return {
    ...actual,
    PageBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    PageHeader: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  };
});

import InvestorCompanyDetail from "../CompanyDetail";

const COMPANY_ID = "co_qab_b2";
const ROUND_ID = "rnd_qab_b2";
const INV_ID = "inv_qab_b2";

const COMPANY = { id: COMPANY_ID, name: "Hydra Labs", sector: "fintech", stage: "seed" };

/** The invitation the page matches on `i.company.id === id` (`CompanyDetail.tsx:173`). */
function invitation(terms: Record<string, string> | null) {
  return {
    id: INV_ID,
    company: { id: COMPANY_ID, name: "Hydra Labs", sector: "fintech" },
    round: {
      id: ROUND_ID,
      name: "Seed",
      type: "priced",
      state: "open",
      ...(terms === null ? {} : { terms }),
    },
    state: "pending",
    receivedAt: "2026-01-01T00:00:00Z",
    expiresAt: null,
    minTicket: 25000,
    targetAmount: 2000000,
    raisedAmount: 0,
    preMoney: 8000000,
    postMoney: 10000000,
    pricePerShare: 1.25,
    currency: "USD",
  };
}

function renderDecisionTab(terms: Record<string, string> | null) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: (async ({ queryKey }: { queryKey: readonly unknown[] }) => {
          const key = queryKey.map(String).join("/");
          if (key.includes("/api/investor/invitations")) return [invitation(terms)];
          if (key.includes("/api/companies")) return COMPANY;
          if (key.includes("/decision")) {
            return {
              invitationId: INV_ID,
              roundId: ROUND_ID,
              companyId: COMPANY_ID,
              state: "viewed",
              history: [],
              mim: [],
            };
          }
          return [];
        }) as never,
      },
      mutations: { retry: false },
    },
  });
  window.history.pushState({}, "", `/investor/companies/${COMPANY_ID}?tab=your-decision`);
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <TooltipProvider>
          <InvestorCompanyDetail companyIdOverride={COMPANY_ID} />
        </TooltipProvider>
      </RoleProvider>
    </QueryClientProvider>,
  );
}

/** All text the investor can actually read, whitespace-normalised. */
function readable(root: HTMLElement): string {
  return (root.textContent ?? "").replace(/\s+/g, " ");
}

beforeEach(() => {
  onlineManager.setOnline(true);
});
afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
});

describe("QA-B2 · the investor's Your Decision tab renders instead of white-screening", () => {
  it("0 · CONTROL — this harness DOES report a ReferenceError thrown during render", () => {
    function Exploding(): JSX.Element {
      /* The exact failure mode B2 produced: an unresolved identifier evaluated
         inside render. Written through `Function` so the module still compiles. */
      return <div>{String(new Function("return myInvDeliberatelyUndefined;")())}</div>;
    }
    /* If this does NOT throw, the harness cannot see the class of failure this
       file exists to detect, and every green below would be worthless. */
    expect(() => render(<Exploding />)).toThrow(/is not defined/);
  });

  it("1 · UPPER POLE — with round terms recorded, the panel renders BOTH recorded values", async () => {
    const { container } = renderDecisionTab({
      liquidationPref: "1x non-participating",
      proRataMinimum: "USD 100,000",
    });

    /* Positive anchor FIRST: prove the panel mounted before asserting on its
       contents, so a silent empty cannot pass as a fix. */
    expect(await screen.findByText("Term sheet preview")).toBeTruthy();

    const text = readable(container);
    expect(text).toContain("Liquidation pref");
    expect(text).toContain("Pro-rata");
    /* The values themselves — read from `inv.round.terms`, which is what the two
       fixed lines now source. Pre-fix these lines threw and rendered nothing. */
    expect(text).toContain("1x non-participating");
    expect(text).toContain("USD 100,000");
    /* And the tab is NOT the "no invitation" empty state. */
    expect(text).not.toContain("No invitation found");
  });

  it("2 · UPPER POLE — with NO round terms, the retained fallback sentence renders verbatim", async () => {
    const { container } = renderDecisionTab(null);
    expect(await screen.findByText("Term sheet preview")).toBeTruthy();
    const text = readable(container);
    expect(text).toContain("Liquidation pref");
    expect(text).toContain("Pro-rata");
    /* `?? "Per round terms"` was retained byte-identical by the fix. It must fire
       exactly as it always was meant to when `terms` is absent — twice. */
    expect(screen.getAllByText("Per round terms").length).toBe(2);
  });

  it("3 · ANCHOR — the sibling stats around the two fixed lines render too", async () => {
    const { container } = renderDecisionTab({
      liquidationPref: "1x non-participating",
      proRataMinimum: "USD 100,000",
    });
    expect(await screen.findByText("Term sheet preview")).toBeTruthy();
    const text = readable(container);
    /* :887 and :896 — untouched neighbours. If these are missing the panel did
       not render and tests 1–2 would be measuring the wrong thing. */
    expect(text).toContain("Round name");
    expect(text).toContain("Min ticket");
    expect(text).toContain("Read-only summary");
  });
});
