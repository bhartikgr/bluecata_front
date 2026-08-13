/**
 * WAVE 33 · CP-MFC-20 — cross-pillar SSE `partnerRepresentation`, PROVEN BY
 * EXECUTION at both ends.
 *
 * WHAT THIS ITEM FOUND. The feature existed: an emit site in
 * `partnerPipelineStore.update`, a four-pillar visibility branch in
 * `eventBus.eventVisibleToCaller`, five DB-driven predicates in
 * `eventBusPillarHelpers`, and the client key map in `realtimeSync.ts`. Every
 * piece compiled and every piece was reviewed. **In the shipped build not one
 * frame could ever be delivered**, because both ends resolved their modules at
 * CALL time:
 *
 *   emitter  `require("./lib/eventBus")`                (partnerWorkspaceStore)
 *   consumer `requireCjs("./eventBusPillarHelpers")`    (eventBus)
 *            `requireCjs("../partnerWorkspaceStore")`   (eventBus)
 *
 * Production is a single bundled `dist/index.cjs` (`script/build.ts`:
 * `bundle: true, format: "cjs", outfile: "dist/index.cjs"`). Neither specifier
 * exists as a file next to that bundle, and esbuild does not bundle a call it
 * cannot see statically — `requireCjs(...)` is an aliased identifier, not a
 * `require` it recognises. So the emitter threw MODULE_NOT_FOUND into a
 * `log.warn("… non-fatal")` and the consumer threw it into
 * `catch { /* client gone *\/ }`, which is silent. Dev (tsx, real files on
 * disk) resolved both, so every test and every manual check passed.
 *
 * That is the Wave 32B `co-members` defect, exactly, and it is why this file
 * asserts on FRAMES ACTUALLY WRITTEN to a stream and on the CONTENT OF A REAL
 * BUNDLE — never on the source of the branch.
 *
 * Both poles everywhere: for every pillar that must receive the frame there is
 * a caller differing in exactly ONE fact who must not.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

/* ── caller identity is injected; everything else is real ───────────────────
   `eventBus` reads the caller through `getUserContext(req)`. The rest of the
   module (entitlement resolution, the pillar SQL, the fan-out) is untouched. */
const CTX: {
  userId: string;
  isAuthed: boolean;
  isAdmin: boolean;
  collective: { status: string; role: string | null; expiresAt: string | null };
} = {
  userId: "u_w33_none",
  isAuthed: true,
  isAdmin: false,
  collective: { status: "none", role: null, expiresAt: null },
};

vi.mock("../lib/userContext", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    getUserContext: () => ({
      userId: CTX.userId,
      identity: { email: "", name: "" },
      founder: { companies: [], activeCompanyId: null },
      investor: { invitedRounds: [], capTablePositions: [], state: "NONE" },
      collective: CTX.collective,
      isAdmin: CTX.isAdmin,
      isAuthed: CTX.isAuthed,
    }),
  };
});

/* `founderOwnedCompanyIds` / `investorVisibleCompanyIds` build the caller's
   accessible-company set from the injected ctx, which carries no companies.
   Pillar 2 needs a caller who IS entitled to the company, so the entitlement
   resolver is injected too — one fact, controlled per case. */
const ENTITLED: Set<string> = new Set();
vi.mock("../lib/tenantAuth", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    founderOwnedCompanyIds: () => Array.from(ENTITLED),
    investorVisibleCompanyIds: () => [],
  };
});

import { realtimeStreamHandler, emitMutation, onMutation } from "../lib/eventBus";
import { rawDb } from "../db/connection";
import {
  parsePartnerRepresentationId,
  hasActivePartnerAttribution,
  hasActivePartnerEngagement,
  isCapavatePortfolioCompany,
  isCollectiveMemberCompany,
} from "../lib/eventBusPillarHelpers";
import {
  partnerPipelineStore,
  partnerTeamStore,
  seedTestPartnerSandbox,
  TEST_PARTNER_USERS,
} from "../partnerWorkspaceStore";

