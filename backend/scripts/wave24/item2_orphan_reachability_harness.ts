/**
 * WAVE 24 · ITEMS 1 & 2 — falsification harness for "the eleven orphaned admin
 * endpoints now have a UI".
 *
 * BOTH POLES, as the brief requires:
 *   POLE A (positive) For each endpoint: the ROUTE exists in the pinned server
 *          file, AND at least one client file that is REACHABLE from the app
 *          root calls it, AND the component holding that call is MOUNTED in
 *          JSX on a page that App.tsx routes.
 *   POLE B (negative control) The machinery must be able to say NO. Three
 *          controls run every time:
 *            B1 a synthetic endpoint token that exists nowhere must return
 *               zero reachable callers;
 *            B2 a synthetic component written into `client/src` and imported
 *               by nothing must be computed UNREACHABLE — this is the exact
 *               shape of the bug (file exists, grep finds it, nothing mounts
 *               it), so a checker that cannot detect it is checking nothing;
 *            B3 a token present ONLY in that unreachable file must be found by
 *               the whole-tree scan and NOT by the reachable scan. Without B3
 *               the reachability filter could be a no-op and A would still
 *               pass.
 *
 * WHY B2/B3 EXIST AT ALL. Twelve checks in this build passed while checking
 * nothing. A reachability harness whose graph silently resolved to "everything
 * is reachable" would report eleven green rows and mean nothing.
 *
 * Run: cd /home/user/workspace/work && npx tsx scripts/wave24/item2_orphan_reachability_harness.ts
 */
import fs from "node:fs";
import path from "node:path";
import { reachableFiles, reachableCallers, allClientFilesContaining, CLIENT_SRC } from "./reachability";

let asserts = 0;
const failures: string[] = [];
function ok(cond: boolean, label: string) {
  asserts++;
  if (!cond) failures.push(label);
}

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

/* ── the inventory, each row re-verified at source before being listed ──────
   `serverFile` + `serverToken` prove the route still exists where FINAL REVIEW
   B pinned it (line numbers move; the registration string does not).
   `clientToken` is the literal a caller must contain — chosen to match the
   TEMPLATE form actually used, so a harness cannot pass on a comment. */
type Row = {
  id: string;
  serverFile: string;
  serverToken: string;
  clientToken: string;
  /** The page whose JSX must mount the panel, and the mount expression. */
  mountFile: string;
  mountToken: string;
};

