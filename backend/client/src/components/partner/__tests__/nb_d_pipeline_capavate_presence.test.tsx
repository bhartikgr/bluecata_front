/**
 * NUMBERS BAND · WAVE D · W326 — TESTS FOR THE PIPELINE PREDICATE FIX.
 *
 * WHAT THIS ASSERTS AND WHY IT IS SHAPED THIS WAY.
 *
 * §0 asserts PRECONDITIONS FIRST, because twenty-one consecutive waves on this
 * platform have found an inert mechanism inside their own evidence. In
 * particular it proves, by executing count, that the DEFECTIVE ORDER IS STILL
 * THE ORDER IN THE FILE — the visibility block still tests the promotion before
 * `d.companyId`. If someone later rewrites that ternary, these tests must not
 * keep passing as though they were still guarding something.
 *
 * §1 drives the four data shapes through a REAL render and asserts the RENDERED
 * TEXT a partner reads — not the source, not a class name (rule 2).
 *
 * §2 is the predicate proof: a company-less deal WITH a live promotion — the
 * exact row the old predicate swallowed — now states its own incompleteness.
 * A control with a company present proves the DISAGREEMENT, so a green here is
 * not an unconditionally-true predicate.
 *
 * §3 proves the pre-existing "Add to Capavate first" link is byte-untouched.
 *
 * §4 proves the orphan/legitimate DISTINCTION is real: the two verdicts differ,
 * and neither is reachable from the other's inputs.
 *
 * §5 pins this wave's own new copy, because THE GUARD CANNOT PROTECT A STRING
 * ADDED IN THE SAME WAVE — it diffs a stored baseline (rule 7). Independently
 * measured this wave: the guard does not even protect PartnerSpvEngine.tsx copy
 * that PRE-DATES the wave (NB_C_TESTS.md §7), so relying on it would be worse
 * than useless here.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import fs from "node:fs";
import path from "node:path";
import PipelineDealCapavatePresence, {
  PIPELINE_NO_CAPAVATE_COMPANY,
  PIPELINE_PUBLISHED_WITHOUT_COMPANY,
  PIPELINE_ONLY_BY_DESIGN,
  PIPELINE_COUNTERPART_PRESENT,
  PIPELINE_PRESENCE_UNREADABLE,
  PIPELINE_ADD_COMPANY_LINK_TEXT,
} from "../PipelineDealCapavatePresence";

const PIPELINE_PAGE = path.resolve(process.cwd(), "client/src/pages/partner/PartnerPipeline.tsx");
const COMPONENT = path.resolve(process.cwd(), "client/src/components/partner/PipelineDealCapavatePresence.tsx");

/* A read that silently returns nothing makes every `not.toContain` pass for
   free — a recorded inert mechanism ("a source file that parses to nothing").
   Refuse the read instead of trusting it. */
function readSrc(p: string): string {
  const s = fs.readFileSync(p, "utf8");
  if (s.length < 500) throw new Error(`REFUSING a suspiciously short read of ${p}: ${s.length} bytes`);
  return s;
}

type Sets = { portfolio?: unknown; clients?: unknown; failPortfolio?: boolean; hang?: boolean };

function renderWith(
  { companyId, published, sets }: { companyId: string | null; published: boolean; sets: Sets },
) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        queryFn: async ({ queryKey }) => {
          const key = String(queryKey[0]);
          if (sets.hang) return await new Promise(() => {});
          if (key.endsWith("/portfolio")) {
            if (sets.failPortfolio) throw new Error("boom");
            return { portfolio: sets.portfolio };
          }
          return { clients: sets.clients };
        },
      },
    },
  });
  render(
    <QueryClientProvider client={qc}>
      <PipelineDealCapavatePresence companyId={companyId} isPublishedToCollective={published} testid="tst" />
    </QueryClientProvider>,
  );
}

const BOTH_EMPTY: Sets = { portfolio: [], clients: [] };

afterEach(() => cleanup());