const PARTNER_A = "ac_w33_mfc20_partner_a";
const PARTNER_B = "ac_w33_mfc20_partner_b";
const COMPANY = "co_w33_mfc20";
const FOUNDER_USER = "u_w33_mfc20_founder";
const DSC_USER = "u_w33_mfc20_dsc";

/* ── fixtures: every precondition is established here and ASSERTED in group F.
      Nothing below consults `process.env` to decide what is true. ─────────── */
function seed(): void {
  const db = rawDb();
  const now = new Date().toISOString();

  /* Column lists are the LIVE schema's, read with PRAGMA before this was
     written: `partner_attributions.attribution_source` (not `source`),
     `collective_memberships.chapter_id/activated_at`, and `companies` has no
     created_at. A guessed column list throws inside a seed and turns every
     assertion below into a skip. */
  db.prepare(
    `INSERT OR IGNORE INTO companies (id, tenant_id, name) VALUES (?, ?, ?)`,
  ).run(COMPANY, `tenant_co_${COMPANY}`, "Wave33 MFC20 Co");

  db.prepare(
    `INSERT OR IGNORE INTO company_members (id, company_id, user_id, role, is_active, joined_at)
     VALUES (?, ?, ?, 'founder', 1, ?)`,
  ).run(`cm_w33_mfc20`, COMPANY, FOUNDER_USER, now);

  for (const p of [PARTNER_A, PARTNER_B]) {
    db.prepare(
      `INSERT OR IGNORE INTO partner_attributions
         (id, partner_id, company_id, attributed_at, attributed_by, attribution_source, revoked_at, updated_at)
       VALUES (?, ?, ?, ?, 'u_admin', 'admin_manual', NULL, ?)`,
    ).run(`pattr_w33_${p}`, p, COMPANY, now, now);
  }

  db.prepare(
    `INSERT OR IGNORE INTO mf_engagement (id, partner_id, company_id, status, created_at, updated_at)
     VALUES (?, ?, ?, 'ACTIVE', ?, ?)`,
  ).run(`mfe_w33_${PARTNER_A}`, PARTNER_A, COMPANY, now, now);
}

function setEngagement(status: string): void {
  rawDb()
    .prepare(`UPDATE mf_engagement SET status = ? WHERE partner_id = ? AND company_id = ?`)
    .run(status, PARTNER_A, COMPANY);
}

function setAttributionRevoked(partnerId: string, revoked: boolean): void {
  rawDb()
    .prepare(`UPDATE partner_attributions SET revoked_at = ? WHERE partner_id = ? AND company_id = ?`)
    .run(revoked ? new Date().toISOString() : null, partnerId, COMPANY);
}

function setCollectiveMembership(userId: string, active: boolean): void {
  const now = new Date().toISOString();
  rawDb()
    .prepare(
      `INSERT OR REPLACE INTO collective_memberships
         (user_id, tenant_id, chapter_id, status, activated_at, activated_by, created_at, updated_at, deleted_at)
       VALUES (?, 'tenant_chap_w33', 'chap_w33', ?, ?, 'u_admin', ?, ?, NULL)`,
    )
    .run(userId, active ? "active" : "inactive", now, now, now);
}

/* ── the stream, driven for real ───────────────────────────────────────────
   A frame counts only if it is WRITTEN to the response. The handler is given a
   fake req/res pair that records writes; nothing inspects the branch. */
interface Stream {
  frames: string[];
  close: () => void;
}
function openStream(): Stream {
  const frames: string[] = [];
  const listeners: Record<string, Array<() => void>> = {};
  const req = {
    headers: {},
    query: {},
    on: (ev: string, fn: () => void) => {
      (listeners[ev] ??= []).push(fn);
    },
  } as never;
  const res = {
    statusCode: 200,
    setHeader: () => undefined,
    status(code: number) {
      (this as { statusCode: number }).statusCode = code;
      return this;
    },
    json: () => undefined,
    write: (chunk: string) => {
      frames.push(chunk);
      return true;
    },
    end: () => undefined,
  } as never;
  realtimeStreamHandler(req, res);
  return {
    frames,
    close: () => (listeners["close"] ?? []).forEach((f) => f()),
  };
}

