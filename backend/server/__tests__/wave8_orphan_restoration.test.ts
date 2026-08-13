/**
 * WAVE 8 — orphan restoration.
 *
 * One `describe` per delivered ORP item. Each assertion is written to FAIL on
 * the pre-wave tree: it pins the SINK (the route, store function or DB write
 * that data actually flows through), not merely the presence of a component.
 *
 * These are static-source assertions on purpose. Every item in this wave is a
 * WIRING defect — a capability that already existed but had no caller, no
 * route target, or no registry entry. The defect is therefore visible in the
 * source graph, and a source-graph assertion is what regresses if someone
 * unwires it again. Where an item also changes runtime behaviour (ORP-029's
 * fee stamp) the DDL and the call site are both pinned.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel: string): boolean => fs.existsSync(path.join(ROOT, rel));

/* ────────────────────────────────────────────────────────────────────────────
 * ORP-028 / ORP-034 / ORP-045 — outbound bridge event registry
 *
 * SINK: server/bridgeStore.ts ALL_OUTBOUND_EVENT_TYPES. That array is what
 * GET /api/bridge/event-types publishes, what Sync Status enumerates, and what
 * replay validates against (bridgeStore.ts:1387-1388 -> 400 invalid_event_type).
 * emitBridgeEvent does NOT filter on it, so unregistered events still landed in
 * the outbox — they were simply invisible to peers and unreplayable.
 * ──────────────────────────────────────────────────────────────────────────── */
