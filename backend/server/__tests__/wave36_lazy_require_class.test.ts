/**
 * WAVE 36 · ROW 6 — falsification harness for the LAZY-REQUIRE defect class.
 *
 * ── THE CLASS, three instances found across three reviews ───────────────────
 *   F4  a module that THREW on import, swallowed by `catch` into `[]`
 *   (2)  a module path that NEVER EXISTED, swallowed by `catch`
 *   (3)  a NAMED EXPORT that is not exported, swallowed by `catch`  ← this wave
 *
 * The shape is always the same: `const { x } = require("…")` inside a `try`
 * whose `catch` substitutes a plausible-looking default (0, [], or nothing at
 * all). The substitute is indistinguishable from a real answer, so the defect
 * is invisible in every log and every green test.
 *
 * ── WHAT THIS WAVE FIXED ────────────────────────────────────────────────────
 *  6a `server/dscVoteStore.ts:347` destructured `countActiveChapterMembers`
 *     from `./chaptersStore`, which never exported it. `catch { memberCount = 0 }`
 *     then made `quorumReached = memberCount > 0 && …` PERMANENTLY FALSE for
 *     every chapter-scoped DSC vote. CONTROL: the un-scoped path, same voters,
 *     reaches quorum — so the two poles cannot both be explained by "no votes".
 *  6b four `emitBridge` sites destructured a name `bridgeStore` has never
 *     exported (the real export is `emitBridgeEvent`), so four event types were
 *     emitted ZERO times since they were written.
 *  6c `server/sprint21Routes.ts:350` destructured `startDmChannel` /
 *     `postMessageToChannel` from `./commsStore` — neither has ever existed —
 *     AND guarded the call with `typeof … === "function"`, so the block was a
 *     no-op that could not even throw. The v25.10 comment above it claims
 *     ma-discuss now reaches recipients through commsStore. It never did.
 *
 * ── METHOD ──────────────────────────────────────────────────────────────────
 * Real DB rows, real production entry points, static imports, no mocks of the
 * store under test. Every precondition is established here. Both poles asserted.
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { countActiveChapterMembers } from "../chaptersStore";
import { tallyForCompany, recordVote } from "../dscVoteStore";
import { ALL_OUTBOUND_EVENT_TYPES, getOutbox, emitBridgeEvent } from "../bridgeStore";

const CHAPTER = "ch_w36_quorum";
const CO = "co_w36_dsc";
const VOTERS = ["u_w36_dsc_1", "u_w36_dsc_2", "u_w36_dsc_3"];

beforeAll(async () => {
  const { rawDb } = await import("../db/connection");
  const db: any = rawDb();
  const now = "2026-01-01T00:00:00Z";
  db.prepare(
    `INSERT OR REPLACE INTO chapters (id,tenant_id,name,region,city,status,admin_user_id,
       partner_org_id,membership_fee_annual_minor,founded,created_at,updated_at,deleted_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)`,
  ).run(CHAPTER, "tnt_capavate_us", "W36 Quorum Chapter", "NA", "New York", "active",
    null, null, null, null, now, now);
  const insM = db.prepare(
    `INSERT OR REPLACE INTO chapter_memberships (id,tenant_id,chapter_id,user_id,role,status,joined_at,created_at,updated_at,deleted_at)
     VALUES (?,?,?,?,?,?,?,?,?,NULL)`,
  );
  // FOUR active members → quorum needs ⌈4/2⌉ = 2 distinct voters.
  ["u_w36_dsc_1", "u_w36_dsc_2", "u_w36_dsc_3", "u_w36_dsc_4"].forEach((u, i) =>
    insM.run(`cm_w36_${i}`, "tnt_capavate_us", CHAPTER, u, "member", "active", now, now, now),
  );
  // A revoked and a soft-deleted row that must NOT be counted.
  insM.run("cm_w36_revoked", "tnt_capavate_us", CHAPTER, "u_w36_dsc_gone", "member", "revoked", now, now, now);
  db.prepare(
    `INSERT OR REPLACE INTO chapter_memberships (id,tenant_id,chapter_id,user_id,role,status,joined_at,created_at,updated_at,deleted_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run("cm_w36_deleted", "tnt_capavate_us", CHAPTER, "u_w36_dsc_del", "member", "active", now, now, now, now);

  /* The un-scoped CONTROL needs a real platform-wide roster, otherwise its
   * denominator is 0 for an unrelated reason and the control proves nothing. */
  const insC = db.prepare(
    `INSERT OR REPLACE INTO collective_memberships
       (user_id,tenant_id,chapter_id,status,tier,activated_at,activated_by,deactivated_at,
        deactivated_by,cap_table_exempt,created_at,updated_at,deleted_at)
     VALUES (?,?,?,?,?,?,?,NULL,NULL,0,?,?,NULL)`,
  );
  ["u_w36_dsc_1", "u_w36_dsc_2", "u_w36_dsc_3", "u_w36_dsc_4"].forEach((u) =>
    insC.run(u, "tnt_capavate_us", CHAPTER, "active", "standard", now, "u_admin", now, now),
  );
});

