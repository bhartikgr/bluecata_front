/**
 * WAVE 166 · BATCH 3 ITEM D (D-2 / D-3) — REGISTRATION BINDS A DIRECT-ADDED LP
 * TO THE POSITION THAT IS ALREADY WAITING FOR THEM.        R131.2 · R134.6 · R139.5
 *
 * THE DEFECT THIS CLOSES, verified at source rather than where cited.
 *   A GP direct-adds an LP by email (Path 2). Every ledger row for that human is
 *   keyed under the deterministic synthetic id `ext_<sha256(lower(trim(email)))[0:16]>`
 *   (`lpIdentity.lpInvestorIdForEmail`). Later that human registers. `registerPersona`
 *   (SACRED `server/lib/userContext.ts:797`, verified this wave) mints
 *   `u_redeemed_${Date.now()}` — a TIMESTAMP, unrelated to the email hash. Nothing
 *   joined the two. The owner's requirement in R131.2 is that the position is
 *   "already there waiting for them, not created afresh"; what actually happened is
 *   that the LP registered into an empty account while their position sat in the
 *   ledger under an id nobody would ever resolve.
 *
 * WHY THIS LIVES IN A NEW FILE AND NOT IN `registerPersona`.
 *   `server/lib/userContext.ts` is SACRED (`sacred_baseline/SACRED_SHA256.txt:16`)
 *   and carries no waiver, so it is CALL-ONLY. The binding therefore hangs off the
 *   registration ROUTES, which are not sacred, immediately after the persona id
 *   exists. The spec's D-2 instruction to "wire it into registration" is satisfied
 *   at the only layer where editing is permitted.
 *
 * THE MATCHING RULE, STATED SO IT CAN BE CHECKED LATER.
 *   EXACT, NORMALISED EMAIL EQUALITY AND NOTHING ELSE. The alias id is derived
 *   from the registrant's own verified registration email by the ONE derivation in
 *   `lpIdentity.lpInvestorIdForEmail` (trim, then lower-case). There is no fuzzy
 *   matching, no name matching, no domain matching and no "closest match": a caller
 *   cannot ask to be bound to somebody else's id because the id is computed FROM
 *   their own email and is never read from a request body. This is R132.5's
 *   "no fuzzy name matching on LP identity" as executable code.
 *
 * WHAT HAPPENS WHEN IT IS AMBIGUOUS: IT REFUSES. IT NEVER MERGES.        R134.6 · R139.5
 *   Ambiguity here has exactly one shape — the derived id is ALREADY claimed by a
 *   DIFFERENT canonical user. `claimAlias` refuses that with `ALIAS_ALREADY_CLAIMED`
 *   rather than repointing (`investorIdentityAliasStore.ts:278-289`), and this module
 *   does NOT catch that refusal and continue. It returns an explicit
 *   `outcome: "refused"` carrying a plain sentence for a human, and it writes
 *   NOTHING. Two people merged into one LP position is the worst outcome available
 *   in this batch and it is not recoverable by a later correction, so there is no
 *   "best guess" branch here and no fallback that picks one. If this ever needs to
 *   resolve, a human resolves it.
 *
 * REGISTRATION IS NEVER BLOCKED BY A BINDING PROBLEM.
 *   A refusal or an infrastructure failure must not stop a person creating their
 *   account — that would turn a data-quality question into a lockout. The outcome is
 *   RETURNED to the caller to record and surface; it is never thrown at the
 *   registrant. This is the one place the fail-closed direction is "bind nothing",
 *   not "deny the user", because binding nothing is visibly incomplete while
 *   denying the user is silently broken.
 */
import {
  claimAlias,
  externalIdHasLedgerRows,
  getActiveAlias,
  resolveInvestorIdSet,
  AliasError,
} from "./investorIdentityAliasStore";
import { lpInvestorIdForEmail, normaliseLpEmail } from "./lpIdentity";
import { log } from "./logger";
import { rawDb } from "../db/connection";

/**
 * The tenant recorded ON the alias row. Read from the registrant's own `users`
 * row, because that is the tenant the person actually belongs to.
 *
 * `tenant_id` on `investor_identity_alias` is a GROUPING/reporting column —
 * `getActiveAlias` looks an alias up by alias id alone and does not filter by
 * tenant, so this value is not a security boundary and a fallback here cannot
 * widen anybody's access. It is still resolved properly rather than hard-coded,
 * so the audit trail says something true.
 */