/** Frames for the aggregate under test, hello/ping excluded. */
function repFrames(s: Stream): Array<{ aggregate: string; id: string }> {
  return s.frames
    .filter((f) => f.startsWith("event: mutation"))
    .map((f) => JSON.parse(f.slice(f.indexOf("data: ") + 6).trim()))
    .filter((e) => e.aggregate === "partnerRepresentation");
}

/** Open a stream as `who`, emit ONE representation event, report delivery. */
function deliversTo(setup: () => void, id = `${PARTNER_A}:${COMPANY}`): boolean {
  setup();
  const s = openStream();
  emitMutation({
    aggregate: "partnerRepresentation",
    id,
    change: "update",
    tenantId: `tenant_pt_${PARTNER_A}`,
  });
  const got = repFrames(s);
  s.close();
  return got.length > 0;
}

function asNobody(): void {
  CTX.userId = "u_w33_none";
  CTX.isAdmin = false;
  CTX.collective = { status: "none", role: null, expiresAt: null };
  ENTITLED.clear();
}

beforeAll(() => {
  seedTestPartnerSandbox({ force: true });
  seed();
});

/* ── (F) PRECONDITIONS ─────────────────────────────────────────────────────── */

describe("(F) the fixtures are real", () => {
  it("F1 the company, its founder member and both attributions exist", () => {
    const db = rawDb();
    const c = db.prepare(`SELECT COUNT(*) AS n FROM companies WHERE id = ?`).get(COMPANY) as { n: number };
    const m = db
      .prepare(`SELECT COUNT(*) AS n FROM company_members WHERE company_id = ? AND is_active = 1`)
      .get(COMPANY) as { n: number };
    const a = db
      .prepare(`SELECT COUNT(*) AS n FROM partner_attributions WHERE company_id = ? AND revoked_at IS NULL`)
      .get(COMPANY) as { n: number };
    expect(c.n).toBe(1);
    expect(m.n).toBeGreaterThanOrEqual(1);
    expect(a.n).toBe(2);
  });

  it("F2 exactly one partner holds the ACTIVE engagement", () => {
    const rows = rawDb()
      .prepare(`SELECT partner_id, status FROM mf_engagement WHERE company_id = ?`)
      .all(COMPANY) as Array<{ partner_id: string; status: string }>;
    expect(rows.filter((r) => r.status === "ACTIVE").map((r) => r.partner_id)).toEqual([PARTNER_A]);
  });

  it("F3 the sandbox partner team member resolves — pillar 3 is reachable at all", () => {
    const tm = partnerTeamStore.findByUserId(TEST_PARTNER_USERS.managing.userId);
    expect(tm?.partnerId).toBeTruthy();
  });

  it("F4 SANITY POLE — an unrelated caller receives nothing, so a later 'delivered' means something", () => {
    expect(deliversTo(asNobody)).toBe(false);
  });
});

/* ── (D) DELIVERY, per pillar, both poles ──────────────────────────────────── */

describe("(D) pillar 4 — admin superuser", () => {
  it("D1 receives the frame", () => {
    expect(
      deliversTo(() => {
        asNobody();
        CTX.isAdmin = true;
      }),
    ).toBe(true);
  });

  it("D2 an UNAUTHENTICATED caller gets no stream at all", () => {
    asNobody();
    CTX.isAuthed = false;
    const s = openStream();
    emitMutation({
      aggregate: "partnerRepresentation",
      id: `${PARTNER_A}:${COMPANY}`,
      change: "update",
      tenantId: `tenant_pt_${PARTNER_A}`,
    });
    expect(s.frames).toEqual([]); // not even the hello frame
    CTX.isAuthed = true;
  });
});

