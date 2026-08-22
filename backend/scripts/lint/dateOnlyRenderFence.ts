/**
 * scripts/lint/dateOnlyRenderFence.ts
 *
 * WAVE 87 · ITEM 1 · THE DATE-ONLY RENDER FENCE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * Wave 83 fixed the one-day shift on the round's target close date by adding
 * `fmtDate` to `client/src/lib/format.ts`. It never applied it universally.
 * Reviewer 1 (2026-08-21) found `new Date(value).toLocaleDateString()` still
 * live on `YYYY-MM-DD` schema strings — `renewsOn`, `lastRaiseDate` and others.
 *
 * `new Date("2026-06-15")` is DEFINED by ECMA-262 to parse a date-only form as
 * UTC midnight. Rendered through any LOCAL-time method:
 *
 *     TZ=America/New_York   →  6/14/2026   (one day EARLY  — the owner, all US)
 *     TZ=Pacific/Auckland   →  6/15/2026   (correct by luck, east of UTC)
 *     TZ=UTC                →  6/15/2026   (correct — which is why CI never saw it)
 *
 * A test suite running in UTC cannot see this defect. That is the whole reason
 * it survived three waves, so this fence exists to catch the SHAPE rather than
 * rely on anybody remembering to test in the right zone.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS A VIOLATION, AND WHAT DELIBERATELY IS NOT
 * ─────────────────────────────────────────────────────────────────────────────
 * VIOLATION   a value whose underlying column/field is DATE-ONLY reaching a
 *             timezone-sensitive rendering path:
 *               A. `new Date(<date-only field>).toLocaleDateString()` and every
 *                  other local-time reader (`toLocaleString`, `toLocaleTimeString`,
 *                  `toDateString`, `getFullYear/Month/Date/Day/Hours`);
 *               B. the same field passed to a LOCAL helper in the same file whose
 *                  own body is one of those unsafe shapes — this is the class the
 *                  brief warned about and the one reviewer 1 undercounted: twelve
 *                  files define their OWN `fmtDate`/`formatIsoDate` that SHADOWS
 *                  the safe one, so "the site calls fmtDate" proves nothing;
 *               C. `new Intl.DateTimeFormat(...).format(new Date(<date-only>))`.
 *
 * NOT A VIOLATION, on purpose:
 *   • A TIMESTAMP through any of those paths. A timestamp is an INSTANT and
 *     SHOULD localise; `createdAt`, `updatedAt`, `ts`, `sentAt`, `closedAt` and
 *     the rest of the `*At` family are instants and are none of this fence's
 *     business. Changing them would be a defect, not a fix.
 *   • A date-only value rendered RAW (`{row.asOfDate}`) — a bare `YYYY-MM-DD`
 *     string never crosses a timezone because no `Date` is constructed.
 *   • A date-only value through `fmtDate`, `fmtLocaleDate`, `fmtLocaleDateTime`
 *     or `toCalendarDate` IMPORTED from `@/lib/format` — that is the fix.
 *   • Arithmetic and comparison (`new Date(a).getTime() - new Date(b).getTime()`,
 *     `new Date(x) >= cutoff`). A UTC-midnight parse of two date-only values
 *     yields a correct day DIFFERENCE, and the fence must not fabricate work.
 *     `getTime`/`valueOf` are therefore not in the banned method list.
 *   • Test files, entirely.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE REGISTRY IS EVIDENCE-BACKED, NOT NAME-GUESSED
 * ─────────────────────────────────────────────────────────────────────────────
 * The brief's instruction was explicit: check the DB schema / column type, do
 * not guess from the variable name. Every entry below therefore carries the
 * file:line that PROVES its shape — a `type="date"` input, a strict
 * `/^\d{4}-\d{2}-\d{2}$/` server validation, a `.toISOString().slice(0, 10)`
 * write, or a seeded literal. Two entries are recorded as MIXED because the
 * tree really does write both shapes into them; the safe formatter handles both,
 * which is exactly why the fix is a formatter and not a parser.
 *
 * A field name that is NOT in this registry is not policed. That is deliberate:
 * this project has twice produced phantom cascades (6,818 and 519 false leaks)
 * by matching on presence instead of proof, and an over-broad date fence would
 * be the third.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.W87_ROOT ? path.resolve(process.env.W87_ROOT) : path.resolve(HERE, "..", "..");
const CLIENT_SRC = path.join(ROOT, "client", "src");

/* ── the evidence-backed registry ────────────────────────────────────────── */

