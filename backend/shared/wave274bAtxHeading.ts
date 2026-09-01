/* ============================================================================
 * WAVE 274b · R221.4 — PRESENTATION ONLY. THE BYTES DO NOT CHANGE.
 * ==========================================================================
 *
 * THE DEFECT
 * ----------
 * The legal confirmation panels quote the SIGNED Consortium Partner Agreement by
 * SLICING it at render time (`wave211AgreementSection`,
 * `consortiumAgreementSection`). Every such slice starts at a markdown ATX
 * heading marker, so the first line of every quote reaches the screen as
 *
 *     ## 5. SPV Formation & Administration
 *     ## 4. Eligibility, Licensing & Regulatory Compliance
 *
 * — hash marks and all. R221.4: "the attestations the audit called genuinely
 * best-in-class legal candor are presented as an unstyled string dump."
 *
 * THE CONSTRAINT THAT SHAPES THIS MODULE
 * --------------------------------------
 * R197.4: the quote is a slice of an EXECUTED instrument. Editing the words would
 * break the binding. So this module may not rewrite, re-wrap, re-case, re-trim or
 * re-flow ANYTHING. It performs exactly one operation: it tells the caller where
 * the first line ends and which leading characters of that first line are the
 * markdown marker, so the caller can render that line AS a heading element and
 * the rest of the slice unchanged.
 *
 * There is NO normalising call anywhere in this file — no `.trim()`, no
 * `.toLowerCase()`, no whitespace collapse. Wave 212 shipped a green test that was
 * blind to its own subject because a helper called `.trim()` (R200). The bytes are
 * the subject.
 *
 * THE INVARIANT, AND WHY IT IS THE WHOLE POINT
 * --------------------------------------------
 * For EVERY string `s`:
 *
 *     wave274bReassembleAtxHeading(wave274bSplitAtxHeading(s)) === s
 *
 * exactly, byte for byte, with no exceptions and no normalisation on either side.
 * The split is therefore lossless: `marker` is the only thing that leaves the
 * screen, and a caller can prove its own rendering by reading back one DOM
 * `textContent` and prepending `marker`.
 *
 * `separator` exists solely so that the invariant holds for a single-line input
 * (no `\n` at all) as well as for a multi-line one. Without it a reassembly would
 * have to GUESS whether to re-insert a newline, and a guess is not a proof.
 */

/** The lossless decomposition of a sliced agreement section. */
export interface Wave274bHeadingSplit {
  /** True when the first line is a markdown ATX heading (`#`…`######` + one space). */
  hasHeading: boolean;
  /**
   * The exact characters removed from the front of the first line — e.g. `"## "`.
   * `""` when `hasHeading` is false. This is the ONLY thing not rendered.
   */
  marker: string;
  /** Heading depth: the number of `#` characters. `0` when `hasHeading` is false. */
  level: number;
  /**
   * The first line with ONLY `marker` removed from its front. Nothing trimmed,
   * nothing collapsed, nothing re-cased. When `hasHeading` is false this is the
   * whole first line, verbatim.
   */
  heading: string;
  /** `"\n"` when the source contained a newline after the first line, else `""`. */
  separator: string;
  /** Everything after the first `"\n"`, verbatim. `""` when there was none. */
  body: string;
}

/**
 * An ATX heading marker: one to six `#` followed by exactly one space.
 *
 * Anchored, and it requires the trailing space, so a line that merely BEGINS with
 * `#` (e.g. a clause numbered `#3 of the schedule`) is not mistaken for a heading
 * and is left completely alone. Six is markdown's maximum depth.
 */
const WAVE274B_ATX_MARKER = /^(#{1,6} )/;

/**
 * Split a sliced agreement section into its heading marker, heading text and body.
 *
 * Never throws. A non-string, or a string with no ATX first line, comes back with
 * `hasHeading: false` and `marker: ""`, which is the caller's signal to render the
 * slice exactly as it does today.
 */
export function wave274bSplitAtxHeading(source: string): Wave274bHeadingSplit {
  const s = typeof source === "string" ? source : "";
  const nl = s.indexOf("\n");
  const firstLine = nl < 0 ? s : s.slice(0, nl);
  const separator = nl < 0 ? "" : "\n";
  const body = nl < 0 ? "" : s.slice(nl + 1);

  const m = WAVE274B_ATX_MARKER.exec(firstLine);
  if (m === null) {
    return {
      hasHeading: false,
      marker: "",
      level: 0,
      heading: firstLine,
      separator,
      body,
    };
  }
  const marker = m[1];
  return {
    hasHeading: true,
    marker,
    level: marker.length - 1,
    heading: firstLine.slice(marker.length),
    separator,
    body,
  };
}

/**
 * Put the pieces back together. Used by the fences to prove losslessness.
 *
 * NO normalisation. If this ever stops returning the exact input bytes, the
 * heading rendering is editing an executed agreement and must be reverted.
 */
export function wave274bReassembleAtxHeading(split: Wave274bHeadingSplit): string {
  return split.marker + split.heading + split.separator + split.body;
}

/**
 * What the SCREEN must contain: the whole slice minus the marker characters.
 *
 * A renderer proves itself with one assertion:
 *   `split.marker + node.textContent === source`
 * which is the same statement as
 *   `node.textContent === wave274bRenderedText(split)`.
 */
export function wave274bRenderedText(split: Wave274bHeadingSplit): string {
  return split.heading + split.separator + split.body;
}