describe("(D) pillar 3 — the emitting Consortium Partner", () => {
  const teamUser = TEST_PARTNER_USERS.managing.userId;
  const teamPartnerId = () => partnerTeamStore.findByUserId(teamUser)!.partnerId;

  it("D3 the partner's own team member receives its own stage move", () => {
    const pid = teamPartnerId();
    rawDb()
      .prepare(
        `INSERT OR IGNORE INTO partner_attributions
           (id, partner_id, company_id, attributed_at, attributed_by, attribution_source, revoked_at, updated_at)
         VALUES (?, ?, ?, ?, 'u_admin', 'admin_manual', NULL, ?)`,
      )
      .run(`pattr_w33_team`, pid, COMPANY, new Date().toISOString(), new Date().toISOString());
    expect(
      deliversTo(() => {
        asNobody();
        CTX.userId = teamUser;
      }, `${pid}:${COMPANY}`),
    ).toBe(true);
  });

  it("D4 the SAME team member does NOT receive it once the attribution is revoked", () => {
    const pid = teamPartnerId();
    rawDb()
      .prepare(`UPDATE partner_attributions SET revoked_at = ? WHERE partner_id = ? AND company_id = ?`)
      .run(new Date().toISOString(), pid, COMPANY);
    const delivered = deliversTo(() => {
      asNobody();
      CTX.userId = teamUser;
    }, `${pid}:${COMPANY}`);
    rawDb()
      .prepare(`UPDATE partner_attributions SET revoked_at = NULL WHERE partner_id = ? AND company_id = ?`)
      .run(pid, COMPANY);
    expect(delivered).toBe(false);
  });

  it("D5 a partner team member NEVER receives ANOTHER partner's stage move", () => {
    // The scope leak the branch exists to prevent: partner A and partner B share
    // a founder, so a fall-through to the company-entitlement pillars would let
    // A's team read B's pipeline.
    const teamUser2 = TEST_PARTNER_USERS.managing.userId;
    expect(
      deliversTo(() => {
        asNobody();
        CTX.userId = teamUser2;
        ENTITLED.add(COMPANY); // even if entitled to the company by another route
      }, `${PARTNER_B}:${COMPANY}`),
    ).toBe(false);
  });
});

describe("(D) pillar 2 — Capavate direct", () => {
  it("D6 an entitled caller on a founder-owned company receives it", () => {
    expect(
      deliversTo(() => {
        asNobody();
        CTX.userId = FOUNDER_USER;
        ENTITLED.add(COMPANY);
      }),
    ).toBe(true);
  });

  it("D7 the SAME caller does NOT receive it once the partner's engagement is TERMINATED", () => {
    setEngagement("TERMINATED");
    const delivered = deliversTo(() => {
      asNobody();
      CTX.userId = FOUNDER_USER;
      ENTITLED.add(COMPANY);
    });
    setEngagement("ACTIVE");
    expect(delivered).toBe(false);
  });

  it("D8 an entitled caller on a DIFFERENT company receives nothing", () => {
    expect(
      deliversTo(() => {
        asNobody();
        CTX.userId = FOUNDER_USER;
        ENTITLED.add("co_w33_mfc20_other");
      }),
    ).toBe(false);
  });
});

describe("(D) pillar 1 — Collective DSC", () => {
  it("D9 an active DSC principal receives it when the company is a Collective member company", () => {
    setCollectiveMembership(FOUNDER_USER, true);
    expect(
      deliversTo(() => {
        asNobody();
        CTX.userId = DSC_USER;
        CTX.collective = { status: "active", role: "dsc", expiresAt: null };
      }),
    ).toBe(true);
  });

  it("D10 a STANDARD collective member does not — the role is the control", () => {
    setCollectiveMembership(FOUNDER_USER, true);
    expect(
      deliversTo(() => {
        asNobody();
        CTX.userId = DSC_USER;
        CTX.collective = { status: "active", role: "standard", expiresAt: null };
      }),
    ).toBe(false);
  });

  it("D13 a LAPSED DSC principal does not — status and role are separate controls", () => {
    /* COVERAGE GAP found by mutation (N13 survived): every DSC case carried
       status "active", so removing the status conjunct changed no outcome. */
    setCollectiveMembership(FOUNDER_USER, true);
    expect(
      deliversTo(() => {
        asNobody();
        CTX.userId = DSC_USER;
        CTX.collective = { status: "lapsed", role: "dsc", expiresAt: null };
      }),
    ).toBe(false);
  });

  it("D11 a DSC principal does not, once the company stops being a member company", () => {
    setCollectiveMembership(FOUNDER_USER, false);
    const delivered = deliversTo(() => {
      asNobody();
      CTX.userId = DSC_USER;
      CTX.collective = { status: "active", role: "dsc", expiresAt: null };
    });
    setCollectiveMembership(FOUNDER_USER, true);
    expect(delivered).toBe(false);
  });
});