export type FieldShape = "date-only" | "mixed";
export type RegistryEntry = { field: string; shape: FieldShape; evidence: string };

export const DATE_ONLY_REGISTRY: RegistryEntry[] = [
  { field: "renewsOn", shape: "mixed",
    evidence: "server/subscriptionsStore.ts:254 seeds \"2026-06-15\"; :274 and :637 write new Date(...).toISOString().slice(0, 10). MIXED: server/paymentGatewayAdapter.ts:1518 can also assign a full-ISO currentPeriodEnd." },
  { field: "trialEndsOn", shape: "date-only",
    evidence: "server/subscriptionsStore.ts:256 seeds \"2026-05-25\"; :277 writes .toISOString().slice(0, 10)." },
  { field: "lastRaiseDate", shape: "date-only",
    evidence: "client/src/pages/admin/CompanyDetail.tsx:102 declares { key: \"lastRaiseDate\", type: \"date\" } — a native date input yields YYYY-MM-DD." },
  { field: "lastRaiseAt", shape: "date-only",
    evidence: "server/companyProfileStore.ts:145 annotates \"// ISO date\"; client/src/lib/financialFieldCopy.ts:140 tells the founder \"enter 2024-03-15\"." },
  { field: "lastRaise", shape: "date-only",
    evidence: "server/collectiveRoutes.ts:710 aliases lastRaiseAt ?? lastRaiseDate — same two date-only sources." },
  { field: "closeDate", shape: "date-only",
    evidence: "server/routes.ts:7029 validates /^(\\d+)-(\\d{2})-(\\d{2})$/ with a 4-digit-year check and rejects impossible calendar dates; the wizard input is <Input type=\"date\"> (client/src/pages/founder/RoundNew.tsx:2264)." },
  { field: "openDate", shape: "date-only",
    evidence: "server/routes.ts:7025-7045 — same strict YYYY-MM-DD validation as closeDate." },
  { field: "targetCloseDate", shape: "date-only",
    evidence: "Wave 83 ITEM 2.2, the original reported defect; the same round-wizard <Input type=\"date\"> at client/src/pages/founder/RoundNew.tsx:2264 and the same strict server validation at server/routes.ts:7029." },
  { field: "incorporationDate", shape: "date-only",
    evidence: "client/src/pages/admin/CompanyDetail.tsx:97 — { type: \"date\" }." },
  { field: "ma_target_close_date", shape: "date-only",
    evidence: "client/src/pages/admin/CompanyDetail.tsx:121 — { type: \"date\" }." },
  { field: "maturityDate", shape: "date-only",
    evidence: "server/mockData.ts:242 seeds \"2026-11-01\"; server/routes.ts:7257 treats it as a calendar date with a future() check." },
  { field: "expectedDate", shape: "date-only",
    evidence: "server/mockData.ts:461-462 seed \"2026-07-15\" / \"2027-03-31\" for tranche rows." },
  { field: "nextBillingDate", shape: "date-only",
    evidence: "server/multiCompanyStore.ts:174 seeds \"2026-06-15\"; :1471 assigns it from sub.renewsOn." },
  { field: "partnerSince", shape: "mixed",
    evidence: "server/adminContactsStore.ts:1455/:1483/:1511/:1539 seed \"2024-01-15\"-style date-only values; :1008 writes a full new Date().toISOString(). MIXED, and the date-only rows are live." },
  { field: "asOfDate", shape: "date-only",
    evidence: "server/spvNavStore.ts:148 and server/lib/reportingEngineRoutes.ts:272/:370 all write .slice(0, 10)." },
  { field: "periodEnd", shape: "mixed",
    evidence: "server/paymentGatewayAdapter.ts:839 writes .toISOString().slice(0, 10) (date-only); :1593 writes a full .toISOString(). MIXED." },
  { field: "expiresOn", shape: "date-only",
    evidence: "client/src/pages/admin/PricingModelDetail.tsx:851 — <Input type=\"date\"> on a discount code." },
  { field: "effectiveFrom", shape: "mixed",
    evidence: "client/src/pages/admin/PricingModelDetail.tsx:907 is <Input type=\"date\"> (date-only), while client/src/pages/admin/CollectiveSubscriptions.tsx:280 offers a full \"2026-08-01T00:00:00Z\". MIXED." },
  { field: "effectiveTo", shape: "mixed",
    evidence: "client/src/pages/admin/PricingModelDetail.tsx:911 — <Input type=\"date\">; same mixed shape as effectiveFrom." },
  { field: "dueDate", shape: "date-only",
    evidence: "client/src/pages/investor/CRM.tsx:383 — <Input type=\"date\"> feeds the task due date; rendered raw as `due ${t.dueDate}` at client/src/pages/partner/PartnerTasks.tsx:121." },
  { field: "due_date", shape: "date-only",
    evidence: "snake_case mirror of dueDate; column is TEXT (migrations/0013_pcrm_tables.sql:37) fed by the same date input." },
  { field: "vestingStartDate", shape: "date-only",
    evidence: "server/mockData.ts:73 seeds vesting.startDate \"2023-04-01\"." },
];

