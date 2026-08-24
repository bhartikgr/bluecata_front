/* ════════════════════════════════════════════════════════════════════════════
   WAVE 108 · FINDING 2 — A FOUNDER READ `founder_global_search` OFF THEIR OWN
   DASHBOARD.
   ════════════════════════════════════════════════════════════════════════════
   The activity feed renders the audit log's `eventType` verbatim. That column is
   a machine key: `round.initial_shareholders.set`, `founder_global_search`,
   `collective.expert.best_answer_accepted`. Printing it to a customer is the
   same class of defect as printing a package name or an engine version — the
   governing ruling for this wave is that RENDERED TEXT must never expose an
   internal identifier, while machine-readable VALUES (a `data-testid`, an error
   `code`, a query key) are explicitly allowed. This module is the one place the
   machine form is turned into English; the raw code stays available to callers
   for `data-*` attributes and export.

   WHY THIS IS NOT A LOOKUP TABLE OF THE OBSERVED CODES.
   An AST sweep of the third argument of every `appendAudit` /
   `appendAdminAudit` call in `server/`, `shared/`, `packages/` and `scripts/`
   (620 files — `build_log/wave108/w108_event_codes.json`) found:

       167 distinct LITERAL event codes
        37 call sites whose event type is a TEMPLATE OR A VARIABLE
           (`user.${action}`, `collective.billing.${event.type}`,
            `dataroom.${ev.action}`, `post_${action}`, `e.action`, `evt.kind`, …)

   Those 37 can emit codes that appear nowhere in the source, so a closed map
   CANNOT cover the feed — it would fall back to printing the raw code exactly
   for the codes nobody anticipated, which is the defect. So the contract here is
   structural: `describeActivityAction` is TOTAL. For any string at all it
   returns English, and its output can never contain a dotted or snake_case
   machine token. `PHRASES` only improves the wording of codes we have actually
   read; it is not what makes the guarantee hold.
   ════════════════════════════════════════════════════════════════════════════ */

/** Tokens that must not be lower-cased into nonsense when humanised. */
const ACRONYMS = new Set([
  "crm", "dsc", "spv", "kyc", "kyb", "aml", "gdpr", "dlq", "api", "csv", "pdf",
  "id", "ids", "url", "sms", "vat", "gst", "iso", "pps", "safe", "nda", "mfa",
  "sso", "ip", "qa", "ui", "dpa", "irr", "kpi", "esg", "usd", "cad", "hkd",
]);

/** Past-tense / past-participle verbs the audit vocabulary actually uses. */
const VERBS = new Set([
  "accepted", "acknowledged", "activated", "added", "adjusted", "anchored",
  "applied", "approved", "archived", "assigned", "attached", "bootstrapped",
  "cancelled", "canceled", "captured", "cast", "certified", "changed",
  "claimed", "cleared", "closed", "committed", "completed", "confirmed",
  "converted", "created", "declined", "deleted", "delivered", "demoted",
  "denied", "deployed", "deprecated", "disabled", "disconnected", "dismissed",
  "downloaded", "edited", "enabled", "ended", "enqueued", "erased", "exempted",
  "expired", "exported", "extended", "failed", "flagged", "generated",
  "granted", "imported", "invited", "issued", "joined", "lapsed", "linked",
  "locked", "logged", "marked", "materialized", "merged", "migrated",
  "opened", "overridden", "paid", "patched", "paused", "placed", "posted",
  "promoted", "provisioned", "published", "purged", "queued", "reanchored",
  "rebuilt", "received", "recorded", "redeemed", "refunded", "registered",
  "rejected", "released", "removed", "renamed", "reopened", "replaced",
  "replayed", "requested", "rescheduled", "reset", "resent", "resolved",
  "restored", "resumed", "retried", "returned", "reverted", "revoked",
  "rotated", "scheduled", "sent", "set", "settled", "shared", "signed",
  "skipped", "started", "stopped", "submitted", "subscribed", "surfaced",
  "suspended", "swapped", "synced", "terminated", "toggled", "transferred",
  "unarchived", "unlinked", "unlocked", "unpublished", "unsubscribed",
  "updated", "uploaded", "verified", "viewed", "voided", "withdrawn", "voted",
]);