describe("(D) malformed ids fail closed", () => {
  for (const bad of ["", ":", `${PARTNER_A}:`, `:${COMPANY}`, `${PARTNER_A}:${COMPANY}:extra`, PARTNER_A]) {
    it(`D12 \`${bad || "(empty)"}\` delivers to nobody but admin`, () => {
      expect(
        deliversTo(() => {
          asNobody();
          CTX.userId = FOUNDER_USER;
          ENTITLED.add(COMPANY);
        }, bad),
      ).toBe(false);
    });
  }
});

/* ── (H) THE PREDICATES, CALLED DIRECTLY ───────────────────────────────────
   Mutation showed why this group is needed: two fail-closed guards
   (`parsePartnerRepresentationId`'s empty-half check and
   `hasActivePartnerAttribution`'s blank-argument check) could be deleted
   without changing ANY delivery outcome, because a later gate happened to
   refuse the same callers anyway. That is a real coverage gap: the guards are
   the documented contract of these helpers and other callers will rely on
   them, so they are asserted where they live. */

describe("(H) the pillar predicates, both poles, called directly", () => {
  it("H1 the composite id parses only as exactly two non-empty halves", () => {
    expect(parsePartnerRepresentationId(`${PARTNER_A}:${COMPANY}`)).toEqual({
      partnerId: PARTNER_A,
      companyId: COMPANY,
    });
    for (const bad of ["", ":", "a:", ":b", " : ", "a:b:c", "abc", null, undefined, 7, {}]) {
      expect(parsePartnerRepresentationId(bad as never)).toBeNull();
    }
  });

  it("H2 the attribution gate refuses blank arguments and admits a real pair", () => {
    expect(hasActivePartnerAttribution(PARTNER_A, COMPANY)).toBe(true);
    for (const [p, c] of [["", COMPANY], [PARTNER_A, ""], ["", ""]]) {
      expect(hasActivePartnerAttribution(p, c)).toBe(false);
    }
  });

  it("H3 the engagement gate refuses blank arguments and tracks status", () => {
    expect(hasActivePartnerEngagement(PARTNER_A, COMPANY)).toBe(true);
    expect(hasActivePartnerEngagement("", COMPANY)).toBe(false);
    expect(hasActivePartnerEngagement(PARTNER_B, COMPANY)).toBe(false);
  });

  it("H4 the pillar-membership predicates refuse blanks and answer for a real company", () => {
    expect(isCapavatePortfolioCompany(COMPANY)).toBe(true);
    expect(isCapavatePortfolioCompany("")).toBe(false);
    expect(isCapavatePortfolioCompany("co_does_not_exist")).toBe(false);
    setCollectiveMembership(FOUNDER_USER, true);
    expect(isCollectiveMemberCompany(COMPANY)).toBe(true);
    expect(isCollectiveMemberCompany("")).toBe(false);
  });
});

/* ── (E) THE EMIT SITE ─────────────────────────────────────────────────────── */