const DATE_ONLY_FIELDS = new Map(DATE_ONLY_REGISTRY.map((e) => [e.field, e]));

/**
 * TIMESTAMP FIELDS — recorded so the census is auditable and so a future reader
 * can see that "not policed" was a decision with a reason, not an omission.
 * Every one of these is an INSTANT and MUST keep localising.
 */
export const TIMESTAMP_FIELDS = new Set([
  "createdAt", "created_at", "updatedAt", "updated_at", "ts", "sentAt", "expiresAt",
  "receivedAt", "submittedAt", "uploadedAt", "closedAt", "signedAt", "issuedAt",
  "promotedAt", "revokedAt", "acceptedAt", "reviewedAt", "viewedAt", "scheduledAt",
  "occurredAt", "verifiedAt", "trialExpiresAt", "authorityExpiresAt", "archivedAt",
  "archiveRetentionUntil", "savedDraftAt", "consumedAt", "paidAt", "completedAt",
  "requestedAt", "deletedAt", "enqueuedAt", "resolvedAt", "activatedAt",
  "lastActivityAt", "queuedAt", "deliveredAt", "testSentAt", "joined_at",
  "auditedAt", "liveAt", "changedAt", "timestamp", "lastLogin", "currentPeriodEnd",
  "emittedAt", "attributedAt", "addedAt", "removedAt", "notesUpdatedAt",
  "lastActiveAt", "openedAt", "generated_at", "effective_from", "effective_to",
  "paymentDate", "asOf", "scheduledFor", "lastUpdated", "reopenUntil",
  "deadlineIso", "dscReceivedAt", "lastMessage", "nextSendAt", "resentAt",
  "dueAt", "ran", "last", "promoted_at", "created", "modifiedAt",
]);

/* ══ WAVE 102 · THE NEAR-NAME BLIND SPOT ══════════════════════════════════
   THE DEFECT THIS CLOSES. `client/src/pages/partner/PartnerTaxForm.tsx:205`
   rendered a tax-form expiry ONE DAY EARLY in New York, and this fence EXCUSED
   it: `expiresAt` is on TIMESTAMP_FIELDS while `expiresOn` is in the date-only
   registry — two near-identical names, opposite treatment — and
   `firstDateOnlyField` consulted the timestamp list FIRST ("an explicit instant
   wins"). The field was ACTIVELY EXCUSED. The `*At`-means-instant heuristic is
   right almost everywhere and was wrong exactly there.

   WHAT WAS NOT DONE, AND WHY. The tempting fix is to move `expiresAt` into the
   date-only registry. THAT WOULD BE THE SAME MISTAKE IN THE OTHER DIRECTION:
   `expiresAt` genuinely IS an instant at five other render sites — invitation
   token TTLs written as `new Date(now + ttlMs).toISOString()`
   (`client/src/lib/invitations/token.ts:119`). Reclassifying by NAME would
   misreport all five, which is the presence-not-proof error this file's own
   header warns produced two phantom cascades (6,818 and 519 false leaks).
   Wave 87's rule was "check the DB schema / column type, never the variable
   name", and this is precisely where it slipped.

   THE STRUCTURAL FIX. A near-name collision may no longer SILENTLY excuse.
   Where a timestamp field's stem is ALSO claimed by the date-only registry, the
   name has been shown to be ambiguous, so the name alone stops being sufficient
   authority. Such a field is excused ONLY AT A SITE THAT CARRIES CITED EVIDENCE
   for that file's own binding (`TIMESTAMP_SITE_EVIDENCE`). Anywhere else it is
   REPORTED. A new file rendering a colliding-stem field through a local-time
   reader therefore FAILS the fence until a human writes down what the value
   actually is — which is the whole point.

   Note on SQLite: every one of these columns is declared `TEXT`, so the column
   TYPE cannot discriminate. The real evidence is the WRITE PATH and the input
   widget, and that is what every entry below cites.
   ═════════════════════════════════════════════════════════════════════ */

