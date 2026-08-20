/**
 * WAVE 60 · A-3 + A-4 — TWO DEFECTS ON `client/src/pages/investor/CompanyDetail.tsx`.
 *
 * ── A-3 (:1019 pre-fix) — A FAILURE ASSERTED NON-EXISTENCE ───────────────────
 *     if (!data || data.exists === false) {
 *       … No cap-table message channel exists for this company yet.
 * `!data` is TRUE on ERROR and on PAUSED, so a failed read printed a sentence
 * that asserts a thing DOES NOT EXIST. The file already got the next state right
 * (`isMember === false` has its own "Cap-table members only" card at :1026), so
 * the author distinguished two of three states and missed the third.
 * FIX: an ADDED refusal branch; the sentence and its <div> are byte-identical and
 * only the condition narrowed.
 *
 * ── A-4 (:506 pre-fix) — CAUSE MISATTRIBUTION ────────────────────────────────
 *     {coMembers.isError && <div …>Co-member list unavailable in preview</div>}
 * That line already fired only on isError — so this is NOT an empty-vs-failed
 * defect. It is a FALSE CAUSE. `preview` is a real named mode in this same file
 * (:127 `mode?: "preview"`, :130 `const isPreview = mode === "preview"`), and
 * :506 was NOT gated on it. On the ordinary investor route (App.tsx:783) the page
 * is not in preview, so a failed co-member read told the investor the list was
 * unavailable because of a mode the page is not in — FALSE in the majority mount.
 * R44 row 1 would permit a REPLACE. It was NOT taken: the literal is preserved
 * byte-identical behind `&& isPreview`, and a real refusal was added for the
 * non-preview mount. No allowlist entry.
 *
 * ── BOTH POLES ───────────────────────────────────────────────────────────────
 *   A-3 LOWER   error / paused  → refusal, sentence ABSENT
 *   A-3 UPPER A {exists:false}  → sentence present BYTE-IDENTICAL, no refusal
 *   A-3 UPPER B {isMember:false}→ "Cap-table members only" card unchanged, no refusal
 *   A-4 LOWER   error, no mode  → refusal, "…unavailable in preview" ABSENT
 *   A-4 UPPER   error, preview  → "…unavailable in preview" present BYTE-IDENTICAL
 *   A-4 UPPER   success with [] → "No co-investors found for this company." present
 *
 * MUTATION TRANSCRIPT: build_log/wave60/W60_TESTS.md.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { ApiError } from "@/lib/queryClient";
import { RoleProvider } from "@/lib/role";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
/* The page body sits behind `RequireEntitlement check={{kind:"investor.onCapTableOf"}}`
   (:210). That gate is ORTHOGONAL to this wave and is exercised by its own tests;
   without bypassing it every assertion below would be made against the
   "Cap-table membership required" fallback and would prove nothing about the
   panels under test. Nothing else about the page is stubbed. */
vi.mock("@/lib/entitlement", async () => {
  const actual = await vi.importActual<typeof import("@/lib/entitlement")>("@/lib/entitlement");
  return {
    ...actual,
    RequireEntitlement: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    useEntitlement: () => ({ data: undefined, isLoading: false, isError: false }),
  };
});
vi.mock("@/components/AppShell", async () => {
  const actual = await vi.importActual<typeof import("@/components/AppShell")>("@/components/AppShell");
  return {
    ...actual,
    PageBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    PageHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  };
});

import InvestorCompanyDetail from "../CompanyDetail";

const COMPANY = { id: "co_w60", name: "Hydra Labs", sector: "fintech", stage: "seed" };

const PREVIEW_COPY = "Co-member list unavailable in preview";
const NO_CO_INVESTORS = "No co-investors found for this company.";
const NO_CHANNEL = "No cap-table message channel exists for this company yet.";

type Wiring = {
  coMembers?: () => Promise<unknown>;
  capTableChannel?: () => Promise<unknown>;
};

/** One default queryFn drives every query on the page; only the two under test
 *  are variable. Everything else answers empty so the page mounts. */
function renderPage(w: Wiring, opts: { preview?: boolean; tab?: string } = {}) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: (async ({ queryKey }: { queryKey: readonly unknown[] }) => {
          const key = queryKey.map(String).join("/");
          if (key.includes("co-members")) return w.coMembers ? await w.coMembers() : [];
          if (key.includes("/api/comms/cap-table")) {
            return w.capTableChannel ? await w.capTableChannel() : { exists: false };
          }
          if (key.includes("/api/companies/co_w60") && !key.includes("founder")) return COMPANY;
          return [];
        }) as never,
      },
      mutations: { retry: false },
    },
  });
  window.history.pushState({}, "", `/investor/companies/co_w60?tab=${opts.tab ?? "overview"}`);
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <TooltipProvider>
          <InvestorCompanyDetail companyIdOverride="co_w60" mode={opts.preview ? "preview" : undefined} />
        </TooltipProvider>
      </RoleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  onlineManager.setOnline(true);
});
afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
});