function tenantForUser(canonicalUserId: string): string {
  try {
    const row = rawDb()
      .prepare(`SELECT tenant_id FROM users WHERE id = ? LIMIT 1`)
      .get(canonicalUserId) as { tenant_id?: string } | undefined;
    const t = String(row?.tenant_id ?? "").trim();
    if (t) return t;
  } catch {
    /* falls through to the explicit unknown marker below */
  }
  /* Named, not blank: a blank tenant on an audit row is indistinguishable from a
     bug, whereas this value says exactly what happened. */
  return "tenant_unresolved_at_registration";
}

/** What the binding attempt did. Four outcomes, none of them a silent merge. */
export type LpBindingOutcome =
  /** An alias now links the LP's synthetic ledger id to their new account. */
  | "bound"
  /** Already linked to THIS person — idempotent, nothing to do. */
  | "already_bound"
  /** Nothing to bind: no ledger rows exist under the derived id. */
  | "nothing_to_bind"
  /** The derived id belongs to somebody else. REFUSED. A human must resolve it. */
  | "refused";

export interface LpBindingResult {
  outcome: LpBindingOutcome;
  /** The deterministic synthetic id derived from the registrant's own email. */
  derivedId: string;
  /** Plain-language sentence, safe to render to a person. Never a raw code. */
  message: string;
  /** Machine code for logs and audit. Never rendered raw (R77). */
  code: string;
  /** Present only on `refused`, so an operator can see who holds the id. */
  conflictingCanonicalUserId?: string;
}

/**
 * R77 — plain-language copy exists BEFORE anything can be thrown or surfaced.
 * Every outcome above has a sentence here; there is no default branch that could
 * let a raw code reach a person's eye.
 */
const LP_BINDING_COPY: Readonly<Record<LpBindingOutcome, string>> = {
  bound:
    "We found an existing investment recorded against your email address and linked it to your new account.",
  already_bound:
    "Your existing investment records are already linked to this account.",
  nothing_to_bind:
    "No existing investment records were found for your email address.",
  refused:
    "We found existing investment records for your email address, but they are already linked to a different account. " +
    "We have not changed anything. Please contact support so a person can confirm which account they belong to.",
};

/** The machine codes, one per outcome. Kept beside the copy so neither drifts. */
const LP_BINDING_CODES: Readonly<Record<LpBindingOutcome, string>> = {
  bound: "LP_IDENTITY_BOUND",
  already_bound: "LP_IDENTITY_ALREADY_BOUND",
  nothing_to_bind: "LP_IDENTITY_NOTHING_TO_BIND",
  refused: "LP_IDENTITY_BINDING_REFUSED_AMBIGUOUS",
};

function result(
  outcome: LpBindingOutcome,
  derivedId: string,
  extra?: { conflictingCanonicalUserId?: string },
): LpBindingResult {
  return {
    outcome,
    derivedId,
    message: LP_BINDING_COPY[outcome],
    code: LP_BINDING_CODES[outcome],
    ...(extra?.conflictingCanonicalUserId
      ? { conflictingCanonicalUserId: extra.conflictingCanonicalUserId }
      : {}),
  };
}

/**
 * Bind a freshly-registered account to any LP position already recorded against
 * the same email. Call immediately after the persona id exists.
 *
 * Returns an outcome; NEVER throws for a binding problem. The only inputs that
 * yield `nothing_to_bind` without a probe are an unusable email or a missing
 * canonical id — both of which mean there is nothing that could be bound.
 */
