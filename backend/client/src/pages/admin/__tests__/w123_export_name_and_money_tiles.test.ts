/* ════════════════════════════════════════════════════════════════════════════
   WAVE 123 · FINDINGS 2 AND 3 — THE FILENAME THAT UNDID WAVE 117, AND THE ADMIN
                                 TILES THAT PUBLISHED $0 FOR "UNKNOWN".
   ════════════════════════════════════════════════════════════════════════════
   FINDING 2. `client/src/pages/founder/TermSheet.tsx` set

       a.download = `term-sheet-${id}.pdf`

   where `id` is the ROUND ID. A same-origin blob's `download` attribute overrides
   the server's `Content-Disposition`, so Wave 117's remediated slug-based
   filename never reached disk: the file landed carrying an internal round key and
   then travelled by email to investors and counsel. The name is now built from
   the SAME Wave 110 helper, `companyExportSlug()`, that the server's own header
   is built from.

   FINDING 3. `client/src/pages/admin/Dashboard.tsx` rendered
   `fmtUsd(data?.summary.totalFunded ?? 0)` and
   `fmtUsd(data?.summary.totalCommittedSoftCircle ?? 0)`. Both fields are
   deliberately `number | null` — Wave 116 made `dbTotalFunded()` return `null`
   when the platform total is not determinable, and the Collective surface returns
   a LITERAL `null` for both — and `fmtUsd` ALREADY renders `null` as an em-dash.
   The `?? 0` was the entire defect: a confident `$0` that means "unknown" is a
   false statement about money (R6). The tile's badge also read "Committed" while
   its label read "Soft-circled"; established from the WRITER
   (`dbTotalCommittedSoftCircle()` sums every non-deleted `soft_circles` row in
   every state), the label was right and the badge was wrong.

   WHY STATIC SOURCE ASSERTIONS. This is the house pattern for these two screens
   (`v25_collective_admin_pages.test.ts`, Wave 120's tile fence): the claims under
   test are which expression reaches the DOM and which helper builds the name, and
   reading the source proves exactly that without standing up a React tree. The
   ONE behavioural claim — what `companyExportSlug` produces — is executed.

   FAIL-BEFORE PROOF: run against the pre-wave tree, restored and hash-verified;
   verbatim output in `build_log/wave123/W123_TESTS.md`.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { companyExportSlug } from "@/lib/captable/exportProvenance";

const ADMIN_SRC = readFileSync(resolve(__dirname, "../Dashboard.tsx"), "utf8");
const TERMSHEET_SRC = readFileSync(
  resolve(__dirname, "../../founder/TermSheet.tsx"),
  "utf8",
);

/** The export handler only, so the assertions cannot pass on unrelated code. */
const EXPORT_FN = TERMSHEET_SRC.slice(
  TERMSHEET_SRC.indexOf("async function handleExportPdf"),
  TERMSHEET_SRC.indexOf("/* ------------ render ------------ */"),
);

