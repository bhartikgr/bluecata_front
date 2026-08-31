/**
 * WAVE 185 · ITEM A · TASK 4 — R137.1 RENDERED-DOM PROOF ON THE REAL INVESTOR PAGE.
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY A STORE TEST WAS NOT ENOUGH, AND THIS FILE IS THE ONLY PROOF THAT COUNTS.
 * R137.1: "an LP-facing or partner-facing claim is only verified when the MOUNTED
 * component is verified — a passing store test is not evidence that a user sees
 * anything." That ruling is load-bearing here, because wave 185's preflight found
 * FIVE independent places one investor peer is discarded between the ledger and
 * the screen, and a green `durableCapTablePeerIds` test is blind to three of them:
 *
 *   3. `candidateIds` — the picker only iterates `COMMS_USERS` ∪ the first 500
 *      durable ids. A peer who is not a candidate is never considered.
 *   4. `commsUserRef(id)` — a second silent `continue` on the same value.
 *   5. the naming gate — a peer that survives 3 and 4 but fails the co-membership
 *      predicate renders as the identical string "Private Investor", so the
 *      investor sees a row they cannot recognise and cannot use.
 *
 * So this test does NOT mock the API. It boots the REAL express app with the REAL
 * `registerCommsRoutes` against the REAL SQLite schema, seeds REAL ledger and
 * alias rows, and points the shipped client's `apiRequest` at that app over
 * supertest. The chain under test is end to end:
 *
 *   captable_commits (ext_* ids) + investor_identity_alias
 *     → durableCapTablePeerIds  (alias-aware probe AND alias-aware result)
 *       → peers ∪ candidateIds
 *         → areCoMembersOnAnyCapTableAliasAware → resolveDisplayName
 *           → GET /api/comms/users
 *             → the shipped investor Messages picker
 *               → A NAME A HUMAN CAN READ IN THE DOM
 *
 * NEGATIVE CONTROLS ARE RENDERED TOO, not just asserted in a store. The wave-167
 * DOM test established the pattern: a DOM test that only proves the happy path
 * proves nothing about confidentiality, and the picker is the exact surface a
 * human reads names from. So the same mounted component is re-rendered as an
 * investor with no position (must reach nobody), and the SPV co-LP and the
 * unrelated stranger are asserted ABSENT from the entitled investor's own list.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import express, { type Express } from "express";
import request from "supertest";
import { getDb, rawDb } from "../../../../../server/db/connection";
import { registerCommsRoutes } from "../../../../../server/commsStore";
import { applyCommsDelegatedContextSchema } from "../../../../../server/lib/applyCommsDelegatedContextSchema";
import { applyWave10EngineSchema } from "../../../../../server/lib/applyWave10EngineSchema";
import { _resetAliasSchemaGuardForTests } from "../../../../../server/lib/investorIdentityAliasStore";
import { installV14TestIdentity } from "../../../../../server/__tests__/_v14TestIdentity";
import { durableCapTablePeerIds } from "../../../../../server/lib/commsUserDirectory";
import Messages from "../Messages";

/* ── the cast ─────────────────────────────────────────────────────────────── */
/* VIEWER shaped like the live investor: cap-table rows seated under `ext_*`. */
const OZAN = "u_w185dom_ozan";
const OZAN_EXT = "ext_w185dom_ozan";

/* The one person OZAN is entitled to reach, with a name distinctive enough that
   finding it in the DOM cannot be an accident. */
const PEER = "u_w185dom_peer";
const PEER_NAME = "Wave185 Entitled CoInvestor";

/* Also entitled, and seated under an `ext_*` id — so the result-side fix is what
   makes this row exist at all. */
const PEER_TWO = "u_w185dom_peer_two";
const PEER_TWO_EXT = "ext_w185dom_peer_two";
const PEER_TWO_NAME = "Wave185 Aliased CoInvestor";

/* Must NEVER appear in OZAN's picker: a holder of a company OZAN does not hold. */
const STRANGER = "u_w185dom_stranger";
const STRANGER_NAME = "Wave185 Unrelated Stranger";

