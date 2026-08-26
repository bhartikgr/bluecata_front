/* ════════════════════════════════════════════════════════════════════════════
   WAVE 142 (BATCH 1 · ITEM 2) — THE ADMIN SIDE: THE FALSE PROMISE IS GONE AND
   THE RESOLVER'S `source` IS ON SCREEN.                    R108.2 · R108.3 · R104
   ════════════════════════════════════════════════════════════════════════════
   Two obligations, both from R108, both asserted here against the REAL rendered
   DOM of the real `AdminFeesConsolidated` Application Fee tab:

   1. R108.3 — the false promise at AdminFeesConsolidated.tsx:1580-1592 must be
      REMOVED. It read "…so the amount an admin types here is the amount a founder
      is shown and charged." That is false whenever the non-fatal mirror-write in
      server/adminPlatformFeesRoutes.ts:113-140 throws into a log line, which is
      the mechanism of the live defect. R108.3 DEFERRED retiring one of the two fee
      tables to batch 2, so the mirror still exists and the copy must describe it
      honestly rather than certify an invariant the code does not enforce.
      The `data-testid="application-fee-mirror-warning"` div is PRESERVED — the
      panel is rewritten, never dropped, so it cannot silently leave a suite.

   2. R108.2 item 3 — "the `source` the resolver already computes must be
      surfaced". Before this wave `source` was computed on every read of the
      founder-facing fee and shown to NOBODY, so "published", "not on record" and
      "database unreadable" were indistinguishable from this console. All three
      states are asserted, plus the store-divergence line that is the live defect.

   FAIL-BEFORE EVIDENCE: with the pre-142 sources restored (reconstructed by
   w142_scratch/make_before.py, independently confirmed byte-exact against WAVE
   139's pinned digest), the `application-fee-resolver-state` panel does not exist
   at all and the mirror-warning div still contains the false sentence. See
   build_log/wave142/W142_TESTS.md.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleProvider } from "@/lib/role";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

import AdminFeesConsolidated from "../AdminFeesConsolidated";

/** $300.00 in TRUE minor units — the canonical Collective application fee (R101). */
const CANONICAL_MINOR = 30_000;

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "200",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

type Resolved = {
  amountMinor: number | null;
  currency: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  source: "db" | "missing" | "unreadable";
};

/** Mounts the Application Fee tab directly via the page's own `initialTab`
 *  (WAVE 4A), so no tab interaction is simulated and no other tab's queries are
 *  asserted against. `editorMinor` is the `platform_fees` row this editor owns;
 *  `resolved` is what the FOUNDER-FACING resolver answers. They are supplied
 *  separately on purpose — their divergence is the live defect. */
function mountApplicationFeeTab(opts: {
  editorMinor: number | null;
  resolved: Resolved | "read-fails";
}) {
  apiRequestMock.mockImplementation(async (_method: string, url: string) => {
    if (/\/api\/admin\/platform-fees$/.test(url)) {
      return jsonResponse({
        ok: true,
        fees:
          opts.editorMinor === null
            ? []
            : [
                {
                  key: "collective_application_fee",
                  amountMinor: opts.editorMinor,
                  currency: "USD",
                  updatedAt: "2026-08-20T10:00:00.000Z",
                  updatedByUserId: "admin@capavate.com",
                  billingPeriod: null,
                },
              ],
      });
    }
    if (/\/api\/admin\/collective\/application-fee$/.test(url)) {
      if (opts.resolved === "read-fails") {
        return { ok: false, status: 500, text: async () => "boom", json: async () => ({}) } as unknown as Response;
      }
      return jsonResponse({ ok: true, ...opts.resolved });
    }
    return jsonResponse({ ok: true });
  });
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, queryFn: (async () => ({})) as never },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <TooltipProvider>
          <AdminFeesConsolidated initialTab="application-fee" />
        </TooltipProvider>
      </RoleProvider>
    </QueryClientProvider>,
  );
}

const PUBLISHED: Resolved = {
  amountMinor: CANONICAL_MINOR,
  currency: "USD",
  updatedAt: "2026-08-25T00:00:00.000Z",
  updatedBy: "admin@capavate.com",
  source: "db",
};
const ABSENT: Resolved = {
  amountMinor: null, currency: null, updatedAt: null, updatedBy: null, source: "missing",
};
const UNREADABLE: Resolved = {
  amountMinor: null, currency: null, updatedAt: null, updatedBy: null, source: "unreadable",
};

beforeEach(() => {
  cleanup();
  apiRequestMock.mockReset();
});
afterEach(() => cleanup());

/* ═════════════════════════════════════ M — R108.3: THE FALSE PROMISE IS GONE */

describe("WAVE 142 · M — the false promise text (R108.3)", () => {
  it("M1 the panel still MOUNTS under its preserved testid — rewritten, not dropped", async () => {
    mountApplicationFeeTab({ editorMinor: CANONICAL_MINOR, resolved: PUBLISHED });
    const warn = await screen.findByTestId("application-fee-mirror-warning");
    expect(warn).toBeTruthy();
    /* Not an empty shell: the note is real prose the admin can read. */
    expect((warn.textContent ?? "").length).toBeGreaterThan(120);
  });

  it("M2 THE REPRODUCTION — the false sentence is absent from the whole document", async () => {
    mountApplicationFeeTab({ editorMinor: CANONICAL_MINOR, resolved: PUBLISHED });
    await screen.findByTestId("application-fee-mirror-warning");
    const doc = document.body.textContent ?? "";
    /* The exact promise R108.3 struck, and the two fragments it is built from, so
       a partial re-wording cannot slip back in. */
    expect(doc).not.toContain(
      "the amount an admin types here is the amount a founder is shown and charged",
    );
    expect(doc).not.toContain("is the amount a founder is shown and charged");
    expect(doc).not.toContain("amount a founder is shown and charged");
  });

  it("M3 the replacement copy states the MECHANISM honestly, including the non-fatal mirror", async () => {
    /* Anti-vacuity: deleting the sentence and saying nothing would also pass M2.
       The admin must be told why this page's success is not proof. */
    mountApplicationFeeTab({ editorMinor: CANONICAL_MINOR, resolved: PUBLISHED });
    const warn = await screen.findByTestId("application-fee-mirror-warning");
    const t = warn.textContent ?? "";
    expect(t).toContain("platform_fees.collective_application_fee");
    expect(t).toContain("collective_application_fee_config");
    expect(t).toContain("non-fatal");
    expect(t.toLowerCase()).toContain("minor units");
  });
});

