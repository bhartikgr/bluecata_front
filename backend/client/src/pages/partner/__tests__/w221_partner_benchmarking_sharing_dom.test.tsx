/**
 * WAVE 221 — RENDERED-DOM PROOF ON THE REAL PARTNER SETTINGS PAGE (§221.6).
 *
 * The investor half of the wave is proved in
 * `client/src/pages/investor/__tests__/w221_benchmarking_sharing_dom.test.tsx`. This
 * file is the partner half, and it exists because §221.6 requires the switch to
 * render on "the **real** partner settings page" — the shipped
 * `client/src/pages/partner/PartnerSettings.tsx`, not a fragment of its JSX copied
 * into a test.
 *
 * DEFAULT OFF is asserted on the rendered `<input type="checkbox">`'s `checked`
 * property, read off the DOM node.
 *
 * WHAT THIS FILE DOES NOT CLAIM. The partner switch persists and audits, and the
 * round-trip is proved, but there is currently NO partner cohort benchmark to filter:
 * `portfolio_metric_snapshot.subject_kind` carries a CHECK constraint admitting only
 * `('investor','spv','fund','platform')`, so no partner row can exist in the sample
 * `computeCohortBenchmark` reads. The partner opt-out is therefore recorded and
 * honoured by construction — there is nothing yet computed from partner-firm data for
 * it to remove. That is stated here and in the owner report rather than dressed up as
 * a computation proof it is not.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";

import { rawDb } from "../../../../../server/db/connection";
import {
  wave221EnsureColumn,
  wave221IsOptedOut,
  WAVE221_OPT_OUT_COLUMN,
} from "../../../../../server/lib/wave221BenchmarkingOptOut";
import {
  wave221SwitchLabel,
  wave221ConsequenceLine,
  wave221PlainStatement,
  wave221NoRetrospectionLine,
  WAVE221_FORBIDDEN_CLAIM_SUBSTRINGS,
} from "@shared/wave221BenchmarkingOptOutCopy";

const PARTNER_ID = "p_w221dom";
const PARTNER_USER = "u_w221dom_partner";

let app: Express;

vi.mock("../../../../../server/lib/requirePartnerAuth", () => ({
  requirePartnerAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { partnerContext?: unknown }).partnerContext = {
      partnerId: PARTNER_ID, userId: PARTNER_USER, subRole: "managing_partner",
    } as unknown as Request["partnerContext"];
    next();
  },
  requirePartnerSubrole: () => (_r: Request, _s: Response, n: NextFunction) => n(),
  assertSubRole: () => (_r: Request, _s: Response, n: NextFunction) => n(),
}));

vi.mock("@/components/partner/PartnerShell", () => ({
  PartnerShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
/* `PartnerSettings` returns null unless `role.ready && role.identity`, and then reads
   `identity.subRole`, `identity.tier` and `identity.identity.name`. The shape below is
   the one the page actually consumes — established by reading the component, not
   guessed, because a wrong shape here makes the page render nothing and every
   assertion below would then fail for the wrong reason. */
vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    isManagingPartner: () => true,
    identity: {
      subRole: "managing_partner",
      tier: "nexus",
      identity: { name: "Wave221 Partner Firm", partnerId: PARTNER_ID },
    },
  }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

async function call(method: string, url: string, body?: unknown) {
  let r = (request(app) as any)[method.toLowerCase()](url);
  if (body !== undefined) r = r.send(body as any);
  return await r;
}

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async (method: string, url: string, body?: unknown) => {
      const res = await call(method, url, body);
      return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        statusText: String(res.status),
        text: async () => JSON.stringify(res.body),
        json: async () => res.body,
      } as unknown as Response;
    },
  };
});

import PartnerSettings from "../PartnerSettings";
import { registerWave221BenchmarkingOptOutRoutes } from "../../../../../server/wave221BenchmarkingOptOutRoutes";

