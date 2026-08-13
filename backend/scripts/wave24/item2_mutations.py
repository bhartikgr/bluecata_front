#!/usr/bin/env python3
"""WAVE 24 · ITEMS 1&2 mutation matrix — orphaned-endpoint reachability.

Every mutation below is a way the wave could be WRONG while still compiling and
still looking wired. Four of them attack the HARNESS itself rather than the
product, because a reachability checker that silently degrades into a grep is
exactly the failure this build has paid for twelve times.
"""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "wave21"))
from mutate import Mutation, run_matrix  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]

PS = "client/src/pages/admin/PlatformSurfaces.tsx"
BO = "client/src/pages/admin/AdminPartnerBillingOps.tsx"
INV = "client/src/pages/admin/Investors.tsx"
PART = "client/src/pages/admin/Partners.tsx"
CD = "client/src/pages/admin/CompanyDetail.tsx"
ALIAS = "client/src/components/admin/InvestorAliasAdminPanel.tsx"
REACH = "scripts/wave24/reachability.ts"
RER = "server/lib/reportingEngineRoutes.ts"
APP = "client/src/App.tsx"

MUTATIONS = [
    # ── product mutations: the wiring comes undone ────────────────────────
    Mutation(
        name="M1-item1-panel-unmounted",
        target=PS,
        anchor="<MarkOverrideReviewPanel />",
        replacement="<div data-testid=\"mark-reviews-placeholder\" />",
        why="ITEM 1 regresses to the exact dead end: the decision endpoint exists, no UI reaches it",
    ),
    Mutation(
        name="M2-invoicing-tab-unmounted",
        target=BO,
        anchor="{tab === \"invoicing\" && <AdminInvoicingOpsPanel />}",
        replacement="{tab === \"invoicing\" && <div />}",
        why="the invoicing panel exists as a file but nothing renders it — 'not shipped'",
    ),
    Mutation(
        name="M3-alias-panel-import-removed",
        target=INV,
        anchor="        <InvestorAliasAdminPanel />\n",
        replacement="",
        why="the alias component drops out of the import graph and becomes unreachable again",
    ),
    Mutation(
        name="M4-funnel-panel-unmounted",
        target=PART,
        anchor="        <PartnerFunnelMetricsPanel />\n",
        replacement="",
        why="AD-4 funnel metrics go back to having zero UI callers",
    ),
    Mutation(
        name="M5-company-mark-behind-false",
        target=CD,
        anchor="{c && <CompanyMarkPanel companyId={c.id} />}",
        replacement="{false && <CompanyMarkPanel companyId={c.id} />}",
        why="the subtle one: imported, grep-visible, mounted behind a constant false — rendered never",
    ),
    Mutation(
        name="M6-alias-revoke-call-removed",
        target=ALIAS,
        anchor='`/api/admin/investor-aliases/${encodeURIComponent(id)}/revoke`',
        replacement='`/api/admin/investor-aliases/${encodeURIComponent(id)}`',
        why="the revoke endpoint loses its only caller while the panel still looks complete",
    ),
    Mutation(
        name="M7-server-route-renamed",
        target=RER,
        anchor='app.get("/api/admin/investor-aliases", requireAdmin',
        replacement='app.get("/api/admin/investor-aliases-v2", requireAdmin',
        why="the UI points at a path the server no longer serves — wired to nothing",
    ),
    Mutation(
        name="M8-refragmented-into-new-route",
        target=APP,
        anchor='import AdminPartners from "@/pages/admin/Partners";',
        replacement='import AdminPartners from "@/pages/admin/Partners";\nimport { PartnerFunnelMetricsPanel } from "@/components/admin/PartnerFunnelMetricsPanel";',
        why="re-fragmenting the admin surface into a standalone route — what lost RS-1 and RS-2 in July",
    ),
    # ── harness mutations: the checker degrades into a check of nothing ───
    Mutation(
        name="M9-reachability-returns-everything",
        target=REACH,
        anchor="    if (src.includes(token)) hits.push(path.relative(process.cwd(), f));",
        replacement="    if (src.includes(token) || true) hits.push(path.relative(process.cwd(), f));",
        why="HARNESS: reachableCallers stops filtering — every row would pass vacuously",
    ),
    Mutation(
        name="M10-graph-resolves-nothing",
        target=REACH,
        anchor="  const out: string[] = [];\n  for (const m of src.matchAll(SPEC_RE)) out.push(m[1]);\n  return out;",
        replacement="  const out: string[] = [];\n  return out;",
        why="HARNESS: the import graph collapses to the roots — reachability becomes meaningless",
    ),
    Mutation(
        name="M11-alias-resolution-broken",
        target=REACH,
        anchor='  if (spec.startsWith("@/")) base = path.join(CLIENT_SRC, spec.slice(2));',
        replacement='  if (spec.startsWith("@/")) return null;',
        why="HARNESS: the @/ alias stops resolving, so almost nothing is reachable and POLE A must go red",
    ),
    Mutation(
        name="M12-wholetree-scan-scans-reachable",
        target=REACH,
        anchor="  walk(CLIENT_SRC);\n  return hits.sort();",
        replacement="  return [];",
        why="HARNESS: the B3 control's whole-tree half stops working, so the filter could be a no-op undetected",
    ),
]

if __name__ == "__main__":
    sys.exit(
        run_matrix(
            ROOT,
            ["npx", "tsx", "scripts/wave24/item2_orphan_reachability_harness.ts"],
            MUTATIONS,
            "ITEM2",
        )
    )