/**
 * Codes whose structural reading is misleading or ungrammatical. Everything not
 * listed here is derived, so a new code needs no entry to read as English.
 */
const PHRASE_ENTRIES: Record<string, string> = {
  founder_global_search: "ran a search across their company",
  admin_global_search: "ran an administrative search",
  "admin.search": "ran an administrative search",
  "round.initial_shareholders.set": "recorded the opening shareholders on a round",
  accreditation_self_certified: "self-certified their accredited-investor status",
  "company.auto_provisioned_on_charge": "was set up automatically when a payment was taken",
  "company.consortium_partner_unlink_attr_warn":
    "raised a warning while unlinking a partner organisation",
  "contact.preferredId.mismatch": "was flagged for two conflicting contact records",
  "audit_chain.re_anchored": "re-anchored the audit trail",
  "bridge.demo_state.reset": "reset the demonstration data",
  "collective_subscription_config.env_fallback_toggled":
    "changed the subscription configuration fallback",
  "reconciliation.force_commit": "forced a reconciliation to commit",
  legal_consent: "recorded a legal consent",
  "legal_consent.recorded": "recorded a legal consent",
  "lifecycle_policy.changed": "changed the data-retention policy",
  platform_fee_updated: "updated the platform fee",
  commission_rate_updated: "updated the commission rate",
  "campaign.audience_resolved": "worked out who a notification campaign would reach",
  "collective.deal_room.opened": "opened a deal room",
  "collective.dsc.vote.cast": "cast a due-diligence screening vote",
  "collective.expert.best_answer_accepted": "accepted a best answer in the expert forum",
  "collective.expert.vote_applied": "voted in the expert forum",
  "collective.member.bootstrapped": "set up a member record",
  "consortium.apply.approval_failed": "could not complete a partner approval",
  "consortium_spv_deployment_recorded": "recorded a partner SPV deployment",
  "consortium_spv_deployment_fee_updated": "updated the partner SPV deployment fee",
  "contact.materialized": "created a full contact record from an invitation",
  "contact.seeded": "created a starter contact record",
  "audit_chain_health.resolved": "resolved an audit-trail health alert",
  "admin.cleanup.dedupe-companies": "merged duplicate company records",
  "collective_payment_entry.marked_paid": "marked a payment entry as paid",
  "partner_billing_entry.marked_paid": "marked a partner billing entry as paid",
  "round.auto_closed": "closed a round automatically",
  "soft_circle.hard_deleted": "permanently deleted a soft-circle commitment",
  "soft_circle.lapsed": "let a soft-circle commitment lapse",
  "email.send": "sent an email",
  "email.send-test": "sent a test email",
  "email.test": "sent a test email",
  "user.invite": "invited a user",
  "user.update": "updated a user's details",
  "user.force_logout": "signed a user out of every session",
  "user.reset_password": "reset a user's password",
  "gdpr.anonymized": "anonymised personal data",
  "gdpr.data_export": "exported personal data on request",
  "gdpr.delete_confirmed": "confirmed a personal-data deletion request",
  "gdpr.delete_requested": "requested deletion of personal data",
  "invoice.emailed_to_founder": "emailed an invoice to the founder",
  "financial.accountant_filled": "had an accountant complete the financials",
  "financial.accountant_request_sent": "sent a request to the accountant",
  "network.post.created": "posted to the network",
  "partner.onboarded": "onboarded a partner organisation",
  "partner.classification.primary": "set a partner's primary classification",
  "partner_taxonomy.sector.create": "added a sector to the partner taxonomy",
  "partner_taxonomy.sector.update": "updated a sector in the partner taxonomy",
  "partner_taxonomy.sector.retire": "retired a sector from the partner taxonomy",
  "partner_taxonomy.subsector.create": "added a sub-sector to the partner taxonomy",
  "partner_taxonomy.subsector.update": "updated a sub-sector in the partner taxonomy",
  "partner_taxonomy.subsector.retire": "retired a sub-sector from the partner taxonomy",
  "partner_tier.frozen": "froze a partner tier",
  "partner_tier.reranked": "re-ranked the partner tiers",
  "partner_revshare.materialized": "calculated a partner revenue share",
  "partner_tax_form.collected": "collected a partner tax form",
  pulse_symbol_enabled_set: "changed which market symbols are tracked",
  pulse_symbol_upserted: "updated a tracked market symbol",
  "region.proposed": "proposed a new region",
  "demo.seeded": "loaded demonstration data",
  "crm.dedup.distinct": "confirmed two contact records are different people",
  "crm.dedup.scanned": "checked the contacts for duplicates",
  "crm.dedup.merged": "merged two duplicate contact records",
  "crm.dedup.reopened": "reopened a duplicate-contact review",
  "dsc.mock_inbound.write": "recorded a test screening submission",
  "dsc.role.promoted": "promoted someone on the screening committee",
  "dsc.role.demoted": "stepped someone down from the screening committee",
  "collective.billing.cancelled_at_period_end": "scheduled a subscription to end at the period end",
  "collective.billing.past_due": "marked a subscription as past due",
  "collective.billing.resume": "resumed a subscription",
  "collective.billing.cancel_requested": "requested a subscription cancellation",
  "collective.offer.lapsed": "let an offer lapse",
  "collective.waitlist.accepted": "accepted someone from the waitlist",
  "collective.settings.patched": "changed the collective settings",
  "collective.deal_room.reverted": "took a deal room back out of the deal room stage",
  "consortium.apply.approved": "approved a partner application",
  "consortium.apply.rejected": "rejected a partner application",
  "consortium.apply.submitted": "submitted a partner application",
  "consortium.apply.withdrawn": "withdrew a partner application",
  "consortium.apply.email_resent": "re-sent a partner application email",
  "consortium.apply.invite_resent": "re-sent a partner application invitation",
  "contacts.csv_imported": "imported contacts from a CSV file",
  "esignature.signed": "signed a document electronically",
  "esignature.envelope_created": "prepared a document for electronic signature",
  "email_campaign.test_sent": "sent a test of an email campaign",
  "bridge.dlq.replayed": "replayed failed background jobs",
  "bridge.outbox.archived": "archived processed background messages",
};

