/**
 * WAVE 168 · ITEM A — R140.1: A SPONSORING PARTNER SEES THEIR OWN LPs' NAMES.
 *                            NOTHING WIDER.
 *
 * WHAT R140.1 DECIDED, AND WHY IT IS NARROW.
 * Wave 167 proved the audience rule works and then found that every own LP still
 * rendered as the identical string "Private Investor", so a partner searching an
 * LP by real name still read "No eligible contacts."
 * (`build_log/wave167/artefacts/BLOCKER_wave167_own_lp_names_masked.md`). The
 * owner ruled: **the partner typed those names in** — "Invite an LP" and "Commit
 * an LP to the cap table" both take a first name, a last name and an email
 * entered by the partner, and the partner holds the subscription agreement.
 * Masking a name back to the party who authored it is a defect, not privacy.
 *
 * THE FENCE IS EXACTLY ONE PREDICATE: `spv.sponsor_partner_id` matching the
 * viewing partner's organisation — the same fence `partner_own_lp_peers` already
 * uses and which wave 167's group B proved moves with the SPV. This file proves
 * the unmask NEVER travels further than that fence, and — critically — that it
 * does not travel with mere VISIBILITY: group N puts another partner's LP into
 * ALPHA's picker through a DIFFERENT enabled rule (`chapter_peer`) and proves the
 * row is present and STILL MASKED. A cross-partner control that relies on the
 * person being absent proves nothing about the naming rule.
 *
 * NOT AUTHORISED, AND ASSERTED HERE: another partner's LPs (N1/N2), another
 * partner's team (N3), the viewer's OWN team — held for the owner under R140.3 —
 * (N4), a founder's cap-table member (N5), a non-partner viewer (N6), an LP who
 * has EXPLICITLY opted out (N7, the resolver's opt-out still wins), and anything
 * that would widen the closed wave-144 key set (U5).
 *
 * The SACRED `server/lib/userPrivacyResolver.ts` is NOT edited by this wave. The
 * change is the CALLING CONTEXT in `server/commsStore.ts` only, and D1 asserts
 * that by reading the shipped resolver file: it still has no partner/SPV concept
 * at all.
 *
 * NEVER MUTATES data.db / test.db. This file writes only to the ordinary
 * in-memory test handle used by every other comms suite.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { installV14TestIdentity } from "./_v14TestIdentity";
import { getDb, rawDb } from "../db/connection";
import { registerCommsRoutes } from "../commsStore";
import { readRules, isAudienceRuleEnabled } from "../lib/commsAudienceRules";
import {
  partnerOwnLpPeerIds,
  partnerTeamPeerIds,
  resolvePartnerIdForUser,
} from "../lib/partnerDelegatedContext";
import { applyCommsDelegatedContextSchema } from "../lib/applyCommsDelegatedContextSchema";
import { writeUserPrivacy } from "../lib/userPrivacyResolver";

const ROOT = process.cwd();
const MASKED = "Private Investor";

/* ── the cast ─────────────────────────────────────────────────────────────── */
const ALPHA_ORG = "porg_w168_alpha";
const BRAVO_ORG = "porg_w168_bravo";
const ALPHA_GP = "u_w168_alpha_gp";
const ALPHA_MATE = "u_w168_alpha_mate";
const BRAVO_GP = "u_w168_bravo_gp";
const BRAVO_MATE = "u_w168_bravo_mate";
const ALPHA_SPV = "spv_w168_alpha";
const BRAVO_SPV = "spv_w168_bravo";
const LP_A1 = "u_w168_lp_a1";
const LP_A2 = "u_w168_lp_a2";
const LP_A3_OPTED_OUT = "u_w168_lp_a3_optout";
const LP_B1 = "u_w168_lp_b1";
const FOUNDER = "u_w168_founder";
const CAPTABLE_LP = "u_w168_captable_lp";
const OPERATING_CO = "co_w168_operating";
const PLAIN_INVESTOR = "u_w168_plain_investor";
const CHAPTER = "chap_w168_shared";

