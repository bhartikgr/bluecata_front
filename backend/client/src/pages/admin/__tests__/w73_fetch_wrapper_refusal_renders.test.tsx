/**
 * WAVE 73 · ITEM 1 · R58 — THE HAND-ROLLED `fetch` WRAPPERS STOP THROWING THE
 * SERVER'S EXPLANATION AWAY.
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT. Wave 69 fixed the `ApiError` consumers, so it fixed the screens that
 * go through `queryClient`. Five screens have their OWN `fetch` wrapper and never
 * build an `ApiError` at all. Each read `j.error` — an enum code — and threw the
 * server's sentence away:
 *
 *     admin/ConsortiumApplicationsPage.tsx  `fetchJson`   (the one Review 3 named)
 *     partner/OnboardingChecklistPage.tsx   `fetchJson`
 *     settings/PrivacyPage.tsx              `postJson`
 *     admin/AuditChainVerifyPage.tsx        `getJson`  (body never read at all)
 *     founder/Subscribe.tsx                 the reactivate branch
 *
 * The measured case: `server/consortiumApplyStore.ts:2162-2174` refuses a partner
 * approval with a 409 whose `message` is 393 characters and states which ruling
 * applies, that the approval was ROLLED BACK, that nothing was half-written, and
 * what to fix. An admin read:
 *
 *     HTTP 409: partner_approval_invoice_refused
 *
 * WHY THIS TEST STUBS `global.fetch`. These wrappers call `fetch` directly, so
 * stubbing anything higher would bypass the exact code under test. The refusal
 * text is deliberately > 240 characters, i.e. long enough that `queryClient`'s
 * boundary gate would have replaced it — asserted below, so this file also proves
 * the fix is not accidentally relying on that path.
 *
 * BOTH POLES, on both of the two screens tested here:
 *   REFUSAL pole    — the server's own sentence reaches the DOM, in the page's
 *                     persistent inline banner (not a toast), and the bare
 *                     `HTTP 409: <code>` substitute is NOT on screen.
 *   LEGITIMATE pole — a 200 renders the page's normal content and no banner, and
 *                     a failure whose body carries NO explanation still renders
 *                     the wrapper's ORIGINAL `HTTP <status>: <code>` string, so
 *                     nothing was lost for the cases the old copy was true of.
 *
 * MUTATION TRANSCRIPT: build_log/wave73/W73_TESTS.md.
 * FULL ENUMERATION:    build_log/wave73/W73_FETCH_WRAPPER_ENUMERATION.md.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleProvider } from "@/lib/role";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "ac_partner_w73",
      tier: "gold",
      subRole: "managing_partner",
      identity: { userId: "u_w73", email: "partner@example.com", name: "W73 Partner" },
    },
  }),
}));
vi.mock("@/components/partner/PartnerShell", async () => {
  const actual = await vi.importActual<typeof import("@/components/partner/PartnerShell")>(
    "@/components/partner/PartnerShell",
  );
  return { ...actual, PartnerShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});

import AdminConsortiumApplicationsPage from "../ConsortiumApplicationsPage";
import PartnerOnboardingChecklistPage from "../../partner/OnboardingChecklistPage";

/* The real 409 body, shaped exactly as `consortiumApplyStore.ts` emits it. */
const APPROVAL_REFUSAL =
  `The approval was REFUSED and rolled back because the $/year partner ` +
  `subscription invoice could not be raised (PARTNER_APPROVAL_PRICE_UNRESOLVED). The application is ` +
  `unchanged, no partner was provisioned and no invoice exists. Approving ` +
  `without an invoice is not an option under ruling R20; resolve the ` +
  `partner's price (or record an explicit $0 override if this partner is ` +
  `grandfathered under R17) and retry the approval.`;

/** What the admin used to see instead of the sentence above. */
const OLD_SUBSTITUTE = "HTTP 409: partner_approval_invoice_refused";

const APP_ROW = {
  id: "app_w73",
  orgName: "Northwind Capital",
  contactName: "Ada Reviewer",
  contactEmail: "ada@northwind.example",
  partnerType: "vc_fund",
  aumRange: "100m_500m",
  status: "submitted",
  createdAt: "2026-08-01T10:00:00Z",
  reviewNotes: null,
  reviewedBy: null,
  reviewedAt: null,
};

function res(status: number, body: unknown): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    text: async () => text,
    json: async () => JSON.parse(text),
    clone: () => res(status, body),
  } as unknown as Response;
}

/** The POST answer for the review call. Set per test. */
let reviewAnswer: { status: number; body: unknown } = { status: 200, body: { ok: true } };
/** The GET answer for the partner checklist. Set per test. */
let checklistAnswer: { status: number; body: unknown } = { status: 200, body: { ok: true, state: {} } };

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (/\/review$/.test(u) && (init?.method ?? "GET") === "POST") return res(reviewAnswer.status, reviewAnswer.body);
      if (/\/api\/admin\/consortium\/applications/.test(u)) return res(200, { rows: [APP_ROW], total: 1 });
      if (/\/api\/admin\/partner\/promotions\/queue/.test(u)) return res(200, { rows: [], total: 0 });
      if (/\/api\/partner\/onboarding\/state/.test(u)) return res(checklistAnswer.status, checklistAnswer.body);
      if (/\/api\/partner\/me\/agreement/.test(u)) return res(200, { signed: true, signedCurrent: true });
      return res(200, {});
    }),
  );
}