export function bindLpIdentityOnRegistration(input: {
  tenantId: string;
  email: unknown;
  canonicalUserId: string;
}): LpBindingResult {
  const email = normaliseLpEmail(input.email);
  const canonical = String(input.canonicalUserId ?? "").trim();
  /* An unusable email must never be hashed into an id: `lpInvestorIdForEmail`
     returns "" precisely so that nobody is ever seated under a hash of the empty
     string, and every LP with a blank email would otherwise collide onto ONE id
     — a mass merge, which is the exact failure D-3 exists to prevent. */
  const derivedId = lpInvestorIdForEmail(email);
  if (!email || !derivedId || !canonical) return result("nothing_to_bind", derivedId);

  /* Only bind when a position actually exists. An alias row for a position that
     does not exist is a row of pure noise the next audit has to explain, and it
     would also pre-claim the id against the real owner arriving later. */
  let hadLedgerRows = false;
  try {
    hadLedgerRows = externalIdHasLedgerRows(derivedId);
  } catch (err) {
    log.warn(
      `[w166] LP binding probe failed for ${derivedId}: ${(err as Error).message}. ` +
        `Binding nothing; registration proceeds and the read path still resolves aliases.`,
    );
    return result("nothing_to_bind", derivedId);
  }
  if (!hadLedgerRows) return result("nothing_to_bind", derivedId);

  /* THE AMBIGUITY CHECK, BEFORE THE WRITE. `claimAlias` refuses this too, and
     that refusal is the real fence; checking here as well means the refusal is
     reported with the conflicting holder named, which is what a human needs in
     order to resolve it. Belt and braces on the one path that could merge two
     people's money. */
  try {
    const existing = getActiveAlias(derivedId);
    if (existing) {
      if (existing.canonicalUserId === canonical) {
        return result("already_bound", derivedId);
      }
      log.warn(
        `[w166] LP binding REFUSED: ${derivedId} is already claimed by ` +
          `${existing.canonicalUserId}; registrant ${canonical} was NOT merged into it.`,
      );
      return result("refused", derivedId, {
        conflictingCanonicalUserId: existing.canonicalUserId,
      });
    }
  } catch (err) {
    /* If we cannot READ the alias table we must not WRITE to it: an unreadable
       conflict is indistinguishable from no conflict, and guessing here is the
       merge. Fail closed by binding nothing. */
    log.warn(
      `[w166] LP binding could not read alias state for ${derivedId}: ${(err as Error).message}. ` +
        `Refusing to write rather than risk a merge.`,
    );
    return result("nothing_to_bind", derivedId);
  }

  try {
    claimAlias({
      tenantId: input.tenantId,
      aliasInvestorId: derivedId,
      canonicalUserId: canonical,
      matchEmail: email,
      /* `email_verified` is the correct basis and its meaning is unchanged: the id
         was derived from the caller's own registration email, not supplied by
         them. See the safety note at `claimAlias`. */
      basis: "email_verified",
      actorId: canonical,
    });
    return result("bound", derivedId);
  } catch (err) {
    if (err instanceof AliasError && err.code === "ALIAS_ALREADY_CLAIMED") {
      /* Lost a race with another registration between the read and the write.
         Still a refusal — never a repoint. */
      let holder: string | undefined;
      try {
        holder = getActiveAlias(derivedId)?.canonicalUserId ?? undefined;
      } catch {
        /* naming the holder is a nicety; refusing is the requirement */
      }
      log.warn(
        `[w166] LP binding REFUSED on write for ${derivedId} (raced): ${err.code}. Nothing merged.`,
      );
      return result("refused", derivedId, { conflictingCanonicalUserId: holder });
    }
    /* Schema missing, or any other infrastructure failure. Bind nothing and let
       the person finish registering; the read path degrades to canonical-only,
       which shows them less rather than showing them somebody else's. */
    log.warn(
      `[w166] LP binding failed for ${derivedId}: ${(err as Error).message}. Registration proceeds unbound.`,
    );
    return result("nothing_to_bind", derivedId);
  }
}

/**
 * The ONE line each registration route calls. Resolves the tenant itself so the
 * three call sites (`lib/authRoutes.ts`, `routes.ts` legacy redeem, `routes.ts`
 * modern redeem) stay identical to each other and cannot drift apart.
 *
 * Never throws. The result is logged here so that even a caller that ignores the
 * return value leaves a record of what happened to this person's position, and
 * a REFUSAL is logged at warn level because a human has to act on it.
 */