/* ═════════════════════════════════════════════════════════════════════════════
   WAVE 110 · FINDING 5 — `PHRASES[code]` READ Object.prototype, SO THE "TOTAL"
   CONTRACT WAS FALSE AND `__proto__` CRASHED REACT.
   ═════════════════════════════════════════════════════════════════════════════
   The map was a plain object literal, so a bracket read inherited every key on
   `Object.prototype`. For eight event codes the lookup returned a NON-STRING and
   returned it as if it were the description:

     __proto__ → the prototype OBJECT (React throws "Objects are not valid as a
                 React child" — the activity feed white-screens)
     constructor, toString, valueOf, hasOwnProperty, isPrototypeOf,
     propertyIsEnumerable, toLocaleString → FUNCTIONS (React renders nothing and
                 any `.length` / string use downstream is wrong)

   An audit `eventType` is not a trusted literal: 37 `appendAudit` call sites build
   it from a template or a variable (`user.${action}`, `e.action`, `evt.kind`), so
   an attacker- or data-shaped `__proto__` reaching this function is a live path,
   not a hypothetical.

   The fix is structural rather than a blocklist: the phrases live in a `Map`,
   which has no prototype chain for string keys, `get` returns `undefined` for
   every inherited name, and the value is type-checked before it is trusted. */
const PHRASES: Map<string, string> = new Map(Object.entries(PHRASE_ENTRIES));

/** Words → a readable form, applied to every derived word. */
function readableWord(word: string): string {
  const w = word.toLowerCase();
  if (ACRONYMS.has(w)) return w.toUpperCase();
  return w;
}