/** Suffixes that mark a field name as temporal. Stripping one yields the STEM. */
export const TEMPORAL_SUFFIXES = [
  "At", "_at", "On", "_on", "Date", "_date", "Time", "_time",
  "Iso", "_iso", "Until", "_until", "From", "_from", "To", "_to",
];

const canonName = (s: string): string => s.replace(/_/g, "").toLowerCase();

/** `expiresAt` and `expiresOn` share the stem `expires`. */
export function stemOf(field: string): string {
  for (const suf of TEMPORAL_SUFFIXES) {
    if (field.length > suf.length && field.endsWith(suf)) {
      return canonName(field.slice(0, field.length - suf.length));
    }
  }
  return canonName(field);
}

/**
 * Every stem claimed by BOTH lists. Computed, never hand-maintained, so adding a
 * field to either list re-runs the sweep automatically. Reported on every run.
 */
export function nearNameCollisions(): Array<{ stem: string; dateOnly: string[]; timestamp: string[] }> {
  const byStem = new Map<string, { stem: string; dateOnly: string[]; timestamp: string[] }>();
  const put = (f: string, which: "dateOnly" | "timestamp"): void => {
    const s = stemOf(f);
    if (!byStem.has(s)) byStem.set(s, { stem: s, dateOnly: [], timestamp: [] });
    byStem.get(s)![which].push(f);
  };
  for (const e of DATE_ONLY_REGISTRY) put(e.field, "dateOnly");
  for (const f of TIMESTAMP_FIELDS) put(f, "timestamp");
  return [...byStem.values()]
    .filter((v) => v.dateOnly.length > 0 && v.timestamp.length > 0)
    .sort((a, b) => (a.stem < b.stem ? -1 : 1));
}

/** Timestamp field names whose stem is contested. The name alone no longer excuses. */
function collidingTimestampFields(): Set<string> {
  const out = new Set<string>();
  for (const c of nearNameCollisions()) for (const f of c.timestamp) out.add(f);
  return out;
}

/**
 * PER-SITE evidence that a contested field really is an INSTANT in THIS file.
 * Keyed `<relative file path>\0<field>`. Each entry cites the write path, not the
 * name. Missing entry = the site is reported, never silently excused.
 */
export const TIMESTAMP_SITE_EVIDENCE = new Map<string, string>([
  ["client/src/pages/FinancialsFill.tsx\u0000expiresAt",
   "An invitation-token TTL. Written as `new Date(now.getTime() + ttlMs).toISOString()` at client/src/lib/invitations/token.ts:119 — a full-ISO instant, never a bare date. Localising is correct."],
  ["client/src/pages/investor/Signup.tsx\u0000expiresAt",
   "Same invitation-token TTL as FinancialsFill.tsx; full-ISO instant from client/src/lib/invitations/token.ts:119."],
  ["client/src/pages/partner/PartnerTeam.tsx\u0000expiresAt",
   "A partner team-invite expiry, an instant computed from a TTL at issue time (same token module). Not typed by a human, so it can never be a bare calendar date."],
  ["client/src/pages/admin/AdminPartnerBillingOps.tsx\u0000expiresAt",
   "A billing pause/override window end, written server-side as a full ISO instant. Not typed by a human."],
  ["client/src/components/collective/widgets/PlatformPulseCard.tsx\u0000asOf",
   "`asOf` here is the pulse snapshot instant and is rendered with toLocaleTimeString — a TIME, which only exists on an instant. server/lib/spvFeeScheduleStore.ts:348 writes `new Date().toISOString()`."],
  ["client/src/pages/admin/Reconciliation.tsx\u0000asOf",
   "A reconciliation RUN timestamp (rendered with toLocaleString, i.e. with a time-of-day, at :206). An instant. Note this is the `asOf` field, NOT the `asOfDate` field, which server/spvNavStore.ts:148 writes with .slice(0, 10) and which IS date-only and IS policed."],
]);

/**
 * NEAR-NAME DEBT · WAVE 102. Sites the collision sweep found that are NOT this
 * wave's to fix, disclosed here rather than excused, and printed on every run so
 * they cannot be lost. Same pattern as SACRED_DEBT below: reported, never silent,
 * and not a build stop — because the alternative is editing a file this wave does
 * not own while two other waves are active in the tree.
 */