const NAMES: Record<string, string> = {
  [ALPHA_GP]: "Wave168 Alpha Principal",
  [ALPHA_MATE]: "Wave168 Alpha Colleague",
  [BRAVO_GP]: "Wave168 Bravo Principal",
  [BRAVO_MATE]: "Wave168 Bravo Colleague",
  [LP_A1]: "Wave168 Alpha LimitedPartner One",
  [LP_A2]: "Wave168 Alpha LimitedPartner Two",
  [LP_A3_OPTED_OUT]: "Wave168 Alpha LimitedPartner Three",
  [LP_B1]: "Wave168 Bravo LimitedPartner One",
  [FOUNDER]: "Wave168 Founder",
  [CAPTABLE_LP]: "Wave168 Cap Table Holder",
  [PLAIN_INVESTOR]: "Wave168 Plain Investor",
};

let app: Express;

/** THROWS on failure — a swallowed fixture error is a vacuous green. */
const run = (sql: string, ...args: unknown[]): void => {
  try {
    rawDb().prepare(sql).run(...(args as any[]));
  } catch (err) {
    throw new Error(`[w168 fixture] SQL failed: ${(err as Error).message}\nSQL: ${sql}`);
  }
};
const now = (): string => new Date().toISOString();

function seedUser(id: string, role: string): void {
  run(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, is_demo, deleted_at)
     VALUES (?, 'tenant_platform', ?, ?, ?, 0, NULL)`,
    id,
    `${id}@w168.test`,
    NAMES[id] ?? id,
    role,
  );
  try {
    run(
      `INSERT OR REPLACE INTO auth_users (id, email, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      id,
      `${id}@w168.test`,
      role,
      now(),
      now(),
    );
  } catch {
    /* auth_users shape differs across builds; users.role is the documented fallback. */
  }
}

function seedTeamMember(org: string, user: string): void {
  run(
    `INSERT OR REPLACE INTO partner_team_members
       (id, partner_id, user_id, sub_role, status, joined_at, removed_at, created_by, is_seed, updated_at)
     VALUES (?, ?, ?, 'managing', 'active', ?, NULL, 'u_w168', 0, ?)`,
    `ptm_${org}_${user}`,
    org,
    user,
    now(),
    now(),
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
    `W168 ${id}`,
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
    "u_w168",
    `hash_${spvId}_${investorId}`,
  );
}

/** A committed row on the SACRED `captable_commits` ledger. `amount`/`shares`
 *  are TEXT columns written as STRING literals — no Number()/parseInt/parseFloat
 *  touches a money value anywhere in this file. */
let capSeq = 968000;
function seedCapTableCommit(company: string, investor: string): void {
  capSeq += 1;
  run(
    `INSERT OR REPLACE INTO captable_commits
       (id, tenant_id, seq, ts, invitation_id, round_id, company_id, investor_id,
        amount, currency, shares, state, prev_hash, hash, deleted_at)
     VALUES (?, 'tenant_platform', ?, ?, ?, ?, ?, ?, '100000', 'USD', '1000',
             'committed', ?, ?, NULL)`,
    `cc_${company}_${investor}`,
    capSeq,
    now(),
    `inv_${company}_${investor}`,
    `round_${company}`,
    company,
    investor,
    "0000000000000000000000000000000000000000000000000000000000000000",
    `hash_${company}_${investor}`,
  );
}

/** An ACTIVE chapter membership — the vehicle that makes a person a picker ROW
 *  without making them an own LP. This is what turns the cross-partner control
 *  from "absent" into "present and still masked". */
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

const asUser = (r: request.Test, id: string, role = "partner") =>
  r.set("x-user-id", id).set("x-actor-user-id", id).set("x-role", role);

type Entry = { id: string; legalName: string; visibility?: Record<string, unknown>; roles?: unknown; isPrivate?: boolean };

