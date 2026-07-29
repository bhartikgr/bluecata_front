/**
 * server/__tests__/wcoll_w1_gate_state_lazy_require.test.ts
 *
 * W-COLLECTIVE Wave 1 — v4 §1.1 / §0a.8. The gate-state dependency repair.
 *
 * CONTEXT. `GET /api/collective/gate-state` probed for a partner-only session
 * with `require("./partnerTeamStore")` — a module that has NEVER existed. The
 * require threw on every call, the surrounding `catch {}` swallowed it, and
 * `isPartnerOnly` was therefore ALWAYS `false`: a Consortium Partner who signed
 * in got the generic "you are not a member" panel with no route to their own
 * workspace.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * THE REPAIR, AND THE REAL ROOT CAUSE.
 *
 * The first pass at this corrected only the PATH (`./partnerTeamStore` →
 * `./partnerWorkspaceStore`) and routed the call through a `requireLazy(path)`
 * wrapper that logs instead of swallowing. That was necessary but NOT
 * sufficient, because the defect was resolver-shaped, not path-shaped:
 *
 *   • `collectiveAppStore.ts` builds its `require` with
 *     `createRequire(import.meta.url)` (:24-25, present on pristine too).
 *   • `script/build.ts` bundles the server with esbuild as CJS to
 *     `dist/index.cjs`, defining `import.meta.url` → `__importMetaUrl` =
 *     `pathToFileURL(__filename)`.
 *   • esbuild statically analyses and INLINES `require("./literal")`, so the
 *     four pristine bare requires were bundled correctly and worked in
 *     production — the only broken one was the one whose path was wrong.
 *   • but `requireLazy(modulePath)` passes a VARIABLE to `require()`. esbuild
 *     cannot analyse that, so it leaves the call intact; at runtime the calling
 *     file IS `dist/index.cjs`, so `./partnerWorkspaceStore` resolved to
 *     `dist/partnerWorkspaceStore` → `Cannot find module`. The wrapper therefore
 *     ALWAYS threw in the production bundle, and under vitest/`tsx` it hit
 *     Node's CJS loader on a `.ts` file instead
 *     (`SyntaxError: Unexpected identifier 'PartnerTier'`).
 *
 * FIX AS SHIPPED: all three dependencies are now STATIC imports —
 * `import { getDb, rawDb } from "./db/connection"`,
 * `import * as collectiveMembershipModule from "./collectiveMembershipStore"`,
 * `import { partnerTeamStore } from "./partnerWorkspaceStore"` — which esbuild
 * resolves at build time, so the whole class of failure is gone rather than
 * merely re-pathed. `isPartnerOnly` is now genuinely `true` for a real partner
 * (see "REPAIRED: gate-state now reports isPartnerOnly:true" below).
 *
 * The strategy's comment warned of an import cycle. There is none: a BFS over
 * the import graph reaches 4 modules from `./db/connection`, 6 from
 * `./collectiveMembershipStore` and 63 from `./partnerWorkspaceStore`, and NONE
 * of them reaches `collectiveAppStore`. `partnerWorkspaceStore.ts` also runs no
 * top-level side effects, so there is no module-init ordering hazard either.
 *
 * `requireLazy` and `checkCollectiveLazyRequires` are retained: the check now
 * validates the three STATIC bindings still expose the members the call sites
 * invoke, and it is invoked at boot from `server/index.ts` (warn-only) so a
 * future rename fails loudly instead of silently disabling a capability.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ANTI-VACUITY — on the PRISTINE tree:
 *   • the three `checkCollectiveLazyRequires` tests FAIL with
 *     `TypeError: collectiveAppStore.checkCollectiveLazyRequires is not a function`.
 *   • "publishes a redirect target" FAILS with
 *     `expected undefined to be '/collective/partner/dashboard'` — pristine has
 *     no `partnerWorkspaceRedirectTo` field at all.
 *   • the decision fields (`accessAllowed` / `denialReason` / `denialMessage`)
 *     FAIL as `undefined`.
 *   • "isPartnerOnly:true" FAILS as `false` — that is the defect itself.
 *   • the source-text guard FAILS: pristine still contains
 *     `require("./db/connection")` (:308) and `require("./collectiveMembershipStore")`
 *     (:381, :407), and has none of the three static imports.
 *   • only "the old `./partnerTeamStore` path never existed" passes on pristine;
 *     it is labelled DOCUMENTING, not proof.
 * The namespace import keeps the file LOADABLE on pristine so the semantic
 * failures above are reachable rather than masked by an import error.
 */
