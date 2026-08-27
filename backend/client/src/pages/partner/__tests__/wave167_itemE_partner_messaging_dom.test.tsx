/**
 * WAVE 167 · ITEM E · TASK 2 — R137.1 RENDERED-DOM PROOF.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS AND WHY IT IS NOT A STORE TEST
 * ══════════════════════════════════════════════════════════════════════════════
 * R137.1: "an LP-facing or partner-facing claim is only verified when the MOUNTED
 * component is verified — a passing store test is not evidence that a user sees
 * anything." On live TODAY every partner recipient search renders
 * "No eligible contacts." and no message can be sent. A green
 * `partnerOwnAudienceIds` unit test would have said the opposite, which is
 * exactly the false claim that ruling was written about.
 *
 * So this test does NOT mock the API. It boots the REAL express app with the
 * REAL `registerCommsRoutes` against the REAL SQLite schema, seeds REAL rows,
 * and points the shipped client's `apiRequest` at that app through supertest.
 * The chain under test is therefore end to end:
 *
 *   users/spv/spv_subscription/partner_team_members rows
 *     → resolveDmRole (STEP 2a)
 *       → isAudienceRuleEnabled("partner_own_lp_peers", "partner")
 *         → partnerOwnAudienceIds
 *           → GET /api/comms/users
 *             → PartnerMessages picker
 *               → TEXT A HUMAN CAN READ IN THE DOM
 *
 * Nothing in the middle is stubbed, so a regression anywhere in it fails here.
 * `MessagesPage` (the split-pane thread reader) and `useRequirePartnerRole` (a
 * session hook with no bearing on the audience) are the only mocks; the audience,
 * the role resolution and the payload are all real.
 *
 * THE VIEWER IS SHAPED LIKE THE LIVE PARTNER, DELIBERATELY.
 * `u_w167dom_partner` has `users.role = 'investor'` and NO `auth_users` row —
 * the measured shape of `u_partner_keiretsu` on live. That is the whole reason
 * enabling the rule alone fixed nothing, so testing a tidy `role = 'partner'`
 * row would prove the one thing that was never broken.
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
import { resolveDmRole } from "../../../../../server/messagingPolicy";
import PartnerMessages from "../PartnerMessages";

/* ── the cast ──────────────────────────────────────────────────────────────── */
/* ALPHA: the live-shaped partner. users.role='investor', no auth_users row,
   promoted to 'partner' only by step 2a's contacts branch. */
const ALPHA_ORG = "porg_w167dom_alpha";
const ALPHA_GP = "u_w167dom_partner";
const ALPHA_MATE = "u_w167dom_alpha_mate";
const ALPHA_SPV = "spv_w167dom_alpha";
const LP_A1 = "u_w167dom_lp_a1";
const LP_A2 = "u_w167dom_lp_a2";

/* BRAVO: a SECOND partner organisation. Its LP must never appear in ALPHA's
   picker. A DOM test that only proves the happy path proves nothing about
   confidentiality, and this is the surface a human actually reads names from. */
const BRAVO_ORG = "porg_w167dom_bravo";
const BRAVO_GP = "u_w167dom_bravo_gp";
const BRAVO_SPV = "spv_w167dom_bravo";
const LP_B1 = "u_w167dom_lp_b1";

/* TEAM-FALLBACK viewer: users.role='investor', NO auth_users row and NO contacts
   row — promoted ONLY by step 2a's explicitly-labelled partner_team_members
   branch, which is the branch that fires on live. */
const TEAM_ONLY_GP = "u_w167dom_teamonly_gp";
const TEAM_ONLY_ORG = "porg_w167dom_teamonly";
const TEAM_ONLY_SPV = "spv_w167dom_teamonly";
const TEAM_ONLY_LP = "u_w167dom_teamonly_lp";

const NAMES: Record<string, string> = {
  [ALPHA_GP]: "Alpha Managing Partner",
  [ALPHA_MATE]: "Alpha Colleague",
  [BRAVO_GP]: "Bravo Managing Partner",
  [LP_A1]: "Wave167 Alpha LimitedPartner One",
  [LP_A2]: "Wave167 Alpha LimitedPartner Two",
  [LP_B1]: "Wave167 Bravo LimitedPartner One",
  [TEAM_ONLY_GP]: "Teamonly Managing Partner",
  [TEAM_ONLY_LP]: "Wave167 Teamonly LimitedPartner",
};

