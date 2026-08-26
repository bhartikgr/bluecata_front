/* ═══════════════════════════════════════════════════════════════════════════
   WAVE 154 · BATCH 2 · ITEM K — THE SPV ELIGIBILITY GATE.
                                     R112.3(3), R113.3, R114, R114.3, R116.3, R77
   ═══════════════════════════════════════════════════════════════════════════
   THE RULE BEING ENFORCED. An SPV may only be LAUNCHED, and money may only be
   taken IN, when EVERY company that SPV invests into holds a CURRENT PAID
   Capavate membership. A multi-company SPV needs EVERY one of its companies paid
   — one lapsed company blocks the launch (R116.3).

   THE THREE THINGS THIS MODULE REFUSES TO DO
   ──────────────────────────────────────────
   1. IT NEVER TURNS A READ FAILURE INTO "UNPAID". This is why the module exists
      at all. Two existing readers collapse three states into two:
        · `resolveCompanyFacts` (server/spvEngineStore.ts:310-311) wraps the
          subscription read in `try { … } catch { paidSubscriber = false; }`
        · sacred `resolveCanonicalPlan` (server/lib/canonicalPlanResolver.ts:62-65)
          does the same
      A dropped connection, a locked file, or a renamed table would therefore be
      indistinguishable from a customer who never paid — and would refuse a paying
      customer's launch while telling them they had not paid. R112.3(3) forbids
      that. This reader returns THREE states:
        "paid"    — a row says so.
        "unpaid"  — the rows were read successfully and none of them is current.
        "unknown" — the read itself failed. NOT a fact about the customer.
   2. IT NEVER PERSISTS A DECISION. There is no `is_eligible` column, no cached
      map, no memoisation. Every call re-reads. A company that pays at 14:02 can
      launch at 14:02 — no cron, no backfill, no flag to repair, and no stale
      "blocked" state surviving a payment.
   3. IT NEVER HIDES, DELETES, OR WITHHOLDS AN EXISTING RECORD. A freeze blocks
      MONEY-IN only. Every LP keeps every document, statement, position, and
      history entry they had before. DISTRIBUTIONS AND TRANSFERS ARE NOT FROZEN:
      money already committed keeps flowing OUT to the people it belongs to, and
      an LP may still exit. Freezing an investor's own money to collect a
      platform fee from a third party would be indefensible.

   WHICH DIRECTION "UNKNOWN" FAILS
   ───────────────────────────────
   Deliberately asymmetric, per the owner's ruling:
     · LAUNCH  — unknown fails CLOSED. Launching is a new, deferrable commitment;
                 the correct answer to "we cannot tell" is "not yet, ask us".
     · FREEZE  — unknown fails OPEN. Freezing an operating vehicle on the strength
                 of a read error would break paying customers to enforce a rule we
                 could not even evaluate. A platform fault must not look like a
                 customer default.

   MEMBERSHIP IS BILLING-FREQUENCY BLIND (R113.3). Monthly, annual, lifetime,
   comped — any CURRENT PAID membership qualifies. `billingCycle` is never read by
   this module, and a test pins that.

   REFUSAL WORDING (R77). Every refusal is a plain sentence naming the company and
   the next step — never a bare code. The AUDIENCE SPLIT is enforced here rather
   than left to each caller: a partner or an admin is told WHICH company and what
   to do; an LP is told only that the vehicle is not open, with no other company's
   billing status disclosed. An unreadable membership renders as "Not on record"
   — never "unpaid", never a blank.
   ═══════════════════════════════════════════════════════════════════════════ */
import { rawDb } from "../db/connection";
/* SACRED, CALL-ONLY: server/subscriptionStore.ts:372-384 `listForCompany` is the
   one authoritative reader of `capavate_subscriptions`. It is called, never
   copied and never modified — but note that it THROWS when the driver is
   unavailable, which is exactly the signal this module needs and the existing
   callers above discard. */
import { listForCompany, type CapavateSubscription } from "../subscriptionStore";
import { readConfigRow, ensurePlatformConfigKey } from "./platformConfigWriter";
import { listActiveOverrides } from "./spvLaunchGateOverrideStore";
/* R122.2 — the creating partner's OWN account standing. A partner membership is
   a `partner_subscription` row (subject_kind='partner'), a DIFFERENT table from
   `capavate_subscriptions`: the partner pays $840/yr for its own account (R110),
   a portfolio company pays for its company membership. Both are read live and
   neither is ever cached here. */
