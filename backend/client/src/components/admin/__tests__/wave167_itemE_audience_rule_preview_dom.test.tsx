/**
 * WAVE 167 · TASK 3.2 — RENDERED-DOM proof for the owner's audience preview.
 *
 * R139.3 requires the owner to be able to SEE who a rule reaches and verify it on
 * the live server. R137.1 means a green route test is not that proof. So this test
 * drives the mounted `AudienceRulePreview` against the REAL express route with the
 * REAL audience resolvers over a REAL SQLite schema — the transport is in-process,
 * nothing about the verdict is faked.
 *
 * What it holds the surface to:
 *   · a REAL non-empty audience is listed;
 *   · a REAL empty audience says so IN WORDS (zero is a result, not a blank);
 *   · a FAILED check is stated and never rendered as an empty audience — the same
 *     defect class task 3.1 removed from the dashboard Messages panel;
 *   · no machine tokens on screen (R77);
 *   · "Not on record" for unreadable values (R111 Q13);
 *   · no legal names anywhere, even though the fixture rows have them.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import express, { type Express } from "express";
import request from "supertest";
import { getDb, rawDb } from "../../../../../server/db/connection";
import { registerCommsRoutes } from "../../../../../server/commsStore";
import { applyCommsDelegatedContextSchema } from "../../../../../server/lib/applyCommsDelegatedContextSchema";
import { installV14TestIdentity } from "../../../../../server/__tests__/_v14TestIdentity";
import { AudienceRulePreview } from "../AudienceRulePreview";

const ORG = "porg_w167pv";
const GP = "u_w167pv_gp";
const MATE = "u_w167pv_mate";
const SPV = "spv_w167pv";
const LP = "u_w167pv_lp";
const LP_LEGAL_NAME = "Wave167Preview LimitedPartner Legalname";
/** An investor with no partner relationship at all — the genuine-zero case. */
const LONER = "u_w167pv_loner";
/** The admin caller. MUST be a resolvable admin PERSONA: `requireAdmin` reads the
 *  session through `getUserContext`, which resolves a persona id and does NOT read
 *  the test shim's `req.userContext`. A freshly-invented id therefore 401s, which
 *  cost this file a debugging round — recorded so the next reader does not repeat
 *  it. The route's guard has its own tests; this file is about the client surface. */
const ADMIN = "u_admin";

let app: Express;
/** Simulated failure switch for the transport, so the failure branch is exercised
 *  without asking the real route to misbehave. */
let forceTransportFailure = false;

const now = () => new Date().toISOString();
const run = (sql: string, ...args: unknown[]): void => {
  try {
    rawDb().prepare(sql).run(...(args as any[]));
  } catch (err) {
    throw new Error(`[w167 preview fixture] SQL failed: ${(err as Error).message}\nSQL: ${sql}`);
  }
};

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

/* The admin identity headers are set here: the route is behind `requireAdmin`,
   and a preview that a non-admin could run would itself be the leak. */
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async (method: string, url: string) => {
      if (forceTransportFailure) throw new Error("network unreachable");
      const res = await (request(app) as any)
        [method.toLowerCase()](url)
        .set("x-user-id", ADMIN)
        .set("x-actor-user-id", ADMIN)
        .set("x-role", "admin");
      if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
      return {
        ok: true,
        status: res.status,
        statusText: String(res.status),
        text: async () => JSON.stringify(res.body),
        json: async () => res.body,
      } as unknown as Response;
    },
  };
});

function mount(ruleKey = "partner_own_lp_peers") {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AudienceRulePreview ruleKey={ruleKey} />
    </QueryClientProvider>,
  );
}

async function checkFor(who: string, ruleKey = "partner_own_lp_peers") {
  mount(ruleKey);
  fireEvent.change(screen.getByTestId(`audience-preview-input-${ruleKey}`), {
    target: { value: who },
  });
  fireEvent.click(screen.getByTestId(`audience-preview-run-${ruleKey}`));
}

