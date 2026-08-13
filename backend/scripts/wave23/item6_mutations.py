#!/usr/bin/env python3
"""WAVE 23 · ITEM 6 mutation matrix — jurisdiction-filtered SPV doc types."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "wave21"))
from mutate import Mutation, run_matrix  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
E = "shared/spvEngine.ts"
C = "client/src/components/partner/SpvDetailTabs.tsx"

MUTATIONS = [
    Mutation(
        name="M1-filter-disabled",
        target=E,
        anchor="  if (spvJurisdictionCompliance(input).isUnitedStates) return SPV_DOC_TYPES;\n  return SPV_DOC_TYPES.filter((t) => !SPV_US_ONLY_DOC_TYPES.includes(t));",
        replacement="  return SPV_DOC_TYPES;",
        why="the exact defect restored: every jurisdiction sees Form D and blue-sky",
    ),
    Mutation(
        name="M2-us-loses-formd",
        target=E,
        anchor="  if (spvJurisdictionCompliance(input).isUnitedStates) return SPV_DOC_TYPES;",
        replacement="  if (false) return SPV_DOC_TYPES;",
        why="over-correction: a Delaware SPV loses filings it genuinely needs",
    ),
    Mutation(
        name="M3-blue-sky-leaks",
        target=E,
        anchor='export const SPV_US_ONLY_DOC_TYPES: readonly SpvDocType[] = ["formd", "blue_sky"];',
        replacement='export const SPV_US_ONLY_DOC_TYPES: readonly SpvDocType[] = ["formd"];',
        why="half the leak stays open — blue-sky still offered to a Cayman vehicle",
    ),
    Mutation(
        name="M4-string-compare-not-ontology",
        target=E,
        anchor="  if (spvJurisdictionCompliance(input).isUnitedStates) return SPV_DOC_TYPES;",
        replacement='  if (String(input ?? "").toLowerCase() === "delaware") return SPV_DOC_TYPES;',
        why="bypasses resolveSpvJurisdiction — 'Delaware, USA' and 'United States' break",
    ),
    Mutation(
        name="M5-enum-narrowed",
        target=E,
        anchor='export const SPV_DOC_TYPES = [\n  "formation", "operating_agreement", "subscription", "formd", "blue_sky", "kyc", "tax",\n] as const;',
        replacement='export const SPV_DOC_TYPES = [\n  "formation", "operating_agreement", "subscription", "kyc", "tax",\n] as const;',
        why="the persisted enum is narrowed instead of the display filtered — orphans existing rows",
    ),
    Mutation(
        name="M6-dropdown-unwired",
        target=C,
        anchor="              {docTypes.map((t) => <option key={t} value={t}>{docTypeLabels[t] ?? t}</option>)}",
        replacement="              {SPV_DOC_TYPES.map((t) => <option key={t} value={t}>{docTypeLabels[t] ?? t}</option>)}",
        why="the helper exists but the dropdown still renders the raw enum — the review's actual finding",
    ),
    Mutation(
        name="M7-stale-selection-submitted",
        target=C,
        anchor="    if (!(docTypes as readonly string[]).includes(docType)) setDocType(docTypes[0]);",
        replacement="    /* MUTANT: no reset */",
        why="a now-disallowed selection survives a jurisdiction change and is submitted",
    ),
    Mutation(
        name="M8-invented-foreign-type",
        target=E,
        anchor="  return SPV_DOC_TYPES.filter((t) => !SPV_US_ONLY_DOC_TYPES.includes(t));",
        replacement='  return [...SPV_DOC_TYPES.filter((t) => !SPV_US_ONLY_DOC_TYPES.includes(t)), "cima_notification" as SpvDocType];',
        why="fabricates a foreign document type the ontology never verified",
    ),
]

if __name__ == "__main__":
    sys.exit(
        run_matrix(
            ROOT,
            ["npx", "tsx", "scripts/wave23/item6_doctype_jurisdiction_harness.ts"],
            MUTATIONS,
            "ITEM6",
        )
    )
