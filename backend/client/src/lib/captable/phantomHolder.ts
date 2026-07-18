/**
 * W-CAP LW-1 (2026-07-17) — phantom "Other" holder suppression.
 *
 * The empty (demo-seed) cap table can surface a nameless / "Other" placeholder
 * holder with zero shares and zero invested. It is a demo remnant, not a real
 * position, and it drives an inconsistent "Member value & intelligence" panel.
 *
 * A row is phantom (and must NOT render) ONLY when ALL hold:
 *   - the holder has no real identity (empty name, or the generic "Other"), AND
 *   - shares == 0, AND
 *   - invested == 0
 * Any real holder — any name, or any shares/invested — always renders.
 */
export function isPhantomHolderRow(row: {
  holderName?: unknown;
  shares?: unknown;
  invested?: unknown;
  orig?: { investmentAmount?: unknown } | null;
}): boolean {
  const name = String(row.holderName ?? "").trim();
  const isPhantomName = name === "" || name.toLowerCase() === "other";
  const sharesNum = Number(row.shares ?? 0) || 0;
  const investedNum = Number(row.invested ?? row.orig?.investmentAmount ?? 0) || 0;
  return isPhantomName && sharesNum === 0 && investedNum === 0;
}