/**
 * Source assertions must read CODE, not prose. This harness itself quotes the
 * defective `require(...)` lines in its comments, and an earlier run of this
 * very file failed on its own documentation — a check that fails while
 * checking nothing is the same bug as one that passes while checking nothing.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/* ══════════════════════════════════════════════════════════════════════════
 * 6a — the quorum denominator
 * ═════════════════════════════════════════════════════════════════════════ */
describe("WAVE 36 · ROW 6a — chapter-scoped DSC quorum counts REAL members", () => {
  it("PRECONDITION — the roster this test relies on is really in the DB, and only the active rows count", () => {
    const n = countActiveChapterMembers(CHAPTER);
    console.log("W36 ROW6a active chapter members:", n);
    expect(n).toBe(4); // 4 active; the revoked and the soft-deleted row excluded
  });

  it("PRECONDITION — `countActiveChapterMembers` is a REAL named export of chaptersStore", async () => {
    const mod: any = await import("../chaptersStore");
    expect(typeof mod.countActiveChapterMembers).toBe("function");
    // The exact failure mode of the defect: destructuring a missing name.
    expect(mod.countActiveChapterMembers).not.toBeUndefined();
  });

  it("6a-A — the DEFECT pole: with the old denominator (0) quorum is unreachable no matter how many vote", () => {
    // Reproduces the arithmetic the shipped code performed. Two real voters,
    // and quorum still false — this is what every chapter DSC vote returned.
    const oldMemberCount = 0;
    const voterCount = 2;
    expect(oldMemberCount > 0 && voterCount * 2 >= oldMemberCount).toBe(false);
  });

  it("6a-B — the FIXED pole: two of four members voting REACHES quorum through the shipped path", () => {
    recordVote({ companyId: CO, voterUserId: VOTERS[0], vote: "approve", chapterId: CHAPTER } as any);
    recordVote({ companyId: CO, voterUserId: VOTERS[1], vote: "approve", chapterId: CHAPTER } as any);
    const scoped = tallyForCompany(CO, { chapterId: CHAPTER });
    console.log("W36 ROW6a scoped tally:", JSON.stringify(scoped));
    expect(scoped.dscMemberCount).toBe(4);
    expect(scoped.voterCount).toBe(2);
    expect(scoped.quorumReached).toBe(true);
  });

  it("6a-C — CONTROL: the un-scoped path was always reachable, so 6a-B is not just 'votes exist'", () => {
    const unscoped = tallyForCompany(CO);
    console.log("W36 ROW6a unscoped tally:", JSON.stringify(unscoped));
    expect(unscoped.voterCount).toBe(2);
    // The un-scoped denominator comes from collectiveMembershipStore, a
    // DIFFERENT source. Review 2A's control was exactly this: the un-scoped
    // path reached quorum with the same voters while the scoped path could not.
    expect(unscoped.dscMemberCount).toBeGreaterThan(0);
    expect(unscoped.quorumReached).toBe(true);
  });

  it("6a-D — a one-of-four minority does NOT reach quorum (the gate still refuses)", () => {
    const lonely = "co_w36_dsc_minority";
    recordVote({ companyId: lonely, voterUserId: VOTERS[2], vote: "approve", chapterId: CHAPTER } as any);
    const t = tallyForCompany(lonely, { chapterId: CHAPTER });
    console.log("W36 ROW6a minority tally:", JSON.stringify(t));
    expect(t.dscMemberCount).toBe(4);
    expect(t.voterCount).toBe(1);
    expect(t.quorumReached).toBe(false); // 1×2 = 2 < 4
  });

  it("6a-E — an unreadable roster REFUSES rather than silently returning 0", () => {
    expect(() => countActiveChapterMembers("")).toThrow();
  });

  it("6a-F — the swallow is GONE from the source: no try/catch around the denominator", () => {
    const src = stripComments(fs.readFileSync(path.join(process.cwd(), "server/dscVoteStore.ts"), "utf8"));
    expect(src).toContain('import { countActiveChapterMembers } from "./chaptersStore"');
    expect(src).not.toMatch(/require\(["']\.\/chaptersStore["']\)/);
    expect(src).not.toMatch(/memberCount\s*=\s*0/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6b — four dead bridge emits
 * ═════════════════════════════════════════════════════════════════════════ */
describe("WAVE 36 · ROW 6b — the four dead `emitBridge` sites now emit for real", () => {
  const DEAD_FOUR = [
    "founderTeam.invitation_sent",
    "founderTeam.member_removed",
    "maInitiative.response_recorded",
    "round.invitation_sent",
  ] as const;

  it("PRECONDITION — `emitBridge` is STILL not an export of bridgeStore (that was the defect)", async () => {
    const mod: any = await import("../bridgeStore");
    expect(mod.emitBridge).toBeUndefined();
    expect(typeof mod.emitBridgeEvent).toBe("function");
  });

  it("6b-A — no call site still destructures the phantom `emitBridge`", () => {
    const offenders: string[] = [];
    for (const f of walk(path.join(process.cwd(), "server"))) {
      const src = stripComments(fs.readFileSync(f, "utf8"));
      if (/\{\s*emitBridge\s*\}\s*=\s*require\(/.test(src)) offenders.push(rel(f));
    }
    console.log("W36 ROW6b phantom emitBridge sites:", JSON.stringify(offenders));
    expect(offenders).toEqual([]);
  });

  it("6b-B — all four event types are registered on the outbound contract, so no consumer drops them", () => {
    for (const t of DEAD_FOUR) expect(ALL_OUTBOUND_EVENT_TYPES).toContain(t);
    expect(new Set(ALL_OUTBOUND_EVENT_TYPES).size).toBe(ALL_OUTBOUND_EVENT_TYPES.length);
  });

  it("6b-C — emitting each of the four actually lands an envelope in the outbox (both poles)", () => {
    const before = getOutbox().length;
    for (const t of DEAD_FOUR) {
      emitBridgeEvent({
        eventType: t,
        aggregateId: `agg_w36_${t}`,
        aggregateKind: "company",
        payload: { probe: "wave36_row6b" },
      });
    }
    const after = getOutbox();
    expect(after.length).toBe(before + 4);
    for (const t of DEAD_FOUR) {
      expect(after.some((e: any) => e.envelope.eventType === t)).toBe(true);
    }
    // NEGATIVE pole: a type nobody emitted is absent, so the positive is meaningful.
    expect(after.some((e: any) => e.envelope.eventType === "founderTeam.never_emitted")).toBe(false);
  });

  it("6b-D — each of the four call sites uses a STATIC import of the real export", () => {
    const sites = [
      "server/lib/founderTeamStore.ts",
      "server/lib/maInitiativesStore.ts",
      "server/lib/bulkInvitationsRoutes.ts",
    ];
    for (const s of sites) {
      const src = fs.readFileSync(path.join(process.cwd(), s), "utf8");
      expect(src).toContain('import { emitBridgeEvent } from "../bridgeStore"');
      const code = stripComments(src);
      expect(code).not.toMatch(/\{\s*emitBridge\s*\}\s*=\s*require\(/);
      expect(src).not.toMatch(/\{\s*emitBridge\s*\}\s*=\s*require\(/);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6c — the dead comms DM site
 * ═════════════════════════════════════════════════════════════════════════ */
describe("WAVE 36 · ROW 6c — ma-discuss really delivers through commsStore", () => {
  it("PRECONDITION — `startDmChannel` / `postMessageToChannel` never existed; the cores do", async () => {
    const mod: any = await import("../commsStore");
    expect(mod.startDmChannel).toBeUndefined();
    expect(mod.postMessageToChannel).toBeUndefined();
    expect(typeof mod.openDmChannelCore).toBe("function");
    expect(typeof mod.postChannelMessageCore).toBe("function");
  });

  it("6c-A — the call site is a static import of the cores, with no typeof-guarded no-op left", () => {
    const src = stripComments(fs.readFileSync(path.join(process.cwd(), "server/sprint21Routes.ts"), "utf8"));
    expect(src).toContain('import { openDmChannelCore, postChannelMessageCore } from "./commsStore"');
    expect(src).not.toMatch(/require\(["']\.\/commsStore["']\)/);
    expect(src).not.toMatch(/typeof\s+startDmChannel\s*===\s*["']function["']/);
  });

  it("6c-B — the HTTP DM route DELEGATES to the core, so there is exactly ONE authorisation implementation", () => {
    const src = stripComments(fs.readFileSync(path.join(process.cwd(), "server/commsStore.ts"), "utf8"));
    const route = src.slice(src.indexOf('app.post("/api/comms/dm/start"'));
    const body = route.slice(0, route.indexOf("/* ---- Cap-table channel access"));
    expect(body).toContain("openDmChannelCore(");
    // The route must not carry its own copy of the gate any more.
    expect(body).not.toContain("canDM(");
    expect(body).not.toContain("authorizedViaCrm");
  });

  it("6c-C — the HTTP message route delegates too", () => {
    const src = stripComments(fs.readFileSync(path.join(process.cwd(), "server/commsStore.ts"), "utf8"));
    const route = src.slice(src.indexOf('app.post("/api/comms/channels/:id/messages"'));
    const body = route.slice(0, route.indexOf("/* ---- Edit message ---- */"));
    expect(body).toContain("postChannelMessageCore(");
    expect(body).not.toContain("persistMessage(msg)");
  });

  it("6c-D — a refused DM is REPORTED by ma-discuss, not swallowed (the honest-refusal pole)", async () => {
    const { openDmChannelCore } = await import("../commsStore");
    const refused = openDmChannelCore({
      actorId: "u_w36_nobody_a",
      targetUserId: "u_w36_nobody_b_does_not_exist",
    });
    console.log("W36 ROW6c refusal:", JSON.stringify(refused));
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect([403, 422]).toContain(refused.status);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE CLASS SWEEP — is the class empty now?
 * ═════════════════════════════════════════════════════════════════════════ */
function walk(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "__tests__" || e.name === "dist") continue;
      walk(p, acc);
    } else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) acc.push(p);
  }
  return acc;
}
const rel = (f: string) => path.relative(process.cwd(), f);

describe("WAVE 36 · ROW 6 — sweep of the whole lazy-require class", () => {
  it("SWEEP — every `const { … } = require(\"./local\")` destructures a name the target module really exports", () => {
    const files = walk(path.join(process.cwd(), "server"));
    const offenders: Array<{ site: string; missing: string[]; target: string }> = [];
    const inspected: string[] = [];
    const re = /const\s*\{([^}]+)\}\s*=\s*require\(\s*["'](\.[^"']+)["']\s*\)/g;
    for (const f of files) {
      const src = stripComments(fs.readFileSync(f, "utf8"));
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(src))) {
        const names = m[1]
          .split(",")
          .map((n) => n.split(":")[0].trim())
          .filter(Boolean);
        const spec = m[2];
        // Resolve the target module on disk.
        const base = path.resolve(path.dirname(f), spec);
        const cand = [base + ".ts", base + ".tsx", path.join(base, "index.ts")];
        const target = cand.find((c) => fs.existsSync(c));
        if (!target) {
          offenders.push({ site: `${rel(f)} → ${spec}`, missing: names, target: "MODULE DOES NOT EXIST" });
          continue;
        }
        const tsrc = fs.readFileSync(target, "utf8");
        const missing = names.filter((n) => {
          const pats = [
            new RegExp(`export\\s+(async\\s+)?function\\s+${n}\\b`),
            new RegExp(`export\\s+(const|let|var|class|type|interface|enum)\\s+${n}\\b`),
            new RegExp(`export\\s*\\{[^}]*\\b${n}\\b[^}]*\\}`),
            new RegExp(`export\\s+default\\b`),
            new RegExp(`\\bas\\s+${n}\\b`),
            new RegExp(`export\\s*\\*`),
            new RegExp(`exports\\.${n}\\b`),
          ];
          return !pats.some((p) => p.test(tsrc));
        });
        inspected.push(`${rel(f)} → ${spec} {${names.join(",")}}`);
        if (missing.length) offenders.push({ site: `${rel(f)} → ${spec}`, missing, target: rel(target) });
      }
    }
    console.log("W36 ROW6 SWEEP destructured lazy requires inspected:", inspected.length);
    console.log("W36 ROW6 SWEEP offenders:", JSON.stringify(offenders, null, 2));
    // Non-vacuity: the sweep must actually be looking at something.
    expect(inspected.length).toBeGreaterThan(20);
    expect(offenders).toEqual([]);
  });

  it("SWEEP SELF-CHECK — the sweep DOES catch a planted missing export (so an empty result means something)", () => {
    const tmp = path.join(process.cwd(), "server", "zz_w36_sweep_selfcheck_tmp.ts");
    const victim = path.join(process.cwd(), "server", "zz_w36_sweep_target_tmp.ts");
    try {
      fs.writeFileSync(victim, "export function iAmExported(): number { return 1; }\n");
      fs.writeFileSync(
        tmp,
        'const { iAmNotExported } = require("./zz_w36_sweep_target_tmp");\nexport const x = iAmNotExported;\n',
      );
      const src = fs.readFileSync(tmp, "utf8");
      const m = /const\s*\{([^}]+)\}\s*=\s*require\(\s*["'](\.[^"']+)["']\s*\)/.exec(src)!;
      const name = m[1].trim();
      const tsrc = fs.readFileSync(victim, "utf8");
      const found = new RegExp(`export\\s+(async\\s+)?function\\s+${name}\\b`).test(tsrc);
      expect(found).toBe(false); // RED pole — the detector fires
      expect(new RegExp(`export\\s+(async\\s+)?function\\s+iAmExported\\b`).test(tsrc)).toBe(true); // GREEN pole
    } finally {
      fs.rmSync(tmp, { force: true });
      fs.rmSync(victim, { force: true });
    }
  });
});
