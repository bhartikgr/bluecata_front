/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * WAVE 340 · ITEM 1 — THE ONBOARDING PERCENTAGE MUST BE ABLE TO REACH 100%.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * THE OWNER, 6 SEPTEMBER 2026: "The onboarding should be able to reach 100%."
 *
 * THE DEFECT, stated as arithmetic. The denominator was `CHECKLIST.length` = 10,
 * and one of those ten — `sso_configured` — says on screen, in its own support
 * sentence, that it "cannot be completed on the platform". A denominator holding
 * a step nobody can complete cannot reach 100% for any partner at any effort.
 *
 * WHAT IS ASSERTED HERE, AND WHY EACH ARM EXISTS.
 *   A-0  CONTROL. The unsupported step is still on the page and still tickable.
 *        The cheap "fix" is deletion; R135.6 forbids it and this arm would go red
 *        if anyone took it.
 *   A-1  100% IS REACHED. Nine of nine, and the bar's own width style is 100%.
 *   A-2  100% IS REACHED WITHOUT TICKING THE UNSUPPORTED STEP — which is the
 *        whole point. If the only route to 100% were to tick a step the platform
 *        cannot perform, the ruling would not have been honoured.
 *   A-3  THE DENOMINATOR IS EXACTLY THE COMPLETABLE SET, asserted by count and by
 *        NAME-SET DIFF, both sides non-empty.
 *   A-4  THE HONESTY LABEL. Reaching 100% and being TRUE are different
 *        requirements. Every step whose tick the platform cannot verify carries a
 *        visible self-attested label; the step Capavate does hold a record for
 *        does not. Counted `=== 8`, and the two exclusions named.
 *   A-5  NO FALSE SENTENCE SURVIVES. The provenance note used to say the
 *        unsupported tick "still counts toward the percentage". After the ruling
 *        that is false, so its absence is asserted, not just the new wording.
 *
 * WHAT THIS TEST DOES NOT CLAIM. It does not claim any step is true. 100% here
 * means "every completable step is recorded"; eight of the nine are the partner's
 * own word. That is exactly what A-4 puts on the screen.
 *
 * No live access. Nothing here is claimed to be fixed on the live site.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleProvider } from "@/lib/role";

import OnboardingChecklistPage, {
  PROGRESS_NOT_SUPPORTED_MARKER,
  SELF_ATTESTED_LABEL,
  isCompletableChecklistItem,
  progressProvenanceOf,
} from "../OnboardingChecklistPage";