describe("NB wave D · §0 PRECONDITIONS — the thing I claim to be fixing is still there", () => {
  it("the visibility block STILL tests the promotion BEFORE d.companyId — the defective order", () => {
    const src = readSrc(PIPELINE_PAGE);
    const promoIdx = src.indexOf("{collectivePromo ? (");
    const companyIdx = src.indexOf(") : d.companyId ? (");
    expect(promoIdx).toBeGreaterThan(-1);
    expect(companyIdx).toBeGreaterThan(-1);
    /* The promotion test comes FIRST. That is the defect, and this wave fixes
       the DISPLAY consequence without reordering the ternary (which would move
       a guard-watched literal). If this ever flips, this test must be revisited
       rather than left passing. */
    expect(promoIdx).toBeLessThan(companyIdx);
  });

  it("the code's own written INVARIANT is still present, and is what the fix is measured against", () => {
    const src = readSrc(PIPELINE_PAGE);
    expect(src).toContain("INVARIANT: the company must be ON CAPAVATE");
  });

  it("the fix is mounted UNCONDITIONALLY at card level — NOT inside the canPromote block", () => {
    const src = readSrc(PIPELINE_PAGE);
    const mount = src.indexOf("<PipelineDealCapavatePresence");
    const iifeClose = src.indexOf("\n                      })()}");
    expect(mount).toBeGreaterThan(-1);
    expect(iifeClose).toBeGreaterThan(-1);
    /* Mounted AFTER the canPromote IIFE closes => not gated by it, and appended
       LAST as the guard's six rules require. */
    expect(mount).toBeGreaterThan(iifeClose);
  });

  it("the promotion set the fix matches is the SAME THREE STATUSES the defective block matches", () => {
    const src = readSrc(PIPELINE_PAGE);
    const occurrences = src.split('p.status === "pending_collective_review"').length - 1;
    /* Exactly two: the original predicate, and the card-level recomputation.
       A count assertion, not a boolean — if a third appears, someone has
       introduced a competing definition. */
    expect(occurrences).toBe(2);
  });

  /* ==================================================================
     A GREEN DISARM, FOUND AND CLOSED. The first version of this suite was
     disarmed seven ways and TWO of them produced a PASS:
       D1 — wrapping the mount in `{false && ...}` (the guard's own definition
            of SUPPRESSION) left every test green, because §0 only checked that
            the mount STRING was present and positioned, never that it was
            actually reachable.
       D2 — hard-coding `isPublishedToCollective={false}` left every test green,
            because the branch tests render the component DIRECTLY with props
            and never asserted that the PAGE wires the real signal into it.
            That is the recorded mechanism "a fence whose installation is
            unproved": the component was correct and unconnected.
     Both are now closed by pinning the mount JSX byte-exactly and by refusing
     any suppression form around it. D1 and D2 both go RED below.
     ================================================================== */
  it("THE MOUNT IS BYTE-PINNED — props wired to the real signals, not to constants (closes D2)", () => {
    const src = readSrc(PIPELINE_PAGE);
    expect(src).toContain(`<PipelineDealCapavatePresence
                        companyId={d.companyId ?? null}
                        isPublishedToCollective={publishedToCollective}
                        testid={\`deal-\${d.id}-capavate-presence\`}
                      />`);
  });

  it("THE MOUNT IS NOT SUPPRESSED — no `{false &&`, no `{null &&`, no comment-out (closes D1)", () => {
    const src = readSrc(PIPELINE_PAGE);
    const i = src.indexOf("<PipelineDealCapavatePresence");
    expect(i).toBeGreaterThan(-1);
    /* The guard treats `{false && …}` as SUPPRESSION rather than a drop, so it
       would not flag it. Read a window BEFORE the mount and refuse any of the
       forms that would render nothing. */
    const before = src.slice(Math.max(0, i - 400), i);
    expect(before).not.toContain("{false &&");
    expect(before).not.toContain("{null &&");
    expect(before).not.toContain("{0 &&");
    /* And the closing form must be a bare self-close, not `/>}`. */
    const after = src.slice(i, i + 400);
    expect(after).toContain("                      />\n");
    expect(after).not.toContain("/>}");
  });

  it("the page computes `publishedToCollective` itself and passes exactly that identifier", () => {
    const src = readSrc(PIPELINE_PAGE);
    expect(src).toContain("const publishedToCollective = promos.some(");
    expect(src.split("isPublishedToCollective={publishedToCollective}").length - 1).toBe(1);
    expect(src).not.toContain("isPublishedToCollective={false}");
    expect(src).not.toContain("isPublishedToCollective={true}");
  });

  it("exactly ONE mount, and the component file is real", () => {
    const src = readSrc(PIPELINE_PAGE);
    expect(src.split("<PipelineDealCapavatePresence").length - 1).toBe(1);
    expect(readSrc(COMPONENT).length).toBeGreaterThan(2000);
  });
});

