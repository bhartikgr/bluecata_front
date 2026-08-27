/**
 * WAVE 173 — TWO DEFECTS THAT BOTH LIE TO THE PARTNER.
 *
 * GROUP A — DUPLICATE TEAM MEMBERSHIPS (item 1).
 * Live carries six duplicate `partner_team_members` rows. The brief asked for a
 * dedupe migration plus the missing uniqueness constraint. This group tests the
 * half a migration cannot cover: THE WRITE PATH THAT MINTED THEM. A migration
 * that collapses today's duplicates while the writer keeps producing new ones
 * has fixed nothing, and — worse — once the unique index from
 * `0211_wave173_partner_team_members_dedupe_unique.sql` is in place, that same
 * writer stops producing a duplicate and starts producing a 500.
 *
 * HOW THE LIVE DUPLICATES ACTUALLY HAPPEN, reproduced faithfully here.
 * `partnerTeamStore.add` (`partnerWorkspaceStore.ts:958`) guards uniqueness by
 * searching the in-RAM `teamMembers` array. When the DB holds an active row that
 * the RAM cache does not — a restart that rehydrates differently, or the second
 * insert path at `:1703` (invitation redeem) — the guard misses, `add` mints a
 * fresh `newId("ptm")`, and `persistTeamMember`'s `ON CONFLICT(id)` cannot
 * collide because the id is new. A second row lands. That is the whole bug, and
 * group A creates exactly that state: a DB row with no matching RAM entry.
 *
 * WHY THIS IS NOT TESTED THROUGH THE MIGRATION. The test bootstrap builds its
 * schema from the INLINE DDL in `server/db/connection.ts` (see `:212` "inline
 * SQLite migrations"), not from `migrations/*.sql`, and `connection.ts` is
 * SACRED so the index cannot be added there. The migration's own DDL is proven
 * separately, and idempotently, on a COPY of live in
 * `build_log/wave173/w173_dedupe_proof.sh`. What is proven HERE is that the
 * writer converges on one row, which is what makes that index safe to add.
 *
 * GROUP B — THE CHECKLIST THAT REPORTED SUCCESS AND SAVED NOTHING (item 2).
 * The brief's premise ("items derived from `partner_organizations`") did not hold
 * — nothing on the checklist derives from that table; nine of the ten items are
 * self-declared checkboxes. But investigating it surfaced something worse. The
 * PATCH at `consortiumApplyStore.ts:2456` runs
 * `UPDATE partner_organizations SET onboarding_state = ... WHERE id = partnerId`
 * against a table that is EMPTY with no server INSERT path. The UPDATE matched
 * zero rows, threw nothing, and the handler answered `{ ok: true }`. The partner
 * ticked a box, was told it saved, and the tick was discarded — then the GET's
 * own empty-table branch returned `{ state: {} }` so the checklist silently
 * reverted. A FALSE SUCCESS, which is worse than a refusal.
 *
 * NO ASSERTION COUNT IS LOWERED ANYWHERE (R98). No money is involved in either
 * group: `partner_team_members` has no money column, and `onboarding_state` is
 * operational metadata with no hash chain.
 *
 * NEVER MUTATES data.db / test.db — ordinary in-memory test handle.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";

import { getDb, rawDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";
import {
  seedTestPartnerSandbox,
  partnerTeamStore,
  TEST_PARTNER_ID,
  TEST_PARTNER_USERS,
} from "../partnerWorkspaceStore";
import {
  registerPartnerOnboardingRoutes,
  PARTNER_ONBOARDING_STATE_NOT_STORABLE_COPY,
} from "../consortiumApplyStore";
import { installV14TestIdentity } from "./_v14TestIdentity";

const PARTNER_A = TEST_PARTNER_ID;
const MANAGING_A = TEST_PARTNER_USERS.managing.userId;

let app: Express;
let server: http.Server;
let port: number;

function call(
  method: string,
  apiPath: string,
  opts: { body?: unknown; userId?: string } = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    if (opts.userId) headers["x-user-id"] = opts.userId;
    const r = http.request(
      { hostname: "127.0.0.1", port, path: apiPath, method, headers },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let b: any = null;
          try {
            b = JSON.parse(buf);
          } catch {
            /* keep null */
          }
          resolve({ status: res.statusCode ?? 0, body: b });
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