/* ── FINDING 2 ─────────────────────────────────────────────────────────────── */
describe("(A) the founder's download carries no internal identifier", () => {
  it("no longer names the file after the round id", () => {
    expect(EXPORT_FN).not.toContain("`term-sheet-${id}.pdf`");
    expect(EXPORT_FN).not.toMatch(/a\.download\s*=\s*`[^`]*\$\{id\}/);
  });

  it("builds the name from the platform's ONE export-slug helper", () => {
    expect(EXPORT_FN).toContain("companyExportSlug(");
    expect(TERMSHEET_SRC).toContain('from "@/lib/captable/exportProvenance"');
  });

  it("passes the company NAME and never the company id to the slug helper", () => {
    expect(EXPORT_FN).toMatch(/companyExportSlug\(\s*\{\s*companyName:/);
    expect(EXPORT_FN).not.toMatch(/companyExportSlug\([^)]*companyId/);
  });

  it("the resulting filename is the server's shape and contains no key", () => {
    /* The same expression the component evaluates, on the company name this page
       displays, with a fixed date. */
    const filename = `${companyExportSlug({ companyName: "NovaPay Labs Inc." })}-term-sheet-2026-08-22.pdf`;
    expect(filename).toBe("novapay-labs-inc-term-sheet-2026-08-22.pdf");
    expect(filename).not.toMatch(/\brnd_/);
    expect(filename).not.toMatch(/\bco_/);
    expect(filename).not.toMatch(/[A-Z]/);
  });

  it("an unknown company name degrades to the neutral slug, never to an id", () => {
    expect(companyExportSlug({ companyName: null })).toBe("captable");
  });
});

/* ── FINDING 3 ─────────────────────────────────────────────────────────────── */
describe("(B) no admin money tile renders $0 for an unknown", () => {
  it("the funded tile passes the nullable field straight to the formatter", () => {
    expect(ADMIN_SRC).not.toContain("summary.totalFunded ?? 0");
    expect(ADMIN_SRC).toContain("fmtUsd(data?.summary.totalFunded ?? null)");
  });

  it("the soft-circle tile — the twin defect — does the same", () => {
    expect(ADMIN_SRC).not.toContain("summary.totalCommittedSoftCircle ?? 0");
    expect(ADMIN_SRC).toContain("fmtUsd(data?.summary.totalCommittedSoftCircle ?? null)");
  });

  it("the formatter both tiles use still renders an unknown as an em-dash", () => {
    expect(ADMIN_SRC).toMatch(/const fmtUsd = \(n: number \| null \| undefined\) => \(n == null \? "—"/);
    expect(ADMIN_SRC).toMatch(/const fmtUsdShort[\s\S]{0,80}n == null \? "—"/);
  });

  it("NO money-formatted figure on the screen coalesces a null to zero", () => {
    /* The enumeration is in build_log/wave123/W123_PREFLIGHT.md: eight money
       render sites. This fence fails if any of them is given `?? 0`. */
    const offenders = ADMIN_SRC.split("\n").filter((l) =>
      /(fmtUsd|fmtUsdShort|fmtCurrencyMinor)\([^)]*\?\?\s*0\b/.test(l),
    );
    expect(offenders).toEqual([]);
  });

  it("an unknown regional capital yields an unknown density, not a $0 density", () => {
    expect(ADMIN_SRC).not.toContain("r.raised / r.companies : 0");
    expect(ADMIN_SRC).toContain("r.raised / r.companies : null");
    /* And an unknown density must not sort as though it were the weakest real
       region: the comparator has to tolerate null. */
    expect(ADMIN_SRC).toMatch(/density \?\? -1/);
  });

  it("the three non-money `?? 0` sites are row COUNTS and are untouched", () => {
    expect(ADMIN_SRC).toContain("summary.totalCompanies ?? 0");
    expect(ADMIN_SRC).toContain("summary.totalInvestors ?? 0");
  });
});

describe("(C) the badge, the label and the arithmetic agree", () => {
  it("the badge is no longer a hardcoded word on the KPI-3 tile", () => {
    const tile = ADMIN_SRC.slice(
      ADMIN_SRC.indexOf('data-testid="stat-kpi-3"'),
      ADMIN_SRC.indexOf('data-testid="stat-kpi-4"'),
    );
    expect(tile).toContain("{copy.kpi3Badge}");
    expect(tile).not.toMatch(/>Committed</);
  });

  it("each surface declares its own badge, and the type requires it", () => {
    expect(ADMIN_SRC).toMatch(/kpi3Label: string; kpi3Help: string; kpi3Badge: string;/);
    expect(ADMIN_SRC).toContain('kpi3Label: "Soft-circled", kpi3Badge: "Non-binding"');
    expect(ADMIN_SRC).toContain('kpi3Label: "Committed via syndicates", kpi3Badge: "Committed"');
  });

  it("on Capavate the badge does not claim capital is committed", () => {
    const capavate = ADMIN_SRC.slice(
      ADMIN_SRC.indexOf("  capavate: {"),
      ADMIN_SRC.indexOf("  collective: {"),
    );
    expect(capavate).toMatch(/kpi3Badge: "Non-binding"/);
    expect(capavate).not.toMatch(/kpi3Badge: "Committed"/);
  });

  it("the help text records what the sum actually covers", () => {
    expect(ADMIN_SRC).toContain("includes soft-circles in every state");
    expect(ADMIN_SRC).toContain("not committed or wired capital");
  });

  it("the reason is recorded against the writer, not against the other copy", () => {
    expect(ADMIN_SRC).toContain("dbTotalCommittedSoftCircle()");
    expect(ADMIN_SRC).toContain("deleted_at IS NULL");
  });
});
