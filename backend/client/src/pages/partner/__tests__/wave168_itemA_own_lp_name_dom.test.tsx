/**
 * WAVE 168 · ITEM A · R137.1 RENDERED-DOM PROOF — a partner FINDS their own LP
 * by typing that LP's real name, and an LP on ANOTHER partner's SPV stays masked
 * on the same screen.
 *
 * WHY A STORE TEST WOULD NOT DO. R137.1: "an LP-facing or partner-facing claim is
 * only verified when the MOUNTED component is verified." Wave 167's own suite is
 * the reason: `partnerOwnAudienceIds` was green, the audience was correct, and the
 * partner still read "No eligible contacts." when they typed a name, because the
 * LABEL was masked. The defect only existed on the screen, so the proof has to be
 * on the screen.
 *
 * NOTHING IN THE CHAIN IS STUBBED except the transport. The REAL express app with
 * the REAL `registerCommsRoutes` runs against the REAL SQLite schema; the shipped
 * client's `apiRequest` is bridged to it by supertest. The chain proved here is:
 *
 *   spv / spv_subscription / partner_team_members rows
 *     → resolveDmRole (step 2a)  → partner_own_lp_peers
 *       → GET /api/comms/users   → the R140.1 naming context
 *         → PartnerMessages picker → TEXT A HUMAN CAN READ AND SEARCH
 *
 * THE VIEWER IS SHAPED LIKE THE LIVE PARTNER: `users.role = 'investor'` and NO
 * `auth_users` row, the measured shape of `u_partner_keiretsu`. A tidy
 * `role = 'partner'` row would prove the one thing that was never broken.
 *
 * THE CROSS-PARTNER NEGATIVE CONTROL IS "PRESENT AND STILL MASKED" (group C).
 * BRAVO's LP is made a picker ROW for ALPHA through the separately-enabled,
 * pre-existing `chapter_peer` rule, so the control is about the NAMING rule
 * rather than about absence. A control that passes because a person is missing
 * says nothing about whether names travel.
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
import { installV14TestIdentity } from "../../../../../server/__tests__/_v14TestIdentity";
import { readRules } from "../../../../../server/lib/commsAudienceRules";
import PartnerMessages from "../PartnerMessages";

const MASKED = "Private Investor";
const EMPTY_STATE = "No eligible contacts.";

/* ── the cast ──────────────────────────────────────────────────────────────── */
const ALPHA_ORG = "porg_w168dom_alpha";
const ALPHA_GP = "u_w168dom_partner";
const ALPHA_MATE = "u_w168dom_alpha_mate";
const ALPHA_SPV = "spv_w168dom_alpha";
const LP_A1 = "u_w168dom_lp_a1";
const LP_A2 = "u_w168dom_lp_a2";

const BRAVO_ORG = "porg_w168dom_bravo";
const BRAVO_GP = "u_w168dom_bravo_gp";
const BRAVO_SPV = "spv_w168dom_bravo";
const LP_B1 = "u_w168dom_lp_b1";

const CHAPTER = "chap_w168dom_shared";

const NAMES: Record<string, string> = {
  [ALPHA_GP]: "Wave168 Alpha Managing Partner",
  [ALPHA_MATE]: "Wave168 Alpha Colleague",
  [BRAVO_GP]: "Wave168 Bravo Managing Partner",
  [LP_A1]: "Wave168dom Alpha LimitedPartner One",
  [LP_A2]: "Wave168dom Alpha LimitedPartner Two",
  [LP_B1]: "Wave168dom Bravo LimitedPartner One",
};

let app: Express;
let VIEWER = ALPHA_GP;

const now = () => new Date().toISOString();

/** THROWS on failure. A swallowed fixture error is a vacuous green, and a
 *  vacuous green on a confidentiality surface is worse than a red. */
const run = (sql: string, ...args: unknown[]): void => {
  try {
    rawDb().prepare(sql).run(...(args as any[]));
  } catch (err) {
    throw new Error(`[w168 dom fixture] SQL failed: ${(err as Error).message}\nSQL: ${sql}`);
  }
};