export type NearNameDebtEntry = { file: string; field: string; owner: string; note: string };
export const NEAR_NAME_DEBT: NearNameDebtEntry[] = [
  { file: "client/src/pages/admin/PartnerFeeSchedules.tsx", field: "effective_from",
    owner: "NOT WAVE 102 — an admin fee-schedule screen; escalated, not edited",
    note: "`{new Date(r.effective_from).toLocaleDateString()}` at :226. The value is MIXED, proved: " +
          "server/lib/partnerFeeAdminRoutes.ts:120 does `const effFrom = b.effectiveFrom && typeof " +
          "b.effectiveFrom === 'string' ? b.effectiveFrom : now` — it stores the CLIENT STRING " +
          "UNNORMALISED, or falls back to a full nowIso() instant. So a bare `YYYY-MM-DD` reaches " +
          "`partner_fee_schedules.effective_from TEXT NOT NULL` and shifts one day west of UTC. " +
          "FIX IS ONE LINE: route through `fmtLocaleDate` from `@/lib/format`, which handles both " +
          "shapes. Wave 102 owns PartnerTaxForm.tsx and this fence, NOT this screen." },
  { file: "client/src/pages/admin/CollectivePaymentSchedules.tsx", field: "effective_from",
    owner: "NOT WAVE 102 — an admin collective-billing screen; escalated, not edited",
    note: "`{new Date(r.effective_from).toLocaleDateString()}` at :257. Identical shape and identical " +
          "one-line fix as PartnerFeeSchedules.tsx above; `collective_payment_schedules.effective_from` " +
          "is `TEXT NOT NULL` (migrations/0055_v25_34_collective_payment_model.sql:70)." },
];
const NEAR_NAME_DEBT_KEYS = new Set(NEAR_NAME_DEBT.map((d) => `${d.file}\u0000${d.field}`));

/** Local-time readers. `getTime`/`valueOf`/`toISOString` are NOT here: they are
 *  timezone-INDEPENDENT and are how the tree legitimately does date arithmetic. */
const TZ_SENSITIVE = new Set([
  "toLocaleDateString", "toLocaleString", "toLocaleTimeString",
  "toDateString", "toTimeString",
  "getFullYear", "getMonth", "getDate", "getDay", "getHours", "getMinutes",
]);

/** The safe formatters. A call to one of these is the FIX, never a violation. */
const SAFE_FORMATTERS = new Set(["fmtDate", "fmtLocaleDate", "fmtLocaleDateTime", "toCalendarDate"]);

/* ── SACRED DEBT — reported loudly, never silently ───────────────────────── */
/**
 * `client/src/pages/founder/Billing.tsx` is a SACRED file (sacred_baseline/
 * SACRED_SHA256.txt). It renders the FOUNDER'S OWN subscription renewal date
 * through its own unsafe local `fmtDate` at :90-93, and that is the single most
 * customer-visible date in the product. WAVE 87 is forbidden to edit it. These
 * rows keep the fence exit-0 while making the debt impossible to lose: the
 * fence PRINTS them on every run and the report escalates them to the owner.
 */
export type SacredDebtEntry = { file: string; field: string; note: string; resolved?: boolean };
export const SACRED_DEBT: SacredDebtEntry[] = [
  { file: "client/src/pages/founder/Billing.tsx", field: "renewsOn", resolved: true,
    note: "SACRED FILE — RESOLVED 2026-08-21 by WAVE 89 under the owner's WAIVER-10 grant (ruling R79). The 4 sites (:284, :411, :454, :500) now call fmtLocaleDate imported from @/lib/format; the file's local fmtDate at :90-93 is left in place for its two TIMESTAMP sites, where localising is correct. The row is KEPT so the debt's history is not erased, and `resolved` LIFTS the suppression below, so this field is now policed live in this file like any other." },
  { file: "client/src/pages/founder/Billing.tsx", field: "nextBillingDate", resolved: true,
    note: "SACRED FILE — RESOLVED with the row above under WAIVER-10 (R79). The field never actually reached this screen; it was listed beside renewsOn for completeness. Suppression is lifted, so if it ever arrives it is policed rather than excused." },
];
/* Only an UNRESOLVED row suppresses a violation. A resolved row is history, not
 * an excuse: WAVE 89 fixed both rows above under WAIVER-10, so from now on this
 * file is scanned like every other and a regression FAILS instead of printing. */
