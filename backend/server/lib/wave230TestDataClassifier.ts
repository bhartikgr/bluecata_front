/**
 * WAVE 230 — TEST-DATA CLASSIFIER. EVIDENCE-BASED, CONSERVATIVE, DB-DRIVEN.
 *
 * R228.3: "An authoritative inventory first: every candidate row, named, with the
 * evidence for classifying it test. The owner sees the list. Ambiguous rows
 * default to KEPT, never to removed — over-inclusion is unrecoverable,
 * under-inclusion is a second pass."
 *
 * R228.3 / R230.3: "Marking must be DB-driven and dynamic — never a hardcoded
 * list of ids, because new test data will appear."
 *
 * ── THERE IS NO ID LIST IN THIS FILE ──────────────────────────────────────────
 * Not one record id appears anywhere below. Every verdict is derived from FIELD
 * VALUES READ OUT OF THE DATABASE at classification time, matched against named
 * rules. A test record created tomorrow is classified tomorrow, by the same
 * rules, with no code change. That is the whole point: the owner's problem is
 * recurring, so the answer had to be a rule set and not a snapshot.
 *
 * ── THE CLASSIFIER PROPOSES. IT NEVER WRITES. ─────────────────────────────────
 * Nothing in this file mutates a row. It returns verdicts with evidence.
 * Applying them is a separate, audited, reversible action
 * (`wave230SetExcluded`). Keeping "decide" and "act" apart is what lets the
 * owner read the list before anything changes, which R228.3 requires.
 *
 * ── THE CONSERVATIVE DIRECTION IS ENFORCED IN THE TYPE, NOT IN A HABIT ────────
 *   CERTAIN   -> propose exclusion. An explicit test marker in a field.
 *   PROBABLE  -> propose exclusion, AND flag for the owner's confirmation.
 *   AMBIGUOUS -> KEPT. NEVER proposed for exclusion, under any combination
 *                of weak signals.
 * `proposeExclude` is computed from the confidence in exactly one place
 * (`proposeFor`), so no rule can quietly opt a weak signal into exclusion.
 *
 * ── COUNTER-EVIDENCE CAN ONLY EVER SAVE A RECORD, NEVER CONDEMN ONE ───────────
 * R228.1: "Deleting a real client to tidy a screen is a catastrophe." So every
 * candidate is also searched for signs of being REAL, and a strong sign of life
 * DOWNGRADES the verdict. It can never upgrade one. The asymmetry is deliberate:
 * over-inclusion is unrecoverable, under-inclusion is a second pass.
 */

import { getDbDriver, rawDb } from "../db/connection";
import { log } from "./logger";
import {
  WAVE230_TABLES,
  wave230KeyColumn,
  wave230LabelColumn,
  type Wave230Table,
} from "./wave230TestDataFlags";

export type Wave230Confidence = "CERTAIN" | "PROBABLE" | "AMBIGUOUS";

export interface Wave230Signal {
  /** Stable rule name, so a verdict can be explained and argued with. */
  rule: string;
  /** Which column the rule fired on. */
  field: string;
  /** The literal value that fired it, so the owner can see it for himself. */
  value: string;
  /** Plain-language reason, written for a non-engineer. */
  note: string;
}