let app: Express;
/** Whose session the mounted component is running as. Read by the apiRequest
 *  bridge below, so one mounted component can be re-rendered as a different
 *  real user without re-mocking anything. */
let VIEWER = ALPHA_GP;

const now = () => new Date().toISOString();

/** THROWS on failure. A swallowed fixture error is a vacuous green, and a
 *  vacuous green on a confidentiality surface is worse than a red. */
const run = (sql: string, ...args: unknown[]): void => {
  try {
    rawDb().prepare(sql).run(...(args as any[]));
  } catch (err) {
    throw new Error(`[w167 dom fixture] SQL failed: ${(err as Error).message}\nSQL: ${sql}`);
  }
};

/** Seeds `users` ONLY — no `auth_users` row, on purpose (see the header). */
function seedLegacyOnlyUser(id: string, role: string): void {
  run(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, is_demo, deleted_at)
     VALUES (?, 'tenant_platform', ?, ?, ?, 0, NULL)`,
    id,
    `${id}@w167dom.test`,
    NAMES[id] ?? id,
    role,
  );
}

function seedTeamMember(org: string, user: string): void {
  run(
    `INSERT OR REPLACE INTO partner_team_members
       (id, partner_id, user_id, sub_role, status, joined_at, removed_at, created_by, is_seed, updated_at)
     VALUES (?, ?, ?, 'managing', 'active', ?, NULL, 'u_w167dom', 0, ?)`,
    `ptm_${org}_${user}`,
    org,
    user,
    now(),
    now(),
  );
}

/** The `contacts` row that satisfies R132.3's OWN wording for step 2a. */
function seedPartnerContact(id: string): void {
  run(
    `INSERT OR REPLACE INTO contacts
       (id, kind, legal_name, email, status, verification, created_at, updated_at,
        created_by, updated_by, version, prev_revision_hash, revision_hash, tenant_id, deleted_at)
     VALUES (?, 'consortium_partner', ?, ?, 'active', 'verified', ?, ?,
             'u_w167dom', 'u_w167dom', 1, '', ?, 'tenant_platform', NULL)`,
    id,
    NAMES[id] ?? id,
    `${id}@w167dom.test`,
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
    `W167 DOM ${id}`,
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
    "u_w167dom",
    `hash_${spvId}_${investorId}`,
  );
}

/* ── the mocks, and there are only two ─────────────────────────────────────── */

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
      partnerId: "porg_w167dom_alpha",
      tier: "builder",
      subRole: "managing_partner",
      identity: { userId: "u_w167dom_partner", email: "p@w167dom.test", name: "Alpha Managing Partner" },
    },
  }),
}));

/* THE BRIDGE. The shipped client's `apiRequest` is redirected at the REAL
   express app over supertest, and returns a real `Response`-shaped object built
   from the real HTTP status and the real JSON body. Nothing about the audience,
   the role resolution or the payload is faked — only the transport is
   in-process. `x-role` is sent as 'investor' to match the live viewer's legacy
   row; the server ignores it for audience purposes and calls `resolveDmRole`
   itself, which is precisely the behaviour under test. */
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

  /* BRAVO — the other organisation whose LP must stay invisible. */
  seedLegacyOnlyUser(BRAVO_GP, "investor");
  seedPartnerContact(BRAVO_GP);
  seedTeamMember(BRAVO_ORG, BRAVO_GP);
  seedLegacyOnlyUser(LP_B1, "investor");
  seedSpv(BRAVO_SPV, BRAVO_ORG, BRAVO_GP);
  seedSubscription(BRAVO_SPV, LP_B1);

  /* TEAM-ONLY — no contacts row at all, so ONLY the partner_team_members branch
     of step 2a can promote this viewer. This is the live-firing branch. */
  seedLegacyOnlyUser(TEAM_ONLY_GP, "investor");
  seedTeamMember(TEAM_ONLY_ORG, TEAM_ONLY_GP);
  seedLegacyOnlyUser(TEAM_ONLY_LP, "investor");
  seedSpv(TEAM_ONLY_SPV, TEAM_ONLY_ORG, TEAM_ONLY_GP);
  seedSubscription(TEAM_ONLY_SPV, TEAM_ONLY_LP);
});

afterEach(() => {
  cleanup();
  httpCalls.length = 0;
  toastMock.mockReset();
  VIEWER = ALPHA_GP;
});

/* ══════════════════════════════════════════════════════════════════════════════
   GROUP 1 — resolveDmRole STEP 2a, against the live row shape
   ══════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 167 · TASK 2 — resolveDmRole step 2a resolves the live partner shape", () => {
  it("2a-1 ANTI-VACUITY: the viewer really has NO auth_users row and users.role='investor'", () => {
    const auth = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM auth_users WHERE id = ? OR lower(email) = lower(?)`)
      .get(ALPHA_GP, `${ALPHA_GP}@w167dom.test`) as { n: number };
    /* If this row existed, step 1 would answer and step 2a would never run —
       every assertion below would pass while proving nothing. */
    expect(auth.n).toBe(0);
    const legacy = rawDb().prepare(`SELECT role FROM users WHERE id = ?`).get(ALPHA_GP) as {
      role: string;
    };
    expect(legacy.role).toBe("investor");
  });

  it("2a-2 users.role='investor' + a consortium_partner contacts row resolves to 'partner'", () => {
    expect(
      rawDb()
        .prepare(`SELECT COUNT(*) AS n FROM contacts WHERE id = ? AND kind = 'consortium_partner'`)
        .get(ALPHA_GP),
    ).toEqual({ n: 1 });
    expect(resolveDmRole(ALPHA_GP)).toBe("partner");
  });

  it("2a-3 the partner_team_members FALLBACK resolves to 'partner' with NO contacts row", () => {
    /* This is the branch that fires on live, where `contacts` is empty. */
    expect(
      rawDb().prepare(`SELECT COUNT(*) AS n FROM contacts WHERE id = ?`).get(TEAM_ONLY_GP),
    ).toEqual({ n: 0 });
    expect(resolveDmRole(TEAM_ONLY_GP)).toBe("partner");
  });

  it("2a-4 step 2a CANNOT promote a plain investor with neither durable record", () => {
    /* LP_A1 is an 'investor' legacy row with no contacts row and no team row.
       If step 2a were widened past its two named conditions, this would break. */
    expect(resolveDmRole(LP_A1)).toBe("investor");
    expect(resolveDmRole(LP_A2)).toBe("investor");
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   GROUP 2 — THE RENDERED DOM: a partner SEES their own LPs and team
   ══════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 167 · TASK 2 — RENDERED DOM: the partner's own LPs are visible recipients", () => {
  it("D-1 the picker renders BOTH own LPs as SELECTABLE rows from a REAL response", async () => {
    mount();
    await openPicker();

    /* Read off the DOM a human sees, not off a store. Both own LPs are present
       and selectable. Their NAMES are masked — see the BLOCKER note at the foot
       of this file and test M-1; that masking is deliberately NOT changed here. */
    await waitFor(() => expect(screen.getByTestId(`partner-new-dm-pick-${LP_A1}`)).toBeTruthy());
    expect(screen.getByTestId(`partner-new-dm-pick-${LP_A2}`)).toBeTruthy();
    expect(screen.getByTestId(`partner-new-dm-pick-${LP_A1}`).tagName).toBe("BUTTON");
    expect((screen.getByTestId(`partner-new-dm-pick-${LP_A1}`) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("D-2 the FAIL-BEFORE string is GONE: no 'No eligible contacts.' anywhere on screen", async () => {
    mount();
    await openPicker();
    await waitFor(() => expect(screen.getByTestId(`partner-new-dm-pick-${LP_A1}`)).toBeTruthy());

    /* The exact live symptom this wave exists to remove. */
    expect(screen.queryByText("No eligible contacts.")).toBeNull();
  });

  it("D-3 the partner's own TEAM MEMBER is a visible recipient too", async () => {
    mount();
    await openPicker();
    await waitFor(() => expect(screen.getByTestId(`partner-new-dm-pick-${ALPHA_MATE}`)).toBeTruthy());
  });

  it("D-4 typing a search term FILTERS to the matching LP and keeps it on screen", async () => {
    mount();
    await openPicker();
    await waitFor(() => expect(screen.getByTestId(`partner-new-dm-pick-${LP_A1}`)).toBeTruthy());

    /* Searching is the live gesture that produced "No eligible contacts.". It now
       returns rows.

       WAVE 168 · R140.1 — the search TERM changed and the assertions did not. It
       was `"Private"`, because the masked label was the only text a partner could
       match on (the usability blocker M-2 recorded). Now that own LPs render with
       the names the partner typed in, the term is the part of those names both own
       LPs share — so this case still proves "the filter narrows and keeps the
       matching rows on screen", against the text a partner can now actually
       type. */
    fireEvent.change(screen.getByTestId("partner-new-dm-search"), {
      target: { value: "Alpha LimitedPartner" },
    });

    await waitFor(() => expect(screen.getByTestId(`partner-new-dm-pick-${LP_A1}`)).toBeTruthy());
    expect(screen.getByTestId(`partner-new-dm-pick-${LP_A2}`)).toBeTruthy();
    expect(screen.queryByText("No eligible contacts.")).toBeNull();
  });

  it("D-5 CAN SEND: clicking the LP drives a real POST /api/comms/dm/start that succeeds", async () => {
    mount();
    await openPicker();
    await waitFor(() => expect(screen.getByTestId(`partner-new-dm-pick-${LP_A1}`)).toBeTruthy());

    fireEvent.click(screen.getByTestId(`partner-new-dm-pick-${LP_A1}`));

    /* The REAL route answered 2xx — the send is not a mocked success. */
    await waitFor(() =>
      expect(
        httpCalls.find((c) => c.method === "POST" && c.url === "/api/comms/dm/start"),
      ).toBeTruthy(),
    );
    const post = httpCalls.find((c) => c.url === "/api/comms/dm/start")!;
    expect(post.status).toBeGreaterThanOrEqual(200);
    expect(post.status).toBeLessThan(300);

    /* And the UI reflected it: the picker closed and no refusal was raised. */
    await waitFor(() => expect(screen.queryByTestId("partner-new-dm-picker")).toBeNull());
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("D-6 the TEAM-FALLBACK viewer also sees their own LP in the DOM", async () => {
    /* Proves the branch that actually fires on live reaches the screen, not just
       the branch matching R132.3's literal wording. */
    VIEWER = TEAM_ONLY_GP;
    mount();
    await openPicker();
    await waitFor(() =>
      expect(screen.getByTestId(`partner-new-dm-pick-${TEAM_ONLY_LP}`)).toBeTruthy(),
    );
    expect(screen.queryByText("No eligible contacts.")).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   GROUP 3 — THE RENDERED DOM MUST ALSO PROVE THE ISOLATION
   A happy-path-only DOM test would let a leak ship looking green.
   ══════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 167 · TASK 2 — RENDERED DOM: another partner's LP is NOT on screen", () => {
  it("X-1 ALPHA's picker contains no row and no name for BRAVO's LP", async () => {
    mount();
    await openPicker();
    await waitFor(() => expect(screen.getByTestId(`partner-new-dm-pick-${LP_A1}`)).toBeTruthy());

    expect(screen.queryByTestId(`partner-new-dm-pick-${LP_B1}`)).toBeNull();
    expect(screen.queryByText(NAMES[LP_B1])).toBeNull();
    expect(screen.queryByTestId(`partner-new-dm-pick-${BRAVO_GP}`)).toBeNull();
    expect(screen.queryByText(NAMES[BRAVO_GP])).toBeNull();
  });

  it("X-2 searching BRAVO's LP by name yields the empty-state, not a hit", async () => {
    mount();
    await openPicker();
    await waitFor(() => expect(screen.getByTestId(`partner-new-dm-pick-${LP_A1}`)).toBeTruthy());

    fireEvent.change(screen.getByTestId("partner-new-dm-search"), {
      target: { value: "Zzz No Such Person" },
    });

    await waitFor(() => expect(screen.getByText("No eligible contacts.")).toBeTruthy());
    expect(screen.queryByTestId(`partner-new-dm-pick-${LP_B1}`)).toBeNull();
  });

  it("X-3 the isolation holds in the OTHER direction — BRAVO cannot see ALPHA's LPs", async () => {
    VIEWER = BRAVO_GP;
    mount();
    await openPicker();
    await waitFor(() => expect(screen.getByTestId(`partner-new-dm-pick-${LP_B1}`)).toBeTruthy());

    expect(screen.queryByTestId(`partner-new-dm-pick-${LP_A1}`)).toBeNull();
    expect(screen.queryByTestId(`partner-new-dm-pick-${LP_A2}`)).toBeNull();
    expect(screen.queryByText(NAMES[LP_A1])).toBeNull();
    expect(screen.queryByText(NAMES[LP_A2])).toBeNull();
  });

  it("X-4 the rendered rows carry NAME ONLY — no positions, no location, no network", async () => {
    /* Wave 144's payload scoping, verified where it matters most: on the pixels.
       The row's text content is the LP's name and nothing else, so even a
       re-added server field could not be read off this surface. */
    mount();
    await openPicker();
    const row = await waitFor(() => screen.getByTestId(`partner-new-dm-pick-${LP_A1}`));
    const text = (row.textContent ?? "").trim();
    /* Whatever label the row carries, it carries NOTHING ELSE: no cap-table
       position, no location, no network affiliation. Asserted on the pixels, so
       even a re-added server field could not be read off this surface. */
    expect(text).not.toContain("co_");
    expect(text).not.toContain("captable");
    expect(text).not.toContain("Angel");
    expect(text).not.toContain("@");
    expect(text.length).toBeLessThan(60);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   GROUP 4 — THE MASKING BLOCKER: RAISED BY WAVE 167, RULED ON IN R140.1,
             RE-ARGUED HERE BY WAVE 168
   ══════════════════════════════════════════════════════════════════════════════
   ┌─ WAVE 168 · R140.1 ─────────────────────────────────────────────────────┐
   │ The owner decided the question this group was written to ASK: **a         │
   │ Consortium Partner may see the names of LPs on SPVs it sponsors. Nothing  │
   │ wider.** The reasoning is also the bound — the partner TYPED THOSE NAMES  │
   │ IN ("Invite an LP" and "Commit an LP to the cap table" both take a first  │
   │ name, a last name and an email entered by the partner) and the partner    │
   │ holds the subscription agreement, so masking a name back to its author is │
   │ a defect, not privacy, and no third party's data is disclosed.            │
   │                                                                          │
   │ So M-1 and M-2 are RE-ARGUED, not deleted: they now assert the ruled      │
   │ behaviour on the same rendered DOM, and each still carries the fence      │
   │ beside it. M-3 is UNCHANGED and still asserts the own TEAM MEMBER is      │
   │ masked — R140.3 holds the team half for the owner, so the naming fence is │
   │ `spv.sponsor_partner_id` and nothing else. M-4 keeps the mechanism proof   │
   │ and now also proves the resolver's EXPLICIT opt-out still wins.           │
   │ The cross-partner control lives in                                        │
   │ `wave168_itemA_own_lp_name_dom.test.tsx` (present-and-still-masked).       │
   └──────────────────────────────────────────────────────────────────────────┘

   WHAT WAVE 167 FOUND, ON THE RENDERED DOM. This is the R137.1 payoff: the store
   layer was correct and the audience rule worked, and yet what a partner SAW was
   still not usable.

   WHAT THE PARTNER SEES. `GET /api/comms/users` resolves every non-self name
   through the SACRED `userPrivacyResolver`. A partner's own LP is a subscriber to
   the partner's SPV, which is NOT cap-table co-membership, so
   `areCoMembersOnAnyCapTable` is false and the name is resolved in the
   `collectiveDirectory` context — a context that requires an EXPLICIT opt-in and
   otherwise returns "Private Investor" (server/lib/userPrivacyResolver.ts). An LP
   who has never opened Settings → Privacy has no `profilestore_user_privacy` row,
   so EVERY own LP renders as the identical string "Private Investor".

   CONSEQUENCE: the partner gets N indistinguishable rows and cannot search for
   anyone by name — a partner typing their LP's actual name still gets
   "No eligible contacts." So R139.1's "finish the messaging completely" is NOT
   fully met by the audience rule alone.

   WHY WAVE 167 DID NOT FIX IT. The only two fixes were (a) resolve own-LP peers
   in the `message` context with `isCoMember: true`, or (b) add an own-LP exception
   inside the resolver. Both DISCLOSE A REAL PERSON'S LEGAL NAME to a party who
   could not see it then, and no ruling authorised it, so the builder raised it
   instead of taking it.

   HOW IT WAS RESOLVED. R140.1 chose (a) and bounded it: `spv.sponsor_partner_id`
   matching the viewing partner, in the CALLING CONTEXT only
   (`server/commsStore.ts`, the `/api/comms/users` handler). The SACRED
   `server/lib/userPrivacyResolver.ts` was NOT edited by wave 168 and still has no
   partner or SPV concept — asserted in
   `server/__tests__/wave168_itemA_own_lp_name_unmask.test.ts` (D1).

   These tests still PIN the decision so it cannot drift silently: M-1/M-2 assert
   the ruled behaviour, M-3 asserts the team half is NOT included, and M-4 asserts
   an explicit opt-out still wins. Widening any of that fails this group. */
describe("WAVE 167 · TASK 2 — R140.1: own-LP names render to their sponsoring partner", () => {
  it("M-1 each own LP renders with their OWN legal name, and the rows are distinguishable", async () => {
    mount();
    await openPicker();
    const a1 = await waitFor(() => screen.getByTestId(`partner-new-dm-pick-${LP_A1}`));
    const a2 = screen.getByTestId(`partner-new-dm-pick-${LP_A2}`);

    /* R140.1 — the names the partner typed in are read back to the partner. */
    expect((a1.textContent ?? "").trim()).toBe(NAMES[LP_A1]);
    expect((a2.textContent ?? "").trim()).toBe(NAMES[LP_A2]);
    expect((a1.textContent ?? "").trim()).not.toBe((a2.textContent ?? "").trim());

    /* THE FENCE, ON THE SAME SCREEN: the other partner's LP is still not named. */
    expect(screen.queryByText(NAMES[LP_B1])).toBeNull();
  });

  it("M-2 searching an own LP by their REAL name now FINDS them", async () => {
    mount();
    await openPicker();
    await waitFor(() => expect(screen.getByTestId(`partner-new-dm-pick-${LP_A1}`)).toBeTruthy());

    /* The exact gesture the owner makes on the live server. Before R140.1 this
       rendered "No eligible contacts." because the audience was right and the
       LABEL was not; the label is now right too. */
    fireEvent.change(screen.getByTestId("partner-new-dm-search"), {
      target: { value: NAMES[LP_A1] },
    });
    await waitFor(() => expect(screen.getByTestId(`partner-new-dm-pick-${LP_A1}`)).toBeTruthy());
    expect(screen.queryByText("No eligible contacts.")).toBeNull();
  });

  it("M-3 the partner's own TEAM MEMBER is masked the same way — not a partner-only quirk", async () => {
    mount();
    await openPicker();
    const mate = await waitFor(() => screen.getByTestId(`partner-new-dm-pick-${ALPHA_MATE}`));
    expect((mate.textContent ?? "").trim()).toBe("Private Investor");
    expect(screen.queryByText(NAMES[ALPHA_MATE])).toBeNull();
  });

  it("M-4 the resolver still governs: an EXPLICIT opt-out is still masked to the partner", async () => {
    /* Wave 167's M-4 proved the branch CAN carry a name by opting an LP in. Under
       R140.1 that is now the default for an own LP, so the load-bearing half of
       the same claim is the OPPOSITE pole: R140.1 unmasks a name the partner
       authored, and it does NOT overrule a person who has actively said no. The
       resolver's explicit `visibleToCoMembers:false` still wins, and it is written
       here through the resolver's OWN public writer, never by poking its table. */
    const { writeUserPrivacy } = await import("../../../../../server/lib/userPrivacyResolver");
    writeUserPrivacy(LP_A2, { visibleToCoMembers: false, visibleInCollectiveDirectory: false });
    try {
      mount();
      await openPicker();
      const a2 = await waitFor(() => screen.getByTestId(`partner-new-dm-pick-${LP_A2}`));
      expect((a2.textContent ?? "").trim()).toBe("Private Investor");

      /* And one LP's opt-out does not mask the other — this is per subject. */
      expect((screen.getByTestId(`partner-new-dm-pick-${LP_A1}`).textContent ?? "").trim()).toBe(
        NAMES[LP_A1],
      );
    } finally {
      writeUserPrivacy(LP_A2, { visibleToCoMembers: true, visibleInCollectiveDirectory: false });
    }
  });
});