describe("NB wave D · §1 + §2 THE PREDICATE FIX — what a partner now reads", () => {
  it("DEFECT ROW: no companyId AND published to the Collective → the card states its own incompleteness", async () => {
    renderWith({ companyId: null, published: true, sets: BOTH_EMPTY });
    expect((await screen.findByTestId("tst-no-company-note")).textContent).toBe(PIPELINE_NO_CAPAVATE_COMPANY);
    expect(screen.getByTestId("tst-published-without-company").textContent).toBe(PIPELINE_PUBLISHED_WITHOUT_COMPANY);
    expect(screen.getByTestId("tst-add-company-link").textContent).toBe(PIPELINE_ADD_COMPANY_LINK_TEXT);
  });

  it("no companyId and NOT published → the same incompleteness note, WITHOUT the contradiction sentence", async () => {
    renderWith({ companyId: null, published: false, sets: BOTH_EMPTY });
    expect((await screen.findByTestId("tst-no-company-note")).textContent).toBe(PIPELINE_NO_CAPAVATE_COMPANY);
    expect(screen.queryByTestId("tst-published-without-company")).toBeNull();
  });

  it("CONTROL — DISAGREEMENT: a deal WITH a company never renders the no-company branch", async () => {
    renderWith({ companyId: "co_x", published: true, sets: BOTH_EMPTY });
    await screen.findByTestId("tst-presence-verdict");
    expect(screen.queryByTestId("tst-no-company-note")).toBeNull();
    expect(screen.queryByTestId("tst-published-without-company")).toBeNull();
    expect(screen.queryByTestId("tst-add-company-link")).toBeNull();
  });

  it("the prompt is reachable in BOTH promo states — so it is no longer pre-emptable", async () => {
    renderWith({ companyId: null, published: true, sets: BOTH_EMPTY });
    expect(await screen.findByTestId("tst-add-company-link")).toBeTruthy();
    cleanup();
    renderWith({ companyId: null, published: false, sets: BOTH_EMPTY });
    expect(await screen.findByTestId("tst-add-company-link")).toBeTruthy();
  });
});

describe("NB wave D · §4 A LEGITIMATE PIPELINE-ONLY DEAL IS DISTINGUISHABLE FROM AN ORPHAN", () => {
  it("company on Capavate, in NEITHER list → deliberately pipeline-only, and it says so", async () => {
    renderWith({ companyId: "co_565574d281cd", published: false, sets: { portfolio: [{ companyId: "co_other" }], clients: [{ companyId: "co_other2" }] } });
    await waitFor(() => expect(screen.getByTestId("tst-presence-verdict").textContent).toBe(PIPELINE_ONLY_BY_DESIGN));
  });

  it("company in the PORTFOLIO list → counterpart present", async () => {
    renderWith({ companyId: "co_a", published: false, sets: { portfolio: [{ companyId: "co_a" }], clients: [] } });
    await waitFor(() => expect(screen.getByTestId("tst-presence-verdict").textContent).toBe(PIPELINE_COUNTERPART_PRESENT));
  });

  it("company in the CLIENTS list only → counterpart present", async () => {
    renderWith({ companyId: "co_b", published: false, sets: { portfolio: [], clients: [{ companyId: "co_b" }] } });
    await waitFor(() => expect(screen.getByTestId("tst-presence-verdict").textContent).toBe(PIPELINE_COUNTERPART_PRESENT));
  });

  it("THE TWO VERDICTS ARE GENUINELY DIFFERENT TEXT — the distinction is not cosmetic", () => {
    expect(PIPELINE_ONLY_BY_DESIGN).not.toBe(PIPELINE_COUNTERPART_PRESENT);
    expect(PIPELINE_ONLY_BY_DESIGN).toContain("deliberately pipeline-only");
    expect(PIPELINE_COUNTERPART_PRESENT).not.toContain("deliberately pipeline-only");
  });

  it("A FAILED LOOKUP IS NEVER DOWNGRADED INTO 'no counterpart' — the accusation is refused", async () => {
    renderWith({ companyId: "co_c", published: false, sets: { failPortfolio: true, clients: [] } });
    await waitFor(() => expect(screen.getByTestId("tst-presence-verdict").textContent).toBe(PIPELINE_PRESENCE_UNREADABLE));
    expect(screen.getByTestId("tst-presence-verdict").textContent).not.toContain("deliberately pipeline-only");
  });

  it("WHILE LOADING → the same honest 'unanswered', not a verdict", () => {
    renderWith({ companyId: "co_d", published: false, sets: { hang: true } });
    expect(screen.getByTestId("tst-presence-verdict").textContent).toBe(PIPELINE_PRESENCE_UNREADABLE);
  });

  it("FIVE unrecognised payload shapes all land on 'unanswered', never on a guess", async () => {
    const shapes: unknown[] = [null, undefined, {}, "portfolio", 7];
    let checked = 0;
    for (const shape of shapes) {
      cleanup();
      renderWith({ companyId: "co_e", published: false, sets: { portfolio: shape, clients: shape } });
      await waitFor(() => expect(screen.getByTestId("tst-presence-verdict").textContent).toBe(PIPELINE_PRESENCE_UNREADABLE));
      checked += 1;
    }
    /* Precondition on the loop's own iteration count. Wave B shipped a loop
       that iterated ZERO rows and passed. */
    expect(checked).toBe(5);
  });
});