export interface Wave230Verdict {
  table: Wave230Table;
  id: string;
  label: string | null;
  confidence: Wave230Confidence;
  /** True only for CERTAIN and PROBABLE. Computed in one place. */
  proposeExclude: boolean;
  /** True for PROBABLE — these are listed separately for owner confirmation. */
  needsOwnerConfirmation: boolean;
  evidence: Wave230Signal[];
  counterEvidence: Wave230Signal[];
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  RULES — expressed over field values, never over ids
 * ═══════════════════════════════════════════════════════════════════════════ */

interface Rule {
  name: string;
  confidence: Exclude<Wave230Confidence, "AMBIGUOUS">;
  pattern: RegExp;
  note: string;
}

/**
 * CERTAIN rules. Each requires an EXPLICIT test marker in the value — a word or
 * token that no real client would carry by accident. These are the 32 companies
 * R230.2 calls "CERTAIN test by name" and their equivalents in the other five
 * populations.
 */
const CERTAIN_RULES: Rule[] = [
  {
    name: "explicit-test-word",
    confidence: "CERTAIN",
    // \btest\b matches "Test f", "TEst Tast", "Live Audit Test", "TEST.pdf".
    // Case-insensitive, so the "TEst" typo in the leaked task name is caught.
    pattern: /\btests?\b/i,
    note: 'Contains the standalone word "test".',
  },
  {
    name: "sd-test-batch-prefix",
    confidence: "CERTAIN",
    // "SD-TEST Wave X Co", "SD-TEST-PortCo Alpha", sector "SD-TEST-SaaS".
    pattern: /\bSD-TEST\b/i,
    note: 'Carries the "SD-TEST" QA batch prefix.',
  },
  {
    name: "qa-marker",
    confidence: "CERTAIN",
    // "QA Note Round", "co_qa_...", "July Wave06" is handled by wave-batch below.
    pattern: /(^|[^a-z])qa([^a-z]|$)/i,
    note: 'Carries a "QA" marker.',
  },
  {
    name: "bug-ticket-token",
    confidence: "CERTAIN",
    // bug001_paid_plan_fresh_founder — an internal ticket id in user-facing data.
    pattern: /\bbug[_-]?\d{2,}\b/i,
    note: "Contains an internal bug-ticket identifier.",
  },
  {
    name: "lorem-ipsum",
    confidence: "CERTAIN",
    pattern: /lorem\s+ipsum/i,
    note: "Contains Lorem Ipsum placeholder text.",
  },
  {
    name: "diagnostic-or-reproduction",
    confidence: "CERTAIN",
    pattern: /\b(diagnostic|bug reproduction|please ignore)\b/i,
    note: "Contains internal diagnostic wording.",
  },
  {
    name: "reserved-test-domain",
    confidence: "CERTAIN",
    // RFC 2606 reserves .test / .example / .invalid. https://deck.test/jun01.pdf
    pattern: /\bhttps?:\/\/[^\s]*\.(test|example|invalid)\b/i,
    note: "Points at an RFC 2606 reserved test domain, which can never be a real site.",
  },
  {
    name: "reserved-test-email-domain",
    confidence: "CERTAIN",
    pattern: /@(example|test|invalid)\.(com|org|net|test)\b|@mailinator\.com\b/i,
    note: "Uses a reserved or throwaway email domain.",
  },
  {
    name: "keyboard-mash",
    confidence: "CERTAIN",
    pattern: /\b(asdf+|qwerty|aaaa+|xxxx+|zzzz+|fooo?bar)\b/i,
    note: "Keyboard-mash placeholder value.",
  },
  {
    name: "internal-build-shorthand",
    confidence: "PROBABLE",
    /* This programme's own shorthand for a wave or a ruling leaking into a
       customer-facing name: "W94-CAP-01-uncapped", "R72 exact probe",
       "W185-COLLECTIVE-03". Requires the letter-plus-number token AND a second
       structural marker (a hyphenated code, or one of this programme's QA words)
       so that a real company called "R2 Robotics" or "W Group" cannot match.

       PROBABLE, NOT CERTAIN, DELIBERATELY. This infers a naming CONVENTION rather
       than reading a marker that says "test". R228.1 is explicit that inference
       alone cannot distinguish a QA batch from a real client, so every record this
       rule reaches is flagged for the owner's confirmation and is never marked on
       the strength of this rule alone.

       FOUND BY RUNNING THE CLASSIFIER, NOT BY READING IT: the dev snapshot's 367
       companies produced 0 CERTAIN verdicts, which sent me looking for why. The
       pre-existing `wave-batch-name` rule requires the literal word "wave" and so
       matched none of them. */
    pattern:
      /\b[WR]\d{1,3}\b[- ](?:[A-Za-z]+-\d|cap-|case|probe|exact|uncapped|capped|binds|fails|fixture|batch|scenario)/i,
    note: "Named with this programme's internal wave/ruling shorthand.",
  },
  {
    name: "wave-batch-name",
    confidence: "CERTAIN",
    // "July Wave06", "SD-TEST Wave X Co" — this programme's own wave numbering
    // leaking into a customer-facing name.
    pattern: /\bwave\s?\d{1,3}\b/i,
    note: "Named after an internal build wave.",
  },
];

/**
 * PROBABLE rules. A real record could carry these, so on their own they are a
 * reason to look, not a reason to be sure. They still propose exclusion — R230.2
 * rules that PROBABLE records are excluded rather than kept — but they are
 * flagged separately for the owner's confirmation, and they are the only
 * verdicts that counter-evidence can overturn.
 */
const PROBABLE_RULES: Rule[] = [
  {
    name: "demo-marker",
    confidence: "PROBABLE",
    // A real company can legitimately be called "Demo Day Ltd", and a sales demo
    // account may be a genuine commercial artefact. So: probable, not certain.
    pattern: /\bdemos?\b/i,
    note: 'Contains the word "demo", which is usually but not always a test marker.',
  },
  {
    name: "sample-or-dummy",
    confidence: "PROBABLE",
    pattern: /\b(sample|dummy|placeholder|untitled|new file|no name)\b/i,
    note: "Reads as a placeholder rather than a chosen name.",
  },
  {
    name: "sandbox-or-staging",
    confidence: "PROBABLE",
    pattern: /\b(sandbox|staging|scratch|temp|tmp)\b/i,
    note: "Named after a non-production environment.",
  },
  {
    name: "trivial-name",
    confidence: "PROBABLE",
    // "28 of 31 consortium applications are single-letter or nonsense org names"
    // (R230.2). One or two characters is not a company name anybody typed on
    // purpose — but it is a name, so this is probable rather than certain.
    pattern: /^\s*\S{1,2}\s*$/,
    note: "Name is one or two characters — not a name anyone chose deliberately.",
  },
];

/** Fields consulted per population. Only real, existing columns. */
function fieldsFor(table: Wave230Table): string[] {
  switch (table) {
    case "companies":
      return ["name", "legal_name", "sector", "stage", "hq", "website_url", "description"];
    case "rounds":
      return ["name", "type", "terms_summary", "lead_investor"];
    case "spvs":
      return ["name", "structure_type"];
    case "subscriptions":
      return ["plan"];
    case "consortium_applications":
      return ["organization_name", "contact_name", "contact_email", "website", "intro_message"];
    case "collective_apps":
      return ["payload_json"];
    default:
      return [];
  }
}

/**
 * Columns that carry real business substance. A record with NONE of them
 * populated is "zero business data", which R230.2 gives as the shared property
 * of the whole QA batch including Kestrel Holdings Ltd and Live Audit Client Ltd.
 */
function substanceFieldsFor(table: Wave230Table): string[] {
  switch (table) {
    case "companies":
      return ["legal_name", "sector", "hq", "website_url", "description", "founded", "employees"];
    case "rounds":
      return ["terms_summary", "lead_investor", "close_date", "instrument"];
    case "spvs":
      return ["lead_company_id", "gp_user_id", "formed_at"];
    case "consortium_applications":
      return ["website", "intro_message", "referred_by"];
    default:
      return [];
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  CLASSIFICATION
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The ONE place a confidence becomes a proposal.
 *
 * AMBIGUOUS can never become an exclusion here, so no rule anywhere else in the
 * file is able to opt a weak signal in. This is the enforcement point for
 * R228.3's "ambiguous rows default to KEPT, never to removed".
 */
function proposeFor(confidence: Wave230Confidence): boolean {
  return confidence === "CERTAIN" || confidence === "PROBABLE";
}

function readable(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  return "";
}

/** Run the rule sets over one row's consulted fields. */
function signalsForRow(table: Wave230Table, row: Record<string, unknown>): Wave230Signal[] {
  const out: Wave230Signal[] = [];
  for (const field of fieldsFor(table)) {
    const value = readable(row[field]);
    if (!value) continue;
    for (const rule of [...CERTAIN_RULES, ...PROBABLE_RULES]) {
      if (rule.pattern.test(value)) {
        out.push({
          rule: rule.name,
          field,
          // Long free-text fields are trimmed for the report, never for the match.
          value: value.length > 160 ? `${value.slice(0, 157)}…` : value,
          note: rule.note,
        });
      }
    }
  }
  return out;
}

/**
 * Each rule's DECLARED confidence, keyed by rule name.
 *
 * ── A BUG THIS REPLACED, RECORDED BECAUSE IT MATTERS ─────────────────────────
 * The first version of `confidenceOf` decided CERTAIN by testing membership of
 * the `CERTAIN_RULES` ARRAY. That made every rule's own `confidence` field
 * DECORATIVE: a rule declaring `confidence: "PROBABLE"` was still reported as
 * CERTAIN if it happened to sit in the certain array. The consequence is exactly
 * the failure this wave is meant to prevent — a record marked for exclusion at
 * CERTAIN, and therefore NOT flagged for the owner's confirmation, on the
 * strength of weak or inferred evidence.
 *
 * It was found by RUNNING the classifier over 367 real companies and disbelieving
 * the result: adding a single PROBABLE rule moved the CERTAIN count from 0 to
 * 203 while the PROBABLE count stayed at 0, which is impossible if the declared
 * confidence is honoured. Reading the code had not revealed it.
 *
 * The confidence a rule DECLARES is now the confidence it CARRIES, wherever it is
 * written. `confidenceOf` takes the strongest declared confidence among the
 * signals that actually fired.
 */
const RULE_CONFIDENCE: ReadonlyMap<string, Wave230Confidence> = new Map(
  [...CERTAIN_RULES, ...PROBABLE_RULES].map((r) => [r.name, r.confidence]),
);

function confidenceOf(signals: Wave230Signal[]): Wave230Confidence {
  if (signals.length === 0) return "AMBIGUOUS";
  /* Unknown rule names cannot silently become CERTAIN. A signal whose rule is not
     in the table is treated as the WEAKEST confidence, never the strongest. */
  let best: Wave230Confidence = "AMBIGUOUS";
  for (const s of signals) {
    const declared = RULE_CONFIDENCE.get(s.rule) ?? "AMBIGUOUS";
    if (declared === "CERTAIN") return "CERTAIN";
    if (declared === "PROBABLE") best = "PROBABLE";
  }
  return best;
}

/**
 * Signs that a record is REAL. Searched for every candidate, and able only to
 * DOWNGRADE a verdict — never to create or strengthen one.
 */
function counterEvidenceForRow(
  table: Wave230Table,
  row: Record<string, unknown>,
): Wave230Signal[] {
  const out: Wave230Signal[] = [];
  const substance = substanceFieldsFor(table);
  const populated = substance.filter((f) => readable(row[f]).trim().length > 0);
  if (populated.length > 0) {
    out.push({
      rule: "has-business-data",
      field: populated.join(", "),
      value: populated.map((f) => `${f}=${readable(row[f])}`).join(" · ").slice(0, 160),
      note: `Has real business detail in ${populated.length} field(s) — a QA fixture usually has none.`,
    });
  }
  if (table === "companies") {
    const paid = companyHasRecordedPayment(readable(row["id"]));
    if (paid) {
      out.push({
        rule: "has-recorded-payment",
        field: "payments",
        value: "at least one payment record exists",
        note: "Money has actually changed hands against this company. Strongest possible sign of a real client.",
      });
    }
  }

  /* SUBSCRIPTIONS CARRY THEIR OWN EVIDENCE OF PAYMENT, and it is the most
     important counter-evidence in the whole wave.
     R230.1's central finding is that `status` was never payment-backed: 31
     "active" subscriptions summing to $26,928.00 sat against a payment ledger of
     ten records totalling $2,530.06, because subscriptions AUTO-CREATE on company
     creation. The corollary matters just as much in the other direction — a
     subscription that HAS been invoiced, or that has a card on file, is one where
     somebody really did transact, and it must never be swept up in a test-data
     purge on the strength of a name.
     A subscription row has no descriptive text of its own, so without this block
     it could accrue no counter-evidence at all. That gap was found by
     `w230_test_data_exclusion.test.ts` before this code shipped, not after. */
  if (table === "subscriptions") {
    /* A comparison, not a coercion: no Number(), parseInt or parseFloat. A value
       that is not a number is not treated as zero — it is simply not counted as
       evidence of payment, which is the conservative direction. */
    const invoices = row["invoices_count"];
    if (typeof invoices === "number" && invoices > 0) {
      out.push({
        rule: "has-recorded-payment",
        field: "invoices_count",
        value: `${invoices} invoice(s) raised`,
        note: "This subscription has been invoiced. Somebody really transacted here, whatever the name says.",
      });
    }
    if (typeof invoices === "bigint" && invoices > BigInt(0)) {
      out.push({
        rule: "has-recorded-payment",
        field: "invoices_count",
        value: `${invoices.toString()} invoice(s) raised`,
        note: "This subscription has been invoiced. Somebody really transacted here, whatever the name says.",
      });
    }
    const card = readable(row["card_last4"]).trim();
    if (card.length > 0) {
      out.push({
        rule: "has-payment-instrument",
        field: "card_last4",
        value: `card ending ${card}`,
        note: "A real payment card is stored against this subscription.",
      });
    }
  }
  return out;
}

/**
 * Has any payment ever been recorded against this company?
 *
 * R230.1 is explicit that the payment ledger is the only payment-backed evidence
 * on the platform, and equally explicit that IT MAY BE INCOMPLETE — "roughly
 * nineteen invoice identifiers" against "ten payment records", and the
 * conclusion drawn from it "must never be restated as settled".
 *
 * That uncertainty is handled by direction, not by confidence: a payment is used
 * ONLY as counter-evidence, so an INCOMPLETE ledger can cause a record to be
 * excluded that should have been kept — which is reversible — and can never
 * cause one to be kept that should have been excluded. It also means a false
 * negative here is safe: if the ledger is missing rows, the worst outcome is a
 * second pass, which R228.3 explicitly prefers.
 */
function companyHasRecordedPayment(companyId: string): boolean {
  if (!companyId) return false;
  if (getDbDriver() !== "sqlite") return false;
  try {
    const db: any = rawDb();
    const t = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='payments'`)
      .get() as { name?: string } | undefined;
    if (!t?.name) return false;
    const cols = db.prepare(`PRAGMA table_info(payments)`).all() as { name: string }[];
    const hasCompany = cols.some((c) => String(c.name) === "company_id");
    if (!hasCompany) return false;
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM payments WHERE company_id = ?`)
      .get(companyId) as { n?: number } | undefined;
    return typeof row?.n === "number" && row.n > 0;
  } catch {
    /* No ledger reachable is not evidence of a real client, and it is not
       evidence of a test one either. It simply adds no counter-evidence. */
    return false;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  THE QA-BATCH COHORT RULE — how Kestrel Holdings Ltd and Live Audit Client
 *  Ltd are reached at all, and why they can only ever be PROBABLE
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * R230.2 on the two ambiguous companies, in full:
 *
 *   "Created days apart from the unambiguous 'Test f' and 'SD-TEST Wave X Co',
 *    by the SAME PARTNER ACTOR, through the SAME AUTOMATED FLOW, with ZERO
 *    business data in all 30 profile fields — and bracketed by a sibling named
 *    'SD-TEST-PortCo Alpha' whose sector reads 'SD-TEST-SaaS'. But NO FIELD
 *    ANYWHERE STATES THEY ARE TEST RECORDS."
 *
 * Neither name contains a test marker, so no name rule can ever fire on them.
 * They are reachable ONLY by their company, which is why this rule exists.
 *
 * ── WHY IT IS STILL DB-DRIVEN AND NOT AN ID LIST ──────────────────────────────
 * The cohort is computed at classification time from `audit_log`. The rule knows
 * nothing about Kestrel or Live Audit; it knows "zero business data, same
 * creating actor as a CERTAIN-test record, within days". The next QA batch with
 * realistic cover names is caught by the same rule with no code change.
 *
 * ── WHY IT CAN NEVER PRODUCE CERTAIN ─────────────────────────────────────────
 * This is INFERENCE FROM CIRCUMSTANCE, not a marker in a field. R228.1 is
 * explicit: "realistic cover names in a QA batch are indistinguishable from real
 * clients by inference alone." A batch neighbour is a reason to ask the owner,
 * never a reason to be sure. The rule is hard-capped at PROBABLE, so every
 * record it reaches is flagged for his confirmation.
 */
const COHORT_WINDOW_MS = 72 * 60 * 60 * 1000; // "created days apart" (R230.2)

/** The audited event that creates a company, named in R230.1. */
const COMPANY_CREATE_ACTION = "subscription.auto_created_on_company_create";

interface CreationMeta {
  actorId: string | null;
  createdAtMs: number;
}

/**
 * Who created each company and when, read out of the audit trail.
 *
 * `companies` carries no `created_at` and no `created_by` column — verified
 * against the live schema — so the creating actor genuinely is only available
 * from `audit_log`. This reads it rather than inventing it; a company with no
 * creation event simply gets no cohort evidence, and therefore stays KEPT.
 */
function companyCreationMeta(): Map<string, CreationMeta> {
  const out = new Map<string, CreationMeta>();
  if (getDbDriver() !== "sqlite") return out;
  try {
    const db: any = rawDb();
    const rows = db
      .prepare(
        `SELECT actor_id, target, payload_json, created_at
           FROM audit_log
          WHERE action = ? AND (deleted_at IS NULL)`,
      )
      .all(COMPANY_CREATE_ACTION) as Array<{
      actor_id: string | null;
      target: string | null;
      payload_json: string | null;
      created_at: string;
    }>;
    for (const r of rows) {
      /* The company id is in the payload as `companyId`, and mirrored into
         `target` as "subscription:<companyId>". The payload is preferred; the
         target is the fallback. If neither yields an id the row is skipped —
         never guessed at. */
      let companyId = "";
      if (r.payload_json) {
        try {
          const p = JSON.parse(r.payload_json) as { companyId?: unknown };
          if (typeof p.companyId === "string") companyId = p.companyId;
        } catch {
          /* unparseable payload contributes nothing */
        }
      }
      if (!companyId && r.target && r.target.startsWith("subscription:")) {
        companyId = r.target.slice("subscription:".length);
      }
      if (!companyId) continue;
      const ms = Date.parse(r.created_at);
      if (Number.isNaN(ms)) continue;
      const prev = out.get(companyId);
      /* Keep the EARLIEST event — that is the creation. */
      if (!prev || ms < prev.createdAtMs) {
        out.set(companyId, { actorId: r.actor_id ?? null, createdAtMs: ms });
      }
    }
  } catch (err) {
    log.warn("[wave230] creation-meta read failed; no cohort evidence:", (err as Error).message);
  }
  return out;
}

/** True when a record has NOTHING in any of its business-substance columns. */
function hasZeroBusinessData(table: Wave230Table, row: Record<string, unknown>): boolean {
  const substance = substanceFieldsFor(table);
  if (substance.length === 0) return false;
  return substance.every((f) => readable(row[f]).trim().length === 0);
}

/**
 * Classify one population.
 *
 * Reads rows out of the database and returns a verdict per row. Rows with no
 * signal at all are returned as AMBIGUOUS with `proposeExclude: false` — they
 * are in the report so the owner can see the whole population was examined,
 * rather than only the accusations.
 */
export function wave230ClassifyTable(table: Wave230Table): Wave230Verdict[] {
  if (getDbDriver() !== "sqlite") return [];
  const key = wave230KeyColumn(table);
  const labelCol = wave230LabelColumn(table);
  try {
    const db: any = rawDb();
    const rows = db.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>;

    /* PASS 1 — field rules only. */
    const drafts = rows.map((row) => {
      const evidence = signalsForRow(table, row);
      return {
        row,
        id: readable(row[key]),
        label: labelCol ? readable(row[labelCol]) || null : null,
        evidence,
        confidence: confidenceOf(evidence),
      };
    });

    /* PASS 2 — the QA-batch cohort, companies only. Runs after pass 1 because it
       needs to know which siblings are already CERTAIN. */
    if (table === "companies") {
      const meta = companyCreationMeta();
      const certainSeeds = drafts.filter((d) => d.confidence === "CERTAIN" && meta.has(d.id));
      for (const d of drafts) {
        if (d.confidence !== "AMBIGUOUS") continue;
        if (!hasZeroBusinessData(table, d.row)) continue;
        const mine = meta.get(d.id);
        if (!mine || !mine.actorId) continue;
        const siblings = certainSeeds.filter((s) => {
          const sm = meta.get(s.id);
          if (!sm || sm.actorId !== mine.actorId) return false;
          return Math.abs(sm.createdAtMs - mine.createdAtMs) <= COHORT_WINDOW_MS;
        });
        if (siblings.length === 0) continue;
        d.evidence.push({
          rule: "qa-batch-cohort",
          field: "audit_log(creating actor + time), all business fields empty",
          value:
            `created by ${mine.actorId} within 72h of ` +
            siblings
              .slice(0, 4)
              .map((s) => `"${s.label ?? s.id}"`)
              .join(", "),
          note:
            "No field on this record says it is a test. It is reached only by circumstance: " +
            "zero business data, and the same account created unmistakable test records within days. " +
            "That is a reason to ask, never a reason to be sure — so it is PROBABLE and needs your confirmation.",
        });
        /* HARD-CAPPED AT PROBABLE. Inference from circumstance can never be
           CERTAIN, per R228.1. */
        d.confidence = "PROBABLE";
      }
    }

    /* PASS 3 — counter-evidence, which can only ever save a record. */
    return drafts.map((d) => {
      let confidence = d.confidence;
      const counterEvidence = counterEvidenceForRow(table, d.row);

      /* A PROBABLE verdict backed only by a weak or circumstantial signal is
         withdrawn when the record shows signs of life. */
      if (confidence === "PROBABLE" && counterEvidence.length > 0) {
        confidence = "AMBIGUOUS";
      }
      /* CERTAIN is not downgraded by business data — "SD-TEST Wave X Co" with a
         filled-in sector is still SD-TEST — but it IS downgraded by a recorded
         payment, because money changing hands outranks a name. */
      if (
        confidence === "CERTAIN" &&
        counterEvidence.some((c) => c.rule === "has-recorded-payment")
      ) {
        confidence = "AMBIGUOUS";
      }

      return {
        table,
        id: d.id,
        label: d.label,
        confidence,
        proposeExclude: proposeFor(confidence),
        needsOwnerConfirmation: confidence === "PROBABLE",
        evidence: d.evidence,
        counterEvidence,
      };
    });
  } catch (err) {
    log.warn(`[wave230] classification failed for ${table}:`, (err as Error).message);
    return [];
  }
}

/** Classify every population. */
export function wave230ClassifyAll(): Wave230Verdict[] {
  const out: Wave230Verdict[] = [];
  for (const t of WAVE230_TABLES) out.push(...wave230ClassifyTable(t));
  return out;
}

export interface Wave230ClassificationSummary {
  table: Wave230Table;
  total: number;
  certain: number;
  probable: number;
  ambiguous: number;
  proposedForExclusion: number;
}

/** Counts by confidence, for the owner's report. */
export function wave230SummariseVerdicts(verdicts: Wave230Verdict[]): Wave230ClassificationSummary[] {
  const byTable = new Map<Wave230Table, Wave230ClassificationSummary>();
  for (const t of WAVE230_TABLES) {
    byTable.set(t, {
      table: t,
      total: 0,
      certain: 0,
      probable: 0,
      ambiguous: 0,
      proposedForExclusion: 0,
    });
  }
  for (const v of verdicts) {
    const s = byTable.get(v.table);
    if (!s) continue;
    s.total += 1;
    if (v.confidence === "CERTAIN") s.certain += 1;
    else if (v.confidence === "PROBABLE") s.probable += 1;
    else s.ambiguous += 1;
    if (v.proposeExclude) s.proposedForExclusion += 1;
  }
  return Array.from(byTable.values());
}
