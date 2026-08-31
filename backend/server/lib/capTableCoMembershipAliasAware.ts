/**
 * WAVE 185 · ITEM A · R156.5 (Q7) — ALIAS-AWARE CO-MEMBERSHIP, WITHOUT A SECOND
 * DEFINITION OF WHO MAY SEE WHOM.
 * ══════════════════════════════════════════════════════════════════════════════
 * THE PROBLEM THIS SOLVES. `captable_commits.investor_id` holds TWO namespaces.
 * On the owner's database, 654 of 1017 rows carry an `ext_<hash>` ledger id
 * minted by the SPV / import paths, and 362 carry a canonical `u_*` user id.
 * Every authorisation question in the messaging path is asked with the canonical
 * id, so an investor whose commits are seated under `ext_*` compares against
 * nothing and resolves NO peers at all — R154.5's live symptom, where an
 * investor's recipient search offers only "New contact".
 *
 * WHY THIS FILE EXISTS AT ALL, AND WHY IT IS SO SMALL. The relationship "these
 * two people are cap-table counterparties" is defined in exactly ONE place:
 * SACRED `areCoMembersOnAnyCapTable` in `capTableMembership.ts` (WAIVER-4,
 * owner-signed 2026-08-11). That definition carries the SPV exclusion that keeps
 * two passive LPs in one vehicle from discovering each other. Re-implementing it
 * here with `IN (...)` in place of `= ?` would create a SECOND copy of a
 * confidentiality gate, free to drift away from the one the owner signed — and a
 * drifted copy of a privacy fence is a leak with a delay on it.
 *
 * So this module writes no SQL. It CALLS the sacred predicate, once per pair of
 * identifiers that could denote the two humans, and ORs the answers. Every fence
 * inside the sacred gate — `state = 'committed'`, `deleted_at IS NULL`, the
 * self-pair refusal, and critically the `notSpvBackedSql` SPV exclusion —
 * therefore applies unchanged to every pair asked. This wrapper CANNOT answer
 * `true` for a pair the owner-signed gate answers `false` for. That is the whole
 * safety argument, and it is an argument about structure rather than about care.
 *
 * WHAT IT CHANGES is strictly narrower than what it could change: only WHICH
 * IDENTIFIERS ARE UNDERSTOOD TO DENOTE THE SAME HUMAN. It widens the vocabulary,
 * never the policy.
 *
 * THE SELF-PAIR HAZARD, which is new and only exists because of aliasing. The
 * sacred gate refuses `a === b`, but it cannot know that `u_ozan` and
 * `ext_9f2c…` are the SAME PERSON. Asking it about that pair would return `true`
 * on any company that person holds, and the caller would then render the viewer
 * as their own co-investor. Both sides are canonicalised first and an equal
 * result is refused BEFORE any pair is asked.
 *
 * SEE ALSO wave 183's `membershipStore.derivedPositionsFor`, which established
 * this alias-union pattern for the investor PORTFOLIO read. This is deliberately
 * the same shape applied to a different read, not a second approach to one
 * problem.
 */
import { areCoMembersOnAnyCapTable } from "./capTableMembership";
import { resolveInvestorIdSet, resolveCanonicalUserId } from "./investorIdentityAliasStore";

const isValidId = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/**
 * TRUE when `viewerId` and `otherId` are cap-table counterparties under the
 * SACRED definition, evaluated across every identifier that denotes each of
 * them.
 *
 * Either argument may be a canonical `u_*` user id or a raw ledger id: both are
 * canonicalised, then expanded to their full alias set, before the sacred gate
 * is consulted.
 *
 * Fails CLOSED. With an empty `investor_identity_alias` table — which is the
 * state of the owner's database today — `resolveInvestorIdSet` returns
 * `[canonical]`, exactly one pair is asked, and the answer is byte-for-byte the
 * answer today's code gives. Nothing an existing investor can see changes until
 * an alias row genuinely exists.
 */
export function areCoMembersOnAnyCapTableAliasAware(viewerId: string, otherId: string): boolean {
  if (!isValidId(viewerId) || !isValidId(otherId)) return false;

  const viewerCanonical = resolveCanonicalUserId(viewerId.trim());
  const otherCanonical = resolveCanonicalUserId(otherId.trim());
  if (!isValidId(viewerCanonical) || !isValidId(otherCanonical)) return false;

  /* THE SELF-PAIR REFUSAL. Two identifiers for one human are not a counterparty
     relationship, and this is the one refusal the sacred gate cannot make on our
     behalf because it cannot see the alias table. */
  if (viewerCanonical === otherCanonical) return false;

  const viewerIds = resolveInvestorIdSet(viewerCanonical);
  const otherIds = resolveInvestorIdSet(otherCanonical);

  for (const a of viewerIds) {
    for (const b of otherIds) {
      /* Skip the degenerate pair rather than relying on the gate's own `a === b`
         refusal, so a mis-keyed alias row can never be laundered into a hit. */
      if (a === b) continue;
      if (areCoMembersOnAnyCapTable(a, b)) return true;
    }
  }
  return false;
}