/**
 * Split a machine token into lower-case words. Handles `.`, `_`, `-`, `:` and
 * camelCase, so `contact.preferredId.mismatch` → contact, preferred, id, mismatch.
 */
function tokenWords(token: string): string[] {
  return token
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[.\-_:\s/]+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
}

/**
 * True when a string still looks like a machine event code — a dotted or
 * snake_case token. Exported so the tests can assert the contract on every one
 * of the 167 codes rather than on the two that were observed.
 */
export function looksLikeMachineEventCode(value: string): boolean {
  const v = String(value ?? "").trim();
  if (!v) return false;
  /* A word joined to another word by a dot or an underscore, with no spaces in
     between — `round.initial_shareholders.set`, `founder_global_search`. Prose
     never does this; every machine code in the audit vocabulary does. */
  return /[A-Za-z0-9]+[._][A-Za-z0-9]/.test(v);
}

/** The one thing this function is allowed to say when it has nothing better. */
const GENERIC_DESCRIPTION = "recorded an activity";

/**
 * Describe an audit event code in words a founder can read.
 *
 * TOTAL, and the guarantee is now true for EVERY input including the
 * `Object.prototype` key names (WAVE 110 · FINDING 5). For any value at all this
 * function:
 *   • returns a `string` — always, `typeof` checked, never an object or function,
 *     so it is always safe as a React child;
 *   • never returns an empty string;
 *   • never returns a value for which `looksLikeMachineEventCode` is true;
 *   • never throws — an unexpected input falls back to "recorded an activity".
 *
 * HONEST LIMIT, stated rather than implied: totality is about the SHAPE of the
 * output, not the quality of the wording. `PHRASES` improves 100-odd codes that
 * have actually been read; everything else is derived structurally from the
 * code's own words, and a code whose words do not form a verb phrase is described
 * ("recorded: …") rather than guessed at. It is English, and it is the record's
 * own vocabulary; it is not a curated sentence.
 */
export function describeActivityAction(rawAction: unknown): string {
  try {
    return describeActivityActionInner(rawAction);
  } catch {
    /* The contract is that this never throws. If some future edit can throw, the
       feed still renders a true, if generic, sentence rather than white-screening. */
    return GENERIC_DESCRIPTION;
  }
}

function describeActivityActionInner(rawAction: unknown): string {
  const code = typeof rawAction === "string" ? rawAction.trim() : String(rawAction ?? "").trim();
  if (!code) return GENERIC_DESCRIPTION;

  /* `Map.get` — not `PHRASES[code]`, which read Object.prototype and returned a
     function or an object for eight codes. The `typeof` check is belt-and-braces:
     the contract is that a string leaves this function, always. */
  const mapped = PHRASES.get(code);
  if (typeof mapped === "string" && mapped.length > 0) return mapped;

  const words = tokenWords(code).map(readableWord);
  if (words.length === 0) return GENERIC_DESCRIPTION;

  /* `re_anchored`, `re_issued` — the split leaves a bare "re" in front of a verb. */
  for (let i = 0; i < words.length - 1; i += 1) {
    if (words[i] === "re" && VERBS.has(words[i + 1])) {
      words.splice(i, 2, `re-${words[i + 1]}`);
    }
  }

  const lastRaw = words[words.length - 1];
  const last = lastRaw.startsWith("re-") ? lastRaw.slice(3) : lastRaw;
  if (words.length > 1 && VERBS.has(last)) {
    const object = words.slice(0, -1).join(" ");
    return `${lastRaw} the ${object}`;
  }
  if (VERBS.has(words[0]) && words.length > 1) {
    return `${words[0]} the ${words.slice(1).join(" ")}`;
  }
  if (words.length === 1 && VERBS.has(words[0])) return words[0];

  /* No verb anywhere — describe rather than guess. The words are still the
     record's own words, so the reader learns what happened; what they do not get
     is a machine token. */
  return `recorded: ${words.join(" ")}`;
}