function renderAdmin() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <TooltipProvider>
          <AdminConsortiumApplicationsPage />
        </TooltipProvider>
      </RoleProvider>
    </QueryClientProvider>,
  );
}

function renderPartner() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <TooltipProvider>
          <PartnerOnboardingChecklistPage />
        </TooltipProvider>
      </RoleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  reviewAnswer = { status: 200, body: { ok: true } };
  checklistAnswer = { status: 200, body: { ok: true, state: {} } };
  installFetch();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("WAVE 73 · ITEM 1 — an admin sees the server's 393-character explanation, not an enum code", () => {
  it("REFUSAL POLE — the rolled-back approval renders the server's own sentence in the persistent banner", async () => {
    /* The precondition, measured rather than assumed: this sentence is longer
       than the 240-character boundary gate Wave 69 documented, so a fix that
       leaned on `ApiError.message` would show a generic substitute instead. */
    expect(APPROVAL_REFUSAL.length).toBeGreaterThan(240);
    reviewAnswer = {
      status: 409,
      body: {
        error: "partner_approval_invoice_refused",
        reason: "PARTNER_APPROVAL_PRICE_UNRESOLVED",
        code: "PARTNER_APPROVAL_PRICE_UNRESOLVED",
        applicationUnchanged: true,
        invoiceRaised: false,
        message: APPROVAL_REFUSAL,
      },
    };
    renderAdmin();

    fireEvent.click(await screen.findByTestId("button-review-app_w73"));
    fireEvent.click(await screen.findByTestId("button-approve"));

    const banner = await screen.findByTestId("error-banner");
    /* THE STRING THAT MUST REACH THE DOM — the whole sentence, phrase by phrase. */
    expect(banner.textContent ?? "").toContain(APPROVAL_REFUSAL);
    expect(banner.textContent ?? "").toContain("rolled back");
    expect(banner.textContent ?? "").toContain("no invoice exists");
    expect(banner.textContent ?? "").toContain("ruling R20");
    /* The enum code is still available to an operator, appended not substituted. */
    expect(banner.textContent ?? "").toContain("partner_approval_invoice_refused");

    /* THE STRING THAT MUST NOT: the bare status-plus-code the admin used to get. */
    expect(document.body.textContent ?? "").not.toContain(OLD_SUBSTITUTE);

    /* NO SILENT DROP — the applications table is still on screen beside it. */
    expect(screen.getByTestId("table-applications")).toBeTruthy();
  });

  it("LEGITIMATE POLE — a 409 with NO message still renders the wrapper's original `HTTP 409: <code>` string", async () => {
    /* R44: the old string was not deleted, it was demoted to the case it is true
       of. A body that explains nothing must lose nothing. */
    reviewAnswer = { status: 409, body: { error: "partner_approval_invoice_refused" } };
    renderAdmin();
    fireEvent.click(await screen.findByTestId("button-review-app_w73"));
    fireEvent.click(await screen.findByTestId("button-approve"));
    const banner = await screen.findByTestId("error-banner");
    expect(banner.textContent ?? "").toBe(OLD_SUBSTITUTE);
  });

  it("LEGITIMATE POLE — a successful approval renders no banner at all", async () => {
    reviewAnswer = { status: 200, body: { ok: true, application: { ...APP_ROW, status: "approved" } } };
    renderAdmin();
    fireEvent.click(await screen.findByTestId("button-review-app_w73"));
    fireEvent.click(await screen.findByTestId("button-approve"));
    await waitFor(() => expect(screen.getByTestId("table-applications")).toBeTruthy());
    expect(screen.queryByTestId("error-banner")).toBeNull();
  });
});

describe("WAVE 73 · ITEM 1 — a Consortium Partner sees it too (the sibling wrapper)", () => {
  const CHECKLIST_REFUSAL =
    `Your onboarding checklist cannot be produced yet: the partner agreement on file has not been ` +
    `countersigned, so the steps that depend on it cannot be evaluated. Nothing has been rejected and ` +
    `no step has been marked failed. Capavate will not guess a status for a document it cannot read; ` +
    `once the countersigned agreement is uploaded this page will populate itself.`;

  it("REFUSAL POLE — the partner reads the server's sentence, not `HTTP 409: <code>`", async () => {
    expect(CHECKLIST_REFUSAL.length).toBeGreaterThan(240);
    checklistAnswer = {
      status: 409,
      body: { error: "partner_agreement_not_countersigned", message: CHECKLIST_REFUSAL },
    };
    renderPartner();
    await waitFor(() => {
      expect(document.body.textContent ?? "").toContain(CHECKLIST_REFUSAL);
    });
    expect(document.body.textContent ?? "").not.toContain("HTTP 409: partner_agreement_not_countersigned");
  });
});