const ROWS: Row[] = [
  /* ITEM 1 — the mark-override review surface. */
  {
    id: "GET /api/reporting/mark-overrides",
    serverFile: "server/lib/reportingEngineRoutes.ts",
    serverToken: 'app.get("/api/reporting/mark-overrides"',
    clientToken: "`/api/reporting/mark-overrides${qs}`",
    mountFile: "client/src/pages/admin/PlatformSurfaces.tsx",
    mountToken: "<MarkOverrideReviewPanel />",
  },
  {
    id: "POST /api/admin/reporting/mark-overrides/:id/decision",
    serverFile: "server/lib/reportingEngineRoutes.ts",
    serverToken: 'app.post("/api/admin/reporting/mark-overrides/:id/decision"',
    clientToken: "/api/admin/reporting/mark-overrides/${encodeURIComponent(row.id)}/decision",
    mountFile: "client/src/pages/admin/PlatformSurfaces.tsx",
    mountToken: "<MarkOverrideReviewPanel />",
  },
  {
    id: "GET /api/admin/reporting/config",
    serverFile: "server/lib/reportingEngineRoutes.ts",
    serverToken: 'app.get("/api/admin/reporting/config"',
    clientToken: 'apiRequest("GET", "/api/admin/reporting/config")',
    mountFile: "client/src/pages/admin/PlatformSurfaces.tsx",
    mountToken: "<MarkOverrideReviewPanel />",
  },
  {
    id: "PUT /api/admin/reporting/config/:key",
    serverFile: "server/lib/reportingEngineRoutes.ts",
    serverToken: 'app.put("/api/admin/reporting/config/:key"',
    clientToken: "/api/admin/reporting/config/${encodeURIComponent(APPROVAL_MODE_KEY)}",
    mountFile: "client/src/pages/admin/PlatformSurfaces.tsx",
    mountToken: "<MarkOverrideReviewPanel />",
  },

  /* ITEM 2 — partner billing cluster. */
  {
    id: "POST /api/admin/partner-billing/invoices",
    serverFile: "server/lib/wave14MoneyRoutes.ts",
    serverToken: 'app.post("/api/admin/partner-billing/invoices"',
    clientToken: '"/api/admin/partner-billing/invoices"',
    mountFile: "client/src/pages/admin/AdminPartnerBillingOps.tsx",
    mountToken: "<AdminInvoicingOpsPanel />",
  },
  {
    id: "POST /api/admin/partner-billing/commission-split",
    serverFile: "server/lib/wave14MoneyRoutes.ts",
    serverToken: 'app.post("/api/admin/partner-billing/commission-split"',
    clientToken: '"/api/admin/partner-billing/commission-split"',
    mountFile: "client/src/pages/admin/AdminPartnerBillingOps.tsx",
    mountToken: "<AdminInvoicingOpsPanel />",
  },
  {
    id: "GET /api/admin/partner-billing/money-events",
    serverFile: "server/lib/wave14MoneyRoutes.ts",
    serverToken: 'app.get("/api/admin/partner-billing/money-events"',
    clientToken: "/api/admin/partner-billing/money-events?",
    mountFile: "client/src/pages/admin/AdminPartnerBillingOps.tsx",
    mountToken: "<AdminInvoicingOpsPanel />",
  },

  /* ITEM 2 — investor aliases (EN-3 admin half). */
  {
    id: "GET /api/admin/investor-aliases",
    serverFile: "server/lib/reportingEngineRoutes.ts",
    serverToken: 'app.get("/api/admin/investor-aliases"',
    clientToken: "`/api/admin/investor-aliases${qs}`",
    mountFile: "client/src/pages/admin/Investors.tsx",
    mountToken: "<InvestorAliasAdminPanel />",
  },
  {
    id: "POST /api/admin/investor-aliases",
    serverFile: "server/lib/reportingEngineRoutes.ts",
    serverToken: 'app.post("/api/admin/investor-aliases"',
    clientToken: 'apiRequest("POST", "/api/admin/investor-aliases"',
    mountFile: "client/src/pages/admin/Investors.tsx",
    mountToken: "<InvestorAliasAdminPanel />",
  },
  {
    id: "POST /api/admin/investor-aliases/:aliasInvestorId/revoke",
    serverFile: "server/lib/reportingEngineRoutes.ts",
    serverToken: 'app.post("/api/admin/investor-aliases/:aliasInvestorId/revoke"',
    clientToken: "/api/admin/investor-aliases/${encodeURIComponent(id)}/revoke",
    mountFile: "client/src/pages/admin/Investors.tsx",
    mountToken: "<InvestorAliasAdminPanel />",
  },

  /* ITEM 2 — partner lifecycle funnel. NOTE the path correction: FINAL REVIEW
     B cites `server/lib/adminPartnerLifecycleRoutes.ts`; the file is at
     `server/adminPartnerLifecycleRoutes.ts`. */
  {
    id: "GET /api/admin/partners/metrics/funnel",
    serverFile: "server/adminPartnerLifecycleRoutes.ts",
    serverToken: '"/api/admin/partners/metrics/funnel"',
    clientToken: 'apiRequest("GET", "/api/admin/partners/metrics/funnel")',
    mountFile: "client/src/pages/admin/Partners.tsx",
    mountToken: "<PartnerFunnelMetricsPanel />",
  },

  /* ITEM 2 — company mark compute + freeze. */
  {
    id: "GET /api/reporting/companies/:companyId/mark",
    serverFile: "server/lib/reportingEngineRoutes.ts",
    serverToken: 'app.get("/api/reporting/companies/:companyId/mark"',
    clientToken: "/api/reporting/companies/${encodeURIComponent(companyId)}/mark`",
    mountFile: "client/src/pages/admin/CompanyDetail.tsx",
    mountToken: "<CompanyMarkPanel companyId={c.id} />",
  },
  {
    id: "POST /api/reporting/companies/:companyId/mark/persist",
    serverFile: "server/lib/reportingEngineRoutes.ts",
    serverToken: 'app.post("/api/reporting/companies/:companyId/mark/persist"',
    clientToken: "/api/reporting/companies/${encodeURIComponent(companyId)}/mark/persist`",
    mountFile: "client/src/pages/admin/CompanyDetail.tsx",
    mountToken: "<CompanyMarkPanel companyId={c.id} />",
  },
];