async function directoryFor(as: string, role = "partner"): Promise<Entry[]> {
  const res = await asUser(request(app).get("/api/comms/users"), as, role);
  expect(res.status).toBe(200);
  return res.body as Entry[];
}
const entryFor = (rows: Entry[], id: string): Entry | undefined => rows.find((r) => r.id === id);
const labelFor = (rows: Entry[], id: string): string | undefined => entryFor(rows, id)?.legalName;

beforeAll(async () => {
  getDb();
  applyCommsDelegatedContextSchema(rawDb() as any);
  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: false });
  registerCommsRoutes(app);

  seedUser(ALPHA_GP, "partner");
  seedUser(ALPHA_MATE, "partner");
  seedUser(BRAVO_GP, "partner");
  seedUser(BRAVO_MATE, "partner");
  seedTeamMember(ALPHA_ORG, ALPHA_GP);
  seedTeamMember(ALPHA_ORG, ALPHA_MATE);
  seedTeamMember(BRAVO_ORG, BRAVO_GP);
  seedTeamMember(BRAVO_ORG, BRAVO_MATE);

  seedUser(LP_A1, "investor");
  seedUser(LP_A2, "investor");
  seedUser(LP_A3_OPTED_OUT, "investor");
  seedUser(LP_B1, "investor");
  seedSpv(ALPHA_SPV, ALPHA_ORG, ALPHA_GP);
  seedSpv(BRAVO_SPV, BRAVO_ORG, BRAVO_GP);
  seedSubscription(ALPHA_SPV, LP_A1);
  seedSubscription(ALPHA_SPV, LP_A2);
  seedSubscription(ALPHA_SPV, LP_A3_OPTED_OUT);
  seedSubscription(BRAVO_SPV, LP_B1);

  /* The EXPLICIT opt-out, written through the resolver's OWN public writer —
     never by poking its table. R140 unmasks a name the partner authored; it does
     not overrule a person who has actively said no. */
  writeUserPrivacy(LP_A3_OPTED_OUT, { visibleToCoMembers: false, visibleInCollectiveDirectory: false });

  /* A founder's OPERATING-company cap table: protected by notSpvBackedSql, and
     its holder must stay masked to a partner. */
  seedUser(FOUNDER, "founder");
  seedUser(CAPTABLE_LP, "investor");
  run(
    `INSERT OR REPLACE INTO companies (id, tenant_id, name, is_demo, deleted_at)
     VALUES (?, 'tenant_platform', ?, 0, NULL)`,
    OPERATING_CO,
    "W168 Operating Co",
  );
  seedCapTableCommit(OPERATING_CO, FOUNDER);
  seedCapTableCommit(OPERATING_CO, CAPTABLE_LP);

  /* A plain investor with no partner record at all — the "who is even asking"
     fence. Given the same shared chapter so BOTH the presence and the masking of
     the rows below are observable for a non-partner viewer too. */
  seedUser(PLAIN_INVESTOR, "investor");

  /* THE SHARED CHAPTER. ALPHA's principal, BRAVO's LP, BRAVO's colleague, the
     founder's cap-table holder and the plain investor all sit in it, so every
     "still masked" claim below is made about a row that IS on the payload. */
  for (const u of [ALPHA_GP, BRAVO_GP, BRAVO_MATE, LP_B1, CAPTABLE_LP, FOUNDER, PLAIN_INVESTOR, LP_A1]) {
    seedChapterMembership(CHAPTER, u);
  }

  /* The rule under test must actually be ON, or every claim below is vacuous. */
  readRules();
  run(
    `UPDATE comms_audience_rules
        SET enabled = 1, requires_owner_decision = 0
      WHERE rule_key = 'partner_own_lp_peers'`,
  );
});