describe("W60 · A-4 — a failed co-member read must not blame a mode the page is not in", () => {
  it("LOWER POLE (normal mount) — the refusal renders and the preview sentence does NOT", async () => {
    renderPage({
      coMembers: async () => {
        throw new ApiError(500, "boom", null, { ok: false });
      },
    });
    const err = await screen.findByTestId("w60-coinvestors-error");
    expect(err.getAttribute("role")).toBe("alert");
    expect(err.textContent).toContain("couldn’t load the co-investor list");
    /* THE defect: pre-fix this found the text on the ORDINARY investor route. */
    expect(screen.queryByText(PREVIEW_COPY)).toBeNull();
  });

  it("UPPER POLE (preview mount) — the existing sentence renders BYTE-IDENTICAL and the refusal does not", async () => {
    renderPage(
      {
        coMembers: async () => {
          throw new ApiError(500, "boom", null, { ok: false });
        },
      },
      { preview: true },
    );
    const node = await screen.findByText(PREVIEW_COPY);
    /* Byte-exact: no full stop, and the original className. */
    expect(node.textContent).toBe(PREVIEW_COPY);
    expect(node.className).toBe("text-sm text-muted-foreground");
    expect(screen.queryByTestId("w60-coinvestors-error")).toBeNull();
  });

  it("UPPER POLE (genuine empty) — the honest empty sentence survives unchanged, with neither error node", async () => {
    renderPage({ coMembers: async () => [] });
    const node = await screen.findByText(NO_CO_INVESTORS);
    expect(node.className).toBe("text-sm text-muted-foreground");
    expect(screen.queryByText(PREVIEW_COPY)).toBeNull();
    expect(screen.queryByTestId("w60-coinvestors-error")).toBeNull();
  });

  it("UPPER POLE (rows) — a co-member row and its DM button still render", async () => {
    renderPage({
      coMembers: async () => [
        { id: "m1", memberId: "m1", userId: "u1", legalName: "Hydra VC", screenName: null, allowDM: true },
      ],
    });
    expect(await screen.findByTestId("row-comember-m1")).toBeTruthy();
    expect(screen.getByTestId("button-dm-m1")).toBeTruthy();
    expect(screen.queryByText(NO_CO_INVESTORS)).toBeNull();
  });

  it("PAUSED POLE — an OFFLINE investor is not told this company has no co-investors", async () => {
    onlineManager.setOnline(false);
    renderPage({ coMembers: async () => [] });
    await screen.findByTestId("w60-coinvestors-error");
    expect(screen.queryByText(NO_CO_INVESTORS)).toBeNull();
  });
});

describe("W60 · A-3 — a failed channel read must not assert the channel does not exist", () => {
  it("LOWER POLE — the refusal renders and the does-not-exist sentence does NOT", async () => {
    renderPage(
      {
        capTableChannel: async () => {
          throw new ApiError(500, "boom", null, { ok: false });
        },
      },
      { tab: "messages" },
    );
    const err = await screen.findByTestId("w60-captable-channel-error");
    expect(err.getAttribute("role")).toBe("alert");
    expect(err.textContent).toContain("couldn’t load the cap-table message channel");
    /* THE defect: pre-fix this found the text. */
    expect(screen.queryByText(NO_CHANNEL)).toBeNull();
  });

  it("PAUSED POLE — an OFFLINE investor is not told the channel does not exist", async () => {
    onlineManager.setOnline(false);
    renderPage({ capTableChannel: async () => ({ exists: false }) }, { tab: "messages" });
    await screen.findByTestId("w60-captable-channel-error");
    expect(screen.queryByText(NO_CHANNEL)).toBeNull();
  });

  it("UPPER POLE A — a SUCCESSFUL {exists:false} still renders the sentence, byte-identical", async () => {
    renderPage({ capTableChannel: async () => ({ exists: false }) }, { tab: "messages" });
    const node = await screen.findByText(NO_CHANNEL);
    expect(node.className).toBe("text-sm text-muted-foreground py-12 text-center");
    expect(screen.queryByTestId("w60-captable-channel-error")).toBeNull();
  });

  it("UPPER POLE B — {exists:true,isMember:false} still renders the members-only card, and NOT a load failure", async () => {
    /* This pole matters most: the narrowing must not turn a legitimate scope
       refusal into "we could not load it". */
    renderPage(
      { capTableChannel: async () => ({ exists: true, isMember: false }) },
      { tab: "messages" },
    );
    expect(await screen.findByText("Cap-table members only")).toBeTruthy();
    expect(screen.queryByTestId("w60-captable-channel-error")).toBeNull();
    expect(screen.queryByText(NO_CHANNEL)).toBeNull();
  });

  it("UPPER POLE C — a member with a real channel sees the thread, not a refusal", async () => {
    renderPage(
      {
        capTableChannel: async () => ({
          exists: true,
          isMember: true,
          channel: { id: "ch_1", name: "Cap table", metadata: { title: "Cap table" }, participantUserIds: [] },
          lastMessages: [],
          visibleMemberCount: 2,
          totalMemberCount: 2,
        }),
      },
      { tab: "messages" },
    );
    await waitFor(() =>
      expect(screen.queryByTestId("w60-captable-channel-error")).toBeNull(),
    );
    expect(screen.queryByText(NO_CHANNEL)).toBeNull();
    expect(screen.queryByText("Cap-table members only")).toBeNull();
  });
});