describe("NB wave D · §3 THE PRE-EXISTING PROMPT WAS NOT TOUCHED", () => {
  it("the 'Add to Capavate first' anchor is byte-identical to its pinned form", () => {
    const src = readSrc(PIPELINE_PAGE);
    expect(src).toContain('data-testid={`add-to-capavate-hint-${d.id}`}');
    expect(src).toContain('href="/collective/partner/add-portfolio-company"');
    expect(src).toContain(">Add to Capavate first</a>");
    expect(src).toContain('title="Add this as a portfolio company on Capavate (cap table + rounds) before publishing to the Collective."');
  });

  it("this wave's own link text is DIFFERENT from the watched literal — no literal was duplicated or moved", () => {
    expect(PIPELINE_ADD_COMPANY_LINK_TEXT).not.toBe("Add to Capavate first");
    const src = readSrc(PIPELINE_PAGE);
    expect(src.split("Add to Capavate first").length - 1).toBe(2); // the <a> text and its comment
  });

  it("the two legitimate pipeline-only deals and the W327 row are NOT special-cased anywhere", () => {
    const both = readSrc(PIPELINE_PAGE) + readSrc(COMPONENT);
    for (const id of ["ppl_c48939581226cb6f", "ppl_fb144d6962cdce41", "ppl_00d987a07d1cd6e1", "ppl_8e6bd96a485a0f70", "co_565574d281cd", "co_fcd01b41dfd3"]) {
      expect(both).not.toContain(id);
    }
  });

  it("no currency is read, converted or defaulted by this wave (rule 13)", () => {
    const src = readSrc(COMPONENT);
    expect(src).not.toContain('|| "USD"');
    expect(src.toLowerCase()).not.toContain('|| "usd"');
    expect(src).not.toContain("x.currency");
  });
});

describe("NB wave D · §5 THIS WAVE'S OWN COPY, pinned because the guard cannot see it", () => {
  it("every new sentence is a full sentence, distinct, and free of raw codes and digits", () => {
    const all = [PIPELINE_NO_CAPAVATE_COMPANY, PIPELINE_PUBLISHED_WITHOUT_COMPANY, PIPELINE_ONLY_BY_DESIGN, PIPELINE_COUNTERPART_PRESENT, PIPELINE_PRESENCE_UNREADABLE];
    expect(new Set(all).size).toBe(5);
    for (const s of all) {
      expect(s.length).toBeGreaterThan(60);
      expect(s.endsWith(".")).toBe(true);
      expect(/\d/.test(s)).toBe(false);
      expect(/\b[A-Z]{3,}_[A-Z_]+\b/.test(s)).toBe(false);
      expect(s).not.toContain("companyId");
    }
  });

  it("the 'unanswered' sentence contains NEITHER real answer", () => {
    expect(PIPELINE_PRESENCE_UNREADABLE).not.toContain("deliberately pipeline-only");
    expect(PIPELINE_PRESENCE_UNREADABLE).not.toContain("also appears in your Portfolio");
    expect(PIPELINE_PRESENCE_UNREADABLE).toContain("unanswered");
  });

  it("the incompleteness note distinguishes an orphan from a deliberate deal IN WORDS", () => {
    expect(PIPELINE_NO_CAPAVATE_COMPANY).toContain("not a deliberate pipeline-only deal");
  });
});