/* ══════════════════════════════════════════════════════════════════════════════
   GROUP U — THE DEFECT R140.1 REMOVES
   ══════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 168 · U — a sponsoring partner reads their own LPs by name", () => {
  it("U0 ANTI-VACUITY: the rule is ON, the fixture is real, and the fence resolves", () => {
    expect(isAudienceRuleEnabled("partner_own_lp_peers", "partner")).toBe(true);
    expect(resolvePartnerIdForUser(ALPHA_GP)).toBe(ALPHA_ORG);
    expect(resolvePartnerIdForUser(BRAVO_GP)).toBe(BRAVO_ORG);
    const own = partnerOwnLpPeerIds(ALPHA_GP);
    expect(own).toContain(LP_A1);
    expect(own).toContain(LP_A2);
    expect(own).not.toContain(LP_B1);
  });

  it("U1 the served payload carries the LP's REAL name, not the masked label", async () => {
    const rows = await directoryFor(ALPHA_GP);
    expect(labelFor(rows, LP_A1)).toBe(NAMES[LP_A1]);
    expect(labelFor(rows, LP_A2)).toBe(NAMES[LP_A2]);
  });

  it("U2 the rows are DISTINGUISHABLE — the usability defect is gone", async () => {
    const rows = await directoryFor(ALPHA_GP);
    expect(labelFor(rows, LP_A1)).not.toBe(labelFor(rows, LP_A2));
    expect(labelFor(rows, LP_A1)).not.toBe(MASKED);
    expect(labelFor(rows, LP_A2)).not.toBe(MASKED);
  });

  it("U3 a name search over the served payload FINDS the LP (the live gesture)", async () => {
    const rows = await directoryFor(ALPHA_GP);
    const q = NAMES[LP_A1].toLowerCase();
    const hits = rows.filter((r) => (r.legalName ?? "").toLowerCase().includes(q));
    expect(hits.map((h) => h.id)).toEqual([LP_A1]);
  });

  it("U4 the unmask MOVES WITH THE SPV — repointing the sponsor moves the name", async () => {
    const before = await directoryFor(ALPHA_GP);
    expect(labelFor(before, LP_A2)).toBe(NAMES[LP_A2]);

    run(`UPDATE spv SET sponsor_partner_id = ? WHERE id = ?`, BRAVO_ORG, ALPHA_SPV);
    try {
      const alpha = await directoryFor(ALPHA_GP);
      /* ALPHA no longer sponsors: the LP is neither a peer nor a name. */
      expect(entryFor(alpha, LP_A2)?.legalName ?? MASKED).toBe(MASKED);
      const bravo = await directoryFor(BRAVO_GP);
      expect(labelFor(bravo, LP_A2)).toBe(NAMES[LP_A2]);
    } finally {
      run(`UPDATE spv SET sponsor_partner_id = ? WHERE id = ?`, ALPHA_ORG, ALPHA_SPV);
    }

    const after = await directoryFor(ALPHA_GP);
    expect(labelFor(after, LP_A2)).toBe(NAMES[LP_A2]);
  });

  it("U5 WAVE 144 STILL HOLDS: the key set is CLOSED and carries no positions", async () => {
    const rows = await directoryFor(ALPHA_GP);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(
        ["id", "isPrivate", "legalName", "roles", "visibility"].sort(),
      );
      expect(r).not.toHaveProperty("capTables");
      expect(r).not.toHaveProperty("location");
      expect(r).not.toHaveProperty("capavateAngelNetwork");
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   GROUP N — THE FENCE. EVERY ONE OF THESE IS "PRESENT AND STILL MASKED".
   ══════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 168 · N — nothing wider than the sponsor fence is unmasked", () => {
  it("N0 ANTI-VACUITY: the cross-partner rows really ARE on ALPHA's payload", async () => {
    const rows = await directoryFor(ALPHA_GP);
    /* Via the pre-existing, separately-enabled `chapter_peer` rule — so the
       masking assertions that follow are about the NAMING rule, not absence. */
    expect(entryFor(rows, LP_B1)).toBeTruthy();
    expect(entryFor(rows, BRAVO_MATE)).toBeTruthy();
    expect(entryFor(rows, CAPTABLE_LP)).toBeTruthy();
  });

  it("N1 ANOTHER PARTNER'S LP is present and STILL MASKED", async () => {
    const rows = await directoryFor(ALPHA_GP);
    expect(labelFor(rows, LP_B1)).toBe(MASKED);
    expect(rows.some((r) => r.legalName === NAMES[LP_B1])).toBe(false);
  });

  it("N2 and in the OTHER DIRECTION — BRAVO cannot read ALPHA's LP name", async () => {
    const rows = await directoryFor(BRAVO_GP);
    expect(labelFor(rows, LP_A1)).toBe(MASKED);
    expect(rows.some((r) => r.legalName === NAMES[LP_A1])).toBe(false);
    /* Anti-vacuity for this direction: BRAVO CAN read their own LP. */
    expect(labelFor(rows, LP_B1)).toBe(NAMES[LP_B1]);
  });

  it("N3 ANOTHER PARTNER'S TEAM MEMBER is present and STILL MASKED", async () => {
    const rows = await directoryFor(ALPHA_GP);
    expect(labelFor(rows, BRAVO_MATE)).toBe(MASKED);
  });

  it("N4 the viewer's OWN TEAM MEMBER stays masked — R140.3 is held, not widened", async () => {
    const rows = await directoryFor(ALPHA_GP);
    expect(partnerTeamPeerIds(ALPHA_GP)).toContain(ALPHA_MATE);
    expect(labelFor(rows, ALPHA_MATE)).toBe(MASKED);
  });

  it("N5 a FOUNDER'S CAP-TABLE HOLDER is present and STILL MASKED to a partner", async () => {
    const rows = await directoryFor(ALPHA_GP);
    expect(labelFor(rows, CAPTABLE_LP)).toBe(MASKED);
    expect(labelFor(rows, FOUNDER)).toBe(MASKED);
  });

  it("N6 a NON-PARTNER viewer gains no name — the unmask is not ambient", async () => {
    const rows = await directoryFor(PLAIN_INVESTOR, "investor");
    expect(resolvePartnerIdForUser(PLAIN_INVESTOR)).toBeNull();
    expect(entryFor(rows, LP_A1)).toBeTruthy();
    expect(labelFor(rows, LP_A1)).toBe(MASKED);
  });

  it("N7 an own LP who EXPLICITLY opted out is STILL masked — consent wins", async () => {
    const rows = await directoryFor(ALPHA_GP);
    expect(partnerOwnLpPeerIds(ALPHA_GP)).toContain(LP_A3_OPTED_OUT);
    expect(labelFor(rows, LP_A3_OPTED_OUT)).toBe(MASKED);
    expect(entryFor(rows, LP_A3_OPTED_OUT)?.isPrivate).toBe(true);
  });

  it("N8 CONTAINMENT: the unmasked set is exactly SELF ∪ own LPs, by set difference", async () => {
    const rows = await directoryFor(ALPHA_GP);
    const unmasked = rows
      .filter((r) => r.legalName !== MASKED)
      .map((r) => r.id)
      .sort();
    const allowed = new Set<string>([ALPHA_GP, ...partnerOwnLpPeerIds(ALPHA_GP)]);
    /* The opted-out LP is allowed to be masked; nobody outside `allowed` may be
       unmasked. This is a set-difference claim, not a spot check. */
    expect(unmasked.filter((id) => !allowed.has(id))).toEqual([]);
    expect(unmasked).toContain(LP_A1);
    expect(unmasked).toContain(LP_A2);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
   GROUP D — WHERE THE CHANGE LIVES. THE SACRED RESOLVER IS UNTOUCHED.
   ══════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 168 · D — the sacred resolver has no partner concept", () => {
  const stripComments = (src: string): string => {
    let out = "";
    let i = 0;
    let mode: "code" | "line" | "block" | "s" | "d" | "t" = "code";
    while (i < src.length) {
      const c = src[i];
      const n = src[i + 1];
      if (mode === "code") {
        if (c === "/" && n === "/") { mode = "line"; i += 2; continue; }
        if (c === "/" && n === "*") { mode = "block"; i += 2; continue; }
        if (c === "'") { mode = "s"; out += c; i += 1; continue; }
        if (c === '"') { mode = "d"; out += c; i += 1; continue; }
        if (c === "`") { mode = "t"; out += c; i += 1; continue; }
        out += c; i += 1; continue;
      }
      if (mode === "line") { if (c === "\n") { mode = "code"; out += c; } i += 1; continue; }
      if (mode === "block") { if (c === "*" && n === "/") { mode = "code"; i += 2; continue; } i += 1; continue; }
      /* inside a string literal: keep it, honour escapes, and NEVER let an
         unterminated quote swallow the rest of the file (a newline in a single-
         or double-quoted literal ends it). */
      if (c === "\\") { out += c + (n ?? ""); i += 2; continue; }
      if ((mode === "s" && c === "'") || (mode === "d" && c === '"') || (mode === "t" && c === "`")) {
        mode = "code"; out += c; i += 1; continue;
      }
      if ((mode === "s" || mode === "d") && c === "\n") { mode = "code"; out += c; i += 1; continue; }
      out += c; i += 1; continue;
    }
    return out;
  };

  it("D0 the stripper actually strips — and does not swallow the file", () => {
    const probe = stripComments(
      "const a = 1; // GONE_LINE\n/* GONE_BLOCK */ const s = '// KEPT_IN_STRING';\nconst t = `/* KEPT_IN_TEMPLATE */`;\nconst apostrophe = \"it's fine\";\nconst tail = 2;",
    );
    expect(probe).not.toContain("GONE_LINE");
    expect(probe).not.toContain("GONE_BLOCK");
    expect(probe).toContain("KEPT_IN_STRING");
    expect(probe).toContain("KEPT_IN_TEMPLATE");
    expect(probe).toContain("const tail = 2");
  });

  it("D1 `userPrivacyResolver.ts` mentions no partner, SPV or sponsor concept", () => {
    const code = stripComments(readFileSync(join(ROOT, "server/lib/userPrivacyResolver.ts"), "utf8"));
    for (const needle of ["sponsor_partner_id", "spv_subscription", "partnerOwnLpPeerIds", "partner_team_members"]) {
      expect(code.includes(needle)).toBe(false);
    }
    /* And the five contexts are still exactly the five. */
    expect(code).toContain("collectiveDirectory");
    expect(code).toContain("chapterRoster");
  });

  it("D2 the unmask is asserted PER FUNCTION BODY of the directory handler, not by whole-file grep", () => {
    /* A whole-file grep over `commsStore.ts` is a false fence: the file contains
       many handlers and the wave-167 audience branch already names
       `partnerOwnAudienceIds`. So the handler body is extracted by brace balance
       and the claim is made about THAT text only. */
    const code = stripComments(readFileSync(join(ROOT, "server/commsStore.ts"), "utf8"));
    const marker = `app.get("/api/comms/users"`;
    const start = code.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const open = code.indexOf("{", code.indexOf("=>", start));
    expect(open).toBeGreaterThan(-1);
    let depth = 0;
    let end = -1;
    for (let i = open; i < code.length; i += 1) {
      if (code[i] === "{") depth += 1;
      else if (code[i] === "}") {
        depth -= 1;
        if (depth === 0) { end = i; break; }
      }
    }
    expect(end).toBeGreaterThan(open);
    const body = code.slice(open, end + 1);

    /* The naming fence inside THIS handler is the own-LP source and nothing else. */
    expect(body).toContain("partnerOwnLpPeerIds");
    /* The withdrawn R108 resolver is NOT named in the naming decision. */
    expect(body).not.toContain("delegatedCompanyPeopleIds(viewerId)\n        .map");
    /* Wave 144's removals stay removed inside this handler. */
    expect(body).not.toContain("capTables: u.capTables");
    expect(body).not.toContain("location: u.location");
    expect(body).not.toContain("capavateAngelNetwork");
  });
});