const SACRED_DEBT_KEYS = new Set(
  SACRED_DEBT.filter((d) => !d.resolved).map((d) => `${d.file}\u0000${d.field}`),
);

/* ── AST helpers ─────────────────────────────────────────────────────────── */

export type DateViolation = {
  file: string;
  line: number;
  field: string;
  shape: FieldShape;
  kind: "direct" | "local-helper" | "intl";
  via: string;
  code: string;
};

/** The candidate field names an expression could be reading. */
function leafFields(n: ts.Node, sf: ts.SourceFile, depth = 0): string[] {
  if (depth > 6) return [];
  if (ts.isPropertyAccessExpression(n)) {
    return [n.name.getText(sf), ...leafFields(n.expression, sf, depth + 1)];
  }
  if (ts.isNonNullExpression(n) || ts.isParenthesizedExpression(n) || ts.isAsExpression(n)) {
    return leafFields(n.expression, sf, depth + 1);
  }
  if (ts.isElementAccessExpression(n)) {
    const arg = n.argumentExpression;
    const extra = arg && ts.isStringLiteral(arg) ? [arg.text] : [];
    return [...extra, ...leafFields(n.expression, sf, depth + 1)];
  }
  if (ts.isBinaryExpression(n)) {
    /* `a ?? b`, `a || b`, and `x + "Z"` — inspect every operand. */
    return [...leafFields(n.left, sf, depth + 1), ...leafFields(n.right, sf, depth + 1)];
  }
  if (ts.isConditionalExpression(n)) {
    return [
      ...leafFields(n.condition, sf, depth + 1),
      ...leafFields(n.whenTrue, sf, depth + 1),
      ...leafFields(n.whenFalse, sf, depth + 1),
    ];
  }
  if (ts.isCallExpression(n)) {
    /* `String(x)` / `x.trim()` / `x.slice(0,10)` are transparent wrappers. */
    const callee = n.expression.getText(sf);
    if (/^(?:String|Number)$/.test(callee) || /\.(?:trim|toString|slice|replace)$/.test(callee)) {
      const inner = ts.isPropertyAccessExpression(n.expression)
        ? [n.expression.expression]
        : Array.from(n.arguments);
      return inner.flatMap((a) => leafFields(a, sf, depth + 1));
    }
    return [];
  }
  if (ts.isIdentifier(n)) return [n.text];
  return [];
}

const COLLIDING_TIMESTAMPS = collidingTimestampFields();

/**
 * WAVE 102 · `rel` is now REQUIRED, because whether a contested timestamp name
 * excuses is a property of the SITE, not of the name.
 *
 * Order of authority, most specific first:
 *   1. the field is in the evidence-backed date-only registry           -> policed
 *   2. the field is a timestamp whose stem is NOT contested             -> excused
 *   3. the field is a CONTESTED timestamp and THIS FILE carries cited
 *      per-site evidence that its binding is an instant                 -> excused
 *   4. the field is a CONTESTED timestamp with no evidence for this file -> POLICED
 *      as `mixed`. This is the case that used to be silently excused and
 *      that let a tax-form expiry render a day early in New York.
 */
function firstDateOnlyField(n: ts.Node, sf: ts.SourceFile, rel: string): RegistryEntry | null {
  for (const name of leafFields(n, sf)) {
    const hit = DATE_ONLY_FIELDS.get(name);
    if (hit) return hit;                                       /* (1) */
    if (!TIMESTAMP_FIELDS.has(name)) continue;
    if (!COLLIDING_TIMESTAMPS.has(name)) return null;          /* (2) */
    if (TIMESTAMP_SITE_EVIDENCE.has(`${rel}\u0000${name}`)) return null; /* (3) */
    return {                                                   /* (4) */
      field: name,
      shape: "mixed",
      evidence:
        `NEAR-NAME COLLISION, unevidenced at this site. "${name}" is on TIMESTAMP_FIELDS, but ` +
        `its stem "${stemOf(name)}" is ALSO claimed by the date-only registry, so the name has ` +
        `been shown to be ambiguous and no longer excuses on its own. Either route this render ` +
        `through fmtDate/fmtLocaleDate (safe for BOTH shapes), or — if this file's binding really ` +
        `is an instant — add an entry to TIMESTAMP_SITE_EVIDENCE citing the WRITE PATH, not the name.`,
    };
  }
  return null;
}