beforeAll(() => {
  getDb();
  applyCommsDelegatedContextSchema(rawDb() as any);
  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: false });
  registerCommsRoutes(app);

  for (const [id, name, role] of [
    [GP, "Preview Managing Partner", "partner"],
    [MATE, "Preview Colleague", "partner"],
    [LP, LP_LEGAL_NAME, "investor"],
    [LONER, "Preview Unrelated Investor", "investor"],
  ] as Array<[string, string, string]>) {
    run(
      `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, is_demo, deleted_at)
       VALUES (?, 'tenant_platform', ?, ?, ?, 0, NULL)`,
      id,
      `${id}@w167pv.test`,
      name,
      role,
    );
  }
  for (const u of [GP, MATE]) {
    run(
      `INSERT OR REPLACE INTO partner_team_members
         (id, partner_id, user_id, sub_role, status, joined_at, removed_at, created_by, is_seed, updated_at)
       VALUES (?, ?, ?, 'managing', 'active', ?, NULL, 'u_w167pv', 0, ?)`,
      `ptm_${ORG}_${u}`,
      ORG,
      u,
      now(),
      now(),
    );
  }
  run(
    `INSERT OR REPLACE INTO spv
       (id, sponsor_partner_id, gp_user_id, name, spv_type, jurisdiction, status,
        distribution_scope, currency, carry_basis, lp_visibility,
        created_at, created_by, updated_at, updated_by, curr_hash)
     VALUES (?, ?, ?, 'W167 Preview SPV', 'spv', 'DE', 'open', 'private', 'USD',
             'whole_fund', 'own_only', ?, ?, ?, ?, ?)`,
    SPV,
    ORG,
    GP,
    now(),
    GP,
    now(),
    GP,
    `hash_${SPV}`,
  );
  run(
    `INSERT OR REPLACE INTO spv_subscription
       (id, spv_id, investor_id, commitment_minor, wired_minor, currency, status,
        created_at, updated_at, updated_by, curr_hash)
     VALUES (?, ?, ?, 5000000, 0, 'USD', 'committed', ?, ?, ?, ?)`,
    `sub_${SPV}_${LP}`,
    SPV,
    LP,
    now(),
    now(),
    "u_w167pv",
    `hash_${SPV}_${LP}`,
  );
});

afterEach(() => {
  cleanup();
  forceTransportFailure = false;
});