import { describe, it, expect, beforeAll } from "vitest";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import request from "supertest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import * as collectiveAppStore from "../collectiveAppStore";
import { registerCollectiveAppRoutes } from "../collectiveAppStore";
import { partnerTeamStore } from "../partnerWorkspaceStore";
import * as membershipStore from "../collectiveMembershipStore";

const require_ = createRequire(import.meta.url);

const PARTNER_ID = "porg_wcoll_gate";
const PARTNER_USER = "u_wcoll_gate_partner";
const PLAIN_USER = "u_wcoll_gate_plain";
const MEMBER_USER = "u_wcoll_gate_member";

let app: express.Express;

/**
 * A minimal identity shim. `installV14TestIdentity` hard-codes
 * `collective: { status: "active" }` for EVERY request, which makes `isMember`
 * unconditionally true and the `!isMember && …` partner branch unreachable — so
 * it cannot be used to exercise this route's partner path.
 */
function installIdentity(a: express.Express): void {
  a.use((req: Request, _res: Response, next: NextFunction) => {
    const userId = req.headers["x-user-id"] as string | undefined;
    if (!userId) return next();
    (req as Request & { userContext?: unknown }).userContext = {
      userId,
      isAdmin: false,
      isAuthed: true,
      identity: { email: `${userId}@test.local`, name: userId, screenName: userId },
      collective: { status: "none", role: null, expiresAt: null },
    } as unknown as Request["userContext"];
    next();
  });
}

function gateState(user: string | null) {
  const r = request(app).get("/api/collective/gate-state");
  if (user) r.set("x-user-id", user);
  return r;
}

beforeAll(() => {
  process.env.COLLECTIVE_ENABLED = "1";
  app = express();
  app.use(express.json());
  installIdentity(app);
  registerCollectiveAppRoutes(app);
  partnerTeamStore.add(PARTNER_ID, PARTNER_USER, "member", "u_test_admin");
});

describe("v4 §1.1 — the corrected module PATH is the right one", () => {
  it("partnerWorkspaceStore exposes partnerTeamStore.findByUserId", () => {
    expect(partnerTeamStore).toBeTruthy();
    expect(typeof partnerTeamStore.findByUserId).toBe("function");
  });

  it("and it resolves a real partner team member", () => {
    const row = partnerTeamStore.findByUserId(PARTNER_USER);
    expect(row).toBeTruthy();
    expect(row?.userId).toBe(PARTNER_USER);
    expect(row?.partnerId).toBe(PARTNER_ID);
  });

  it("DOCUMENTING (passes on pristine): the old `./partnerTeamStore` path never existed", () => {
    expect(() => require_("../partnerTeamStore")).toThrow();
  });
});

