/**
 * WAVE 207 · ITEM A — THE SWEEP, AS A STANDING FENCE.
 * ═══════════════════════════════════════════════════════════════════════════════════
 *
 * The owner's instruction: "Sweep for it; do not fix only the one I quoted." A sweep done
 * once is a claim about a moment; this file makes it a property of the tree, so a future
 * wave that reintroduces a capital basis in copy fails here rather than shipping.
 *
 * HOW IT AVOIDS THE TWO WAYS THIS KIND OF TEST GOES WRONG:
 *
 *   1. COMMENTS ARE STRIPPED BEFORE ANY CONCLUSION IS DRAWN. Wave 207's own comments
 *      quote the capital wording extensively, precisely because R143.1 requires the
 *      history to stay legible. Counting prose as copy would make this test unfixable.
 *      (Comments only — string literals are exactly what is being inspected.)
 *   2. THE RETAINED LITERALS ARE DECLARED, WITH A REASON, RATHER THAN GREPPED AROUND.
 *      R143.1 forbids replacing a literal, so the wave-188/165 capital sentences still
 *      exist in the tree on unreachable arms. Each is listed below with the file it
 *      lives in and why it is allowed to remain. Anything NOT on that list fails.
 *
 * The list is an exact expectation, not a floor: a retained literal that is later deleted
 * ALSO fails here, which is the R143.1 half of the same fence.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import {
  W207_VEHICLE_FEE_BASIS,
  W207_BANDING_KEPT_SENTENCE,
} from "../../shared/wave207FeeBasisDimension";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..");

/** Remove `//` and block comments, preserving newlines so line numbers stay true. */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      const j = src.indexOf("\n", i);
      i = j === -1 ? n : j;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const j = src.indexOf("*/", i + 2);
      const end = j === -1 ? n : j + 2;
      out += " " + "\n".repeat((src.slice(i, end).match(/\n/g) ?? []).length);
      i = end;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

/** The phrases that describe a vehicle fee as varying with capital. */
const FORBIDDEN = [
  "confirmed capital at that moment",
  "Based on confirmed capital",
  "size of the vehicle",
  "stepped size bands",
  "the band the confirmed capital falls into",
];

/**
 * Every place a forbidden phrase is ALLOWED to remain, and why. Keyed by repo-relative
 * path. `arm` records what makes the literal unreachable in production.
 */
/**
 * Every place a forbidden phrase is ALLOWED to remain, and why — declared LITERAL BY
 * LITERAL, not merely file by file. File-level granularity was tried first and the
 * adversarial disarm defeated it: deleting one retained wave-188 sentence still left
 * other capital literals in the same file, so the check stayed green while R143.1 was
 * being broken. Each literal below must be present, byte-for-byte.
 */