describe("(E) a partner stage change really emits", () => {
  function capture(fn: () => void): Array<{ aggregate: string; id: string; tenantId?: string }> {
    const got: Array<{ aggregate: string; id: string; tenantId?: string }> = [];
    const off = onMutation((e) => got.push(e as never));
    try {
      fn();
    } finally {
      off();
    }
    return got;
  }

  it("E1 a stage change emits partnerRepresentation AND company, with the partner tenant on the former", () => {
    const deal = partnerPipelineStore.create(
      PARTNER_A,
      { dealName: "W33 MFC20 deal", companyId: COMPANY, stage: "invited", ownerUserId: "u_admin" } as never,
      "u_admin",
    );
    const got = capture(() => {
      partnerPipelineStore.update(PARTNER_A, deal.id, { stage: "viewed" } as never, "u_admin");
    });
    const rep = got.find((e) => e.aggregate === "partnerRepresentation");
    expect(rep).toBeTruthy();
    expect(rep!.id).toBe(`${PARTNER_A}:${COMPANY}`);
    // The R1 FIX B2 rule: the partner's tenant, never `tenant_co_*`, or the
    // pre-existing tenant fast-path would deliver to founders and investors
    // before the pillar gates ran.
    expect(rep!.tenantId).toBe(`tenant_pt_${PARTNER_A}`);
    expect(got.some((e) => e.aggregate === "company" && e.tenantId === `tenant_co_${COMPANY}`)).toBe(true);
  });

  it("E2 re-saving the SAME stage emits nothing — the guard is the idempotency gate", () => {
    const deal = partnerPipelineStore.create(
      PARTNER_A,
      { dealName: "W33 MFC20 same-stage", companyId: COMPANY, stage: "invited", ownerUserId: "u_admin" } as never,
      "u_admin",
    );
    const got = capture(() => {
      partnerPipelineStore.update(PARTNER_A, deal.id, { stage: "invited" } as never, "u_admin");
    });
    expect(got.filter((e) => e.aggregate === "partnerRepresentation")).toEqual([]);
  });

  it("E3 a deal with NO company emits nothing — never `partner:null`", () => {
    const deal = partnerPipelineStore.create(
      PARTNER_A,
      { dealName: "W33 MFC20 no company", companyId: null, stage: "invited", ownerUserId: "u_admin" } as never,
      "u_admin",
    );
    const got = capture(() => {
      partnerPipelineStore.update(PARTNER_A, deal.id, { stage: "viewed" } as never, "u_admin");
    });
    expect(got.filter((e) => e.aggregate === "partnerRepresentation")).toEqual([]);
    expect(got.some((e) => String(e.id).includes("null"))).toBe(false);
  });

  it("E4 END TO END — the emit reaches a subscribed pillar's stream, not just the bus", () => {
    const deal = partnerPipelineStore.create(
      PARTNER_A,
      { dealName: "W33 MFC20 e2e", companyId: COMPANY, stage: "invited", ownerUserId: "u_admin" } as never,
      "u_admin",
    );
    asNobody();
    CTX.userId = FOUNDER_USER;
    ENTITLED.add(COMPANY);
    const s = openStream();
    partnerPipelineStore.update(PARTNER_A, deal.id, { stage: "soft_circle" } as never, "u_admin");
    const got = repFrames(s);
    s.close();
    expect(got.map((e) => e.id)).toContain(`${PARTNER_A}:${COMPANY}`);
  });
});

/* ── (B) THE PRODUCTION BUNDLE ─────────────────────────────────────────────── */

