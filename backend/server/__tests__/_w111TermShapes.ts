/**
 * WAVE 111 — THE TERM SHAPES, AND WHAT IT MEANS FOR TWO SURFACES TO AGREE.
 *
 * A helper, not a test: `w111_before_disagreement_probe.test.ts` (the measurement of
 * the defect) and `w111_one_term_reader_agreement.test.ts` (the fence that every
 * surface reaches the same conclusion) both read the SAME 16 term shapes and the
 * SAME definition of agreement from here. Two copies of either would let the BEFORE
 * table and the AFTER fence drift apart, which is the same mistake at one remove.
 *
 * EVERY SHAPE IS ORDINARY PREFERENCE LANGUAGE. Nothing here is exotic input; each is
 * something a founder or an analyst would plausibly type into a free-text box.
 */

export type Shape = { id: string; note: string; liquidationPreference: unknown; capParticipation?: unknown };

/** The 13 + 3 term shapes. Every one of them is ordinary preference language. */
export const SHAPES: readonly Shape[] = [
  { id: "S01", note: "plain 1x non-participating, no cap", liquidationPreference: "1x non-participating" },
  { id: "S02", note: "1x participating, cap only in the numeric key", liquidationPreference: "1x participating", capParticipation: 3 },
  { id: "S03", note: "REPORTED A — text says 2x cap, key says 3", liquidationPreference: "1x participating, capped at 2x", capParticipation: 3 },
  { id: "S04", note: "REPORTED B — 2.5x cap in the wording only", liquidationPreference: "1x participating, capped at 2.5x" },
  { id: "S05", note: "cap asserted but not a number", liquidationPreference: "1x participating, cap TBD" },
  { id: "S06", note: "explicitly uncapped", liquidationPreference: "1x participating, uncapped" },
  { id: "S07", note: "participation stated, no multiple", liquidationPreference: "participating" },
  { id: "S08", note: "multiple stated, participation not stated", liquidationPreference: "1x preferred" },
  { id: "S09", note: "nothing recorded at all", liquidationPreference: null },
  { id: "S10", note: "key holds a word, not a multiple", liquidationPreference: "1x participating", capParticipation: "FULL_RATCHET" },
  { id: "S11", note: "cap below the preference multiple", liquidationPreference: "2x participating", capParticipation: 1.5 },
  { id: "S12", note: "cap recorded against a non-participating class", liquidationPreference: "1x non-participating", capParticipation: 2 },
  { id: "S13", note: "both sources agree at 3x", liquidationPreference: "1x participating, capped at 3x", capParticipation: 3 },
  { id: "S14", note: "cap in wording outside the domain", liquidationPreference: "1.5x participating, capped at 12x" },
  { id: "S15", note: "a SAFE valuation cap in the preference field", liquidationPreference: "1x participating, valuation cap $6m" },
  { id: "S16", note: "cap written as 'cap to 2x' — server phrase, not client phrase", liquidationPreference: "1x participating, cap to 2x", capParticipation: 2 },
];


/** The conclusion a surface COMMITS TO, as data rather than as prose. `undefined`
 *  means "this surface asserts nothing about that term" and is not compared. */
type Committed = {
  refuses: boolean;
  multiple?: number | null;
  participating?: boolean | null;
  /** The cap the surface commits to, as written. `null` = "there is no cap". */
  cap?: string | null;
};


/** Compare only the terms BOTH sides commit to. A cap is compared as a NUMBER
 *  where both are numeric, so "3" and "3.0" are the same cap and "FULL_RATCHET"
 *  is not a cap at all. */
export function committedAgree(a: Committed, b: Committed): boolean {
  if (a.refuses || b.refuses) return a.refuses === b.refuses;
  if (a.multiple !== undefined && b.multiple !== undefined && a.multiple !== b.multiple) return false;
  if (a.participating !== undefined && b.participating !== undefined && a.participating !== b.participating) return false;
  if (a.cap !== undefined && b.cap !== undefined) {
    if (a.cap === null || b.cap === null) return a.cap === b.cap;
    const na = Number(String(a.cap).replace(/\s*x$/i, ""));
    const nb = Number(String(b.cap).replace(/\s*x$/i, ""));
    if (!Number.isFinite(na) || !Number.isFinite(nb)) return String(a.cap) === String(b.cap);
    if (na !== nb) return false;
  }
  return true;
}