const RETAINED: Array<{ file: string; why: string; literals: string[] }> = [
  {
    file: "client/src/pages/admin/AdminFeesConsolidated.tsx",
    why:
      "R143.1 — the wave-188 W188_FEE_KIND_WHEN/_BASIS literals and the two wave-131/wave-5 " +
      "SectionTitle hints are kept byte-identical on the capital-basis arm, which migration " +
      "0217's CHECK constraint makes unselectable for any row the database will accept.",
    literals: [
      "Charged once, when this SPV is marked Deployed. Based on confirmed capital at that moment — soft-circled interest is not counted.",
      "The size of the vehicle. Each size band below has its own amount, and the band the confirmed capital falls into is the one that is charged.",
      "SPV deployment fees use stepped size bands.",
    ],
  },
  {
    file: "client/src/pages/admin/PartnerFeeSchedules.tsx",
    why: "R143.1 — the wave-131 page-header sentence, retained verbatim on the capital-basis arm.",
    literals: ["SPV deployment fees use stepped size bands."],
  },
  {
    file: "client/src/pages/partner/PartnerBilling.tsx",
    why: "R143.1 — the wave-165 AGG_FEE_KIND_TRIGGERS literal, retained on the capital-basis arm.",
    literals: [
      "Charged once, when this SPV is marked Deployed. Based on confirmed capital at that moment — soft-circled interest is not counted.",
    ],
  },
  {
    file: "client/src/components/__tests__/wave188_admin_fees_readable_dom.test.tsx",
    why: "The test that PROVES the retained wave-188 literal still renders on the capital-basis arm.",
    literals: [
      "Charged once, when this SPV is marked Deployed. Based on confirmed capital at that moment — soft-circled interest is not counted.",
      "size of the vehicle",
    ],
  },
  {
    file: "client/src/pages/partner/__tests__/wave207_fee_basis_copy_dom.test.tsx",
    why: "The wave-207 DOM tests assert these phrases are ABSENT from the rendered surfaces.",
    literals: ["confirmed capital at that moment", "size of the vehicle", "stepped size band"],
  },
  {
    file: "server/__tests__/wave207_capital_basis_copy_sweep.test.ts",
    why: "This file declares the phrases it forbids and the literals it permits.",
    literals: ["confirmed capital at that moment", "size of the vehicle", "stepped size bands"],
  },
];

describe("W207 — no surface describes the vehicle fee as capital-based", () => {
  const files = [
    ...walk(path.join(ROOT, "client", "src")),
    ...walk(path.join(ROOT, "shared")),
  ];

  it("T207.J0: the sweep actually reads a substantial number of files", () => {
    /* A sweep over an empty list also passes. */
    expect(files.length).toBeGreaterThan(200);
  });

  it("T207.J1: every occurrence of capital-basis copy is a DECLARED retained literal", () => {
    const byFile = new Map(RETAINED.map((r) => [r.file, r.literals]));
    const offenders: string[] = [];
    for (const f of files) {
      const rel = path.relative(ROOT, f);
      const code = stripComments(fs.readFileSync(f, "utf8"));
      for (const phrase of FORBIDDEN) {
        if (!code.includes(phrase)) continue;
        const declared = byFile.get(rel);
        /* Allowed only if this file declares a retained literal that CONTAINS the
           phrase — a file cannot be blanket-exempted. */
        if (!declared || !declared.some((lit) => lit.includes(phrase))) {
          offenders.push(`${rel}: "${phrase}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("T207.J2: R143.1 — every declared retained literal is STILL THERE, byte-for-byte", () => {
    const missing: string[] = [];
    for (const r of RETAINED) {
      const full = path.join(ROOT, r.file);
      if (!fs.existsSync(full)) {
        missing.push(`${r.file}: file absent`);
        continue;
      }
      const code = stripComments(fs.readFileSync(full, "utf8"));
      for (const lit of r.literals) {
        if (!code.includes(lit)) {
          missing.push(`${r.file}: retained literal missing — "${lit.slice(0, 60)}…" was replaced, not appended`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("T207.J4: the fee-schedules header's spelled-out sentence still equals the shared constants", () => {
    /* That page must carry a PLAIN STRING LITERAL in its `description` attribute, or the
       silent-drop guard stops seeing it as copy at all. A spelled-out string can drift
       from the shared constant it was copied from, so the equality is asserted here. */
    const src = fs.readFileSync(
      path.join(ROOT, "client", "src", "pages", "admin", "PartnerFeeSchedules.tsx"),
      "utf8",
    );
    expect(src).toContain(`${W207_VEHICLE_FEE_BASIS} ${W207_BANDING_KEPT_SENTENCE}"`);
    /* …and it is a literal, not an expression: no `{` before the closing quote's attribute. */
    expect(src).toMatch(/description="Optional OVERRIDES/);
  });

  it("T207.J3: every retained literal carries a stated reason", () => {
    for (const r of RETAINED) expect(r.why.length, r.file).toBeGreaterThan(40);
  });
});