function main(): number {
  const reachable = reachableFiles();

  /* ═══ POLE B FIRST — if the machinery cannot say NO, POLE A is worthless. */

  // B1 — a token that exists nowhere.
  ok(
    reachableCallers("/api/admin/this-endpoint-does-not-exist-w24", reachable).length === 0,
    "B1 CONTROL: a nonexistent endpoint token reported reachable callers",
  );

  // B2 / B3 — a real file inside client/src that nothing imports.
  const decoyPath = path.join(CLIENT_SRC, "components", "__w24_decoy_unmounted__.tsx");
  const DECOY_TOKEN = "/api/__w24_decoy_endpoint__";
  fs.writeFileSync(
    decoyPath,
    `// WAVE 24 harness decoy — written and deleted by\n` +
      `// scripts/wave24/item2_orphan_reachability_harness.ts. Imported by nothing.\n` +
      `export function W24Decoy() { return fetch("${DECOY_TOKEN}"); }\n`,
  );
  try {
    const freshReachable = reachableFiles();
    ok(!freshReachable.has(decoyPath), "B2 CONTROL: an unimported component was computed REACHABLE — the graph is vacuous");
    const wholeTree = allClientFilesContaining(DECOY_TOKEN);
    const reachableOnly = reachableCallers(DECOY_TOKEN, freshReachable);
    ok(wholeTree.length === 1, `B3 CONTROL: whole-tree scan found ${wholeTree.length} decoy files, expected 1`);
    ok(
      reachableOnly.length === 0,
      "B3 CONTROL: the reachability filter is a no-op — it returned the unmounted decoy",
    );
  } finally {
    fs.rmSync(decoyPath, { force: true });
  }
  ok(!fs.existsSync(decoyPath), "B2 CLEANUP: the decoy file was left behind");

  /* ═══ POLE A — every endpoint is genuinely wired. */
  for (const r of ROWS) {
    const serverSrc = read(r.serverFile);
    ok(serverSrc.includes(r.serverToken), `${r.id}: route registration not found in ${r.serverFile}`);

    const callers = reachableCallers(r.clientToken, reachable);
    ok(callers.length >= 1, `${r.id}: NO reachable client caller (this is the orphan defect)`);

    const mountSrc = read(r.mountFile);
    ok(mountSrc.includes(r.mountToken), `${r.id}: panel is not mounted in ${r.mountFile} (${r.mountToken})`);

    /* The mount page must itself be reachable, or the mount is decoration. */
    ok(
      reachable.has(path.join(ROOT, r.mountFile)),
      `${r.id}: mount page ${r.mountFile} is NOT reachable from the app root`,
    );

    /* Module reachability cannot see a mount rendered behind a constant false
       — the documented limit of this technique. Closed here for the pages
       Wave 24 touches by asserting no dead JSX guard exists on them at all,
       which is cheap and would go red on `{false && <Panel />}`. */
    ok(!/\{\s*false\s*&&/.test(mountSrc), `${r.id}: ${r.mountFile} renders JSX behind a constant false — mounted nowhere in practice`);
  }

  /* ═══ Consolidation, which the brief asked for explicitly: NO new routes. */
  const app = read("client/src/App.tsx");
  for (const bad of ["MarkOverrideReviewPanel", "AdminInvoicingOpsPanel", "InvestorAliasAdminPanel", "PartnerFunnelMetricsPanel", "CompanyMarkPanel"]) {
    ok(!app.includes(bad), `CONSOLIDATION: ${bad} was given its own route in App.tsx instead of a tab/panel on an existing page`);
  }

  console.log(`\nITEM2 REACHABILITY HARNESS: ${asserts} assertions, ${failures.length} failed`);
  for (const f of failures) console.log(`  FAIL ${f}`);
  if (failures.length === 0) console.log("ITEM2 REACHABILITY HARNESS: PASS");
  return failures.length === 0 ? 0 : 1;
}

process.exit(main());