import {
  getActiveForSubject,
  getGrandfatheredForSubject,
} from "./partnerSubscriptionStore";
/* WAVE 155 — the ADMIN-GRANTED (COMPED) membership ledger. R123.1/R124.4.3: with
   zero rows in `capavate_subscriptions` and the payment path unconfigured, an
   `enforced` gate had NO clearable path at all. A comped grant satisfies the
   readers below exactly as a paid membership does (R113.3 — membership is
   billing-frequency blind and "comped" is named in that ruling), and it is
   carried on the result as a DISTINCT basis so no surface can present it as
   money. It is a SEPARATE table: nothing here writes to `capavate_subscriptions`
   and the sacred store is called, never modified. */
import {
  getLiveGrant,
  type CompedMembershipGrant,
} from "./compedMembershipStore";

/* ── states ───────────────────────────────────────────────────────────────── */

export type MembershipState = "paid" | "unpaid" | "unknown";

/** WAVE 155 — WHY this subject is in good standing, when it is.
 *  `"paid"`   — a real payment record satisfies it.
 *  `"comped"` — an admin granted it without payment (wave 155). NEVER revenue.
 *  `null`     — it is not in good standing, so there is no basis to name. */
export type MembershipBasis = "paid" | "comped" | null;

export interface CompanyMembership {
  companyId: string;
  state: MembershipState;
  /** Plain-language provenance for logs and admin screens; never shown to LPs. */
  reason: string;
  /** When this was read. Proves the answer is live, not cached. */
  checkedAt: string;
  /** WAVE 155 — paid or comped. Read this before showing anything as money. */
  basis?: MembershipBasis;
  /** The granting record, when `basis === "comped"`. Admin audience only. */
  compedGrantId?: string | null;
}

/* ── settings ─────────────────────────────────────────────────────────────── */

export const LAUNCH_GATE_MODE_KEY = "spv.launch_gate.mode";
export const LAUNCH_GATE_NO_COMPANY_POLICY_KEY = "spv.launch_gate.no_company_policy";
export const LAUNCH_GATE_FREEZE_ENABLED_KEY = "spv.launch_gate.freeze_enabled";

export type LaunchGateMode = "enforced" | "warn";
export type NoCompanyPolicy = "require_company" | "allow";

/** Read one string setting. An unreadable/absent setting uses the SHIPPING
 *  default — the gate does not disable itself because a config row is missing. */