function activeRows(partnerId: string, userId: string): Array<{ id: string; sub_role: string }> {
  return rawDb()
    .prepare(
      `SELECT id, sub_role FROM partner_team_members
        WHERE partner_id = ? AND user_id = ? AND status = 'active' AND removed_at IS NULL
        ORDER BY joined_at ASC, id ASC`,
    )
    .all(partnerId, userId) as Array<{ id: string; sub_role: string }>;
}

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
  await seedDemoData(getDb());
  seedTestPartnerSandbox({ force: true });

  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: false });
  registerPartnerOnboardingRoutes(app);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      port = (server.address() as any).port;
      resolve();
    });
  });
});

afterAll(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

/* ══════════════════════════════════════════════════════════════════════════
   GROUP A — THE WRITER CONVERGES ON ONE ROW
   ══════════════════════════════════════════════════════════════════════════ */
describe("wave173 A · partner_team_members duplicate write path", () => {
  /* A unique user per test: these tests assert on ROW COUNTS, so they must not
     share a subject with each other or with the sandbox seed. */
  const USER_STALE = "u_w173_stale_cache";
  const USER_CONTROL = "u_w173_control_untouched";

  it("A0 (anti-vacuity) the table exists and the sandbox seeded real memberships", () => {
    const total = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM partner_team_members WHERE partner_id = ?`)
      .get(PARTNER_A) as { n: number };
    /* If the sandbox seeded nothing, A1's "exactly one row" would pass for the
       wrong reason. This pins that there is a populated table underneath. */
    expect(total.n).toBeGreaterThan(0);
    expect(activeRows(PARTNER_A, MANAGING_A).length).toBe(1);
  });

  it("A1 a DB row the RAM cache does not know about does NOT become a second row", () => {
    /* Reproduce the live precondition exactly: an active DB membership with no
       corresponding entry in the in-RAM `teamMembers` array. Inserted directly,
       because that is the only way to create the skew that a restart or the
       invite-redeem path creates in production. */
    const now = new Date().toISOString();
    rawDb()
      .prepare(
        `INSERT INTO partner_team_members
           (id, partner_id, user_id, sub_role, status, joined_at, removed_at, created_by, is_seed, updated_at)
         VALUES (?, ?, ?, 'associate', 'active', ?, NULL, 'u_system_seed', 0, ?)`,
      )
      .run("ptm_w173_preexisting", PARTNER_A, USER_STALE, now, now);

    expect(activeRows(PARTNER_A, USER_STALE).length).toBe(1);

    /* The RAM guard cannot see that row, so `add` proceeds and mints a fresh id.
       BEFORE the wave-173 write-path fix this produced a second active row —
       the live defect. AFTER it, `canonicalActiveTeamMemberId` resolves the
       existing row's id and the upsert converges onto it. */
    partnerTeamStore.add(PARTNER_A, USER_STALE, "bd", MANAGING_A);

    const rows = activeRows(PARTNER_A, USER_STALE);
    expect(rows.length).toBe(1);
    /* Convergence, not replacement: the SURVIVING row is the original one, so no
       id that another table might reference is orphaned. */
    expect(rows[0].id).toBe("ptm_w173_preexisting");
  });

  it("A2 the converged write still applies the update, so it is not a silent no-op", () => {
    /* A fix that made the second write vanish entirely would pass A1 and be
       wrong: `add` is also how a sub-role gets corrected. The upsert's DO UPDATE
       must still land. A1 wrote sub_role 'bd' over 'associate'. */
    const rows = activeRows(PARTNER_A, USER_STALE);
    expect(rows.length).toBe(1);
    expect(rows[0].sub_role).toBe("bd");
  });

  it("A3 repeating the write many times still yields exactly one row (idempotent)", () => {
    for (let i = 0; i < 5; i++) {
      partnerTeamStore.add(PARTNER_A, USER_STALE, "associate", MANAGING_A);
    }
    expect(activeRows(PARTNER_A, USER_STALE).length).toBe(1);
  });

  it("A4 a genuinely new member is still created — the fix does not block new rows", () => {
    expect(activeRows(PARTNER_A, USER_CONTROL).length).toBe(0);
    partnerTeamStore.add(PARTNER_A, USER_CONTROL, "associate", MANAGING_A);
    const rows = activeRows(PARTNER_A, USER_CONTROL);
    expect(rows.length).toBe(1);
    expect(rows[0].sub_role).toBe("associate");
  });

  it("A5 partner_team_members carries no money column, so a dedupe can move no figure", () => {
    const cols = (
      rawDb().prepare(`PRAGMA table_info('partner_team_members')`).all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(cols.length).toBeGreaterThan(0); // anti-vacuity
    const moneyish = cols.filter((c) => /minor|amount|currenc|fee|carry|nav|price|balance/i.test(c));
    expect(moneyish).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   GROUP B — THE CHECKLIST TELLS THE TRUTH OR REFUSES
   ══════════════════════════════════════════════════════════════════════════ */
describe("wave173 B · onboarding checklist false success", () => {
  it("B0 (precondition) partner_organizations really is empty for this partner", () => {
    const row = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM partner_organizations WHERE id = ?`)
      .get(PARTNER_A) as { n: number };
    /* The entire defect depends on there being no row to UPDATE. If a future
       wave builds the INSERT path this test turns red, which is correct — group
       B's premise will have changed and the refusal should no longer fire. */
    expect(row.n).toBe(0);
  });

  it("B1 a PATCH that stores nothing REFUSES instead of answering ok:true", async () => {
    const res = await call("PATCH", "/api/partner/onboarding/state", {
      userId: MANAGING_A,
      body: { billing_contact: true },
    });
    /* BEFORE the wave-173 fix this was 200 { ok: true, state: {...} } while the
       UPDATE matched zero rows. */
    expect(res.status).toBe(409);
    expect(res.body?.ok).toBeUndefined();
    expect(res.body?.error).toBe("ONBOARDING_STATE_NOT_STORABLE");
  });

  it("B2 the refusal carries the plain-language sentence, not just a code", async () => {
    const res = await call("PATCH", "/api/partner/onboarding/state", {
      userId: MANAGING_A,
      body: { team_invites: true },
    });
    expect(res.status).toBe(409);
    const msg = String(res.body?.message ?? "");
    expect(msg).toBe(PARTNER_ONBOARDING_STATE_NOT_STORABLE_COPY);
    /* Real prose, not a slug: a whole sentence, ending in a full stop, with no
       SCREAMING_SNAKE code and no internal table name leaked to the partner. */
    expect(msg.length).toBeGreaterThan(60);
    expect(msg).toMatch(/\.$/);
    expect(msg).not.toMatch(/[A-Z]{3,}_[A-Z]{3,}/);
    expect(msg.toLowerCase()).not.toContain("partner_organizations");
    expect(msg.toLowerCase()).not.toContain("onboarding_state");
    /* It must say the tick was NOT kept — that is the whole point of the fix. */
    expect(msg.toLowerCase()).toMatch(/not been kept|could not be saved/);
  });

  it("B3 the refusal wrote nothing, so it is honest in both directions", async () => {
    await call("PATCH", "/api/partner/onboarding/state", {
      userId: MANAGING_A,
      body: { sso_configured: true },
    });
    const row = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM partner_organizations WHERE id = ?`)
      .get(PARTNER_A) as { n: number };
    /* The fix must not have quietly created the row it refused over — R135.7's
       decision not to build the INSERT path still stands. */
    expect(row.n).toBe(0);
  });

  it("B4 the GET still answers, so the refusal breaks no read path", async () => {
    const res = await call("GET", "/api/partner/onboarding/state", { userId: MANAGING_A });
    expect(res.status).toBe(200);
    expect(res.body?.state).toBeDefined();
  });
});