describe("v4 §0a.8 — the dependency contract is self-checked at boot, and REPAIRED", () => {
  it("the check never throws — a broken path must be loud but must not brick a boot", () => {
    expect(() => collectiveAppStore.checkCollectiveLazyRequires()).not.toThrow();
  });

  it("it reports the full declared contract", () => {
    const r = collectiveAppStore.checkCollectiveLazyRequires();
    // Three specs: ./db/connection, ./collectiveMembershipStore,
    // ./partnerWorkspaceStore#partnerTeamStore.
    expect(r.checked).toBe(3);
    expect(Array.isArray(r.failures)).toBe(true);
    expect(typeof r.ok).toBe("boolean");
  });

  it("REPAIRED: the dependency contract self-check reports ok with no failures", () => {
    // Was a DEFECT LOCK asserting ok:false. The defect is now FIXED: the three
    // dependencies are STATIC imports, so the contract resolves in every
    // runtime including the production CJS bundle.
    const r = collectiveAppStore.checkCollectiveLazyRequires();
    expect(r.ok).toBe(true);
    expect(r.failures).toEqual([]);
    expect(r.checked).toBe(3);
  });

  it("REPAIRED: no relative require() for these deps survives in the production bundle", () => {
    // The root cause was resolver-shaped, not path-shaped: `requireLazy` passes a
    // VARIABLE to require(), which esbuild cannot rewrite, so at runtime it
    // resolved relative to dist/ and always threw. Static imports remove the class.
    //
    // ANTI-VACUITY: each assertion below was executed against
    // build/_presnapshot/server/collectiveAppStore.ts and FAILS there —
    //   • the no-require assertion matches 3 pristine sites (:308 `./db/connection`,
    //     :381 and :407 `./collectiveMembershipStore`) and 0 here;
    //   • all three static imports are absent from pristine (it has only
    //     `import { getDb } from "./db/connection"`, no `rawDb`, no namespace
    //     import of the membership store, and no partnerWorkspaceStore import
    //     at all — its bare require targeted `./partnerTeamStore`, which never
    //     existed).
    // The earlier revision of this test asserted on `requireLazy("./literal")`,
    // which pristine never contained either, so it passed on a full revert and
    // locked nothing. That vacuity is what these assertions replace.
    const src = readFileSync(
      new URL("../collectiveAppStore.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toMatch(
      /\brequire\(\s*["']\.\/(db\/connection|collectiveMembershipStore|partnerWorkspaceStore)["']/,
    );
    expect(src).toMatch(/^import \{ getDb, rawDb \} from "\.\/db\/connection"/m);
    expect(src).toMatch(
      /^import \* as collectiveMembershipModule from "\.\/collectiveMembershipStore"/m,
    );
    expect(src).toMatch(/^import \{ partnerTeamStore \} from "\.\/partnerWorkspaceStore"/m);
  });

  it("REPAIRED: gate-state now reports isPartnerOnly:true for a real partner", () => {
    // This is the behaviour v4 §1.1 set out to fix, and it is now genuinely
    // fixed rather than merely path-corrected.
    return gateState(PARTNER_USER).then((r) => {
      expect(r.status).toBe(200);
      expect(partnerTeamStore.findByUserId(PARTNER_USER)).toBeTruthy();
      expect(r.body.isPartnerOnly).toBe(true);
    });
  });
});

describe("v4 §1.1 — the unconsumed flag is published, not deleted (no silent drop)", () => {
  it("`partnerWorkspaceRedirectTo` is part of the response contract", async () => {
    const r = await gateState(PLAIN_USER);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body)).toContain("partnerWorkspaceRedirectTo");
  });

  it("it is null when the session is not partner-only", async () => {
    const r = await gateState(PLAIN_USER);
    expect(r.body.partnerWorkspaceRedirectTo).toBeNull();
  });

  it("the five pre-existing gate-state signals are all still present", async () => {
    const r = await gateState(PLAIN_USER);
    for (const key of [
      "isMember",
      "isPartnerOnly",
      "capTableExempt",
      "accreditationStatus",
      "requiresAccreditationDeclaration",
      "declarationEndpoint",
    ]) {
      expect(Object.keys(r.body), key).toContain(key);
    }
  });
});

describe("v5 §C — gate-state publishes the shared decision alongside the old signals", () => {
  it("a non-member is reported denied WITH a reason and non-empty human copy", async () => {
    const r = await gateState("u_wcoll_gate_denied");
    expect(r.status).toBe(200);
    expect(r.body.accessAllowed).toBe(false);
    expect(typeof r.body.denialReason).toBe("string");
    expect(String(r.body.denialMessage).trim().length).toBeGreaterThan(0);
  });

  it("the reason is never a fabricated billing status for a plain non-member", async () => {
    const r = await gateState("u_wcoll_gate_denied2");
    expect(r.body.denialReason).not.toBe("billing_deactivation_pending");
    expect(r.body.denialReason).not.toBe("application_pending");
  });

  it("an allowed member reports accessAllowed:true with a null reason and null message", async () => {
    membershipStore.activate(MEMBER_USER, "u_test_admin", "standard", { capTableExempt: true });
    const compliance = await import("../investorComplianceRoutes");
    compliance.recordAccreditationDeclaration(MEMBER_USER, {
      signatureName: "Allowed Member",
      criteria: ["us_income"],
    } as never);

    const r = await gateState(MEMBER_USER);
    expect(r.body.accessAllowed).toBe(true);
    expect(r.body.denialReason).toBeNull();
    expect(r.body.denialMessage).toBeNull();
  });

  it("the legacy signal and the shared decision now AGREE for an activated member", () => {
    // Before the static-import fix these two DISAGREED: `isMember` was computed
    // from the inert lazy require (so `false` for a genuinely activated member
    // whose ctx did not say "active"), while `accessAllowed` came from
    // `resolveCollectiveAccessDecision`, which uses static imports and reads
    // `collective_memberships` directly. That divergence is the mechanism behind
    // the live "shell renders, every widget 403s" report. Both must now be true.
    return gateState(MEMBER_USER).then((r) => {
      expect(membershipStore.isActive(MEMBER_USER)).toBe(true);
      expect(r.body.isMember).toBe(true); // legacy signal — now REPAIRED
      expect(r.body.accessAllowed).toBe(true); // durable signal
    });
  });

  it("the decision is never allowed to synthesise allow:true — anonymous is still 401", async () => {
    const r = await gateState(null);
    expect(r.status).toBe(401);
  });
});