vi.mock("@/components/partner/PartnerShell", () => ({
  PartnerShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PartnerEmptyState: ({ title }: { title?: string }) => <div>{title}</div>,
  TierBadge: () => <span />,
  SubRoleBadge: () => <span />,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

/* One stable object: the page's load effect depends on `role.identity`, so a
   fresh object per call re-triggers the read forever and every control stays
   disabled. Documented by the sibling wave-F file, reused here deliberately. */
const W340_ROLE = {
  ready: true as const,
  error: null,
  identity: {
    partnerId: "p_w340",
    tier: "nexus",
    subRole: "managing_partner",
    identity: { userId: "u_w340", email: "w340@example.com", name: "Northgate Capital Partners" },
  },
};
vi.mock("@/lib/partner/useRequirePartnerRole", async () => ({
  ...(await vi.importActual<typeof import("@/lib/partner/useRequirePartnerRole")>(
    "@/lib/partner/useRequirePartnerRole",
  )),
  useRequirePartnerRole: () => W340_ROLE,
}));

/** The ten keys the page renders, in group order. */
const ALL_KEYS = [
  "kyc_org_doc",
  "kyc_signatory_doc",
  "signed_partner_agreement",
  "billing_contact",
  "team_invites",
  "first_pipeline_deal",
  "first_client_org",
  "sso_configured",
  "data_retention_acked",
  "go_live_review",
];
const AGREEMENT_KEY = "signed_partner_agreement";
const UNSUPPORTED_KEY = "sso_configured";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: String(status),
    headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone() {
      return this;
    },
  } as unknown as Response;
}

let serverState: Record<string, boolean> = {};
let agreementSignedOnRecord = false;
const realFetch = globalThis.fetch;

beforeEach(() => {
  serverState = Object.fromEntries(ALL_KEYS.map((k) => [k, false]));
  agreementSignedOnRecord = false;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? "GET").toUpperCase();
    if (url.includes("/api/partner/onboarding/state")) {
      if (method === "GET") {
        return jsonResponse({ state: { ...serverState }, savedAt: "2026-09-01T10:00:00.000Z" });
      }
      if (method === "PATCH") {
        const body =
          init?.body === undefined || init?.body === null ? {} : JSON.parse(String(init.body));
        serverState = { ...serverState, ...(body as Record<string, boolean>) };
        return jsonResponse({ state: { ...serverState }, savedAt: "2026-09-01T10:05:00.000Z" });
      }
    }
    if (url.includes("/api/partner/me/agreement")) {
      return jsonResponse({ signed: agreementSignedOnRecord, signedCurrent: agreementSignedOnRecord });
    }
    return jsonResponse({});
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

async function mountReady(): Promise<HTMLElement> {
  const root = document.createElement("div");
  root.setAttribute("data-product", "partner");
  document.body.appendChild(root);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <RoleProvider>
      <QueryClientProvider client={qc}>
        <OnboardingChecklistPage />
      </QueryClientProvider>
    </RoleProvider>,
    { container: root },
  );
  /* "The read has finished" = the Reload control is enabled. Waiting for a row is
     not enough; rows render while the read is still in flight. */
  await waitFor(() => {
    const reload = root.querySelector('[data-testid="button-reload"]') as HTMLButtonElement | null;
    expect(reload, "the checklist never rendered its Reload control").not.toBeNull();
    expect(reload!.hasAttribute("disabled"), "still loading").toBe(false);
  });
  return root;
}

function badgeText(root: HTMLElement): string {
  return root.querySelector('[data-testid="badge-progress"]')!.textContent ?? "";
}

describe("wave340 · item 1 — the onboarding percentage can reach 100%", () => {
  it("A-0 CONTROL: the step that cannot be completed is STILL on the page and STILL tickable", async () => {
    const root = await mountReady();
    const row = root.querySelector(`[data-testid="item-${UNSUPPORTED_KEY}"]`);
    expect(row, "the unsupported step was removed from the page — R135.6 forbids that").not.toBeNull();
    const toggle = root.querySelector(
      `[data-testid="toggle-${UNSUPPORTED_KEY}"]`,
    ) as HTMLButtonElement | null;
    expect(toggle, "the unsupported step lost its toggle").not.toBeNull();
    expect(toggle!.hasAttribute("disabled")).toBe(false);
    /* And it still says why, in its own words, verbatim. */
    const support = root.querySelector(`[data-testid="support-${UNSUPPORTED_KEY}"]`);
    expect(support!.textContent ?? "").toContain(PROGRESS_NOT_SUPPORTED_MARKER);
  }, 30_000);

  it("A-1 100% IS REACHED: nine of nine, and the bar itself is full", async () => {
    serverState = Object.fromEntries(ALL_KEYS.map((k) => [k, true]));
    agreementSignedOnRecord = true;
    const root = await mountReady();
    const badge = badgeText(root);
    expect(badge).toContain("9 / 9");
    expect(badge).toContain("100%");
    /* The BAR, not only the badge — the two are separate renders and a fix that
       moved one and not the other would still show a partner an unfinished bar. */
    const bar = root.querySelector('[data-testid="bar-progress"]') as HTMLElement;
    expect(bar.getAttribute("style") ?? "").toContain("width: 100%");
  }, 30_000);

  it("A-2 100% IS REACHED WITHOUT TICKING THE UNSUPPORTED STEP", async () => {
    /* This is the arm that proves the ruling was honoured rather than gamed. If
       the only route to 100% were ticking a step the platform cannot perform, the
       number would be reachable and dishonest. */
    serverState = Object.fromEntries(ALL_KEYS.map((k) => [k, true]));
    serverState[UNSUPPORTED_KEY] = false;
    agreementSignedOnRecord = true;
    const root = await mountReady();
    expect(badgeText(root)).toContain("100%");
    const toggle = root.querySelector(
      `[data-testid="toggle-${UNSUPPORTED_KEY}"]`,
    ) as HTMLButtonElement;
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    /* And the unsupported bucket line agrees it is unticked, so the 100% above is
       not being read off a row this test accidentally ticked. */
    expect(
      root.querySelector('[data-testid="text-progress-provenance-unsupported"]')!.textContent ?? "",
    ).toContain("0 ticked");
  }, 30_000);

  it("A-3 THE DENOMINATOR IS EXACTLY THE COMPLETABLE SET — count and name-set diff", async () => {
    const root = await mountReady();
    const total = Number(badgeText(root).split(" / ")[1].split(" ")[0]);

    const completable = ALL_KEYS.filter((k) =>
      isCompletableChecklistItem({
        key: k,
        support: k === UNSUPPORTED_KEY ? PROGRESS_NOT_SUPPORTED_MARKER : undefined,
      }),
    );
    const excluded = ALL_KEYS.filter((k) => !completable.includes(k));

    /* BOTH SIDES ASSERTED NON-EMPTY. A name-set diff where one side is empty
       proves nothing and would pass if the filter had been deleted. */
    expect(completable.length).toBeGreaterThan(0);
    expect(excluded.length).toBeGreaterThan(0);
    expect(excluded).toEqual([UNSUPPORTED_KEY]);
    expect(completable.length).toBe(ALL_KEYS.length - 1);
    expect(total).toBe(completable.length);
    expect(total).toBe(9);
  }, 30_000);

  it("A-4 THE HONESTY LABEL: every unverifiable step is labelled self-attested; the recorded one is not", async () => {
    const root = await mountReady();
    const labelled = Array.from(root.querySelectorAll('[data-testid^="selfattested-"]')).map((n) =>
      (n.getAttribute("data-testid") ?? "").replace("selfattested-", ""),
    );
    expect(labelled.length).toBe(8);
    expect(labelled).not.toContain(AGREEMENT_KEY);
    expect(labelled).not.toContain(UNSUPPORTED_KEY);
    /* Name-set diff against the mechanism that decides the tick, both sides
       non-empty. */
    const expected = ALL_KEYS.filter(
      (k) =>
        progressProvenanceOf({
          key: k,
          support: k === UNSUPPORTED_KEY ? PROGRESS_NOT_SUPPORTED_MARKER : undefined,
        }) === "self_attested",
    );
    const notExpected = ALL_KEYS.filter((k) => !expected.includes(k));
    expect(expected.length).toBeGreaterThan(0);
    expect(notExpected.length).toBeGreaterThan(0);
    expect([...labelled].sort()).toEqual([...expected].sort());
    /* THE RENDERED WORDS, not the constant's name. */
    const first = root.querySelector('[data-testid="selfattested-kyc_org_doc"]')!;
    expect(first.textContent ?? "").toBe(SELF_ATTESTED_LABEL);
    expect(first.textContent ?? "").toMatch(/self-attested/i);
    expect(first.textContent ?? "").toMatch(/does not verify/i);
  }, 30_000);

  it("A-5 NO FALSE SENTENCE SURVIVES the change to the arithmetic", async () => {
    const root = await mountReady();
    const block = root.querySelector('[data-testid="text-progress-provenance"]')!.textContent ?? "";
    expect(block).toMatch(/outside the percentage above/i);
    /* The old sentence is now untrue. Asserting its ABSENCE is the point: a new
       sentence added beside a false one leaves the false one on the screen. */
    expect(block).not.toMatch(/counts toward the percentage/i);
    /* And the lead line must not have started claiming a check nobody performs. */
    expect(block).not.toMatch(/verified/i);
    expect(block).toMatch(/100% is reachable/i);
  }, 30_000);
});