/* Must NEVER appear in OZAN's picker: a co-LP of an SPV. Seeded as OZAN's
   co-holder IN THE VEHICLE, so only `notSpvBackedSql` keeps them apart. */
const SPV_LP = "u_w185dom_spv_lp";
const SPV_LP_NAME = "Wave185 BlindVehicle CoLP";

/* An investor with no position at all — the "reaches nobody" control. */
const ORPHAN = "u_w185dom_orphan";

const CO_SHARED = "co_w185dom_shared";
const CO_OTHER = "co_w185dom_other";
const SPV_VEHICLE = "spv_w185dom_vehicle";

const NAMES: Record<string, string> = {
  [OZAN]: "Wave185 Viewer Investor",
  [PEER]: PEER_NAME,
  [PEER_TWO]: PEER_TWO_NAME,
  [STRANGER]: STRANGER_NAME,
  [SPV_LP]: SPV_LP_NAME,
  [ORPHAN]: "Wave185 Orphan Investor",
};

let app: Express;
/** Whose session the mounted component runs as. Read by the apiRequest bridge,
 *  so one component can be re-rendered as a different REAL user. */
let VIEWER = OZAN;

const now = () => new Date().toISOString();
let seq = 950000;

/** THROWS. A swallowed fixture error is a vacuous green. */
const run = (sql: string, ...args: unknown[]): void => {
  try {
    rawDb().prepare(sql).run(...(args as any[]));
  } catch (err) {
    throw new Error(`[w185 dom fixture] SQL failed: ${(err as Error).message}\nSQL: ${sql}`);
  }
};