/** Seeds `users` ONLY — no `auth_users` row, on purpose (see the header). */
function seedLegacyOnlyUser(id: string, role: string): void {
  run(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, is_demo, deleted_at)
     VALUES (?, 'tenant_platform', ?, ?, ?, 0, NULL)`,
    id,
    `${id}@w168dom.test`,
    NAMES[id] ?? id,
    role,
  );
}

function seedTeamMember(org: string, user: string): void {
  run(
    `INSERT OR REPLACE INTO partner_team_members
       (id, partner_id, user_id, sub_role, status, joined_at, removed_at, created_by, is_seed, updated_at)
     VALUES (?, ?, ?, 'managing', 'active', ?, NULL, 'u_w168dom', 0, ?)`,
    `ptm_${org}_${user}`,
    org,
    user,
    now(),
    now(),
  );
}

/** The `contacts` row that satisfies R132.3's own wording for step 2a. */
function seedPartnerContact(id: string): void {
  run(
    `INSERT OR REPLACE INTO contacts
       (id, kind, legal_name, email, status, verification, created_at, updated_at,
        created_by, updated_by, version, prev_revision_hash, revision_hash, tenant_id, deleted_at)
     VALUES (?, 'consortium_partner', ?, ?, 'active', 'verified', ?, ?,
             'u_w168dom', 'u_w168dom', 1, '', ?, 'tenant_platform', NULL)`,
    id,
    NAMES[id] ?? id,
    `${id}@w168dom.test`,
    now(),
    now(),
    `rev_${id}`,
  );
}

function seedSpv(id: string, org: string, gp: string): void {
  run(
    `INSERT OR REPLACE INTO spv
       (id, sponsor_partner_id, gp_user_id, name, spv_type, jurisdiction, status,
        distribution_scope, currency, carry_basis, lp_visibility,
        created_at, created_by, updated_at, updated_by, curr_hash)
     VALUES (?, ?, ?, ?, 'spv', 'DE', 'open', 'private', 'USD', 'whole_fund',
             'own_only', ?, ?, ?, ?, ?)`,
    id,
    org,
    gp,
    `W168 DOM ${id}`,
    now(),
    gp,
    now(),
    gp,
    `hash_${id}`,
  );
}

function seedSubscription(spvId: string, investorId: string): void {
  run(
    `INSERT OR REPLACE INTO spv_subscription
       (id, spv_id, investor_id, commitment_minor, wired_minor, currency, status,
        created_at, updated_at, updated_by, curr_hash)
     VALUES (?, ?, ?, 5000000, 0, 'USD', 'committed', ?, ?, ?, ?)`,
    `sub_${spvId}_${investorId}`,
    spvId,
    investorId,
    now(),
    now(),
    "u_w168dom",
    `hash_${spvId}_${investorId}`,
  );
}

function seedChapterMembership(chapterId: string, user: string): void {
  run(
    `INSERT OR REPLACE INTO chapter_memberships
       (id, tenant_id, chapter_id, user_id, role, status, joined_at, created_at, updated_at, deleted_at)
     VALUES (?, 'tenant_platform', ?, ?, 'member', 'active', ?, ?, ?, NULL)`,
    `chm_${chapterId}_${user}`,
    chapterId,
    user,
    now(),
    now(),
    now(),
  );
}

/* ── the mocks, and there are only three ───────────────────────────────────── */
vi.mock("@/components/comms/MessagesPage", () => ({
  MessagesPage: () => <div data-testid="mock-messages-page" />,
}));

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));

vi.mock("@/components/partner/PartnerShell", () => ({
  PartnerShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "porg_w168dom_alpha",
      tier: "builder",
      subRole: "managing_partner",
      identity: { userId: "u_w168dom_partner", email: "p@w168dom.test", name: "Wave168 Alpha Managing Partner" },
    },
  }),
}));

/* THE BRIDGE — only the transport is in-process. */
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
      <PartnerMessages />
    </QueryClientProvider>,
  );
}

/** Open the picker and wait for the REAL directory response to land. */
async function openPicker(): Promise<void> {
  fireEvent.click(screen.getByTestId("partner-new-dm-button"));
  await waitFor(() =>
    expect(httpCalls.some((c) => c.url === "/api/comms/users" && c.status === 200)).toBe(true),
  );
}

beforeAll(() => {
  getDb();
  applyCommsDelegatedContextSchema(rawDb() as any);
  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: false });
  registerCommsRoutes(app);

  /* ALPHA — live-shaped: legacy 'investor' row, no auth_users row, a
     consortium_partner contacts row (step 2a branch (a)). */
  seedLegacyOnlyUser(ALPHA_GP, "investor");
  seedPartnerContact(ALPHA_GP);
  seedTeamMember(ALPHA_ORG, ALPHA_GP);
  seedLegacyOnlyUser(ALPHA_MATE, "partner");
  seedTeamMember(ALPHA_ORG, ALPHA_MATE);
  seedLegacyOnlyUser(LP_A1, "investor");
  seedLegacyOnlyUser(LP_A2, "investor");
  seedSpv(ALPHA_SPV, ALPHA_ORG, ALPHA_GP);
  seedSubscription(ALPHA_SPV, LP_A1);
  seedSubscription(ALPHA_SPV, LP_A2);

  /* BRAVO — the other organisation. Its LP shares a Collective chapter with
     ALPHA's principal, so the LP IS a row in ALPHA's picker and the masking
     claim below is about the naming rule, not about absence. */
  seedLegacyOnlyUser(BRAVO_GP, "investor");
  seedPartnerContact(BRAVO_GP);
  seedTeamMember(BRAVO_ORG, BRAVO_GP);
  seedLegacyOnlyUser(LP_B1, "investor");
  seedSpv(BRAVO_SPV, BRAVO_ORG, BRAVO_GP);
  seedSubscription(BRAVO_SPV, LP_B1);
  seedChapterMembership(CHAPTER, ALPHA_GP);
  seedChapterMembership(CHAPTER, LP_B1);

  readRules();
  run(
    `UPDATE comms_audience_rules
        SET enabled = 1, requires_owner_decision = 0
      WHERE rule_key = 'partner_own_lp_peers'`,
  );
});

afterEach(() => {
  cleanup();
  httpCalls.length = 0;
  toastMock.mockReset();
  VIEWER = ALPHA_GP;
});

/* ══════════════════════════════════════════════════════════════════════════════
   GROUP R — R140.1 ON THE SCREEN
   ══════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 168 · R — the partner READS their own LPs' names in the picker", () => {
  it("R-1 both own LPs render with their REAL names, not the identical masked label", async () => {
    mount();
    await openPicker();
    const a1 = await waitFor(() => screen.getByTestId(`partner-new-dm-pick-${LP_A1}`));
    const a2 = screen.getByTestId(`partner-new-dm-pick-${LP_A2}`);
    expect((a1.textContent ?? "").trim()).toBe(NAMES[LP_A1]);
    expect((a2.textContent ?? "").trim()).toBe(NAMES[LP_A2]);
    /* Rendered as readable text, not only as an attribute. */
    expect(screen.getByText(NAMES[LP_A1])).toBeTruthy();
    expect(screen.getByText(NAMES[LP_A2])).toBeTruthy();
  });

  it("R-2 THE LIVE GESTURE: typing an own LP's real name FINDS them", async () => {
    mount();
    await openPicker();
    await waitFor(() => expect(screen.getByTestId(`partner-new-dm-pick-${LP_A1}`)).toBeTruthy());

    fireEvent.change(screen.getByTestId("partner-new-dm-search"), {
      target: { value: NAMES[LP_A1] },
    });

    /* The row survives the filter, and the fail-before copy is GONE. */
    await waitFor(() => expect(screen.getByTestId(`partner-new-dm-pick-${LP_A1}`)).toBeTruthy());
    expect(screen.queryByText(EMPTY_STATE)).toBeNull();
    /* And the search really discriminated — the other LP was filtered out. */
    expect(screen.queryByTestId(`partner-new-dm-pick-${LP_A2}`)).toBeNull();
  });

  it("R-3 a partial surname search works too — a human types fragments", async () => {
    mount();
    await openPicker();
    await waitFor(() => expect(screen.getByTestId(`partner-new-dm-pick-${LP_A2}`)).toBeTruthy());
    fireEvent.change(screen.getByTestId("partner-new-dm-search"), {
      target: { value: "LimitedPartner Two" },
    });
    await waitFor(() => expect(screen.getByTestId(`partner-new-dm-pick-${LP_A2}`)).toBeTruthy());
    expect(screen.queryByText(EMPTY_STATE)).toBeNull();
  });

  it("R-4 CAN STILL SEND: clicking the named LP drives a real POST that succeeds", async () => {
    mount();
    await openPicker();
    const a1 = await waitFor(() => screen.getByTestId(`partner-new-dm-pick-${LP_A1}`));
    fireEvent.click(a1);
    await waitFor(() =>
      expect(
        httpCalls.some((c) => c.url === "/api/comms/dm/start" && c.status >= 200 && c.status < 300),
      ).toBe(true),
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   GROUP C — THE CROSS-PARTNER NEGATIVE CONTROL, PROVED IN THE DOM
   ══════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 168 · C — an LP on ANOTHER partner's SPV stays masked on screen", () => {
  it("C-1 ANTI-VACUITY: BRAVO's LP really IS a row in ALPHA's picker", async () => {
    mount();
    await openPicker();
    await waitFor(() => expect(screen.getByTestId(`partner-new-dm-pick-${LP_B1}`)).toBeTruthy());
  });

  it("C-2 that row is MASKED, and BRAVO's LP's real name is nowhere on screen", async () => {
    mount();
    await openPicker();
    const b1 = await waitFor(() => screen.getByTestId(`partner-new-dm-pick-${LP_B1}`));
    expect((b1.textContent ?? "").trim()).toBe(MASKED);
    expect(screen.queryByText(NAMES[LP_B1])).toBeNull();
    /* On the SAME screen ALPHA's own LP is named — so this is the fence, not a
       global masking regression. */
    expect(screen.getByText(NAMES[LP_A1])).toBeTruthy();
  });

  it("C-3 searching BRAVO's LP by real name yields the empty state, not a hit", async () => {
    mount();
    await openPicker();
    await waitFor(() => expect(screen.getByTestId(`partner-new-dm-pick-${LP_B1}`)).toBeTruthy());
    fireEvent.change(screen.getByTestId("partner-new-dm-search"), {
      target: { value: NAMES[LP_B1] },
    });
    await waitFor(() => expect(screen.getByText(EMPTY_STATE)).toBeTruthy());
  });

  it("C-4 the OTHER DIRECTION: BRAVO's picker never names ALPHA's LPs", async () => {
    VIEWER = BRAVO_GP;
    mount();
    await openPicker();
    /* BRAVO reads their OWN LP by name (anti-vacuity for this direction) … */
    const b1 = await waitFor(() => screen.getByTestId(`partner-new-dm-pick-${LP_B1}`));
    expect((b1.textContent ?? "").trim()).toBe(NAMES[LP_B1]);
    /* … and ALPHA's LPs are neither rows nor names. */
    expect(screen.queryByTestId(`partner-new-dm-pick-${LP_A1}`)).toBeNull();
    expect(screen.queryByText(NAMES[LP_A1])).toBeNull();
    expect(screen.queryByText(NAMES[LP_A2])).toBeNull();
  });

  it("C-5 the partner's OWN TEAM MEMBER is still masked — R140.3 is held, not widened", async () => {
    mount();
    await openPicker();
    const mate = await waitFor(() => screen.getByTestId(`partner-new-dm-pick-${ALPHA_MATE}`));
    expect((mate.textContent ?? "").trim()).toBe(MASKED);
    expect(screen.queryByText(NAMES[ALPHA_MATE])).toBeNull();
  });

  it("C-6 the rendered rows carry NAME ONLY — no positions, no location, no network", async () => {
    mount();
    await openPicker();
    const row = await waitFor(() => screen.getByTestId(`partner-new-dm-pick-${LP_A1}`));
    const text = (row.textContent ?? "").trim();
    expect(text).toBe(NAMES[LP_A1]);
    for (const leak of ["co_", "spv_", "Berlin", "Angel", "$"]) {
      expect(text.includes(leak)).toBe(false);
    }
  });
});