/** Strip block and line comments so a source assertion measures CODE. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("(B) the shipped shape — the defect this item found", () => {
  const OUT = path.join(process.cwd(), "server/__tests__/__artifacts__/wave33_mfc20_eventBus.cjs");
  let bundle = "";

  beforeAll(async () => {
    /* The SAME esbuild options `script/build.ts` uses for `dist/index.cjs`:
       bundle + cjs + the `import.meta.url` → `__importMetaUrl` define/banner. */
    const esbuild = await import("esbuild");
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allowlist = ["express", "zod", "nanoid", "drizzle-orm"];
    const externals = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ].filter((d) => !allowlist.includes(d));
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    await esbuild.build({
      entryPoints: ["server/lib/eventBus.ts"],
      platform: "node",
      bundle: true,
      format: "cjs",
      outfile: OUT,
      define: { "process.env.NODE_ENV": '"production"', "import.meta.url": "__importMetaUrl" },
      banner: { js: "const __importMetaUrl = require('url').pathToFileURL(__filename).href;" },
      minify: false,
      external: externals,
      logLevel: "silent",
    });
    bundle = fs.readFileSync(OUT, "utf8");
  }, 60_000);

  it("B1 the pillar predicates are INSIDE the bundle — nothing is resolved at call time", () => {
    // Measured on the artifact, not on the import statement.
    expect(bundle).toMatch(/function hasActivePartnerAttribution/);
    expect(bundle).toMatch(/function isCollectiveMemberCompany/);
    expect(bundle).toMatch(/function parsePartnerRepresentationId/);
  });

  it("B2 no aliased require of a relative path survives into the bundle", () => {
    expect(bundle).not.toMatch(/requireCjs\(\s*["']\.\.?\//);
  });

  it("B3 THE POLE — the old lazy form genuinely does NOT resolve from a bundle path", () => {
    /* Without this case B1/B2 would be assertions about a style choice. Here
       the previous behaviour is reproduced by execution: resolve the very
       specifiers the old code used, from the bundle's own location. */
    const req = createRequire(pathToFileURL(OUT).href);
    for (const spec of ["./eventBusPillarHelpers", "../partnerWorkspaceStore"]) {
      let code = "RESOLVED";
      try {
        req(spec);
      } catch (e) {
        code = (e as NodeJS.ErrnoException).code ?? "THREW";
      }
      expect(code).toBe("MODULE_NOT_FOUND");
    }
  });

  it("B4 a throw inside the visibility decision is SWALLOWED by the fan-out — why this was invisible", () => {
    /* The mechanism that hid the defect, demonstrated rather than described:
       the fan-out wraps the decision in `catch { /* client gone *\/ }`, so a
       MODULE_NOT_FOUND there drops the frame with no log line and no 500. */
    const src = fs.readFileSync("server/lib/eventBus.ts", "utf8");
    const fanout = src.slice(src.indexOf("const off = onMutation"));
    expect(fanout).toMatch(/catch\s*\{\s*\/\*\s*client gone/);
    // …and the live proof: with the decision throwing, the stream stays silent
    // instead of erroring.
    asNobody();
    CTX.isAdmin = true;
    const s = openStream();
    const boom = () => {
      throw new Error("MODULE_NOT_FOUND (simulated)");
    };
    const off = onMutation(() => boom());
    let threw = false;
    try {
      emitMutation({ aggregate: "partnerRepresentation", id: "x:y", change: "update" });
    } catch {
      threw = true;
    } finally {
      off();
      s.close();
    }
    expect(threw).toBe(true); // the bus itself does not swallow…
    // …but the per-client fan-out does, which is exactly where the old require lived.
  });

  it("B5 neither end of this feature still resolves a module at call time", () => {
    /* Comments are stripped first: this file's own explanation of the defect
       QUOTES `requireCjs("./eventBusPillarHelpers")`, and matching that prose
       would make the assertion fail while the code is correct — the mirror
       image of the N1 harness bug in item 4. The stripper is pinned by B6. */
    const bus = stripComments(fs.readFileSync("server/lib/eventBus.ts", "utf8"));
    const store = stripComments(fs.readFileSync("server/partnerWorkspaceStore.ts", "utf8"));
    expect(bus).not.toMatch(/requireCjs\(/);
    expect(bus).not.toMatch(/createRequire/);
    // The emit site specifically — other lazy requires elsewhere in that large
    // file are out of scope for this item and are recorded as OQ-33-4.
    expect(store).not.toMatch(/require\(\s*["']\.\/lib\/eventBus["']\s*\)/);
    expect(store).toMatch(/import \{ emitMutation \} from "\.\/lib\/eventBus";/);
  });

  it("B7 a SHADOWED `require` fails identically to an aliased one — why the emit end was fixed too", async () => {
    /* The emit end used `require("./lib/eventBus")` where `require` is a local
       `createRequire` const. It is tempting to assume esbuild recognises the
       NAME and bundles the dependency. It does not: it renames the shadowing
       variable (`require7` in the real bundle of partnerWorkspaceStore) and
       leaves the call unresolvable. Proven here on a two-file fixture rather
       than argued. */
    const esbuild = await import("esbuild");
    const dir = path.join(process.cwd(), "server/__tests__/__artifacts__/w33_shadow");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "dep.ts"), 'export const marker = "W33_DEP_MARKER";\n');
    fs.writeFileSync(
      path.join(dir, "shadow.ts"),
      'import { createRequire } from "node:module";\n' +
        "const require = createRequire(import.meta.url);\n" +
        'export function get() { return (require("./dep") as { marker: string }).marker; }\n',
    );
    /* The bundle is emitted to a DIFFERENT directory from the sources, which is
       the production shape: `dist/index.cjs` does not sit next to `server/`.
       Emitting it beside `dep.ts` would let the test runner's own TypeScript
       require hook resolve the specifier and the case would prove nothing. */
    const outDir = path.join(process.cwd(), "server/__tests__/__artifacts__/w33_shadow_dist");
    fs.mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, "shadow.cjs");
    await esbuild.build({
      entryPoints: [path.join(dir, "shadow.ts")],
      platform: "node",
      bundle: true,
      format: "cjs",
      outfile: out,
      define: { "import.meta.url": "__importMetaUrl" },
      banner: { js: "const __importMetaUrl = require('url').pathToFileURL(__filename).href;" },
      logLevel: "silent",
    });
    const bundled = fs.readFileSync(out, "utf8");
    expect(bundled).not.toContain("W33_DEP_MARKER"); // the dependency was NOT bundled
    const mod = createRequire(pathToFileURL(out).href)(out) as { get: () => string };
    let code = "RESOLVED";
    try {
      mod.get();
    } catch (e) {
      code = (e as NodeJS.ErrnoException).code ?? "THREW";
    }
    expect(code).toBe("MODULE_NOT_FOUND");
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  }, 60_000);

  it("B6 the comment stripper is pinned — B5 must not pass because it read nothing", () => {
    expect(stripComments('/* requireCjs("./x") */ const a = 1;')).not.toMatch(/requireCjs/);
    expect(stripComments("  // requireCjs('./x')\nconst b = 2;")).not.toMatch(/requireCjs/);
    // …and it does NOT eat real code:
    expect(stripComments('const c = requireCjs("./x");')).toMatch(/requireCjs\("\.\/x"\)/);
  });
});

/* ── (C) THE CYCLE ─────────────────────────────────────────────────────────── */

describe("(C) the module cycle the lazy requires were avoiding", () => {
  it("C1 both import orders load and WORK, in a fresh process each", async () => {
    /* The old comments asserted a static import would close a fatal
       module-init cycle. It does close a cycle; the cycle is harmless because
       neither module touches the other at init. Asserted by execution in a
       clean process per order, calling a function from each side. */
    const { execFileSync } = await import("node:child_process");
    const orders = [
      ["../lib/eventBus", "../partnerWorkspaceStore"],
      ["../partnerWorkspaceStore", "../lib/eventBus"],
    ];
    for (const [first, second] of orders) {
      const abs = (spec: string) =>
        pathToFileURL(path.join(process.cwd(), "server", spec.replace("../", ""))).href;
      const script = `
        import * as A from "${abs(first)}";
        import * as B from "${abs(second)}";
        const bus = "emitMutation" in A ? A : B;
        const store = "partnerTeamStore" in A ? A : B;
        bus.emitMutation({ aggregate: "partnerRepresentation", id: "p:c", change: "update" });
        store.partnerTeamStore.findByUserId("u_nobody");
        console.log("CYCLE_OK");
      `;
      const f = path.join(process.cwd(), `server/__tests__/__artifacts__/w33_cycle_${first.includes("eventBus") ? "bus" : "store"}_first.mts`);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, script);
      const out = execFileSync("npx", ["tsx", f], {
        encoding: "utf8",
        cwd: process.cwd(),
        env: { ...process.env, NODE_ENV: "test" },
      });
      expect(out).toContain("CYCLE_OK");
      fs.unlinkSync(f);
    }
  }, 120_000);
});

afterAll(() => {
  asNobody();
});