function seedUser(id: string): void {
  run(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, is_demo, deleted_at)
     VALUES (?, 'tenant_platform', ?, ?, 'investor', 0, NULL)`,
    id,
    `${id}@w185dom.test`,
    NAMES[id] ?? id,
  );
}

function seedCommit(companyId: string, investorId: string): void {
  seq += 1;
  run(
    `INSERT OR REPLACE INTO captable_commits
       (id, tenant_id, seq, ts, invitation_id, round_id, company_id, investor_id,
        amount, currency, shares, state, prev_hash, hash, deleted_at)
     VALUES (?, 'tenant_platform', ?, ?, ?, ?, ?, ?, '1', 'USD', '1', 'committed', '', ?, NULL)`,
    `ccm_w185dom_${companyId}_${investorId}`,
    seq, now(), `inv_w185dom_${seq}`, `rnd_w185dom_${companyId}`,
    companyId, investorId, `hash_w185dom_${seq}`,
  );
}

function seedAlias(aliasId: string, canonicalId: string): void {
  run(
    `INSERT OR REPLACE INTO investor_identity_alias
       (id, tenant_id, alias_investor_id, canonical_user_id, match_email, basis, state,
        created_by, created_at, updated_at)
     VALUES (?, 'tenant_platform', ?, ?, ?, 'admin_manual', 'active', 'u_w185dom_admin', ?, ?)`,
    `alias_w185dom_${aliasId}`, aliasId, canonicalId,
    `${canonicalId}@w185dom.test`, now(), now(),
  );
}

/* ── the mocks: transport and page furniture ONLY ─────────────────────────── */
vi.mock("@/components/comms/MessagesPage", () => ({
  MessagesPage: () => <div data-testid="mock-messages-page" />,
}));
vi.mock("@/components/comms/MessagingAudienceNotice", () => ({
  MessagingAudienceNotice: () => <div data-testid="mock-audience-notice" />,
}));
vi.mock("@/components/comms/CommsTiersTabs", () => ({
  CommsTiersTabs: () => <div data-testid="mock-tiers-tabs" />,
}));
vi.mock("@/components/comms/CommsTierActionsPanel", () => ({
  CommsTierActionsPanel: () => <div data-testid="mock-tier-actions" />,
}));
vi.mock("@/components/AppShell", () => ({
  PageHeader: ({ title }: { title?: string }) => <div>{title}</div>,
}));

/* The session. Deliberately follows VIEWER, so the same component mounted for a
   different user really runs as that user on both client and server. */
vi.mock("@/lib/entitlement", () => ({
  useEntitlement: () => ({ data: { userId: VIEWER }, isLoading: false }),
}));

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));

/* THE BRIDGE. Only the transport is in-process; the audience, the alias
   resolution, the naming and the payload are all real. */
const httpCalls: Array<{ method: string; url: string; status: number }> = [];

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async (method: string, url: string, body?: unknown) => {
      let r = (request(app) as any)[method.toLowerCase()](url)
        .set("x-user-id", VIEWER)
        .set("x-actor-user-id", VIEWER)
        .set("x-role", "investor");
      if (body !== undefined) r = r.send(body as any);
      const res = await r;
      httpCalls.push({ method, url, status: res.status });
      if (res.status < 200 || res.status >= 300) {
        throw new actual.ApiError(
          res.status,
          (res.body as { error?: string })?.error ?? `HTTP ${res.status}`,
          null,
          res.body,
        );
      }
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

function mount() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <Messages />
    </QueryClientProvider>,
  );
}

/** Open the picker and wait for the REAL directory response to land. */
async function openPicker(): Promise<void> {
  fireEvent.click(screen.getByTestId("investor-new-dm-button"));
  await waitFor(() =>
    expect(httpCalls.some((c) => c.url === "/api/comms/users" && c.status === 200)).toBe(true),
  );
}

beforeAll(() => {
  getDb();
  applyCommsDelegatedContextSchema(rawDb() as any);
  applyWave10EngineSchema(rawDb() as any);
  _resetAliasSchemaGuardForTests();

  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: false });
  registerCommsRoutes(app);

  for (const u of [OZAN, PEER, PEER_TWO, STRANGER, SPV_LP, ORPHAN]) seedUser(u);

  /* The shared OPERATING company — NOT in `spv`, so these are real cap-table
     counterparties under the owner's 2026-06-25 policy. */
  seedCommit(CO_SHARED, OZAN_EXT);
  seedCommit(CO_SHARED, PEER);
  seedCommit(CO_SHARED, PEER_TWO_EXT);

  /* A company OZAN holds nothing in. */
  seedCommit(CO_OTHER, STRANGER);

  /* The vehicle. OZAN and SPV_LP are BOTH in it, so nothing but the SPV
     exclusion stops them from discovering each other. */
  run(
    `INSERT OR REPLACE INTO spv
       (id, sponsor_partner_id, gp_user_id, name, spv_type, jurisdiction, status,
        distribution_scope, currency, carry_basis, lp_visibility,
        created_at, created_by, updated_at, updated_by, curr_hash)
     VALUES (?, 'ac_consortium_partner_w185dom', 'u_w185dom_gp', 'W185 DOM Vehicle', 'spv', 'DE',
             'open', 'private', 'USD', 'whole_fund', 'own_only', ?, 'u_w185dom_admin', ?,
             'u_w185dom_admin', 'hash_w185dom_spv')`,
    SPV_VEHICLE, now(), now(),
  );
  seedCommit(SPV_VEHICLE, OZAN_EXT);
  seedCommit(SPV_VEHICLE, SPV_LP);

  seedAlias(OZAN_EXT, OZAN);
  seedAlias(PEER_TWO_EXT, PEER_TWO);
});

afterEach(() => {
  cleanup();
  httpCalls.length = 0;
  toastMock.mockReset();
  VIEWER = OZAN;
});

describe("WAVE 185 · ITEM A — the investor picker on the rendered DOM", () => {
  it("D-0 ANTI-VACUITY: the viewer's own ledger rows are ext_* ONLY", () => {
    /* If a canonical-id commit existed, the PRE-FIX code would already have
       resolved peers and every assertion below would prove nothing. */
    expect(
      rawDb().prepare(`SELECT COUNT(*) AS n FROM captable_commits WHERE investor_id = ?`).get(OZAN),
    ).toEqual({ n: 0 });
    expect(durableCapTablePeerIds(OZAN)).toContain(PEER);
  });

  it("D-1 THE LIVE SYMPTOM IS GONE: entitled peers render BY NAME, not 'Private Investor'", async () => {
    mount();
    await openPicker();
    /* The name a human reads. This is the assertion R154.5 was about: before the
       fix the list was empty and the only offer was to create a new contact. */
    expect(await screen.findByText(PEER_NAME)).toBeTruthy();
    /* And the ext_*-seated peer too, which only exists because the RESULT side
       is canonicalised — an `ext_*` value would have been dropped silently. */
    expect(await screen.findByText(PEER_TWO_NAME)).toBeTruthy();
    expect(screen.queryByText("No eligible contacts.")).toBeNull();
  });

  it("D-2 the picker rows are addressable: a real pick target exists per peer", async () => {
    mount();
    await openPicker();
    /* The `candidateIds` fix is what makes these buttons exist at all — the
       audience alone would have produced an empty list. */
    expect(screen.getByTestId(`investor-new-dm-pick-${PEER}`)).toBeTruthy();
    expect(screen.getByTestId(`investor-new-dm-pick-${PEER_TWO}`)).toBeTruthy();
  });

  it("D-3 SEARCH BY NAME finds the entitled peer, which is the reported symptom", async () => {
    mount();
    await openPicker();
    fireEvent.change(screen.getByTestId("investor-new-dm-search"), {
      target: { value: "Entitled CoInvestor" },
    });
    expect(await screen.findByText(PEER_NAME)).toBeTruthy();
    expect(screen.queryByText("No eligible contacts.")).toBeNull();
  });

  it("D-4 NEGATIVE CONTROL — a holder of a company the viewer does NOT hold is absent", async () => {
    mount();
    await openPicker();
    expect(screen.queryByText(STRANGER_NAME)).toBeNull();
    expect(screen.queryByTestId(`investor-new-dm-pick-${STRANGER}`)).toBeNull();
  });

  it("D-5 NEGATIVE CONTROL — an SPV co-LP of the SAME vehicle is absent, BY NAME and BY ROW", async () => {
    /* The sharpest control in this wave. `ext_*` ids come mostly from the SPV
       LP-commit path, so this is the typical shape of what the fix newly
       resolves. WAIVER-4's policy is that two passive LPs of one vehicle "very
       often must not even know of each other's existence". */
    mount();
    await openPicker();
    expect(screen.queryByText(SPV_LP_NAME)).toBeNull();
    expect(screen.queryByTestId(`investor-new-dm-pick-${SPV_LP}`)).toBeNull();
  });

  it("D-6 NEGATIVE CONTROL — an investor with NO position reaches NOBODY through this path", async () => {
    VIEWER = ORPHAN;
    mount();
    await openPicker();
    expect(screen.queryByText(PEER_NAME)).toBeNull();
    expect(screen.queryByText(PEER_TWO_NAME)).toBeNull();
    expect(screen.queryByText(STRANGER_NAME)).toBeNull();
    expect(screen.queryByText(SPV_LP_NAME)).toBeNull();
    expect(screen.queryByTestId(`investor-new-dm-pick-${PEER}`)).toBeNull();
  });

  it("D-7 the viewer is never offered as their own message recipient", async () => {
    mount();
    await openPicker();
    /* An alias of the viewer resolving through the join would otherwise present
       the viewer to themselves as their own co-investor. */
    expect(screen.queryByTestId(`investor-new-dm-pick-${OZAN_EXT}`)).toBeNull();
  });

  it("D-8 NO RAW LEDGER ID EVER REACHES THE SCREEN", async () => {
    mount();
    await openPicker();
    const picker = screen.getByTestId("investor-new-dm-picker");
    /* A picker row labelled `ext_9f2c1a…` would be both useless and a leak of
       the internal identity scheme. */
    expect(picker.textContent ?? "").not.toContain("ext_");
    expect(picker.textContent ?? "").not.toContain("u_w185dom");
  });
});
