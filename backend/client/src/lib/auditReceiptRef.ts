/**
 * WAVE 95 · ITEM 2 — a receipt reference a HUMAN can quote.
 *
 * R77 governs RENDERED TEXT: an internal machine value is a defect when a user
 * can read it, and is not a defect as a machine-readable value nobody sees. A
 * 64-character sha256 digest is the purest example of a machine value: it is
 * unquotable over the phone, unreadable at a glance, and it tells a partner
 * nothing. Register M-8 recorded one rendered verbatim on the partner SPV page.
 *
 * The full digest is NOT deleted (owner's rule: "I'd rather add than delete").
 * It stays on the row as a machine-readable `data-revision-hash` attribute, so
 * support, an integration and a `data-testid` reader all still have the exact
 * value. What a partner READS is the first four bytes of the same digest,
 * grouped and upper-cased, which is short enough to read aloud and is a
 * deterministic function of the full value — so the reference a partner quotes
 * always resolves to exactly one receipt by prefix.
 *
 * Returns null when the value is not a hex digest, so the caller renders an
 * explicit refusal rather than a mangled fragment (Rule 7: never a blank, never
 * a dash pretending to be data, never the string "undefined").
 */
export function auditReceiptReference(hash: string | null | undefined): string | null {
  const h = String(hash ?? "").trim();
  if (!/^[0-9a-fA-F]{8,}$/.test(h)) return null;
  const s = h.slice(0, 8).toUpperCase();
  return `${s.slice(0, 4)}-${s.slice(4, 8)}`;
}

export default auditReceiptReference;