/* ── THE PRE-WAVE-111 CLIENT READER, TRANSCRIBED ──────────────────────────────
   `client/src/lib/termsheet/roundNegotiatedTerms.ts` MIRRORED the server's rules by
   hand and drifted on the cap: it knew "capped at", "cap of" and "participation cap
   of" but not the server's "cap to", and it had no concept of a cap that is on
   record and unreadable — it reported every such round as having NO cap. It now
   imports `shared/liquidationTermsReader.ts` instead, so the mirror is transcribed
   here to keep this BEFORE table reproducible for good. `w111_one_term_reader_agreement`
   is the test that holds the LIVE surfaces to the engine. */
export function legacyClientRead(s: Shape): { liqPrefMultiple: number | null; participating: boolean | null; capParticipation: string } {
  const raw = s.liquidationPreference === null || s.liquidationPreference === undefined
    ? null : (String(s.liquidationPreference).trim() === "" ? null : String(s.liquidationPreference).trim());
  const low = (raw ?? "").toLowerCase();
  let multiple: number | null = null;
  if (low !== "") {
    const m = /(^|[^0-9.])([0-9]+(?:\.[0-9]+)?)\s*x\b/.exec(low);
    if (m) { const n = Number(m[2]); if (Number.isFinite(n) && n > 0 && n <= 10) multiple = n; }
  }
  let participating: boolean | null = null;
  if (low !== "") {
    if (/non[-\s]?participating/.test(low)) participating = false;
    else if (/participating/.test(low)) participating = true;
  }
  const keyRaw = s.capParticipation === null || s.capParticipation === undefined
    ? null : (String(s.capParticipation).trim() === "" ? null : String(s.capParticipation).trim());
  let fromKey: number | null = null;
  if (keyRaw !== null && /^[0-9]+(\.[0-9]+)?\s*x?$/i.test(keyRaw)) {
    const n = Number(keyRaw.replace(/\s*x$/i, ""));
    if (Number.isFinite(n) && n > 0 && n <= 10) fromKey = n;
  }
  let fromText: number | null = null;
  if (low !== "") {
    const m = /(?:capped\s+at|cap\s+of|participation\s+cap\s+of)\s*([0-9]+(?:\.[0-9]+)?)\s*x\b/.exec(low)
      ?? /([0-9]+(?:\.[0-9]+)?)\s*x\s*(?:participation\s*)?cap\b/.exec(low);
    if (m) { const n = Number(m[1]); if (Number.isFinite(n) && n > 0 && n <= 10) fromText = n; }
  }
  let cap: number | null = null;
  if (fromKey !== null && fromText !== null) { if (fromKey === fromText) cap = fromKey; }
  else if (fromKey !== null) cap = fromKey;
  else if (fromText !== null) cap = fromText;
  return { liqPrefMultiple: multiple, participating, capParticipation: cap === null ? "" : String(cap) };
}

/** WHAT THE TERMS TAB COMMITTED TO BEFORE WAVE 111 — it read `capParticipation` and
 *  nothing else, so a cap written into the wording was invisible to it and a cap it
 *  could not read was printed as though it were a multiple. Transcribed from
 *  `client/src/pages/founder/RoundDetail.tsx` as it stood before this wave. */
export function legacyTermsTabCommitted(s: Shape): Committed {
  const stored = s.liquidationPreference === null || s.liquidationPreference === undefined ? "" : String(s.liquidationPreference).trim();
  if (stored === "") return { refuses: true };
  const participating = !/non[-\s]?participating/i.test(stored) && /participating/i.test(stored);
  const capRaw = s.capParticipation;
  const cap = capRaw === null || capRaw === undefined ? "" : String(capRaw).trim();
  return { refuses: false, participating, cap: participating ? (cap === "" ? null : cap) : undefined };
}

/** WHAT THE TERM SHEET COMMITTED TO BEFORE WAVE 111. */
export function legacyTermSheetCommitted(s: Shape): Committed {
  const x = legacyClientRead(s);
  if (x.liqPrefMultiple === null || x.participating === null) return { refuses: true };
  return {
    refuses: false,
    multiple: x.liqPrefMultiple,
    participating: x.participating,
    cap: x.participating ? (x.capParticipation === "" ? null : x.capParticipation) : undefined,
  };
}