describe("WAVE 167 · TASK 3.2 — the owner can SEE who a rule reaches", () => {
  it("P-1 a REAL non-empty audience is listed, from the REAL route", async () => {
    await checkFor(GP);
    await waitFor(() => expect(screen.getByTestId(`audience-preview-person-${LP}`)).toBeTruthy());
    expect(screen.getByTestId(`audience-preview-person-${MATE}`)).toBeTruthy();
    /* And the verdict is a sentence, not a number the owner has to interpret. */
    expect(screen.getByTestId("audience-preview-statement-partner_own_lp_peers").textContent ?? "").toMatch(
      /reachable/i,
    );
  });

  it("P-2 the resolved role and applicability are PLAIN LANGUAGE, not machine tokens (R77)", async () => {
    await checkFor(GP);
    const role = await waitFor(() => screen.getByTestId("audience-preview-role-partner_own_lp_peers"));
    expect(role.textContent ?? "").toContain("Consortium Partner");

    const panel = screen.getByTestId("audience-preview-partner_own_lp_peers");
    const text = panel.textContent ?? "";
    /* None of the machine vocabulary reaches the screen. */
    expect(text).not.toContain("partner_own_lp_peers");
    expect(text).not.toContain("enabledForThisViewer");
    expect(text).not.toContain("appliesToViewerRole");
    expect(text).not.toContain("audienceUserIds");
    expect(text).not.toContain("viewerRole");
    expect(text).not.toContain("sponsor_partner_id");
  });

  it("P-3 no legal name appears anywhere, even though the fixture row has one", async () => {
    /* The check exists to protect identities; it must not hand them out. */
    await checkFor(GP);
    await waitFor(() => expect(screen.getByTestId(`audience-preview-person-${LP}`)).toBeTruthy());
    expect(screen.queryByText(LP_LEGAL_NAME)).toBeNull();
    expect((screen.getByTestId("audience-preview-partner_own_lp_peers").textContent ?? "")).not.toContain(
      "Legalname",
    );
    expect((screen.getByTestId("audience-preview-partner_own_lp_peers").textContent ?? "")).not.toContain(
      "@w167pv.test",
    );
  });

  it("P-4 a GENUINELY EMPTY audience says so in words — zero is a result", async () => {
    await checkFor(LONER);
    await waitFor(() => expect(screen.getByTestId("audience-preview-nobody-partner_own_lp_peers")).toBeTruthy());
    const text = screen.getByTestId("audience-preview-nobody-partner_own_lp_peers").textContent ?? "";
    expect(text).toContain("real result");
    /* No phantom list, and no phantom person. */
    expect(screen.queryByTestId("audience-preview-people-partner_own_lp_peers")).toBeNull();
    expect(screen.queryByTestId(`audience-preview-person-${LP}`)).toBeNull();
  });

  it("P-5 a FAILED check is STATED and is never rendered as an empty audience", async () => {
    forceTransportFailure = true;
    await checkFor(GP);
    const fail = await waitFor(() => screen.getByTestId("audience-preview-failed-partner_own_lp_peers"));
    const text = fail.textContent ?? "";
    expect(text).toContain("couldn");
    /* The load-bearing part: a failure must not be mistaken for "reaches nobody". */
    expect(screen.queryByTestId("audience-preview-nobody-partner_own_lp_peers")).toBeNull();
    expect(screen.queryByTestId("audience-preview-result-partner_own_lp_peers")).toBeNull();
    /* And it must not leak the machine's vocabulary while apologising. */
    expect(text).not.toContain("HTTP");
    expect(text).not.toContain("/api/");
  });

  it("P-6 a STALE verdict is cleared before a failed re-check — no wrong answer left on screen", async () => {
    const ruleKey = "partner_own_lp_peers";
    mount(ruleKey);
    fireEvent.change(screen.getByTestId(`audience-preview-input-${ruleKey}`), { target: { value: GP } });
    fireEvent.click(screen.getByTestId(`audience-preview-run-${ruleKey}`));
    await waitFor(() => expect(screen.getByTestId(`audience-preview-person-${LP}`)).toBeTruthy());

    forceTransportFailure = true;
    fireEvent.change(screen.getByTestId(`audience-preview-input-${ruleKey}`), { target: { value: LONER } });
    fireEvent.click(screen.getByTestId(`audience-preview-run-${ruleKey}`));

    await waitFor(() => expect(screen.getByTestId(`audience-preview-failed-${ruleKey}`)).toBeTruthy());
    /* The previous person's audience must NOT still be on screen next to a
       failure about someone else. */
    expect(screen.queryByTestId(`audience-preview-person-${LP}`)).toBeNull();
  });

  it("P-7 the check is read-only: it never issues a write and the rule state is untouched", async () => {
    const before = rawDb()
      .prepare(`SELECT enabled FROM comms_audience_rules WHERE rule_key = 'partner_own_lp_peers'`)
      .get() as { enabled: number };
    await checkFor(GP);
    await waitFor(() => expect(screen.getByTestId(`audience-preview-person-${LP}`)).toBeTruthy());
    const after = rawDb()
      .prepare(`SELECT enabled FROM comms_audience_rules WHERE rule_key = 'partner_own_lp_peers'`)
      .get() as { enabled: number };
    expect(after.enabled).toBe(before.enabled);
  });

  it("P-8 the run button refuses an empty account reference rather than guessing", async () => {
    const ruleKey = "partner_own_lp_peers";
    mount(ruleKey);
    const btn = screen.getByTestId(`audience-preview-run-${ruleKey}`) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByTestId(`audience-preview-input-${ruleKey}`), { target: { value: "   " } });
    expect((screen.getByTestId(`audience-preview-run-${ruleKey}`) as HTMLButtonElement).disabled).toBe(true);
  });

  it("P-9 works for a DIFFERENT rule too — the surface is not hard-wired to wave 167's", async () => {
    await checkFor(GP, "partner_team_peers");
    await waitFor(() =>
      expect(screen.getByTestId("audience-preview-result-partner_team_peers")).toBeTruthy(),
    );
    expect(screen.getByTestId(`audience-preview-person-${MATE}`)).toBeTruthy();
    /* The team rule reaches the colleague but NOT the LP — proving the surface
       reports the rule it was asked about rather than a fixed answer. */
    expect(screen.queryByTestId(`audience-preview-person-${LP}`)).toBeNull();
  });
});