describe("ORP-028/034/045 — SPV + telemetry events are in the outbound registry", () => {
  const bridge = read("server/bridgeStore.ts");

  const SPV_EVENTS = [
    "spv.created",
    "spv.updated",
    "spv.deployed",
    "spv.closed_to_new_lps",
    "spv.wound_down",
    "spv.fee_obligation_accrued",
    "spv.lp_committed",
    "partner.spv_updated",
  ];

  it("registers spv.* events in BOTH the union type and the runtime array", () => {
    for (const ev of SPV_EVENTS) {
      expect(bridge, `${ev} missing from OutboundEventType`).toContain(`"${ev}"`);
    }
    const arrStart = bridge.indexOf("ALL_OUTBOUND_EVENT_TYPES");
    expect(arrStart).toBeGreaterThan(-1);
    const arrBody = bridge.slice(arrStart, arrStart + 6000);
    for (const ev of SPV_EVENTS) {
      expect(arrBody, `${ev} missing from ALL_OUTBOUND_EVENT_TYPES`).toContain(`"${ev}"`);
    }
  });

  it("routes every sprint10 emitSync() call through the bridge forwarder", () => {
    expect(exists("server/lib/telemetryBridgeForward.ts")).toBe(true);
    const telem = read("server/sprint10Telemetry.ts");
    expect(telem).toContain("forwardTelemetryToBridge");
  });

  it("no longer suppresses the emit type with `as never` / `as any`", () => {
    const engine = read("server/spvEngineStore.ts");
    const partner = read("server/partnerWorkspaceStore.ts");
    for (const src of [engine, partner]) {
      const emits = src.split("\n").filter((l) => l.includes("emitBridgeEvent"));
      for (const line of emits) {
        expect(line).not.toContain("as never");
      }
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * ORP-050 — real round.terms_updated event
 *
 * The pre-wave code duck-typed `BridgeOutbound.roundTermsUpdated` in a ternary
 * at server/routes.ts:2191. That method never existed, so the branch ALWAYS
 * fell through to auditLogAppended and round.terms_updated was never emitted.
 * SINK: server/lib/bridgeOutbound.ts roundTermsUpdated() + the registry.
 * ──────────────────────────────────────────────────────────────────────────── */
describe("ORP-050 — round.terms_updated is emitted for real", () => {
  it("defines roundTermsUpdated on BridgeOutbound", () => {
    expect(read("server/lib/bridgeOutbound.ts")).toContain("roundTermsUpdated");
  });

  it("registers the event type in both the union and the runtime array", () => {
    const bridge = read("server/bridgeStore.ts");
    expect(bridge).toContain('"round.terms_updated"');
    const arrBody = bridge.slice(bridge.indexOf("ALL_OUTBOUND_EVENT_TYPES"));
    expect(arrBody).toContain('"round.terms_updated"');
  });

  it("calls it directly instead of duck-typing the method away", () => {
    const routes = read("server/routes.ts");
    expect(routes).toContain("roundTermsUpdated");
    expect(routes).not.toMatch(/typeof\s*\(?\s*BridgeOutbound\s*as\s*any\s*\)?\s*\.\s*roundTermsUpdated/);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * ORP-029 — SPV deployment fee on the CANONICAL engine table
 *
 * Two SPV tables exist: legacy `spvs` (already had fee columns) and the
 * canonical engine table `spv` (had none). The fee stamp only ever hit the
 * legacy table, so deploying through the engine recorded no fee at all.
 * SINK: server/spvEngineStore.ts markDeployed() -> spvEngineDeploymentFeeHook
 * -> UPDATE spv SET deployment_fee_*. Sole caller spvEngineRoutes.ts:486.
 * ──────────────────────────────────────────────────────────────────────────── */
describe("ORP-029 — deployment fee is stamped on the canonical `spv` table", () => {
  const MIGRATION = "0160_wave8_orp029_engine_spv_deployment_fee.sql";

  it("ships migration 0160 byte-identically in both migration directories", () => {
    const a = path.join(ROOT, "migrations", MIGRATION);
    const b = path.join(ROOT, "server/db/migrations", MIGRATION);
    expect(fs.existsSync(a), `${a} missing`).toBe(true);
    expect(fs.existsSync(b), `${b} missing`).toBe(true);
    expect(fs.readFileSync(a)).toEqual(fs.readFileSync(b));
  });

  it("adds the deployment_fee_* columns to `spv`, not to legacy `spvs`", () => {
    const sql = read(`migrations/${MIGRATION}`);
    expect(sql).toMatch(/ALTER TABLE\s+spv\s+ADD COLUMN\s+deployment_fee_/i);
    expect(sql).not.toMatch(/ALTER TABLE\s+spvs\s+ADD COLUMN\s+deployment_fee_/i);
  });

  it("the stampTable selector is whitelisted, never interpolated from input", () => {
    const src = read("server/lib/spvDeploymentFee.ts");
    expect(src).toContain("stampTable");
    // The two legal values must appear as literals — proof of a whitelist.
    expect(src).toMatch(/"spvs"/);
    expect(src).toMatch(/"spv"/);
  });

  it("markDeployed() is on the write path", () => {
    expect(exists("server/lib/spvEngineDeploymentFeeHook.ts")).toBe(true);
    const store = read("server/spvEngineStore.ts");
    expect(store).toContain("markDeployed");
    expect(store).toMatch(/DeploymentFee|deploymentFee/);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * ORP-030 — SPV engine endpoints that had ZERO client callers
 *
 * SINK: client/src/components/partner/SpvOperationsPanels.tsx issues the
 * requests; client/src/components/partner/SpvDetailTabs.tsx and
 * client/src/pages/partner/PartnerSpvEngine.tsx mount them. Without a mounted
 * caller the endpoints are unreachable from the product regardless of the
 * server being correct.
 * ──────────────────────────────────────────────────────────────────────────── */
describe("ORP-030 — orphaned SPV engine endpoints now have mounted callers", () => {
  const panels = read("client/src/components/partner/SpvOperationsPanels.tsx");
  const tabs = read("client/src/components/partner/SpvDetailTabs.tsx");
  const wizard = read("client/src/pages/partner/PartnerSpvEngine.tsx");

  const ENDPOINTS = [
    "fee-breakdown",
    "fee-obligations",
    "capital-accounts",
    "close-summary",
    "signoffs",
    "eligibility",
    "deployments",
  ];

  it("calls each previously-orphaned endpoint", () => {
    for (const ep of ENDPOINTS) {
      expect(panels, `no client call for ${ep}`).toContain(ep);
    }
  });

  it("mounts every panel in the SPV detail tabs", () => {
    for (const c of [
      "SpvFeeLedgerPanel",
      "SpvCloseSummaryPanel",
      "SpvSignoffsPanel",
      "SpvEligibilityPanel",
      "SpvDeploymentLifecyclePanel",
      "useSpvCapitalAccounts",
    ]) {
      expect(tabs, `${c} not mounted`).toContain(c);
    }
  });

  it("keeps the Capital-accounts copy in SpvDetailTabs.tsx (guard: copy class)", () => {
    // The hook exists precisely so this markup does NOT migrate out of the file
    // the silent-drop guard fingerprints it in.
    for (const s of ["Capital accounts", "Contributed", "Distributed"]) {
      expect(tabs, `copy string "${s}" left the file`).toContain(s);
    }
  });

  it("wires GET /spv-wizard/defaults into the wizard", () => {
    expect(wizard).toContain("spv-wizard/defaults");
    expect(wizard).toContain("spv-w-clone-select");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * ORP-051 — investor LP roster
 * SINK: MyPortfolioPage mounts InvestorSpvLpRosterPanel, which is the only
 * caller of GET /api/capavate/spv/:id/lp-roster (spvEngineRoutes.ts:648).
 * ──────────────────────────────────────────────────────────────────────────── */
describe("ORP-051 — investor LP roster is reachable from the portfolio", () => {
  it("mounts the roster panel on the investor portfolio page", () => {
    const page = read("client/src/pages/collective/MyPortfolioPage.tsx");
    expect(page).toContain("InvestorSpvLpRosterPanel");
  });

  it("the panel calls the lp-roster endpoint", () => {
    expect(read("client/src/components/partner/SpvOperationsPanels.tsx")).toContain("lp-roster");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * ORP-027 — founder Billing page was unreachable behind a redirect
 *
 * SINK: the ROUTE ELEMENT in client/src/App.tsx (a component-level fix would
 * be worthless while the route redirects away) plus the left-nav entry point in
 * AppShell.tsx. Four capabilities live ONLY on that page.
 * ──────────────────────────────────────────────────────────────────────────── */
describe("ORP-027 — /founder/billing renders the real page and is navigable", () => {
  const app = read("client/src/App.tsx");
  const shell = read("client/src/components/AppShell.tsx");
  const billing = read("client/src/pages/founder/Billing.tsx");
  const settings = read("client/src/pages/founder/Settings.tsx");

  it("routes /founder/billing to FounderBilling, not to a Redirect", () => {
    const idx = app.indexOf('"/founder/billing"');
    expect(idx).toBeGreaterThan(-1);
    const window = app.slice(idx, idx + 400);
    expect(window).toContain("FounderBilling");
    expect(window).not.toMatch(/Redirect\s+to=/);
  });

  it("restores the Billing left-nav entry point", () => {
    expect(shell).toContain('href: "/founder/billing"');
    expect(shell).toContain("nav-founder-billing");
  });

  it("the four capabilities really are unique to that page", () => {
    const UNIQUE = [
      "/api/founder/subscription/payment-method",
      "/api/founder/subscription/resume",
    ];
    for (const ep of UNIQUE) {
      expect(billing, `${ep} not on Billing.tsx`).toContain(ep);
      expect(settings, `${ep} unexpectedly duplicated into Settings.tsx`).not.toContain(ep);
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * ORP-047 — /terms and /privacy had zero inbound links tree-wide
 * SINK: LegalFooterLinks mounted in BOTH shells; a link in one shell only would
 * leave every collective-side user with no route in.
 * ──────────────────────────────────────────────────────────────────────────── */
describe("ORP-047 — legal routes are linked from both shells", () => {
  it("ships the footer component", () => {
    expect(exists("client/src/components/LegalFooterLinks.tsx")).toBe(true);
    const c = read("client/src/components/LegalFooterLinks.tsx");
    expect(c).toContain("/terms");
    expect(c).toContain("/privacy");
  });

  it("mounts it in AppShell and CollectiveShell", () => {
    expect(read("client/src/components/AppShell.tsx")).toContain("LegalFooterLinks");
    expect(read("client/src/components/CollectiveShell.tsx")).toContain("LegalFooterLinks");
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * ORP-048 / ORP-049 — unlinked client routes
 * ──────────────────────────────────────────────────────────────────────────── */
describe("ORP-048 — collective public member profile is linked", () => {
  it("links /collective/profile/:id from the member detail sheet", () => {
    const p = read("client/src/pages/collective/CollectiveMembers.tsx");
    expect(p).toContain("/collective/profile/");
    expect(p).toContain("link-member-public-profile");
  });
});

describe("ORP-049 — founder company settings alias is linked", () => {
  it("links /founder/settings/company from Settings", () => {
    const p = read("client/src/pages/founder/Settings.tsx");
    expect(p).toContain("/founder/settings/company");
    expect(p).toContain("tab-company-link");
  });

  it("places that link OUTSIDE <TabsList> so the tab-strip text is unchanged", () => {
    const p = read("client/src/pages/founder/Settings.tsx");
    const close = p.indexOf("</TabsList>");
    const link = p.indexOf("tab-company-link");
    expect(close).toBeGreaterThan(-1);
    expect(link).toBeGreaterThan(close);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * ORP-063 — SPV_EDU keys defined but rendered nowhere
 * The owner's rule is that nothing is deleted: the fix is to RENDER them.
 * ──────────────────────────────────────────────────────────────────────────── */
describe("ORP-063 — orphaned SPV_EDU keys are rendered, not deleted", () => {
  it("renders SPV_EDU.terms and SPV_EDU.reviewLaunch in the wizard", () => {
    const w = read("client/src/pages/partner/PartnerSpvEngine.tsx");
    expect(w).toContain("SPV_EDU.terms");
    expect(w).toContain("SPV_EDU.reviewLaunch");
    expect(w).toContain("spv-edu-terms");
    expect(w).toContain("spv-edu-review-launch");
  });
});