function mount() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => (await call("GET", String(queryKey[0]))).body,
      },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <PartnerSettings />
    </QueryClientProvider>,
  );
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as Request & { userContext?: unknown }).userContext = {
      userId: PARTNER_USER, tenantId: "t_w221dom", isAdmin: false,
    } as unknown as Request["userContext"];
    next();
  });
  registerWave221BenchmarkingOptOutRoutes(app);
  /* A settings row must exist, or the write is correctly refused with
     SUBJECT_ROW_NOT_FOUND rather than silently "succeeding". */
  rawDb()
    .prepare(
      `INSERT OR IGNORE INTO partner_workspace_settings (partner_id, settings_json, updated_at)
       VALUES (?, '{}', ?)`,
    )
    .run(PARTNER_ID, "2026-05-01T00:00:00.000Z");
  const ensured = wave221EnsureColumn("partner");
  expect(ensured.ok, "the partner column must actually be installed").toBe(true);
  /* Fresh firm: sharing OFF, the documented default. */
  rawDb()
    .prepare(`UPDATE partner_workspace_settings SET ${WAVE221_OPT_OUT_COLUMN} = ? WHERE partner_id = ?`)
    .run("2026-05-02T00:00:00.000Z", PARTNER_ID);
}, 180_000);

afterEach(() => cleanup());

describe("W221 · DOM — the real partner settings page", () => {
  it("J1 the sharing block renders on the REAL PartnerSettings page", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("w221-benchmarking-sharing")).toBeTruthy());
    /* Proof it is the real page and not the block alone: a control this wave did not
       add is rendered alongside it. */
    expect(screen.getByTestId("partner-settings-profile")).toBeTruthy();
  });

  it("J2 DEFAULT OFF, read off the rendered checkbox", async () => {
    mount();
    const cb = (await waitFor(() => screen.getByTestId("w221-sharing-switch"))) as HTMLInputElement;
    await waitFor(() => expect(cb.checked).toBe(false));
  });

  it("J3 the label, statement, consequence and non-retrospection lines all render", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("w221-statement")).toBeTruthy());
    expect(screen.getByTestId("w221-statement").textContent).toBe(wave221PlainStatement("partner"));
    expect(screen.getByTestId("w221-consequence").textContent).toBe(wave221ConsequenceLine("partner"));
    expect(screen.getByTestId("w221-no-retrospection").textContent).toBe(wave221NoRetrospectionLine());
    expect(screen.getByTestId("w221-label").textContent).toContain(wave221SwitchLabel("partner"));
  });

  it("J4 no forbidden claim is rendered, and the block is proved non-empty first", async () => {
    mount();
    const block = await waitFor(() => screen.getByTestId("w221-benchmarking-sharing"));
    const text = block.textContent ?? "";
    expect(text.length, "the partner sharing block rendered no text at all").toBeGreaterThan(200);
    const lower = text.toLowerCase();
    for (const bad of WAVE221_FORBIDDEN_CLAIM_SUBSTRINGS) {
      expect(lower, `the rendered partner copy must not claim "${bad}"`).not.toContain(bad);
    }
  });

  it("J5 toggling in the DOM persists and the RE-READ comes back ON", async () => {
    mount();
    const cb = (await waitFor(() => screen.getByTestId("w221-sharing-switch"))) as HTMLInputElement;
    await waitFor(() => expect(cb.checked).toBe(false));
    fireEvent.click(cb);
    await waitFor(
      () =>
        expect((screen.getByTestId("w221-sharing-switch") as HTMLInputElement).checked).toBe(true),
      { timeout: 5000 },
    );
    /* The re-read is the whole test — a fresh GET, not the mutation's echo. */
    const after = await call("GET", "/api/partner/me/benchmarking-sharing");
    expect(after.body.sharingEnabled).toBe(true);
    expect(wave221IsOptedOut("partner", PARTNER_ID)).toBe(false);
  });

  it("J6 the control is NOT hidden from a partner user — hiding it would be the restriction R190.10 forbids", async () => {
    mount();
    const cb = await waitFor(() => screen.getByTestId("w221-sharing-switch"));
    expect((cb as HTMLInputElement).disabled).toBe(false);
  });
});