export function bindLpIdentityAfterRegistration(
  personaId: string,
  email: unknown,
  where: string,
): LpBindingResult {
  let r: LpBindingResult;
  try {
    r = bindLpIdentityOnRegistration({
      tenantId: tenantForUser(personaId),
      email,
      canonicalUserId: personaId,
    });
  } catch (err) {
    /* Defence in depth. `bindLpIdentityOnRegistration` is written not to throw;
       if it ever does, a person's account creation must still succeed. */
    log.warn(`[w166] LP binding threw unexpectedly at ${where}: ${(err as Error).message}`);
    return {
      outcome: "nothing_to_bind",
      derivedId: "",
      message: LP_BINDING_COPY.nothing_to_bind,
      code: LP_BINDING_CODES.nothing_to_bind,
    };
  }
  if (r.outcome === "refused") {
    log.warn(
      `[w166] ${r.code} at ${where}: derived=${r.derivedId} registrant=${personaId} ` +
        `heldBy=${r.conflictingCanonicalUserId ?? "unknown"}. NOTHING WAS MERGED.`,
    );
  } else {
    log.info?.(`[w166] ${r.code} at ${where}: derived=${r.derivedId} user=${personaId}`);
  }
  return r;
}

/* ══════════════════════════════════════════════════════════════════════════════
 * WAVE 166 · BATCH 3 ITEM D (D-4) — THE READ SIDE.
 * ══════════════════════════════════════════════════════════════════════════════
 * Binding writes an alias row. Nothing READ it: `lpRosterForViewer` matched
 * `x.investorId === viewerInvestorId` on the canonical id only
 * (`spvEngineStore.ts:2041`, verified this wave), and every query in
 * `lpPositionsStore.ts` bound a single `investor_id`. So a bound LP was still
 * shown `NOT_AN_LP`, and the alias table was decoration.
 *
 * The fix widens WHICH IDS ARE ME. It does not widen what an LP may see, does not
 * touch a status filter, and does not touch an aggregate: `resolveInvestorIdSet`
 * returns `[canonical, ...active aliases]` and FAILS CLOSED to `[canonical]` on
 * any error (`investorIdentityAliasStore.ts:146-168`), so the worst case is
 * today's behaviour.
 */

/** Every id that IS this viewer: their canonical id plus active aliases. */
export function viewerInvestorIds(canonicalUserId: string): string[] {
  const id = String(canonicalUserId ?? "").trim();
  if (!id) return [];
  try {
    const set = resolveInvestorIdSet(id);
    return set.length ? set : [id];
  } catch {
    /* Fail closed to canonical-only: showing an LP less than they own is
       recoverable, showing them somebody else's position is not. */
    return [id];
  }
}

/**
 * Thrown when ONE human resolves to TWO seats in the SAME vehicle.
 *
 * This is the second shape of ambiguity, and it is the one that appears at READ
 * time rather than at binding time: an LP was seated under their derived email id
 * AND, separately, under their account id, and both rows survive. Summing them
 * would invent a commitment nobody signed for; picking one with `LIMIT 1` would
 * silently hide real money. So the read REFUSES and says so, and a human decides
 * which row is real. Refusing is loud, wrong numbers are not.
 */
export class LpIdentityAmbiguityError extends Error {
  readonly code = "LP_POSITION_AMBIGUOUS";
  /** R77 — plain-language copy attached at construction, before it can be thrown. */
  readonly plainMessage =
    "We found more than one investment record for you in this vehicle and cannot tell which one is correct, " +
    "so we have not shown a figure. Nothing has been changed or combined. Please contact support and a person will resolve it.";
  constructor(readonly spvId: string, readonly matchedIds: readonly string[]) {
    super(`LP_POSITION_AMBIGUOUS:${spvId}:${matchedIds.join(",")}`);
    this.name = "LpIdentityAmbiguityError";
  }
}

/**
 * Pick the ONE id under which this viewer holds a row, from `candidateIds`, using
 * `probe` to test each. Returns null when they hold none. REFUSES when more than
 * one matches — never sums, never picks.
 */
export function soleMatchingInvestorId<T>(
  spvId: string,
  candidateIds: readonly string[],
  probe: (investorId: string) => T | null,
): { investorId: string; row: T } | null {
  const hits: Array<{ investorId: string; row: T }> = [];
  for (const id of candidateIds) {
    const row = probe(id);
    if (row !== null && row !== undefined) hits.push({ investorId: id, row });
  }
  if (hits.length === 0) return null;
  if (hits.length > 1) {
    throw new LpIdentityAmbiguityError(spvId, hits.map((h) => h.investorId));
  }
  return hits[0];
}