/* ═══════════════════════════════ N — R108.2 item 3: `source` IS ON SCREEN */

describe("WAVE 142 · N — the resolver's `source` is surfaced to the admin (R108.2)", () => {
  it("N1 source 'db' is reported as PUBLISHED, with the figure and its provenance", async () => {
    mountApplicationFeeTab({ editorMinor: CANONICAL_MINOR, resolved: PUBLISHED });
    const panel = await screen.findByTestId("application-fee-resolver-state");
    expect(panel).toBeTruthy();
    const src = await screen.findByTestId("application-fee-resolver-source");
    await waitFor(() => expect(src.textContent).toContain("source: db"));
    expect(src.textContent).toContain("Published");
    /* $300.00, not $30,000 — 30000 is TRUE minor units (WAVE 137). */
    expect(src.textContent).toContain("$300.00");
    expect(src.textContent).not.toContain("$30,000");
    const prov = await screen.findByTestId("application-fee-resolver-provenance");
    expect(prov.textContent).toContain("admin@capavate.com");
    expect(prov.textContent).toContain("2026-08-25T00:00:00.000Z");
  });

  it("N2 source 'missing' says NOT ON RECORD and states no figure at all", async () => {
    mountApplicationFeeTab({ editorMinor: CANONICAL_MINOR, resolved: ABSENT });
    const src = await screen.findByTestId("application-fee-resolver-source");
    await waitFor(() => expect(src.textContent).toContain("source: missing"));
    expect(src.textContent).toContain("NOT ON RECORD");
    /* R95/R108.2: an absent price is never restated as its canonical figure. */
    expect(src.textContent).not.toContain("$300.00");
    expect(src.textContent).not.toContain("30000");
    /* And the admin is told the founder consequence, not left to guess. */
    expect(src.textContent).toContain("not published");
    const prov = await screen.findByTestId("application-fee-resolver-provenance");
    expect(prov.textContent).toContain("no row");
  });

  it("N3 source 'unreadable' is distinguished from 'missing' — a fault, not an unset price", async () => {
    /* These need different operator responses, so collapsing them into one
       message would be its own defect. */
    mountApplicationFeeTab({ editorMinor: CANONICAL_MINOR, resolved: UNREADABLE });
    const src = await screen.findByTestId("application-fee-resolver-source");
    await waitFor(() => expect(src.textContent).toContain("source: unreadable"));
    expect(src.textContent).toContain("UNREADABLE");
    expect(src.textContent).not.toContain("NOT ON RECORD");
    expect(src.textContent).not.toContain("$300.00");
  });

  it("N4 THE LIVE DEFECT — a divergence between the two stores is stated outright", async () => {
    /* The live symptom of R104: platform_fees held 30000 while the founder
       resolved the Consortium Partner's 24000 ($240/yr) from the config table.
       The console must NAME the disagreement, not average it or pick one. */
    mountApplicationFeeTab({
      editorMinor: CANONICAL_MINOR,
      resolved: { ...PUBLISHED, amountMinor: 24_000 },
    });
    const agree = await screen.findByTestId("application-fee-store-agreement");
    await waitFor(() => expect(agree.textContent).toContain("THE TWO STORES DISAGREE"));
    expect(agree.textContent).toContain("$300.00");
    expect(agree.textContent).toContain("$240.00");
    /* The founder-facing figure is the one that governs, and it says so. */
    expect(agree.textContent).toContain("founder");
  });

  it("N5 agreement is asserted only when it is TRUE, and refused when unprovable", async () => {
    /* Pole for N4: equal figures must NOT read as a disagreement… */
    mountApplicationFeeTab({ editorMinor: CANONICAL_MINOR, resolved: PUBLISHED });
    const agree = await screen.findByTestId("application-fee-store-agreement");
    await waitFor(() => expect(agree.textContent).toContain("Both stores hold the same figure"));
    expect(agree.textContent).not.toContain("DISAGREE");

    /* …and with the founder figure absent, agreement is neither claimed nor denied. */
    cleanup();
    apiRequestMock.mockReset();
    mountApplicationFeeTab({ editorMinor: CANONICAL_MINOR, resolved: ABSENT });
    const agree2 = await screen.findByTestId("application-fee-store-agreement");
    await waitFor(() =>
      expect(agree2.textContent).toContain("cannot be stated until both figures are on record"),
    );
    expect(agree2.textContent).not.toContain("Both stores hold the same figure");
  });

  it("N6 a FAILED read of the resolver refuses instead of implying 'published'", async () => {
    /* Anti-fabrication: a 500 from the console's own read must not render as a
       state of the founder-facing fee. */
    mountApplicationFeeTab({ editorMinor: CANONICAL_MINOR, resolved: "read-fails" });
    const src = await screen.findByTestId("application-fee-resolver-source");
    await waitFor(() => expect(src.textContent).toContain("could not be read"));
    expect(src.textContent).not.toContain("Published");
    expect(src.textContent).not.toContain("$300.00");
  });
});