/** Does this function body render a Date through a local-time reader? */
function bodyIsUnsafe(body: ts.Node, sf: ts.SourceFile): string | null {
  let found: string | null = null;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const m = n.expression.name.getText(sf);
      if (TZ_SENSITIVE.has(m)) {
        const recv = n.expression.expression;
        const recvText = recv.getText(sf);
        if (/new Date\s*\(/.test(recvText) || /^[A-Za-z_$][\w$]*$/.test(recvText)) {
          found = m;
          return;
        }
      }
    }
    if (ts.isNewExpression(n) && n.expression.getText(sf) === "Intl.DateTimeFormat") {
      found = "Intl.DateTimeFormat";
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(body);
  if (!found) return null;
  /* A helper that delegates to a safe formatter is not unsafe. */
  const text = body.getText(sf);
  for (const safe of SAFE_FORMATTERS) {
    if (new RegExp(`\\b${safe}\\s*\\(`).test(text)) return null;
  }
  return found;
}

/** Names of unsafe date helpers DEFINED in this file (they shadow the safe one). */
function unsafeLocalHelpers(sf: ts.SourceFile): Map<string, string> {
  const out = new Map<string, string>();
  const consider = (name: string | undefined, fn: ts.Node | undefined): void => {
    if (!name || !fn) return;
    const unsafe = bodyIsUnsafe(fn, sf);
    if (unsafe) out.set(name, unsafe);
  };
  const visit = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name && n.body) consider(n.name.getText(sf), n.body);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer &&
        (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) {
      consider(n.name.getText(sf), n.initializer.body);
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
  /* An IMPORTED safe formatter must never be shadowed-in by accident. */
  for (const safe of SAFE_FORMATTERS) {
    const importedSafely = new RegExp(
      `import\\s*\\{[^}]*\\b${safe}\\b[^}]*\\}\\s*from\\s*["']@/lib/format["']`,
    ).test(sf.getFullText());
    if (importedSafely) out.delete(safe);
  }
  return out;
}

export function scanDateFile(abs: string, rel: string): DateViolation[] {
  const code = fs.readFileSync(abs, "utf8");
  const sf = ts.createSourceFile(
    abs, code, ts.ScriptTarget.Latest, true,
    abs.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const helpers = unsafeLocalHelpers(sf);
  const out: DateViolation[] = [];
  const push = (n: ts.Node, e: RegistryEntry, kind: DateViolation["kind"], via: string): void => {
    if (SACRED_DEBT_KEYS.has(`${rel}\u0000${e.field}`)) return;
    /* WAVE 102 · disclosed near-name debt: reported above, not a build stop. */
    if (NEAR_NAME_DEBT_KEYS.has(`${rel}\u0000${e.field}`)) return;
    const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
    out.push({
      file: rel, line: line + 1, field: e.field, shape: e.shape, kind, via,
      code: n.getText(sf).replace(/\s+/g, " ").slice(0, 160),
    });
  };

  const visit = (n: ts.Node): void => {
    /* A. new Date(<date-only>).<tzMethod>() */
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const method = n.expression.name.getText(sf);
      if (TZ_SENSITIVE.has(method)) {
        let recv: ts.Node = n.expression.expression;
        while (ts.isParenthesizedExpression(recv) || ts.isNonNullExpression(recv)) recv = recv.expression;
        if (ts.isNewExpression(recv) && recv.expression.getText(sf) === "Date" &&
            recv.arguments && recv.arguments.length === 1) {
          const hit = firstDateOnlyField(recv.arguments[0], sf, rel);
          if (hit) push(n, hit, "direct", method);
        }
      }
      /* C. Intl.DateTimeFormat(...).format(new Date(<date-only>)) */
      if (method === "format" && /DateTimeFormat/.test(n.expression.expression.getText(sf))) {
        for (const a of n.arguments) {
          let inner: ts.Node = a;
          if (ts.isNewExpression(inner) && inner.expression.getText(sf) === "Date" &&
              inner.arguments && inner.arguments.length === 1) {
            inner = inner.arguments[0];
          }
          const hit = firstDateOnlyField(inner, sf, rel);
          if (hit) push(n, hit, "intl", "Intl.DateTimeFormat().format");
        }
      }
    }
    /* B. <unsafeLocalHelper>(<date-only>) */
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
      const name = n.expression.getText(sf);
      const unsafe = helpers.get(name);
      if (unsafe) {
        for (const a of n.arguments) {
          const hit = firstDateOnlyField(a, sf, rel);
          if (hit) push(n, hit, "local-helper", `${name}() → ${unsafe}`);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
  return out;
}

export function listSourceFiles(dir: string, acc: string[] = []): string[] {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "__tests__" && e.name !== "node_modules" && e.name !== "__mocks__") listSourceFiles(p, acc);
      continue;
    }
    if (!/\.tsx?$/.test(e.name)) continue;
    if (/\.(test|spec)\./.test(e.name)) continue;
    acc.push(p);
  }
  return acc;
}

export type DateFenceResult = {
  ok: boolean;
  filesScanned: number;
  violations: DateViolation[];
  sacredDebt: SacredDebtEntry[];
};

export function runDateOnlyRenderFence(): DateFenceResult {
  const files = listSourceFiles(CLIENT_SRC);
  const violations: DateViolation[] = [];
  for (const abs of files) {
    violations.push(...scanDateFile(abs, path.relative(ROOT, abs).split(path.sep).join("/")));
  }
  return { ok: violations.length === 0, filesScanned: files.length, violations, sacredDebt: SACRED_DEBT };
}

/* ── CLI ─────────────────────────────────────────────────────────────────── */
if (process.argv[1] && /dateOnlyRenderFence\.ts$/.test(process.argv[1])) {
  const t0 = Date.now();
  const r = runDateOnlyRenderFence();
  for (const d of r.sacredDebt) {
    const tag = d.resolved ? "SACRED DEBT CLEARED" : "SACRED DEBT";
    console.log(`[date-only-render-fence] ${tag} — ${d.file} «${d.field}»: ${d.note}`);
  }
  /* WAVE 102 · the collision sweep and its disclosed debt, printed EVERY run. */
  const collisions = nearNameCollisions();
  console.log(
    `[date-only-render-fence] NEAR-NAME COLLISION SWEEP — ${collisions.length} stem(s) claimed by ` +
    `BOTH the date-only registry and TIMESTAMP_FIELDS. A colliding name no longer excuses a site ` +
    `on its own (WAVE 102).`);
  for (const c of collisions) {
    console.log(
      `[date-only-render-fence]   stem "${c.stem}": date-only {${c.dateOnly.join(", ")}} ` +
      `vs timestamp {${c.timestamp.join(", ")}}`);
  }
  console.log(
    `[date-only-render-fence]   ${TIMESTAMP_SITE_EVIDENCE.size} colliding site(s) excused WITH cited ` +
    `write-path evidence; ${NEAR_NAME_DEBT.length} disclosed as NEAR-NAME DEBT below.`);
  for (const d of NEAR_NAME_DEBT) {
    console.log(`[date-only-render-fence] NEAR-NAME DEBT — ${d.file} «${d.field}» [${d.owner}]`);
    console.log(`[date-only-render-fence]     ${d.note}`);
  }
  if (!r.ok) {
    console.error(
      "[date-only-render-fence] FAIL — a DATE-ONLY value is rendered through a\n" +
      "timezone-sensitive path. `new Date(\"2026-06-15\")` parses as UTC midnight, so\n" +
      "this prints ONE DAY EARLY for every user west of UTC (the owner is in New\n" +
      "York) while looking correct to a UTC developer. Route it through `fmtDate`\n" +
      "or `fmtLocaleDate` from `@/lib/format`; do NOT change timestamp rendering —\n" +
      "localising an instant is correct.",
    );
    for (const v of r.violations) {
      console.error(`  ${v.file}:${v.line} [${v.shape}] «${v.field}» via ${v.via}`);
      console.error(`      ${v.code}`);
    }
    console.error(`${r.violations.length} violation(s) in ${new Set(r.violations.map((v) => v.file)).size} file(s), ${Date.now() - t0} ms.`);
    process.exit(1);
  }
  console.log(
    `[date-only-render-fence] OK — ${r.filesScanned} file(s) scanned, ` +
    `${DATE_ONLY_REGISTRY.length} evidence-backed date-only field(s) policed, ` +
    `${TIMESTAMP_FIELDS.size} timestamp field(s) deliberately left to localise, ` +
    `${r.sacredDebt.filter((d) => !d.resolved).length} OPEN sacred-file debt row(s) ` +
    `(${r.sacredDebt.filter((d) => d.resolved).length} cleared) reported above, ${Date.now() - t0} ms.`,
  );
}
