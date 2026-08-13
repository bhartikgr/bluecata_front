#!/usr/bin/env python3
"""WAVE 21 · ITEM 6 mutation matrix."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent))
from mutate import Mutation, run_matrix  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
FEEHUB = "client/src/pages/admin/FeeHub.tsx"
DISCUSS = "client/src/components/investor/DiscussWithCapTableDialog.tsx"
DETAILS = "client/src/pages/CompanyDetails.tsx"

MUTATIONS = [
    Mutation("M1-price-rehardcoded", FEEHUB,
             "This is where the live per-tier price lives",
             "This is where e.g. the Catalyst $499/mo price lives",
             "the hardcoded price example returns"),
    Mutation("M2-different-price-hardcoded", FEEHUB,
             "The BASE subscription price per tier is set on",
             "The BASE subscription price per tier (e.g. Catalyst = $1299/mo) is set on",
             "a DIFFERENT hardcoded price — the assertion must not be pinned to 499"),
    Mutation("M3-commission-rehardcoded", FEEHUB,
             "Per-tier commission %, set and stored per tier.",
             "Per-tier commission % (catalyst 2%, builder 3%, etc.).",
             "the hardcoded commission rates return"),
    Mutation("M4-tbd-returns", DISCUSS,
             '  const buyerClause = buyer ? ` — top buyer ${buyer}` : "";',
             '  const buyerClause = ` — top buyer ${buyer || "TBD"}`;',
             "TBD is composed back into an outbound message body"),
    Mutation("M5-empty-buyer-asserted", DISCUSS,
             '  const buyer = (topBuyer ?? "").trim();',
             '  const buyer = String(topBuyer ?? "unknown");',
             "an absent buyer becomes the asserted string 'unknown'"),
    Mutation("M6-reset-path-drifts", DISCUSS,
             "      setMessageBody(composeDiscussBody(companyName, topBuyer, maScore));",
             '      setMessageBody(`Discussing M&A signal on ${companyName} — top buyer ${topBuyer || "TBD"}, M&A score ${maScore}/100.`);',
             "only the re-open path regresses — the original two-copy drift"),
    Mutation("M7-empty-state-removed", DETAILS,
             "{!coMembersLoadedInThisView && (",
             "{false && (",
             "the empty-state explanation is suppressed, restoring a silently blank card"),
    Mutation("M8-empty-state-says-nothing", DETAILS,
             "The cap-table co-member list is not loaded in this shared company view. Open this company from your investor dashboard to see it.",
             "Coming Soon",
             "the honest explanation is replaced by a bare 'Coming Soon'"),
    Mutation("M9-real-list-deleted", DETAILS,
             "{coMembers.map(m => {",
             "{[].map((m: any) => {",
             "the real rendering is deleted rather than left ready to wire"),
]

if __name__ == "__main__":
    sys.exit(run_matrix(ROOT, ["npx", "tsx", "scripts/wave21/item6_placeholder_harness.ts"], MUTATIONS, "ITEM6"))