function readStringSetting(key: string, fallback: string): string {
  try {
    const row = readConfigRow(key);
    if (!row) return fallback;
    const parsed = JSON.parse(row.valueJson);
    return typeof parsed === "string" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/** R114 — the gate SHIPS `enforced`. `warn` is retained so the owner can watch
 *  it for a wave without turning it into a wall, but that is a deliberate
 *  admin action, never the default and never what an error falls back to. */
export function getLaunchGateMode(): LaunchGateMode {
  return readStringSetting(LAUNCH_GATE_MODE_KEY, "enforced") === "warn" ? "warn" : "enforced";
}

/** R122.2 — WHAT THIS SETTING DOES, AND WHAT IT DOES **NOT** DO.
 *
 *  `require_company` governs whether a **named** company must be paid. It does
 *  NOT mean "a company must exist". A vehicle with no target company — a
 *  blind-pool fund, a thesis-driven or no-target SPV — is checked against the
 *  CREATING PARTNER'S OWN ACCOUNT standing instead, because that is the only
 *  party in the transaction with a Capavate relationship.
 *
 *  The earlier reading (refuse every company-less create) was wrong and is
 *  corrected here: it refused 100% of legitimate blind-pool business, which is
 *  not a membership rule but an outage, and a gate that blocks all correct
 *  behaviour gets switched off. `allow` remains as the setting that skips the
 *  no-company check entirely, partner account included. */
export function getNoCompanyPolicy(): NoCompanyPolicy {
  return readStringSetting(LAUNCH_GATE_NO_COMPANY_POLICY_KEY, "require_company") === "allow"
    ? "allow"
    : "require_company";
}

/** Freeze is separately killable, because it is the half that touches LIVE
 *  vehicles. Ships enabled. */
export function isFreezeEnabled(): boolean {
  return readStringSetting(LAUNCH_GATE_FREEZE_ENABLED_KEY, "1") !== "0";
}

/* ── the three-state readers ──────────────────────────────────────────────── */

/** A subscription row is CURRENT when it is active and its period has not ended.
 *  `current_period_end` wins when present (the renewal boundary), otherwise
 *  `expires_at`; a row with NEITHER is treated as current — that is how comped
 *  and lifetime memberships are stored, and inventing an expiry for them would
 *  refuse a customer we chose not to bill. */
function isCurrent(sub: CapavateSubscription, now: number): boolean {
  if (sub.status !== "active") return false;
  const boundary = sub.currentPeriodEnd ?? sub.expiresAt ?? null;
  if (!boundary) return true;
  const t = Date.parse(String(boundary));
  if (Number.isNaN(t)) return true; // unparseable boundary ≠ expired
  return t > now;
}

/* WAVE 155 — the comped read, shared by both subject kinds.
 *
 * It is consulted FIRST. A grant the platform read successfully is a definite
 * fact about standing, and asking the billing table afterwards could only turn
 * that definite fact into an "unknown" produced by an unrelated read fault.
 *
 * A FAILURE OF THIS READ IS NOT AN ANSWER. It returns null and the caller falls
 * through to the payment record, so a missing/locked grant table never refuses a
 * customer who genuinely paid. */
function readCompedGrant(
  subjectKind: "company" | "partner",
  subjectId: string,
): CompedMembershipGrant | null {
  try {
    return getLiveGrant(subjectKind, subjectId);
  } catch {
    return null;
  }
}

function compedMembership(
  subjectId: string,
  grant: CompedMembershipGrant,
  checkedAt: string,
): CompanyMembership {
  return {
    companyId: subjectId,
    state: "paid",
    basis: "comped",
    compedGrantId: grant.id,
    /* Named as a comp in the provenance sentence itself, so a log line or an
       admin screen that shows only `reason` still cannot mistake it for money. */
    reason: `A comped membership is on record — granted by ${grant.grantedBy} on ${grant.grantedAt} with no payment taken. Reason: ${grant.reason}`,
    checkedAt,
  };
}

export function resolveCompanyMembership(companyId: string): CompanyMembership {
  const checkedAt = new Date().toISOString();
  const id = String(companyId ?? "").trim();
  if (!id) {
    return {
      companyId: id,
      state: "unknown",
      reason: "No company id was supplied, so no membership could be looked up.",
      checkedAt,
      basis: null,
    };
  }
  const comped = readCompedGrant("company", id);
  if (comped) return compedMembership(id, comped, checkedAt);
  let subs: CapavateSubscription[];
  try {
    subs = listForCompany(id);
  } catch (err) {
    /* THE WHOLE POINT. The read failed; we do not know, and we say so. */
    return {
      companyId: id,
      state: "unknown",
      reason: `The membership record could not be read (${(err as Error).message}).`,
      checkedAt,
      basis: null,
    };
  }
  const now = Date.now();
  /* `billingCycle` is deliberately NOT consulted anywhere in this function
     (R113.3): monthly, annual, and lifetime all count the same. */
  const current = subs.find((s) => isCurrent(s, now));
  if (current) {
    return {
      companyId: id,
      state: "paid",
      basis: "paid",
      reason: `A current paid membership is on file (status ${current.status}).`,
      checkedAt,
    };
  }
  return {
    companyId: id,
    state: "unpaid",
    basis: null,
    reason:
      subs.length === 0
        ? "No Capavate membership has ever been recorded for this company."
        : `${subs.length} membership record(s) were read and none is currently active.`,
    checkedAt,
  };
}

/* ── R122.2: the creating partner's own account standing ──────────────────── */

/**
 * THE BLIND-POOL READER (R122.2).
 *
 * Same three states, same refusal to invent a fact:
 *   "paid"    — a current `partner_subscription` row exists. `active`, `grace`
 *               and `past_due` all mean "currently subscribed" (the store's own
 *               definition, `getActiveForSubject`), and `grandfathered` is an
 *               entitlement the store deliberately keeps out of that query —
 *               excluding it here would refuse a partner Capavate chose not to
 *               bill, so it is read explicitly.
 *   "unpaid"   — the rows were read successfully and none of them is current.
 *   "unknown"  — the read itself failed (no driver, absent table). NOT a fact
 *                about the partner, and never rendered as "unpaid" (R77).
 *
 * Billing frequency is not consulted (R113.3): monthly, annual, lifetime and
 * comped all satisfy the gate.
 */
export function resolvePartnerAccountMembership(partnerId: string): CompanyMembership {
  const checkedAt = new Date().toISOString();
  const id = String(partnerId ?? "").trim();
  if (!id) {
    return {
      companyId: id,
      state: "unknown",
      reason: "No partner account id was supplied, so no membership could be looked up.",
      checkedAt,
      basis: null,
    };
  }
  /* WAVE 155 — an admin-granted comp satisfies a partner account exactly as it
     does a company. R123.1's lockout hit partners hardest: a blind-pool fund
     names no company, so the partner's OWN standing (R122.2) is the only thing
     checked, and there was no way to establish it. */
  const comped = readCompedGrant("partner", id);
  if (comped) return compedMembership(id, comped, checkedAt);
  try {
    const active = getActiveForSubject("partner", id);
    if (active) {
      return {
        companyId: id,
        state: "paid",
        basis: "paid",
        reason: `A current partner membership is on file (status ${active.status}).`,
        checkedAt,
      };
    }
    const grandfathered = getGrandfatheredForSubject("partner", id);
    if (grandfathered) {
      return {
        companyId: id,
        state: "paid",
        basis: "paid",
        reason: "A grandfathered partner entitlement is on file.",
        checkedAt,
      };
    }
  } catch (err) {
    return {
      companyId: id,
      state: "unknown",
      reason: `The partner membership record could not be read (${(err as Error).message}).`,
      checkedAt,
      basis: null,
    };
  }
  return {
    companyId: id,
    state: "unpaid",
    basis: null,
    reason: "No current Capavate partner membership is recorded for this account.",
    checkedAt,
  };
}

/** Display label for a partner account in a refusal sentence. Falls back to the
 *  id, because a refusal must always name something the reader can act on. */
export function partnerLabel(partnerId: string): string {
  try {
    const row = rawDb()
      .prepare(`SELECT legal_name AS n FROM accounts WHERE id = ?`)
      .get(partnerId) as { n: string | null } | undefined;
    const n = row?.n && String(row.n).trim();
    return n || partnerId;
  } catch {
    return partnerId;
  }
}

/** The sponsoring partner of an EXISTING SPV, for the blind-pool freeze case.
 *  Null when it cannot be read — the caller must treat that as "unknown", never
 *  as "no partner". */
export function resolveSponsorPartnerId(spvId: string): string | null {
  try {
    const row = rawDb()
      .prepare(`SELECT sponsor_partner_id AS p FROM spv WHERE id = ?`)
      .get(spvId) as { p: string | null } | undefined;
    const p = row?.p && String(row.p).trim();
    return p || null;
  } catch {
    return null;
  }
}

/* ── which companies does an SPV actually invest into? ────────────────────── */

/** EVERY company the SPV touches, from all three places one can be named:
 *  the SPV's own target company, every deployment, and a mandate's explicit
 *  company list. Read failures here surface as a thrown error to the caller
 *  rather than an empty list, because an empty list would silently mean
 *  "no companies to check" — i.e. an accidental bypass. */
export function resolveGatedCompanyIds(spvId: string): string[] {
  const db: any = rawDb();
  const ids = new Set<string>();
  const target = db
    .prepare(`SELECT target_company_id AS c FROM spv WHERE id = ?`)
    .get(spvId) as { c: string | null } | undefined;
  if (target?.c) ids.add(String(target.c));
  for (const r of db
    .prepare(`SELECT DISTINCT company_id AS c FROM spv_deployment WHERE spv_id = ?`)
    .all(spvId) as { c: string | null }[]) {
    if (r.c) ids.add(String(r.c));
  }
  try {
    const m = db
      .prepare(`SELECT company_ids_json AS j FROM spv_mandate WHERE spv_id = ?`)
      .get(spvId) as { j: string | null } | undefined;
    if (m?.j) {
      const arr = JSON.parse(m.j);
      if (Array.isArray(arr)) for (const c of arr) if (c) ids.add(String(c));
    }
  } catch {
    /* A mandate table absent in an older DB is not a company list we lost; the
       target + deployments above still stand. A CORRUPT list is skipped rather
       than treated as "no companies": the gate below still requires at least one
       paid company under `require_company`. */
  }
  return Array.from(ids);
}

/* ── override lookup (R114.3) ─────────────────────────────────────────────── */

export interface OverrideHit {
  scopeKind: "spv" | "company";
  scopeId: string;
  reason: string;
  createdBy: string | null;
  createdAt: string;
}

function findOverride(spvId: string | null, companyIds: string[]): OverrideHit | null {
  let live: OverrideHit[];
  try {
    live = listActiveOverrides();
  } catch {
    /* An unreadable override ledger must NEVER be read as "an override exists" —
       that would be a bypass created by a fault. Absence of proof is not relief. */
    return null;
  }
  if (spvId) {
    const bySpv = live.find((o) => o.scopeKind === "spv" && o.scopeId === spvId);
    if (bySpv) return bySpv;
  }
  const set = new Set(companyIds);
  return live.find((o) => o.scopeKind === "company" && set.has(o.scopeId)) ?? null;
}

/* ── decisions ────────────────────────────────────────────────────────────── */

export interface GateDecision {
  allowed: boolean;
  /** True when the gate WOULD have refused but `warn` mode let it through. */
  warned: boolean;
  mode: LaunchGateMode;
  /** Every company checked, with its state. Partner/admin audience only. */
  memberships: CompanyMembership[];
  blocking: CompanyMembership[];
  override: OverrideHit | null;
  /** A plain sentence (R77) for a partner or admin: names the company + next step. */
  partnerMessage: string;
  /** A plain sentence for an LP: state only, no other party's billing status. */
  lpMessage: string;
  code: "SPV_COMPANY_MEMBERSHIP_REQUIRED" | null;
}

const HUMAN_STATE: Record<MembershipState, string> = {
  paid: "Paid",
  unpaid: "Not paid",
  /* R77 — an unreadable membership renders as this, never as "unpaid". */
  unknown: "Not on record",
};

export function renderMembershipState(state: MembershipState): string {
  return HUMAN_STATE[state];
}

/**
 * WAVE 155 — THE LABEL THAT KEEPS A COMP FROM READING AS MONEY.
 *
 * Every admin surface that shows a membership state renders THIS, not
 * `renderMembershipState`, so a comped membership is never shown by the same
 * word as a paid one. Plain language, no codes (R77); "Not on record" for
 * unreadable state (R111 Q13).
 */
export function renderMembershipStanding(m: {
  state: MembershipState;
  basis?: MembershipBasis;
}): string {
  if (m.state === "paid") {
    return m.basis === "comped" ? "Comped by Capavate (no payment taken)" : "Paid";
  }
  return HUMAN_STATE[m.state];
}

/** Company display name for a refusal sentence. Falls back to the id — a
 *  refusal must still name something the partner can act on. */
export function companyLabel(companyId: string): string {
  try {
    const row = rawDb()
      .prepare(`SELECT legal_name AS n FROM contacts WHERE id = ?`)
      .get(companyId) as { n: string | null } | undefined;
    const n = row?.n && String(row.n).trim();
    return n || companyId;
  } catch {
    return companyId;
  }
}

function buildRefusal(blocking: CompanyMembership[]): { partner: string; lp: string } {
  const parts = blocking.map(
    (b) => `${companyLabel(b.companyId)} (${renderMembershipState(b.state)})`,
  );
  const list = parts.join(", ");
  const partner =
    blocking.length === 1
      ? `${list} does not have a current paid Capavate membership on file, so this SPV cannot be launched yet. Ask the company to activate its membership, or ask a Capavate admin to record an override with a reason.`
      : `These companies do not have a current paid Capavate membership on file, so this SPV cannot be launched yet: ${list}. Every company in a multi-company SPV must be a paid member. Ask them to activate, or ask a Capavate admin to record an override with a reason.`;
  /* LPs are told the STATE and nothing else — no company name, no billing status
     of a third party. */
  const lp =
    "This vehicle is not open for new commitments right now. Nothing you already hold is affected, and your existing documents, statements, and distributions are unchanged. The sponsor has been told what to do next.";
  return { partner, lp };
}

/**
 * LAUNCH / MONEY-IN decision. Unknown fails CLOSED.
 *
 * `spvId` may be null on a CREATE path where the SPV does not exist yet; pass the
 * company ids the caller is about to attach.
 */
export function evaluateLaunchGate(input: {
  spvId?: string | null;
  companyIds: string[];
  /** R122.2 — the partner account CREATING this vehicle. Used only when no
   *  company is named; it is that partner's own standing that is checked. */
  partnerId?: string | null;
}): GateDecision {
  const mode = getLaunchGateMode();
  const spvId = input.spvId ?? null;
  const companyIds = Array.from(new Set(input.companyIds.filter(Boolean).map(String)));
  const memberships = companyIds.map(resolveCompanyMembership);
  const override = findOverride(spvId, companyIds);

  /* ══ NO COMPANY NAMED AT ALL — R122.2 ═════════════════════════════════════
     A blind-pool fund or no-target SPV names no company BY CONSTRUCTION. The
     gate therefore applies to the CREATING PARTNER'S OWN ACCOUNT standing, not
     to a company that does not exist. THE ABSENCE OF A COMPANY IS NEVER, ON ITS
     OWN, A REASON TO REFUSE — the previous reading of `require_company` refused
     100% of legitimate blind-pool business, and a gate that blocks all correct
     behaviour is worse than no gate because it gets switched off.

     The purpose of the gate is that SOMEONE in the transaction is paying for the
     platform. For a targeted vehicle that is the target company; for a blind
     pool the only party with a relationship is the partner (R110, $840/yr). */
  if (companyIds.length === 0) {
    if (getNoCompanyPolicy() === "allow" || override) {
      return {
        allowed: true, warned: false, mode, memberships, blocking: [], override,
        partnerMessage: "", lpMessage: "", code: null,
      };
    }
    const partnerId = String(input.partnerId ?? "").trim();
    const standing = resolvePartnerAccountMembership(partnerId);
    /* Unknown fails CLOSED for a launch, exactly as it does for a company. */
    if (standing.state === "paid") {
      return {
        allowed: true, warned: false, mode, memberships: [standing], blocking: [], override,
        partnerMessage: "", lpMessage: "", code: null,
      };
    }
    const who = partnerId ? partnerLabel(partnerId) : "this partner account";
    const partnerMessage =
      standing.state === "unpaid"
        ? `${who} does not have a current paid Capavate partner membership on file. A vehicle with no target company is checked against your own account, so activate the partner membership, name the company you are investing into, or ask a Capavate admin to record an override with a reason.`
        : `${who}'s Capavate partner membership could not be read just now (${renderMembershipState(standing.state)}), so this vehicle cannot be launched yet. This is a Capavate-side fault, not a statement that you have not paid — retry shortly, or ask a Capavate admin to record an override with a reason.`;
    return {
      allowed: mode === "warn", warned: mode === "warn", mode,
      memberships: [standing],
      blocking: [standing], override,
      partnerMessage,
      lpMessage:
        "This vehicle is not open for new commitments right now. Nothing you already hold is affected.",
      code: "SPV_COMPANY_MEMBERSHIP_REQUIRED",
    };
  }

  /* Unknown fails CLOSED here: both "unpaid" and "unknown" block a launch. */
  const blocking = memberships.filter((m) => m.state !== "paid");
  if (blocking.length === 0 || override) {
    return {
      allowed: true, warned: false, mode, memberships, blocking: [], override,
      partnerMessage: "", lpMessage: "", code: null,
    };
  }
  const { partner, lp } = buildRefusal(blocking);
  return {
    allowed: mode === "warn",
    warned: mode === "warn",
    mode,
    memberships,
    blocking,
    override,
    partnerMessage: partner,
    lpMessage: lp,
    code: "SPV_COMPANY_MEMBERSHIP_REQUIRED",
  };
}

export interface FreezeDecision {
  frozen: boolean;
  mode: LaunchGateMode;
  memberships: CompanyMembership[];
  blocking: CompanyMembership[];
  override: OverrideHit | null;
  partnerMessage: string;
  lpMessage: string;
}

/**
 * FREEZE decision for an EXISTING SPV — derived live, NEVER persisted.
 *
 * Unknown fails OPEN (a read fault must not freeze a paying customer). A freeze
 * blocks MONEY-IN only: it never hides, deletes, or withholds a record, and
 * DISTRIBUTIONS AND TRANSFERS ARE NEVER FROZEN.
 */
export function evaluateFreeze(spvId: string): FreezeDecision {
  const mode = getLaunchGateMode();
  if (!isFreezeEnabled()) {
    return {
      frozen: false, mode, memberships: [], blocking: [], override: null,
      partnerMessage: "", lpMessage: "",
    };
  }
  let companyIds: string[];
  try {
    companyIds = resolveGatedCompanyIds(spvId);
  } catch {
    /* Cannot even list the companies ⇒ fail OPEN for freezing. */
    return {
      frozen: false, mode, memberships: [], blocking: [], override: null,
      partnerMessage: "", lpMessage: "",
    };
  }
  const memberships = companyIds.map(resolveCompanyMembership);
  const override = findOverride(spvId, companyIds);
  /* OPEN on unknown — ONLY a definite "unpaid" freezes. */
  const blocking = memberships.filter((m) => m.state === "unpaid");
  if (blocking.length === 0 || override || mode === "warn") {
    return {
      frozen: false, mode, memberships, blocking, override,
      partnerMessage: blocking.length ? buildRefusal(blocking).partner : "",
      lpMessage: "",
    };
  }
  const { partner, lp } = buildRefusal(blocking);
  return { frozen: true, mode, memberships, blocking, override, partnerMessage: partner, lpMessage: lp };
}

/* ── boot-time settings install ───────────────────────────────────────────── */

/**
 * Seed the three settings from TypeScript, because `trg_pc_no_direct_insert`
 * (server/db/connection.ts) rejects a SQL INSERT into `platform_config` that has
 * no genesis history row with a computed revision hash — a migration cannot do
 * it. IDEMPOTENT: `ensurePlatformConfigKey` returns an existing row untouched, so
 * an admin who has since switched the mode to `warn` is NOT reset on the next
 * boot. Never routed through `adminPlatformStore.setLifecyclePolicies`, which
 * swallows its own write failures (server/adminPlatformStore.ts:2076).
 */
export function installLaunchGateSettings(actor = "u_system_wave154"): void {
  /* WAVE 158 — this used `require("./platformConfigWriter")`, which throws
     `SyntaxError: Unexpected token 'export'` under the ESM test runner and so made
     EVERY test that boots `registerRoutes(...)` fail at collection (routes.ts:1664
     calls this at registration time; `server/__tests__/wave4a_rs_restorations.test.ts`
     was failing for exactly this reason and now passes). The module was already
     imported statically at the top of this file for `readConfigRow`, so there is
     no import cycle to avoid and nothing else about this function changes —
     `platformConfigWriter` imports only `node:crypto` and `../db/connection`. */
  const keys: { key: string; value: string; description: string }[] = [
    {
      key: LAUNCH_GATE_MODE_KEY,
      value: "enforced",
      description:
        "SPV launch gate: 'enforced' refuses a launch when a company is not a paid member; 'warn' allows it and records the warning. Ships enforced (R114).",
    },
    {
      key: LAUNCH_GATE_NO_COMPANY_POLICY_KEY,
      value: "require_company",
      description:
        "How a vehicle that names no company is checked (R122.2): 'require_company' checks the CREATING PARTNER'S OWN account membership — it never refuses merely because no company exists; 'allow' skips the no-company check entirely.",
    },
    {
      key: LAUNCH_GATE_FREEZE_ENABLED_KEY,
      value: "1",
      description:
        "Whether a live SPV whose company membership has lapsed is frozen for new money-in. '1' enabled, '0' disabled. Never affects distributions or transfers.",
    },
  ];
  for (const k of keys) {
    try {
      ensurePlatformConfigKey({
        key: k.key,
        valueJson: JSON.stringify(k.value),
        valueType: "string",
        description: k.description,
        createdBy: actor,
      });
    } catch (err) {
      /* A failed SEED must be loud in the log but must not stop boot — the
         readers above already default to the shipping values, so the gate is
         enforced even if this insert never lands. */
      console.warn(
        `[spvEligibilityGate] could not seed ${k.key}: ${(err as Error).message} — the shipping default still applies.`,
      );
    }
  }
}
