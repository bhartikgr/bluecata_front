/**
 * scripts/lint/internalLanguageFence.ts
 *
 * WAVE 84 — THE POSITIVE FENCE AGAINST INTERNAL PROCESS LANGUAGE.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 * ─────────────────────────────────────────────────────────────────────────────
 * Wave 83 removed 123 instances of internal engineering language from
 * customer-facing screens — SQL table and column names, endpoint paths, error
 * constants, error class names, function names, telemetry event names, hash
 * digests. Wave 83's OWN mutation test then proved the standing protection was
 * one-directional: mutation W83-M6 RE-ADDED the `Table` row to the /admin/fees
 * source-of-truth panel and `npm run guard` still passed, because the
 * silent-drop guard detects REMOVALS and never RE-ADDITIONS.
 *
 * So the cleanup was protected by a handful of file-specific assertions. Anybody
 * could reintroduce a source path, a table name or an error constant tomorrow
 * with every gate green. A platform-wide visual overhaul across four product
 * areas (R73/R74) is queued next and will touch nearly every rendered file;
 * that programme is exactly when this regresses.
 *
 * This fence is the POSITIVE direction: it FAILS when internal language APPEARS
 * in text a user can read.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * METHOD — SYNTAX LEVEL, NOT TEXT SEARCH
 * ─────────────────────────────────────────────────────────────────────────────
 * The TypeScript compiler parses every non-test file under `client/src`, and the
 * fence inspects ONLY rendered text nodes and user-facing string literals —
 * JsxText, string literals and template-literal chunks — each classified by its
 * syntactic parent. This is Wave 80's and Wave 83's method, chosen because it is
 * the method that measured correctly:
 *
 *   * a plain `grep` for the Wave 83 class produced 24 hits where the AST sweep
 *     found 61;
 *   * a naive line-based filter has twice produced false-alarm cascades in this
 *     project (6,818 and 519 phantom "leaks"), both times by matching the file
 *     path the search tool prints rather than the text a user reads.
 *
 * COMMENTS ARE STRUCTURALLY INVISIBLE HERE — they are not nodes this walk
 * visits. That is deliberate and load-bearing: this project's engineering
 * comments cite routes, tables and owner rulings on purpose, and deleting that
 * reasoning to satisfy a copy check would destroy context and fix nothing a
 * customer sees.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SOURCES OF TRUTH — so the banned lists cannot go stale
 * ─────────────────────────────────────────────────────────────────────────────
 *   SQL tables / columns  ← parsed from `shared/schema.ts` and `shared/schema.pg.ts`
 *                           (sqliteTable/pgTable names and column definitions).
 *   Telemetry events      ← `ALL_EVENT_TYPES` in `packages/telemetry/src/events.ts`.
 *   Machine tokens        ← every snake_case string literal in non-test
 *                           `server/`, `shared/` and `packages/<pkg>/src` code:
 *                           error codes, refusal codes, state constants.
 *                           `closed_round_readonly` (server/routes.ts) and
 *                           `fd_base_divergence` (shared/roundMathEngineAdapter.ts)
 *                           come from here.
 *   Environment variables ← real `process.env.<NAME>` reads. The Wave 83 admin
 *                           exception only applies to names the tree truly reads;
 *                           an invented SCREAMING_SNAKE token still fails.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY NOT A VIOLATION, AND WHY
 * ─────────────────────────────────────────────────────────────────────────────
 *   * CODE COMMENTS — structurally invisible (see above).
 *   * `data-testid`, `className`, `key`, `id`, `href`, `to`, `src`, `path`,
 *     `value`, `name`, `type` and other non-copy attributes.
 *   * QUERY KEYS, `fetch` / `apiRequest` arguments, mutation keys, route
 *     constants, `readEndpoint` / `writeEndpoint` / `table` / `column` /
 *     `provenance` props — Wave 83's own test drew this line and this fence
 *     reuses it, including its two corrections: a COMMENT is never prose, and a
 *     bare path argument ending in more than one punctuation character is a
 *     fetch argument, not prose.
 *   * EQUALITY COMPARISONS, `??` / `||` DEFAULTS, `case` labels, object keys,
 *     type positions, enum members, index accesses — code, not copy. (This is
 *     what keeps `String(mode ?? "pre_money") === "post_money"` in
 *     founder/RoundDetail.tsx from being read as rendered copy: the literal is a
 *     default value inside a comparison, and no user ever sees it.)
 *   * TEST FILES, entirely: `__tests__/`, `*.test.*`, `*.spec.*`.
 *   * The admin **Migration** tool — a real feature name. Only the bare word is
 *     exempt; an actual migration NUMBER is always a violation.
 *   * LEGAL STATUTE CITATIONS. `§` on its own is NOT banned: this product quotes
 *     Companies Act §107-108, ITAA 1997 §83A-105 and MAS SFA §4A to founders and
 *     investors, and those are product copy of the highest value. What IS banned
 *     is an INTERNAL spec citation — `R73 §2`, `§11.6.4`, `per R44`.
 *   * The word "Telemetry" as a FEATURE NAME (there is an admin Telemetry
 *     screen). What is banned is a telemetry EVENT NAME, and the internal
 *     framing "emits a telemetry event".
 *   * SHA-256 as an algorithm name: out of scope for this wave's banned list
 *     (Wave 83 handled rendered digests as its own class). A RAW hex digest of
 *     16+ characters rendered as a value is still a violation.
 *   * The four admin exceptions Wave 83 ratified and pinned in
 *     `client/src/pages/admin/__tests__/w83_admin_fees_not_a_database_console.test.ts`
 *     — UNITS, LAST EDITOR, EDITABILITY, and ERROR CODES / ENVIRONMENT VARIABLE
 *     NAMES on admin-only screens, "because an operator's only lever for those
 *     lives outside the product". See `EXCEPTIONS`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * KNOWN LIMIT, STATED OUT LOUD
 * ─────────────────────────────────────────────────────────────────────────────
 * This fence sees LITERALS. A table name that arrives through a prop or an API
 * response and is rendered by `<Row label="Table" value={table} />` is invisible
 * to it, because the internal string is not in the file. That is exactly the
 * shape of mutation W83-M6, and it is why Wave 83's file-specific assertions
 * MUST STAY — the two are complementary, not redundant. The fence stops new
 * literals; the pinned tests stop the old rows coming back.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * R77 — THE FENCE GOVERNS RENDERED TEXT ONLY, NEVER THE PRESENCE OF A STRING
 * ─────────────────────────────────────────────────────────────────────────────
 * RULING (R77, delegated authority, encoded here): an internal identifier is a
 * defect WHEN A USER CAN READ IT. It is not a defect when it exists as a
 * machine-readable value no user ever sees.
 *
 *   BANNED   rendered text — JSX text nodes, `title`, `aria-label`,
 *            `placeholder`, toast and description strings, table cell content:
 *            anything that reaches an eye or a screen reader.
 *   ALLOWED  the SAME identifier as a non-rendered machine-readable value — an
 *            API payload field, an `error.code`, a `refusalName`, a props value,
 *            a query key, a fetch argument, a route constant, a `switch`
 *            discriminant, a `data-testid`, a docstring or a comment.
 *
 * WHY THIS IS RIGHT ON THE MERITS AND NOT A COMPROMISE. A refusal has two
 * audiences at once: it must be PROFESSIONAL TO A HUMAN and PRECISE TO AN
 * INTEGRATION. Stripping the code out of the payload would degrade the API to
 * satisfy a copy rule; leaving it on the screen violates the owner's ruling.
 * Separating the two satisfies both.
 *
 * WORKED EXAMPLE — the refusal that made the ruling necessary
 * (`price_contradicts_pool`, W58CD-A1e vs Wave 83's pin):
 *
 *     // GREEN. The code is the machine's, the sentence is the human's.
 *     if (refusal.code === "price_contradicts_pool") {
 *       return (
 *         <Alert
 *           data-testid="refusal-price_contradicts_pool"
 *           title="This price disagrees with the option pool"
 *           description="Saving is blocked until the price and the pool agree."
 *         />
 *       );
 *     }
 *     // …and the payload keeps its precision, untouched:
 *     //   { ok: false, code: "price_contradicts_pool", saved: 1.23, derived: 1.19 }
 *
 *     // RED. The same identifier moved into something a user reads.
 *     <Alert title="price_contradicts_pool" />
 *     <p>Refused: price_contradicts_pool</p>
 *
 * HOW IT IS IMPLEMENTED. This is not a list of exempt strings — it is the AST
 * position test in `classify()`. The comparison operand, the `data-testid`, the
 * `code` prop and the comment are never reachable as copy; the `title`, the
 * `description` and the JSX child are. A fence that matched the PRESENCE of a
 * bare string in a file would flag the green example above, and that is precisely
 * the over-broad matching that produced this project's two phantom leak cascades
 * (6,818 and 519 false "leaks", both from matching a path rather than the text).
 * Both poles of this exact case are mutation-tested (W84-E in the test file).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE REGISTER — PRE-EXISTING SITES, NAMED, NOT BLANKET-ALLOWED
 * ─────────────────────────────────────────────────────────────────────────────
 * The baseline on the tree Wave 84 inherited is NOT zero: the sweep finds
 * pre-existing sites, overwhelmingly on admin screens Wave 83 never reached.
 * Wave 84 is not authorised to change copy, so each one is recorded in
 * `REGISTER` below with its own written reason and a status:
 *
 *   status "ratified" — allowed indefinitely; the reason says why a person needs
 *                       to see it (cookie names in the privacy policy, an
 *                       operator's env var, the units of a fee).
 *   status "debt"     — a genuine leak of the Wave 83 class that this wave is
 *                       not allowed to rewrite. The entry names the screen and
 *                       what the replacement should say. These are the follow-on
 *                       work, counted and printed on every run.
 *
 * An entry is keyed by FILE + CLASS + MATCH and NOT by line number, on purpose:
 * R73/R74 will move nearly every rendered line, and a line-keyed register would
 * turn that programme into a red storm and get this fence deleted. Anything NOT
 * in the register is RED. Adding to the register is a visible diff with a reason
 * in it, which is the point.
 *
 * MUTATION TRANSCRIPT (both poles, every banned class): build_log/wave84/W84_MUTATIONS.md
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

/* ── tree layout ─────────────────────────────────────────────────────────── */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.W84_ROOT ? path.resolve(process.env.W84_ROOT) : path.resolve(HERE, "..", "..");
const CLIENT_SRC = path.join(ROOT, "client", "src");

export type Violation = { file: string; line: number; cls: string; match: string; text: string; ctx: string };

/* ── files Wave 80 measured as unrendered, kept rather than deleted ──────── */
const EXEMPT_FILES: ReadonlyArray<{ file: string; why: string }> = [
  {
    file: "client/src/lib/sprint-banner.ts",
    why: "WAVE 80 MEASURED: `SPRINT_BANNER` is an exported constant with zero consumers anywhere in client/src or server/. It renders on no screen. Kept rather than deleted under the owner's \"I'd rather add than delete\"; if it is ever imported this exemption must be revisited.",
  },
  {
    file: "client/src/lib/partner/mfcrmPersona.ts",
    why: "WAVE 80 MEASURED: `MfcrmGate.source` is a code-documentation field. `gateRefusalText` — the one function that turns a gate into user-visible copy — builds its sentence from `capabilityLabel(gate.key)` and never reads `.source`. PartnerShell.tsx imports `resolvePersona` and `MfcrmCapability` from this module, not the source strings.",
  },
];
const EXEMPT_FILE_SET = new Set(EXEMPT_FILES.map((e) => e.file));

/* ── SOURCES OF TRUTH ────────────────────────────────────────────────────── */
export type Catalogue = {
  tables: Set<string>;
  columns: Set<string>;
  events: Set<string>;
  machineTokens: Set<string>;
  envNames: Set<string>;
};

function readFilesUnder(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "__tests__" || e.name === "__mocks__" || e.name === "dist") continue;
      readFilesUnder(p, out);
      continue;
    }
    if (!/\.(tsx?|mjs|cjs|js)$/.test(e.name)) continue;
    if (/\.(test|spec)\./.test(e.name)) continue;
    out.push(p);
  }
  return out;
}

export function buildCatalogue(): Catalogue {
  const tables = new Set<string>();
  const columns = new Set<string>();
  const events = new Set<string>();
  const machineTokens = new Set<string>();
  const envNames = new Set<string>();

  /* schema — tables and snake_case columns */
  for (const rel of ["shared/schema.ts", "shared/schema.pg.ts"]) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const src = fs.readFileSync(abs, "utf8");
    for (const m of src.matchAll(/(?:sqliteTable|pgTable)\(\s*"([a-z0-9_]+)"/g)) tables.add(m[1]);
    for (const m of src.matchAll(
      /\b(?:text|integer|real|blob|numeric|boolean|timestamp|jsonb|json|serial|varchar|bigint|doublePrecision|uuid|date)\(\s*"([a-z0-9_]+)"/g,
    ))
      columns.add(m[1]);
  }

  /* telemetry catalogue */
  const evAbs = path.join(ROOT, "packages", "telemetry", "src", "events.ts");
  if (fs.existsSync(evAbs)) {
    const src = fs.readFileSync(evAbs, "utf8");
    const start = src.indexOf("ALL_EVENT_TYPES");
    if (start >= 0) {
      const end = src.indexOf("];", start);
      for (const m of src.slice(start, end).matchAll(/"([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)"/g)) events.add(m[1]);
    }
  }

  /* machine tokens + env-var names, from non-test server / shared / package code */
  const scan = [
    ...readFilesUnder(path.join(ROOT, "server")),
    ...readFilesUnder(path.join(ROOT, "shared")),
    ...readFilesUnder(path.join(ROOT, "packages")),
  ];
  for (const abs of scan) {
    const src = fs.readFileSync(abs, "utf8");
    for (const m of src.matchAll(/["'`]([a-z][a-z0-9]*(?:_[a-z0-9]+)+)["'`]/g)) machineTokens.add(m[1]);
    for (const m of src.matchAll(/process\.env(?:\.([A-Z][A-Z0-9_]*)|\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\])/g))
      envNames.add((m[1] ?? m[2]) as string);
  }
  for (const abs of readFilesUnder(CLIENT_SRC)) {
    const src = fs.readFileSync(abs, "utf8");
    for (const m of src.matchAll(/process\.env(?:\.([A-Z][A-Z0-9_]*)|\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\])/g))
      envNames.add((m[1] ?? m[2]) as string);
    for (const m of src.matchAll(/import\.meta\.env\.([A-Z][A-Z0-9_]*)/g)) envNames.add(m[1]);
  }
  for (const t of tables) machineTokens.add(t);
  for (const c of columns) machineTokens.add(c);
  return { tables, columns, events, machineTokens, envNames };
}

/* ── contexts that are never rendered copy ───────────────────────────────── */
/**
 * WAVE 87 · ITEM 2 — ARIA IDREF ATTRIBUTES ARE NOT TEXT, AND THAT IS A RULING.
 *
 * Reviewer 1 asked for `aria-labelledby` to be added to COPY_ATTRS because its
 * value fell through the fence. WAVE 87 declines, on the merits.
 *
 * `aria-labelledby` does not carry text. It carries an ID REFERENCE LIST. The
 * accessible name is computed from the TEXT CONTENT of the element whose `id`
 * matches; the attribute's own value is never spoken, shown or exposed by any
 * assistive technology, and an IDREF that resolves to nothing leaves the element
 * with NO accessible name — no browser reads the id aloud. So an internal
 * identifier there is exactly what R77 protects: a machine-readable value no
 * user can read.
 *
 * It would also be internally inconsistent to ban it. The value must EQUAL some
 * element's `id`, and `id`/`htmlFor` are already (correctly) non-copy. A fence
 * that failed on `aria-labelledby="captable_commits"` while passing
 * `id="captable_commits"` would require the two to differ, which is impossible.
 *
 * The real protection is that the REFERENCED ELEMENT'S TEXT is policed — and it
 * always was, as JsxText. Both halves are pinned in
 * client/src/lib/__tests__/w87_internal_language_fence_bypasses.test.ts.
 *
 * The aria attributes that ARE spoken text (`aria-label`, `aria-description`,
 * `aria-roledescription`, `aria-valuetext`, `aria-placeholder`) are COPY_ATTRS
 * and are red.
 */
const ARIA_IDREF_ATTRS = new Set([
  "aria-labelledby", "aria-describedby", "aria-details", "aria-controls",
  "aria-owns", "aria-flowto", "aria-activedescendant", "aria-errormessage",
]);

/**
 * WAVE 87 · ITEM 2 — CHART AXIS AND LEGEND LABELS ARE COPY.
 * On a recharts element, `name`, `unit` and `label` are what the legend, the
 * tooltip and the axis PRINT. Everywhere else `name` is a form field name, which
 * is why it stays in NON_COPY_ATTRS — the distinction is the element, not the
 * attribute.
 */
const CHART_TAGS =
  /^(?:Bar|Line|Area|Pie|Radar|RadialBar|Scatter|Funnel|Cell|XAxis|YAxis|ZAxis|PolarAngleAxis|PolarRadiusAxis|Legend|Tooltip|LabelList|ReferenceLine|ReferenceArea|Brush)$/;
const CHART_COPY_ATTRS = new Set(["name", "unit", "label", "legendType", "tickFormatter"]);

const NON_COPY_ATTRS = new Set([
  "data-testid", "testId", "dataTestId", "className", "class", "key", "id", "htmlFor",
  "href", "to", "src", "path", "value", "defaultValue", "name", "type", "variant",
  "size", "role", "queryKey", "endpoint", "readEndpoint", "writeEndpoint", "table",
  "column", "provenance", "editableVia", "as", "position", "side", "align", "target",
  "rel", "method", "action", "autoComplete", "inputMode", "pattern", "step", "min", "max",
  "sotColumn", "dataSotColumn", "form", "list", "accept", "encType", "loading", "fill",
]);

const NON_COPY_PROPS = new Set([
  "queryKey", "mutationKey", "url", "endpoint", "readEndpoint", "writeEndpoint",
  "table", "column", "provenance", "editableVia", "path", "route", "href", "to",
  "key", "id", "testId", "dataTestId", "type", "kind", "field", "column_name",
  "eventType", "event", "code", "method", "src", "name", "slug", "value", "state",
  "status", "mode", "variant", "icon", "className",
]);

const NON_COPY_CALLEES =
  /(?:^|\.)(?:fetch|apiRequest|useQuery|useMutation|useInfiniteQuery|invalidateQueries|refetchQueries|getQueryData|setQueryData|prefetchQuery|require|import|navigate|push|replace|setLocation|matchPath|createElement|querySelector|querySelectorAll|getAttribute|setAttribute|getItem|setItem|removeItem|track|logEvent|emit|recordEvent|includes|startsWith|endsWith|indexOf|split|join|has|get|set|add|delete|z\.\w+|console\.\w+|logger\.\w+|debug|warn|error|info|log)$/;

const COPY_ATTRS = new Set([
  "title", "label", "placeholder", "aria-label", "aria-description", "alt",
  "description", "helperText", "helper", "hint", "tooltip", "emptyMessage",
  "message", "subtitle", "heading", "caption", "confirmText", "cancelText",
  "submitLabel", "summary", "note", "reason", "detail", "details", "positive",
  /* WAVE 87 · ITEM 2 — `dangerouslySetInnerHTML` IS rendered text, by
     definition. Reviewer 1's first bypass was
     `dangerouslySetInnerHTML={{ __html: "captable_commits" }}`: the attribute
     was unknown to both lists, so the literal counted as "not rendered" and the
     >=3-word prose fallback discarded a one-word identifier. Nothing about
     innerHTML is machine-readable — it is the most rendered position there is. */
  "dangerouslySetInnerHTML",
  /* Spoken aria text (the IDREF attributes are handled by ARIA_IDREF_ATTRS). */
  "aria-roledescription", "aria-valuetext", "aria-placeholder",
  /* Tooltip / popover content props that reach the eye verbatim. */
  "content", "text", "body", "banner", "legend", "empty", "emptyText",
]);
const COPY_PROPS = new Set([
  "title", "label", "message", "description", "hint", "helper", "helperText",
  "body", "text", "detail", "details", "explanation", "summary", "subtitle",
  "caption", "note", "placeholder", "heading", "remediation", "guidance", "copy",
  "tooltip", "warning", "cta", "confirmText", "blurb", "emptyMessage",
  "errorMessage", "toast", "positive", "negative",
  /* WAVE 87 · ITEM 2 — tooltip/popover `content`, chart series `unit`, and the
     header/footer/legend slots: all printed verbatim. */
  /* NOT `unit`: client/src/lib/financialFieldCopy.ts uses `unit: "usd_minor"` as a
     machine code. `unit` is copy only as a CHART attribute (CHART_COPY_ATTRS),
     where it is printed on the axis. Measured: adding it here produced 7 false
     positives in one run. */
  "content", "header", "footer", "legend", "banner", "empty", "emptyText",
]);
const RENDERING_CALLEES = /(?:toast|alert|confirm|prompt|setError|setMessage|setStatusText|setToast|notify|setRefusal|setMessageRefusal)/i;
/* Of those, the ones whose argument is shown to the user VERBATIM. A one-word
   string here is copy (see isCopy): `toast({ description: "price_contradicts_pool" })`
   is a readable leak. The rest are STATE SETTERS, whose value is frequently a
   machine code that a mapper turns into a sentence before render — e.g.
   `setMessageRefusal("missing_fields")` rendered as `tierErrorCopy(messageRefusal)`,
   which is R77-correct and must stay green. For setters, only multi-word strings
   are treated as copy; the limit that follows from this is stated in the report. */
/* WAVE 87 · ITEM 2 — `toast.error("captable_commits")` reached the eye while
   the anchored pattern below only matched a bare `toast`. Variants are the
   normal way this tree raises a toast, so the dotted form is included. */
const DIRECT_RENDER_CALLEES = /^(?:toast|alert|confirm|prompt|notify)(?:\.[A-Za-z_$][\w$]*)?$/i;

/** A text node that is ONLY a route path is a route string, not prose. */
const ROUTE_ONLY = /^[A-Za-z]*:?\/?\/?(?:api|admin|founder|investor|partner|collective|consortium)[A-Za-z0-9_/:.\-${}[\]?=&]*$/;

/* ── the ratified exceptions ─────────────────────────────────────────────── */
export type Exception = {
  id: string;
  scope: RegExp;
  cls: RegExp;
  match: RegExp;
  reason: string;
  approvedBy: string;
  date: string;
};

const ADMIN_ONLY = /^client\/src\/(?:pages\/admin\/|components\/admin\/)/;

/**
 * The two names Wave 83's pinning test asserts are KEPT on /admin/fees
 * (W83-I1e). `COLLECTIVE_RENEWAL_WORKER_ENABLED` is a real `process.env` read;
 * `COLLECTIVE_RENEWAL_POLL_MS` is a documented operator knob the worker reads
 * from stored config rather than the environment. Wave 83 ratified BOTH as
 * operator levers, so this fence honours both verbatim rather than second-guess
 * a ruling it was told to respect exactly.
 */
const W83_PINNED_ENV = new Set(["COLLECTIVE_RENEWAL_WORKER_ENABLED", "COLLECTIVE_RENEWAL_POLL_MS"]);

/**
 * R77 — the documented machine-readable allowance, exported so the test can
 * assert every position on this list stays GREEN and so nobody has to read the
 * classifier to know what is allowed. These are POSITIONS, not strings: any
 * identifier is fine in any of them, and no identifier is fine in rendered text.
 */
export const R77_MACHINE_READABLE_ALLOWANCE = {
  ruling: "R77",
  rule:
    "An internal identifier is a defect when a user can read it. The same identifier is allowed as a machine-readable value that is never rendered.",
  allowedPositions: [
    "API payload field / response property",
    "error.code and other discriminant comparisons",
    "refusalName and similar machine keys",
    "props values that are not copy props (code, kind, eventType, slug, state, …)",
    "query keys and mutation keys",
    "fetch / apiRequest arguments",
    "route constants",
    "switch and case discriminants",
    "data-testid values",
    "docstrings and comments",
  ],
  workedExample:
    'if (refusal.code === "price_contradicts_pool") return <Alert data-testid="refusal-price_contradicts_pool" title="This price disagrees with the option pool" description="Saving is blocked until the price and the pool agree." />;',
  bannedExample: '<Alert title="price_contradicts_pool" /> — the identifier is now readable.',
  mutationTest: "client/src/lib/__tests__/w84_internal_language_fence.test.ts (W84-E, both poles)",
} as const;

export const EXCEPTIONS: Exception[] = [
  {
    id: "W83-ADMIN-ENVVAR",
    scope: ADMIN_ONLY,
    cls: /^error-const$/,
    match: /^[A-Z][A-Z0-9_]*$/,
    reason:
      "ENVIRONMENT VARIABLE NAMES on admin-only screens. Wave 83 pinned this (W83-I1e): \"an admin's only lever for these lives outside the product, so renaming them in copy would make the screen useless.\" Accepted ONLY when the tree really reads process.env.<NAME> / import.meta.env.<NAME>; an invented SCREAMING_SNAKE token on an admin screen still FAILS.",
    approvedBy: "Wave 83 ratified admin exception (owner ruling Q25 / R44)",
    date: "2026-08-20",
  },
  {
    id: "W83-ADMIN-UNITS",
    scope: ADMIN_ONLY,
    cls: /^(internal-token|sql-column|sql-table|sql-framing)$/,
    match: /^(?:currency_minor|basis_points|percent_scaled|minor_units|amount_minor|fee_minor)$/,
    reason:
      "UNITS on admin-only screens. An operator editing a fee must know whether the field is whole cents or basis points — the unit is the fact, and Wave 83 asserts the Units row EXISTS (W83-I1a). The plain-English mapping (UNIT_IN_PLAIN_ENGLISH) is still the preferred rendering; this covers the raw unit token shown beside it.",
    approvedBy: "Wave 83 ratified admin exception (owner ruling Q25 / R44)",
    date: "2026-08-20",
  },
  {
    id: "W83-ADMIN-ERRORCODE",
    scope: ADMIN_ONLY,
    cls: /^(error-const|internal-token)$/,
    match: /^(?:TIER_PRICE_UNPRICED|PRICE_UNPRICED|UNPRICED)$/,
    reason:
      "ERROR CODES on admin-only screens, where the operator's remediation lives outside the product and support quotes the code back to them. NARROW BY DESIGN — it names specific codes, not a pattern, so a new constant is a new decision. Wave 83 REMOVED TIER_PRICE_UNPRICED from AdminPartnerBillingOps.tsx and W83-I1f pins its absence; this entry does not re-open that screen, it keeps an operator-facing error-code column elsewhere from having to disable the fence.",
    approvedBy: "Wave 83 ratified admin exception (owner ruling Q25 / R44)",
    date: "2026-08-20",
  },
  {
    id: "W83-ADMIN-LAST-EDITOR-AND-EDITABILITY",
    scope: ADMIN_ONLY,
    cls: /^(internal-token|sql-column)$/,
    match: /^(?:updated_by|updated_at|last_edited_by|edited_by|editable_via|changed_by)$/,
    reason:
      "LAST EDITOR and EDITABILITY on admin-only screens. Wave 83's line: an operator legitimately needs WHO LAST EDITED a value and WHETHER THEY CAN EDIT IT HERE. The preferred rendering is the English label (\"Last edited by\"); this covers the residual identifier form on an admin screen only.",
    approvedBy: "Wave 83 ratified admin exception (owner ruling Q25 / R44)",
    date: "2026-08-20",
  },
];

/* ── the pinned register of pre-existing sites (see header) ──────────────── */
export type RegisterEntry = {
  file: string;
  cls: string;
  match: string;
  status: "ratified" | "debt";
  reason: string;
};

export const REGISTER: RegisterEntry[] = [
  {
    file: "client/src/pages/admin/AdminPlatformFees.tsx",
    cls: "event-name",
    match: "collective.member_subscription",
    status: "debt",
    reason:
      "DEBT: the internal FEE-CODE NAMESPACE rendered in helper text (\"each is stored as a platform_fees row (collective.member_subscription.*)\"). The operator needs to know WHICH fees this panel governs, not the dotted key. REPLACEMENT: \"these are the Collective membership subscriptions\". Found only after the dotted-shape event rule was added, which is why that rule exists: a catalogue-only rule saw nothing here.",
  },
  {
    file: "client/src/pages/admin/PlatformSurfaces.tsx",
    cls: "event-name",
    match: "audit.chain_integrity",
    status: "debt",
    reason:
      "DEBT: an internal surface key used as a PLACEHOLDER example on the platform-surfaces screen. Same class and same replacement as the other placeholder entries here — state the format (\"surface key\") rather than ship an internal identifier as the example.",
  },
  {
    file: "client/src/components/PaymentSurface.tsx",
    cls: "error-const",
    match: "AIRWALLEX_API_BASE",
    status: "debt",
    reason:
      "GENUINE LEAK, customer-visible payment surface: the gateway-unreachable message reads \"Check credentials and AIRWALLEX_API_BASE.\" This is not an admin-only screen, so the Wave 83 env-var exception does not reach it. REPLACEMENT SHOULD SAY: \"Payments are temporarily unavailable — our team has been notified.\" Wave 84 changes no copy, so it is named here.",
  },
  {
    file: "client/src/pages/Privacy.tsx",
    cls: "internal-token",
    match: "cap_uid",
    status: "ratified",
    reason:
      "RATIFIED: the session cookie NAME (`__Host-cap_uid`) inside the privacy policy. Naming the cookies it sets is a disclosure obligation, not internal-process exposure — a reader auditing their own browser storage needs the literal name, and it is rendered inside a <code> element for exactly that reason.",
  },
  {
    file: "client/src/pages/admin/AdminFeesConsolidated.tsx",
    cls: "internal-token",
    match: "partner_basic",
    status: "debt",
    reason:
      "DEBT, /admin/fees tier-rename map: the legacy tier tokens are rendered as `partner_basic → catalyst`. An operator needs the MAPPING, but the left-hand side should read \"Basic (legacy)\". Same class Wave 83 fixed on this very screen; this row was outside its three named panels.",
  },
  {
    file: "client/src/pages/admin/AdminFeesConsolidated.tsx",
    cls: "internal-token",
    match: "partner_pro",
    status: "debt",
    reason:
      "DEBT: as `partner_basic` above — legacy tier token rendered in the rename map on /admin/fees.",
  },
  {
    file: "client/src/pages/admin/AdminFeesConsolidated.tsx",
    cls: "internal-token",
    match: "partner_enterprise",
    status: "debt",
    reason:
      "DEBT: as `partner_basic` above — legacy tier token rendered in the rename map on /admin/fees.",
  },
  {
    file: "client/src/pages/admin/AdminFeesConsolidated.tsx",
    cls: "ruling-citation",
    match: "under R3",
    status: "debt",
    reason:
      "DEBT, and the clearest single leak the fence found: an OWNER RULING CITATION (\"the tiered machinery is retained under R3\") rendered on a screen that is screenshared during partner onboarding. Exactly Wave 80's banned class, re-appearing on an admin screen Wave 80 did not clear. REPLACEMENT: state the rule — \"the tiered machinery is retained, and a divergence is disclosed rather than discovered on an invoice\" — deleting only the citation.",
  },
  {
    file: "client/src/pages/admin/AdminFeesConsolidated.tsx",
    cls: "internal-token",
    match: "collective_application_fee_config",
    status: "debt",
    reason:
      "DEBT: the hint names the config KEY the retired duplicate editor used to write to. The operator's lever is this editor, not the key. REPLACEMENT: \"...which wrote display dollars into the stored application-fee configuration\".",
  },
  {
    file: "client/src/pages/admin/AdminFeesConsolidated.tsx",
    cls: "error-const",
    match: "COLLECTIVE_RENEWAL_LEAD_SEC",
    status: "ratified",
    reason:
      "RATIFIED under Wave 83's admin exception (W83-I1e), same panel and same class as the two names its test pins verbatim: an operator knob whose only lever lives outside the product. NOTE FOR THE OWNER: unlike COLLECTIVE_RENEWAL_WORKER_ENABLED this is not read via `process.env` in the current tree — it is documented in server/lib/collectiveRenewalWorker.ts and read from stored config — so it is ratified by CATEGORY, not by verification.",
  },
  {
    file: "client/src/pages/admin/AdminFeesConsolidated.tsx",
    cls: "error-const",
    match: "MAX_CONSECUTIVE_FAILURES",
    status: "ratified",
    reason:
      "RATIFIED under Wave 83's admin exception (W83-I1e), same panel: the failure threshold an operator must reason about when a subscription escalates. NOTE FOR THE OWNER: this one is a bare literal in server/lib/collectiveRenewalWorker.ts, not an environment variable at all, so the honest description of the row is \"Failures before escalation: 3\" — see OWNER QUESTIONS.",
  },
  {
    file: "client/src/pages/admin/AdminIntegrations.tsx",
    cls: "endpoint-prose",
    match: "/api/feeds/venture-markets",
    status: "debt",
    reason:
      "DEBT: an ENDPOINT PATH rendered as prose (`GET /api/feeds/venture-markets`) on the integrations screen. An admin cannot call it from here. REPLACEMENT: name the SURFACE — \"Read by the venture-markets feed\" — which is the substitution Wave 83 made for the identical row on /admin/fees.",
  },
  {
    file: "client/src/pages/admin/AdminIntegrations.tsx",
    cls: "endpoint-prose",
    match: "GET /api/feeds/venture-markets",
    status: "debt",
    reason:
      "DEBT: the HTTP-verb form of the same rendered endpoint path on the integrations screen; recorded separately because the fence reports the verb+path class as its own hit.",
  },
  {
    file: "client/src/pages/admin/AdminPlatformFees.tsx",
    cls: "internal-token",
    match: "platform_fees",
    status: "debt",
    reason:
      "DEBT: the SQL table name `platform_fees` in the helper text of two tier panels. Wave 83 replaced this exact table name with \"Fee registry\" on /admin/fees and pinned the change; this screen was not in its scope. REPLACEMENT: \"each is stored as a fee-registry row\".",
  },
  {
    file: "client/src/pages/admin/AuditChainVerifyPage.tsx",
    cls: "internal-token",
    match: "chap_keiretsu_canada",
    status: "debt",
    reason:
      "DEBT: a raw chapter id used as a PLACEHOLDER example. Wave 83's ruling on the identical `cmp_abc, cmp_xyz` placeholder was to state the FORMAT instead (\"one company id per line\"). REPLACEMENT: \"chapter id\".",
  },
  {
    file: "client/src/pages/admin/AuditLog.tsx",
    cls: "telemetry-framing",
    match: "telemetry event",
    status: "debt",
    reason:
      "DEBT: internal event-bus framing (\"Hash-chained admin audit log + telemetry event log unified\") in the screen description. REPLACEMENT: \"every action and signal, recorded immutably and queryable\" — the promise, not the bus.",
  },
  {
    file: "client/src/pages/admin/CollectivePaymentPL.tsx",
    cls: "internal-token",
    match: "collective_payment_entries",
    status: "debt",
    reason:
      "DEBT: the SQL table name in the screen description. REPLACEMENT: \"aggregated from the collective payment ledger\", which is what the sentence already calls it two words earlier.",
  },
  {
    file: "client/src/pages/admin/CollectiveSubscriptions.tsx",
    cls: "internal-token",
    match: "dsc_member",
    status: "debt",
    reason:
      "DEBT: an internal role token rendered as a value. REPLACEMENT: the role's display name.",
  },
  {
    file: "client/src/pages/admin/CollectiveSubscriptions.tsx",
    cls: "internal-token",
    match: "chapter_admin",
    status: "debt",
    reason:
      "DEBT: an internal role token rendered as a value. REPLACEMENT: \"Chapter admin\".",
  },
  {
    file: "client/src/pages/admin/Companies.tsx",
    cls: "telemetry-framing",
    match: "telemetry event",
    status: "debt",
    reason:
      "DEBT: internal event-bus framing in the tenant-roster guidance and in the behavioural-signals note. REPLACEMENT: \"recorded activity\".",
  },
  {
    file: "client/src/pages/admin/ConsortiumApplicationsPage.tsx",
    cls: "sql-table",
    match: "partner_organizations",
    status: "debt",
    reason:
      "DEBT: the SQL table name `partner_organizations` inside the guidance text (\"auto-provisions a partner organisation row\"). REPLACEMENT: drop the table name; the sentence already says what approval does.",
  },
  {
    file: "client/src/pages/admin/Dashboard.tsx",
    cls: "internal-token",
    match: "wired_minor",
    status: "debt",
    reason:
      "DEBT: a column name rendered in a metric explanation (\"actual wired amounts on SPV subscriptions (wired_minor field)\"). REPLACEMENT: \"(the wired amount recorded on each subscription)\" — the fact, not the field.",
  },
  {
    file: "client/src/pages/admin/Email.tsx",
    cls: "internal-token",
    match: "dry_run",
    status: "debt",
    reason:
      "DEBT: an internal mode token rendered as an option label (`dry_run (test)`). REPLACEMENT: \"Test send (nothing is delivered)\".",
  },
  {
    file: "client/src/pages/admin/InvestorImport.tsx",
    cls: "internal-token",
    match: "consortium_partner",
    status: "ratified",
    reason:
      "RATIFIED: this is the IMPORT CONTRACT. The line lists the exact literal values the operator must put in the file they are about to upload (`kind (investor|founder|consortium_partner)`). The operator's lever is the file, which lives outside the product — Wave 83's stated reason for the admin exception — and a friendly paraphrase here would make the import fail.",
  },
  {
    file: "client/src/pages/admin/LifecyclePolicies.tsx",
    cls: "event-name",
    match: "lifecycle_policy.changed",
    status: "debt",
    reason:
      "DEBT: a TELEMETRY EVENT NAME from the ALL_EVENT_TYPES catalogue rendered in prose (\"Saving emits a lifecycle_policy.changed event to the Collective outbox\"). Wave 83's substitution for this exact shape: say the effect — \"saving propagates the new thresholds to the Collective\".",
  },
  {
    file: "client/src/pages/admin/Migration.tsx",
    cls: "sql-column",
    match: "legal_name",
    status: "ratified",
    reason:
      "RATIFIED: the admin MIGRATION TOOL is a legitimate feature, and this screen's feature IS the field mapping — `legal_name → legalName` is the mapping the operator is being asked to trust, so the source field name is the content of the row, not a leak. The brief names the Migration tool as an allowed exception; this is the one place a raw source field name is the product.",
  },
  {
    file: "client/src/pages/admin/PartnerDetail.tsx",
    cls: "sql-qualified",
    match: "contacts.metadata_json",
    status: "debt",
    reason:
      "DEBT: a QUALIFIED table.column reference in a tooltip (\"Legacy free-text type from contacts.metadata_json\"). REPLACEMENT: \"Legacy free-text type captured at application approval\" — the tooltip's own next sentence already gives the operator their lever (\"use Classification below\").",
  },
  {
    file: "client/src/pages/admin/PartnerPL.tsx",
    cls: "internal-token",
    match: "commission_minor",
    status: "debt",
    reason:
      "DEBT: a column name in the screen description (\"Every amount is the database commission_minor for that entry\"). The operator needs the UNITS, which Wave 83 ratified — so the replacement keeps them: \"every amount is the recorded commission, in whole cents\".",
  },
  {
    file: "client/src/pages/admin/PartnerResponders.tsx",
    cls: "internal-token",
    match: "chap_keiretsu_canada",
    status: "debt",
    reason:
      "DEBT: raw chapter id as a placeholder example; same class and same replacement as the AuditChainVerifyPage placeholder above.",
  },
  {
    file: "client/src/pages/admin/PartnerTaxonomyAdmin.tsx",
    cls: "internal-token",
    match: "search_fund",
    status: "debt",
    reason:
      "DEBT: an internal taxonomy token as a placeholder example. REPLACEMENT: state the format (\"taxonomy key\") or show the display name.",
  },
  {
    file: "client/src/pages/admin/Partners.tsx",
    cls: "internal-token",
    match: "consortium_partner",
    status: "debt",
    reason:
      "DEBT: unlike the InvestorImport line, this is descriptive prose (\"contacts of kind=consortium_partner\"), not an input contract — the operator types nothing here. REPLACEMENT: \"Roster of all consortium partners\", which the sentence already says.",
  },
  {
    file: "client/src/pages/admin/Payments.tsx",
    cls: "internal-token",
    match: "payment_ledger",
    status: "debt",
    reason:
      "DEBT: the SQL table name in the screen description and again as a rendered value (\"sourced from the durable payment_ledger table\"). REPLACEMENT: \"sourced from the durable payment ledger\" — one underscore is the whole difference.",
  },
  {
    file: "client/src/pages/admin/PricingModelDetail.tsx",
    cls: "event-name",
    match: "pricing_model.published",
    status: "debt",
    reason:
      "DEBT: a telemetry event name rendered as a value on the pricing-model screen. REPLACEMENT: \"Published\" plus the timestamp the row already carries.",
  },
  {
    file: "client/src/pages/admin/RegionExtensionDetail.tsx",
    cls: "internal-token",
    match: "safe_conversion",
    status: "debt",
    reason:
      "DEBT: internal conversion-type tokens rendered as a placeholder list (`safe_conversion | note_conversion | esop_topup | …`). REPLACEMENT: the display names the same screen already uses elsewhere.",
  },
  {
    file: "client/src/pages/admin/RegionExtensionDetail.tsx",
    cls: "internal-token",
    match: "note_conversion",
    status: "debt",
    reason:
      "DEBT: as `safe_conversion` above — same placeholder list on the region-extension screen.",
  },
  {
    file: "client/src/pages/admin/RegionExtensionDetail.tsx",
    cls: "internal-token",
    match: "esop_topup",
    status: "debt",
    reason:
      "DEBT: as `safe_conversion` above — same placeholder list on the region-extension screen.",
  },
  {
    file: "client/src/pages/admin/RegionExtensionDetail.tsx",
    cls: "endpoint-prose",
    match: "/api/regions",
    status: "debt",
    reason:
      "DEBT: an endpoint path rendered as prose in a success message (\"now included in /api/regions\"). REPLACEMENT: \"the region is now available across the platform\", which the same sentence already promises.",
  },
  {
    file: "client/src/pages/admin/Sync.tsx",
    cls: "internal-token",
    match: "never_synced",
    status: "debt",
    reason:
      "DEBT: internal state tokens (`never_synced`, `drifted`) rendered in guidance. Wave 83's precedent is exactly this: it replaced the state constant `past_due` with \"escalated\". REPLACEMENT: \"never synced\" / \"drifted\" as words, not code spans.",
  },
  {
    file: "client/src/pages/admin/Users.tsx",
    cls: "internal-token",
    match: "auth_users",
    status: "debt",
    reason:
      "DEBT: the SQL table name in the screen description (\"Real user list backed by auth_users\"). REPLACEMENT: \"the platform's user directory\".",
  },
  {
    file: "client/src/pages/collective/ScreeningEventsPage.tsx",
    cls: "internal-token",
    match: "co_novapay",
    status: "debt",
    reason:
      "DEBT: a demo company id as a placeholder. Same class as Wave 83's `cmp_abc, cmp_xyz` fix; REPLACEMENT: state the format (\"company id\").",
  },
  {
    file: "client/src/pages/collective/ScreeningEventsPage.tsx",
    cls: "internal-token",
    match: "u_maya_chen",
    status: "debt",
    reason:
      "DEBT: demo user ids as a placeholder (`u_maya_chen, u_daniel_okafor`). REPLACEMENT: \"one member id per line\", which is the exact wording Wave 83 chose for the identical field.",
  },
  {
    file: "client/src/pages/collective/ScreeningEventsPage.tsx",
    cls: "internal-token",
    match: "u_daniel_okafor",
    status: "debt",
    reason:
      "DEBT: second id in the same placeholder; see the entry above.",
  },
  {
    file: "client/src/pages/founder/ApplyToCollective.tsx",
    cls: "telemetry-framing",
    match: "Telemetry collective_company_application_submitted",
    status: "debt",
    reason:
      "DEBT, FOUNDER-FACING — one of the two worst sites the fence found: the founder application screen tells the applicant \"Telemetry collective_company_application_submitted emitted.\" REPLACEMENT: \"Your application has been recorded.\" Wave 84 changes no copy, so it is named and counted here rather than quietly fixed.",
  },
  {
    file: "client/src/pages/founder/ApplyToCollective.tsx",
    cls: "internal-token",
    match: "collective_company_application_submitted",
    status: "debt",
    reason:
      "DEBT, FOUNDER-FACING: the event name inside the same sentence, recorded as its own class hit so that fixing the framing without removing the identifier does not silently pass.",
  },
  {
    file: "client/src/pages/investor/ApplyToCollective.tsx",
    cls: "telemetry-framing",
    match: "emit telemetry",
    status: "debt",
    reason:
      "DEBT, INVESTOR-FACING: the accreditation screen says \"Submitting will emit telemetry\". REPLACEMENT: \"Submitting is recorded\" — the honest promise without the event bus.",
  },
  /* WAVE 87 · ITEM 2 — THIS DEBT ROW IS PAID AND THEREFORE DELETED.
   * The site was `{agg.tierError ?? "PARTNER_TIER_UNRESOLVED"}` rendered to a
   * PARTNER, re-found by reviewer 3 on 2026-08-21. WAVE 87 applied R44 (remove
   * the identifier, keep the sentence) and moved the code to a
   * `data-error-code` attribute per R77. The entry is removed rather than left
   * behind, because a register row that matches nothing is a lie the fence
   * itself reports on every run. The design point the row recorded — that a
   * `??` fallback DOES render, so the classifier crosses default operators —
   * is preserved as a comment at the classifier, and both poles are pinned in
   * client/src/lib/__tests__/w87_internal_language_fence_bypasses.test.ts. */
  {
    file: "client/src/pages/partner/PartnerSpvEngine.tsx",
    cls: "internal-token",
    match: "series_a",
    status: "debt",
    reason:
      "DEBT: an internal round-stage token as a placeholder example (`e.g. seed, series_a`). REPLACEMENT: \"e.g. Seed, Series A\" — the same information, written the way the rest of the product writes it.",
  },
];

/* ── the rules ───────────────────────────────────────────────────────────── */
type TextRule = { cls: string; rx: RegExp; note: string };

const TEXT_RULES: TextRule[] = [
  /* SOURCE FILE PATHS */
  {
    cls: "source-path",
    rx: /\b(?:server|client|shared|scripts|migrations|packages)\/[A-Za-z0-9_./-]*\.(?:ts|tsx|mjs|cjs|js|sql|json)\b/,
    note: "a source file path is architecture, not product",
  },
  { cls: "source-path", rx: /\bclient\/src\/[A-Za-z0-9_./-]+/, note: "client source tree path" },
  { cls: "source-path", rx: /\bserver\/[a-z][A-Za-z0-9_/-]*\.(?:ts|tsx)\b/, note: "server source path" },

  /* ENDPOINT PATHS RENDERED AS PROSE */
  { cls: "endpoint-prose", rx: /\/api\/[A-Za-z0-9_/:{}$.-]+/, note: "an endpoint path a user cannot call" },
  { cls: "endpoint-prose", rx: /\b(?:GET|POST|PATCH|PUT|DELETE)\s+\/[A-Za-z0-9_/:{}$.-]+/, note: "HTTP verb + path" },

  /* ERROR CONSTANTS AND ERROR CLASS NAMES */
  { cls: "error-const", rx: /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/, note: "SCREAMING_SNAKE constant" },
  { cls: "error-class", rx: /\b[A-Z][A-Za-z0-9]*(?:Error|Exception)\b/, note: "an error class name" },

  /* FUNCTION NAMES */
  { cls: "function-name", rx: /\b[a-zA-Z_$][A-Za-z0-9_$]*\(\)/, note: "a function name with parentheses" },

  /* INTERNAL PROCESS IDENTIFIERS */
  { cls: "ruling-citation", rx: /\bR\d{1,3}\s*§/, note: "owner-ruling citation" },
  { cls: "ruling-citation", rx: /\b(?:per|under|see|ruling|Ruling)\s+R\d{1,3}\b/, note: "owner-ruling citation" },
  { cls: "ruling-citation", rx: /\bR\d{2,3}\/R\d{2,3}\b/, note: "owner-ruling citation" },
  { cls: "spec-section", rx: /§\s*\d+(?:\.\d+){2,}/, note: "an internal spec section (statutes are NOT matched)" },
  { cls: "spec-section", rx: /\b(?:STRATEGY|SPEC|spec)\s*§/, note: "an internal spec section" },
  { cls: "sprint", rx: /\bSprint\s*\d+/i, note: "delivery sprint number" },
  { cls: "wave", rx: /\bWave\s*\d+/i, note: "delivery wave number" },
  { cls: "slice", rx: /\bSlice\s*\d+/i, note: "delivery slice number" },
  { cls: "waiver", rx: /\bWAIVER[-\s]?\d+\b/i, note: "sacred-file waiver id" },
  { cls: "sacred", rx: /\bSACRED\b/, note: "internal sacred-file vocabulary" },
  { cls: "ticket-code", rx: /\b(?:FE|EN|DEF)-\d+\b/, note: "internal ticket id" },
  { cls: "decision-code", rx: /\bD\d(?:\.\d)*\s*R\d\b/, note: "internal decision code" },

  /* TELEMETRY FRAMING — the feature name "Telemetry" is fine, this is not */
  { cls: "telemetry-framing", rx: /\btelemetry\s+event/i, note: "internal event-bus framing" },
  { cls: "telemetry-framing", rx: /\bemits?\s+(?:an?\s+)?(?:immutable\s+)?telemetry\b/i, note: "internal event-bus framing" },
  { cls: "telemetry-framing", rx: /\bemit\s+telemetry\b/i, note: "internal event-bus framing" },
  { cls: "telemetry-framing", rx: /\bTelemetry\s+[a-z][a-z0-9]*_[a-z0-9_]+/, note: "a telemetry event named in prose" },

  /* RAW ENTITY IDS WHERE A NAME BELONGS — prefix + hex-ish blob */
  {
    cls: "entity-id",
    rx: /\b(?:u|rnd|spv|ccm|cmp|inv|org|sc|tr)_(?=[0-9a-f]*\d)[0-9a-f]{6,}\b/,
    note: "a raw entity id rendered where a name belongs",
  },

  /* MIGRATION NUMBERS AND INTERNAL BUILD VOCABULARY */
  { cls: "migration-number", rx: /\bmigrations?\s*#?\s*0?\d{3,4}\b/i, note: "a migration number" },
  { cls: "migration-number", rx: /\b0[0-2]\d{2}_[a-z0-9_]+\b/, note: "a migration file stem" },
  { cls: "build-vocab", rx: /\bpreflight\b/i, note: "internal build vocabulary" },
  { cls: "build-vocab", rx: /\btripwire\b/i, note: "internal build vocabulary" },
  { cls: "build-vocab", rx: /\bfences?\b/i, note: "internal build vocabulary" },
  { cls: "build-vocab", rx: /hot[-\s]read mirror/i, note: "internal build vocabulary" },
  { cls: "build-vocab", rx: /\b(?:silent[-\s])?drop guard\b/i, note: "internal build vocabulary" },
  { cls: "build-vocab", rx: /\bmutation[-\s]test(?:ing|s|ed)?\b/i, note: "internal build vocabulary" },
  { cls: "build-vocab", rx: /READ-ONLY mirror/i, note: "internal build vocabulary" },

  /* RAW DIGESTS */
  { cls: "hash-digest", rx: /\b[0-9a-f]{16,}\b/, note: "a raw hex digest rendered as a value" },
];

/* ── token-level rules, resolved against the catalogue ───────────────────── */
const TOKEN_RX = /[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*/g;
const SNAKE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;
const SNAKE_HYPHEN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+-[a-z][a-z0-9-]*$/;

/**
 * Two tracks, deliberately:
 *
 *  TRACK A — the token is in a SOURCE OF TRUTH (schema table/column, telemetry
 *            event, or a machine token this codebase uses in server/shared
 *            code). Always a violation: an operator or a founder is being shown
 *            the machine's own name for something.
 *  TRACK B — the token is an unknown snake_case identifier EMBEDDED IN PROSE
 *            (six or more words). An identifier inside a sentence is internal
 *            language regardless of whether the catalogue knows it, and this is
 *            the track that catches an identifier a future wave invents. A
 *            STANDALONE unknown token — a placeholder showing the FORMAT of a
 *            value the USER types, e.g. `e.g. maya_chen` in a handle field — is
 *            NOT reported, because it is the user's own data shape, not ours.
 */
function tokenViolations(
  text: string,
  cat: Catalogue,
  formatExample: boolean,
): { cls: string; match: string }[] {
  const out: { cls: string; match: string }[] = [];
  const words = text.split(/\s+/).filter(Boolean).length;
  for (const m of text.matchAll(TOKEN_RX)) {
    const tok = m[0];
    if (tok.includes(".")) {
      const [head, ...rest] = tok.split(".");
      if (cat.events.has(tok)) { out.push({ cls: "event-name", match: tok }); continue; }
      if (cat.tables.has(head) && rest.length === 1) { out.push({ cls: "sql-qualified", match: tok }); continue; }
      /* DOTTED EVENT SHAPE. `round.terms_updated` is the shape the brief names,
         and it is NOT in ALL_EVENT_TYPES — the catalogue has `round.terms_set`.
         A fence that only knew the catalogue would miss every event name a wave
         invents, so the shape counts too: a dotted lowercase pair where EITHER
         side carries an underscore is an event name, not a sentence. */
      if (
        rest.every((r) => /^[a-z][a-z0-9_]*$/.test(r)) &&
        /^[a-z][a-z0-9_]*$/.test(head) &&
        (SNAKE.test(head) || rest.some((r) => SNAKE.test(r)))
      ) {
        out.push({ cls: "event-name", match: tok });
        continue;
      }
      continue;
    }
    if (SNAKE_HYPHEN.test(tok)) { out.push({ cls: "event-name", match: tok }); continue; }
    if (!SNAKE.test(tok)) continue;
    if (cat.columns.has(tok)) { out.push({ cls: "sql-column", match: tok }); continue; }
    if (cat.tables.has(tok)) { out.push({ cls: "sql-table", match: tok }); continue; }
    if (cat.machineTokens.has(tok)) { out.push({ cls: "internal-token", match: tok }); continue; }
    /* AN UNKNOWN snake_case TOKEN. R77 is why this is not simply ignored: the
       identifier the ruling was written about, `price_contradicts_pool`, appears
       nowhere in non-test server or shared code, so it is NOT in any catalogue —
       and a fence that only knew the catalogues would go green on the exact
       string it exists to keep off the screen. So an unknown token in rendered
       copy IS a violation, with ONE narrow exception: a `placeholder`, which is
       the position where showing the FORMAT of a value the user will type is the
       whole point. Elsewhere, prose or not, a machine token is a machine token. */
    if (!formatExample || words >= 6) out.push({ cls: "internal-token", match: tok });
  }
  return out;
}

/* ── the walk ────────────────────────────────────────────────────────────── */
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

type TextNode = { text: string; line: number; ctx: string; rendered: boolean; hasSpace: boolean };

/** Is this literal a value flowing through code rather than text on a screen? */
function classify(n: ts.Node, sf: ts.SourceFile): { ctx: string; skip: boolean; rendered: boolean } {
  const par = n.parent as ts.Node | undefined;
  if (!par) return { ctx: "orphan", skip: true, rendered: false };
  if (ts.isJsxText(n)) return { ctx: "jsxtext", skip: false, rendered: true };

  if (
    ts.isLiteralTypeNode(par) || ts.isImportDeclaration(par) || ts.isExportDeclaration(par) ||
    ts.isImportSpecifier(par) || ts.isExportSpecifier(par) || ts.isEnumMember(par) ||
    ts.isModuleDeclaration(par) || ts.isExternalModuleReference(par) || ts.isImportTypeNode(par)
  )
    return { ctx: "type-or-import", skip: true, rendered: false };

  if (ts.isBinaryExpression(par)) {
    const op = par.operatorToken.kind;
    if (
      op === ts.SyntaxKind.EqualsEqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
      op === ts.SyntaxKind.EqualsEqualsToken || op === ts.SyntaxKind.ExclamationEqualsToken
    )
      return { ctx: "comparison", skip: true, rendered: false };
  }
  if (ts.isCaseClause(par)) return { ctx: "case-label", skip: true, rendered: false };
  if (ts.isElementAccessExpression(par) && par.argumentExpression === n)
    return { ctx: "index-access", skip: true, rendered: false };
  if (ts.isComputedPropertyName(par)) return { ctx: "computed-key", skip: true, rendered: false };
  if ((ts.isPropertyAssignment(par) || ts.isPropertySignature(par)) && par.name === n)
    return { ctx: "object-key", skip: true, rendered: false };

  /* JSX attribute (possibly through a JsxExpression / template) */
  let attr: ts.JsxAttribute | undefined;
  {
    let cur: ts.Node | undefined = par;
    for (let i = 0; cur && i < 4; i++) {
      if (ts.isJsxAttribute(cur)) { attr = cur; break; }
      cur = cur.parent;
    }
  }
  if (attr) {
    const name = attr.name.getText(sf);
    /* WAVE 87 · ITEM 2 — an IDREF is a machine value; see ARIA_IDREF_ATTRS. */
    if (ARIA_IDREF_ATTRS.has(name)) return { ctx: `jsxattr:${name}`, skip: true, rendered: false };
    /* WAVE 87 · ITEM 2 — on a chart element, `name`/`unit`/`label` are the
       legend, tooltip and axis text. Resolve the owning element to decide. */
    {
      const holder = attr.parent && attr.parent.parent;
      const tag =
        holder && (ts.isJsxOpeningElement(holder) || ts.isJsxSelfClosingElement(holder))
          ? holder.tagName.getText(sf)
          : "";
      if (tag && CHART_TAGS.test(tag) && CHART_COPY_ATTRS.has(name))
        return { ctx: `chartattr:${tag}.${name}`, skip: false, rendered: true };
    }
    /* WAVE 87 · ITEM 2 — a KNOWN copy attribute wins over the generic
       `data-`/`aria-` skip. Without this, `aria-roledescription` and
       `aria-valuetext` — both SPOKEN by a screen reader — were skipped by the
       prefix rule, whose negative lookahead only spares `aria-label…` and
       `aria-description`. */
    if (COPY_ATTRS.has(name)) return { ctx: `jsxattr:${name}`, skip: false, rendered: true };
    if (NON_COPY_ATTRS.has(name) || /^(?:data|aria)-(?!label|description)/.test(name) || /^on[A-Z]/.test(name))
      return { ctx: `jsxattr:${name}`, skip: true, rendered: false };
    return { ctx: `jsxattr:${name}`, skip: false, rendered: COPY_ATTRS.has(name) };
  }

  if (ts.isPropertyAssignment(par)) {
    const name = par.name.getText(sf).replace(/["']/g, "");
    if (NON_COPY_PROPS.has(name)) return { ctx: `prop:${name}`, skip: true, rendered: false };
    return { ctx: `prop:${name}`, skip: false, rendered: COPY_PROPS.has(name) };
  }

  if (ts.isCallExpression(par) || ts.isNewExpression(par)) {
    const callee = par.expression.getText(sf);
    /* WAVE 87 · ITEM 2 — a DIRECT-RENDER callee wins over the non-copy list.
       `toast.error("captable_commits")` was skipped because NON_COPY_CALLEES
       matches a trailing `.error` (it exists for `console.error` /
       `logger.error`), so the most common way this tree shows a message to a
       user was the easiest way past the fence. */
    if (DIRECT_RENDER_CALLEES.test(callee)) return { ctx: `call:${callee}`, skip: false, rendered: true };
    if (NON_COPY_CALLEES.test(callee)) return { ctx: `call:${callee}`, skip: true, rendered: false };
    return { ctx: `call:${callee}`, skip: false, rendered: RENDERING_CALLEES.test(callee) };
  }

  if (ts.isArrayLiteralExpression(par)) {
    const gp = par.parent;
    if (gp && (ts.isCallExpression(gp) || ts.isPropertyAssignment(gp))) {
      const label = ts.isCallExpression(gp) ? gp.expression.getText(sf) : gp.name.getText(sf).replace(/["']/g, "");
      if (NON_COPY_CALLEES.test(label) || NON_COPY_PROPS.has(label))
        return { ctx: `array:${label}`, skip: true, rendered: false };
    }
    return { ctx: "array", skip: false, rendered: false };
  }

  /**
   * A JSX CHILD EXPRESSION, e.g. `{"copy"}` or `{cond ? "a" : "b"}`. Only the
   * chain of shapes that PRESENTS the literal counts: parentheses, a ternary
   * branch, a template expression, string concatenation. Crossing a call, a
   * comparison or a default operator means the literal is an argument or a
   * fallback value, not something a user reads — that is the correction that
   * stops `String(mode ?? "pre_money") === "post_money"` reading as copy.
   */
  {
    let cur: ts.Node | undefined = par;
    for (let i = 0; cur && i < 8; i++) {
      if (ts.isJsxExpression(cur)) {
        const host = cur.parent;
        if (host && (ts.isJsxElement(host) || ts.isJsxFragment(host)))
          return { ctx: "jsxchild", skip: false, rendered: true };
        break;
      }
      const ok =
        ts.isParenthesizedExpression(cur) || ts.isConditionalExpression(cur) ||
        ts.isTemplateExpression(cur) || ts.isTemplateSpan(cur) ||
        (ts.isBinaryExpression(cur) &&
          (cur.operatorToken.kind === ts.SyntaxKind.PlusToken ||
            /* `{value ?? "FALLBACK"}` RENDERS the fallback — Wave 84 found
               PARTNER_TIER_UNRESOLVED hiding behind exactly this shape, so a
               default operator is crossed, not skipped. It is only code when the
               chain then hits a call or a comparison, which breaks this loop. */
            cur.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
            cur.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
            cur.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken));
      if (!ok) break;
      cur = cur.parent;
    }
  }

  return { ctx: ts.SyntaxKind[par.kind], skip: false, rendered: false };
}

/**
 * WAVE 87 · ITEM 2 — BOUNDED CONSTANT FOLDING.
 *
 * Reviewer 1's fourth bypass was `["captable_", "commits"].join("")`. The walk
 * sees LITERALS, and neither chunk matches on its own. Folding is therefore done
 * BEFORE classification, for the shapes that can be folded with certainty and no
 * evaluation:
 *
 *   ["a","b"].join(sep)   "a".concat("b")   "a" + "b" + "c"   String.raw`a_b`
 *
 * Only all-literal operands fold. `\`captable_${x}\`` cannot be folded and is
 * NOT guessed at — that limit is stated in W87_FENCE_HARDENING.md rather than
 * papered over. Folding says nothing about rendering: the folded value is
 * classified at the position of the WHOLE expression, so a folded query key stays
 * green and a folded JSX child goes red.
 */
function foldConstantString(n: ts.Node, sf: ts.SourceFile, depth = 0): string | null {
  if (depth > 8) return null;
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  if (ts.isParenthesizedExpression(n)) return foldConstantString(n.expression, sf, depth + 1);
  if (ts.isTaggedTemplateExpression(n) && n.tag.getText(sf) === "String.raw" &&
      ts.isNoSubstitutionTemplateLiteral(n.template)) {
    return n.template.text;
  }
  if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = foldConstantString(n.left, sf, depth + 1);
    const r = foldConstantString(n.right, sf, depth + 1);
    return l !== null && r !== null ? l + r : null;
  }
  if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
    const method = n.expression.name.getText(sf);
    const recv = n.expression.expression;
    if (method === "join" && ts.isArrayLiteralExpression(recv)) {
      const parts: string[] = [];
      for (const el of recv.elements) {
        const p = foldConstantString(el, sf, depth + 1);
        if (p === null) return null;
        parts.push(p);
      }
      if (parts.length === 0) return null;
      let sep = ",";
      if (n.arguments.length > 0) {
        const s = foldConstantString(n.arguments[0], sf, depth + 1);
        if (s === null) return null;
        sep = s;
      }
      return parts.join(sep);
    }
    if (method === "concat") {
      const base = foldConstantString(recv, sf, depth + 1);
      if (base === null) return null;
      const parts: string[] = [base];
      for (const a of n.arguments) {
        const p = foldConstantString(a, sf, depth + 1);
        if (p === null) return null;
        parts.push(p);
      }
      return parts.join("");
    }
  }
  return null;
}

/**
 * WAVE 87 · ITEM 2 — ONE-HOP RENDER TAINT, SAME FILE ONLY.
 *
 * Reviewer 1's third bypass was `const getLeak = () => "captable_commits"` with
 * `{getLeak()}` in the JSX, and the same hole swallows a lookup table
 * (`const L = { a: "captable_commits" }` rendered as `{L[k]}`). The literal is
 * not in a rendering position; the CALL is.
 *
 * So: collect the names that are READ in a rendering position in this file, then
 * treat the literals inside THOSE declarations as rendered. One hop, one file,
 * names only — no cross-module inference, no evaluation, and no presence
 * matching. A helper that is never rendered stays green, which is the pole that
 * keeps `queryKey: [tableOf()]` out of the sweep.
 */
function renderedLocalNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const rootName = (e: ts.Node): string | null => {
    let cur: ts.Node = e;
    for (let i = 0; i < 8; i++) {
      if (ts.isIdentifier(cur)) return cur.text;
      if (ts.isCallExpression(cur) || ts.isPropertyAccessExpression(cur) ||
          ts.isElementAccessExpression(cur) || ts.isNonNullExpression(cur) ||
          ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur)) {
        cur = (cur as ts.CallExpression).expression;
        continue;
      }
      return null;
    }
    return null;
  };
  const consider = (e: ts.Expression | undefined): void => {
    if (!e) return;
    if (ts.isConditionalExpression(e)) { consider(e.whenTrue); consider(e.whenFalse); return; }
    if (ts.isBinaryExpression(e)) {
      /* `{cond && <Panel/>}` — the LEFT of `&&` is a GUARD, never rendered.
         Measured: treating it as rendered flagged
         `instrumentToCarryForwardRoundType()` in founder/RoundNew.tsx, whose
         return is a machine `roundType` prop. `||` and `??` DO render either
         side, which is how PARTNER_TIER_UNRESOLVED was caught in Wave 84. */
      if (e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) { consider(e.right); return; }
      consider(e.left); consider(e.right); return;
    }
    if (ts.isTemplateExpression(e)) { for (const s of e.templateSpans) consider(s.expression); return; }
    const n = rootName(e);
    if (n) names.add(n);
  };
  const visit = (n: ts.Node): void => {
    /* a JSX child expression */
    if (ts.isJsxExpression(n) && n.expression && n.parent &&
        (ts.isJsxElement(n.parent) || ts.isJsxFragment(n.parent))) {
      consider(n.expression);
    }
    /* the value of a copy attribute, and a copy prop in an object literal */
    if (ts.isJsxAttribute(n)) {
      const an = n.name.getText(sf);
      if (COPY_ATTRS.has(an) && n.initializer && ts.isJsxExpression(n.initializer)) {
        consider(n.initializer.expression);
      }
    }
    if (ts.isPropertyAssignment(n)) {
      const pn = n.name.getText(sf).replace(/["']/g, "");
      if (COPY_PROPS.has(pn)) consider(n.initializer);
    }
    /* a direct-render call argument: toast(...) / toast.error(...) */
    if (ts.isCallExpression(n) && DIRECT_RENDER_CALLEES.test(n.expression.getText(sf))) {
      for (const a of n.arguments) consider(a);
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
  return names;
}

/**
 * The EXACT positions the taint pass promotes to "rendered".
 *
 * The first cut of this pass tainted whole declarations and produced 71 false
 * positives in one run — arrays of machine tokens (`["safe_pre","safe_post"]`)
 * that a rendered `.map()` turns into display labels, and key-building
 * concatenations. That is the presence-based cascade this project has already
 * suffered twice (6,818 and 519 phantom leaks), so the pass was narrowed to the
 * two shapes that are genuinely "text on its way to the screen":
 *
 *   1. the value a tainted FUNCTION RETURNS — its concise arrow body, or the
 *      expression of a `return` inside it. This is reviewer 1's bypass 3.
 *   2. the value of a PROPERTY in a tainted OBJECT LOOKUP TABLE, when the table
 *      itself is read in a rendering position (`{LABEL[k]}`).
 *
 * ARRAY ELEMENTS ARE DELIBERATELY EXCLUDED. An array of machine tokens beside a
 * label map is the normal, correct shape in this tree, and the token is not what
 * renders — the label is.
 */
function taintedRenderPositions(sf: ts.SourceFile, names: Set<string>): Set<number> {
  const out = new Set<number>();
  /* Follow only the shapes that PRESENT a value: parens, ternary branches,
     template spans and string concatenation. */
  const mark = (e: ts.Node | undefined, depth = 0): void => {
    if (!e || depth > 6) return;
    if (ts.isParenthesizedExpression(e)) return mark(e.expression, depth + 1);
    if (ts.isConditionalExpression(e)) { mark(e.whenTrue, depth + 1); mark(e.whenFalse, depth + 1); return; }
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      mark(e.left, depth + 1); mark(e.right, depth + 1); return;
    }
    out.add(e.getStart(sf));
  };
  const markReturns = (body: ts.Node): void => {
    const walk = (n: ts.Node): void => {
      if (ts.isReturnStatement(n)) mark(n.expression);
      /* do not descend into nested functions: a different function's return is
         a different name, and this pass is name-directed. */
      if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n)) {
        if (n !== body) return;
      }
      ts.forEachChild(n, walk);
    };
    if (ts.isBlock(body)) walk(body);
    else mark(body); /* concise arrow body */
  };
  const visit = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name && n.body && names.has(n.name.getText(sf))) {
      markReturns(n.body);
    }
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer &&
        names.has(n.name.getText(sf))) {
      const init = n.initializer;
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) markReturns(init.body);
      else if (ts.isObjectLiteralExpression(init)) {
        for (const pr of init.properties) {
          if (ts.isPropertyAssignment(pr)) mark(pr.initializer);
        }
      }
      /* `const x = "literal"` rendered as `{x}` is already caught by the walk's
         own jsxchild classification once the identifier is rendered; nothing to
         taint, and tainting it would re-open the array cascade. */
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
  return out;
}

function collect(abs: string): TextNode[] {
  const code = fs.readFileSync(abs, "utf8");
  const sf = ts.createSourceFile(
    abs, code, ts.ScriptTarget.Latest, true,
    abs.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const out: TextNode[] = [];
  const tainted = taintedRenderPositions(sf, renderedLocalNames(sf));
  const inTainted = (pos: number): boolean => tainted.has(pos);
  const visit = (n: ts.Node): void => {
    /* WAVE 87 · ITEM 2 — fold first, so a constructed identifier is seen whole. */
    if (ts.isCallExpression(n) || ts.isTaggedTemplateExpression(n) ||
        (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken)) {
      const folded = foldConstantString(n, sf);
      if (folded !== null && folded.trim().length > 0) {
        const { ctx, skip, rendered } = classify(n, sf);
        if (!skip) {
          const flat = folded.replace(/\s+/g, " ").trim();
          const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
          out.push({
            text: flat, line: line + 1, ctx: `folded:${ctx}`,
            rendered: rendered || inTainted(n.getStart(sf)), hasSpace: /\s/.test(flat),
          });
        }
      }
    }
    let text: string | null = null;
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) text = n.text;
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) text = (n as ts.TemplateHead).text;
    else if (ts.isJsxText(n)) text = n.text;
    if (text !== null && text.trim().length > 0) {
      const { ctx, skip, rendered } = classify(n, sf);
      if (!skip) {
        const flat = text.replace(/\s+/g, " ").trim();
        const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf));
        out.push({
          text: flat, line: line + 1, ctx,
          /* WAVE 87 · ITEM 2 — one-hop taint: a literal inside a declaration that
             is READ in a rendering position in this file is rendered text. */
          rendered: rendered || inTainted(n.getStart(sf)),
          hasSpace: /\s/.test(flat),
        });
      }
    }
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
  return out;
}

/**
 * IS THIS COPY? A node is copy when it is rendered (JsxText, a JSX child, a
 * user-facing attribute, a toast argument) or when it reads as prose — three or
 * more words, the test Wave 83 used.
 *
 * ONE ASYMMETRY, chosen on purpose: a SINGLE-TOKEN string reached through an
 * object PROPERTY (`{ reason: "NOT_AUTHED" }`) is NOT copy. In this tree those
 * are machine codes carried beside their message, and the message is what the
 * screen renders. A single token in a JSX ATTRIBUTE (`title=`, `label=`,
 * `placeholder=`) or as JSX text IS copy, because that one really is on screen.
 */
function isCopy(t: TextNode): boolean {
  if (!t.rendered) {
    /* Not in a rendering position: only treated as copy if it is prose, which is
       what keeps comments, keys and machine values out of the sweep entirely. */
    return t.text.split(/\s+/).filter(Boolean).length >= 3;
  }
  if (t.hasSpace) return true;
  /* ── ONE-WORD STRINGS IN A RENDERING POSITION (R77) ────────────────────────
     A refusal whose entire body is an identifier is the most readable leak there
     is — `title="price_contradicts_pool"`, `toast({ description: "…" })`. The
     earlier heuristic ("one word is probably a machine key") let exactly that
     through, so one-word strings now count as copy in every rendering position
     EXCEPT the argument of a STATE SETTER. A setter usually stores a machine code
     that a mapper turns into a sentence before render —
     `setMessageRefusal("missing_fields")` rendered as `tierErrorCopy(refusal)` —
     which is R77-correct and must stay green. Props that genuinely carry machine
     values (`code`, `kind`, `eventType`, `queryKey`, `value`, `state`,
     `data-testid`, …) never reach this function: NON_COPY_PROPS skips them
     earlier, and that is what makes R77's green pole green. */
  if (t.ctx.startsWith("call:")) return DIRECT_RENDER_CALLEES.test(t.ctx.slice("call:".length));
  return true;
}

export type FenceResult = {
  ok: boolean;
  filesScanned: number;
  nodesConsidered: number;
  copyNodes: number;
  violations: Violation[];
  exceptionsApplied: { id: string; file: string; line: number; match: string }[];
  registered: { entry: RegisterEntry; file: string; line: number }[];
  unusedRegister: RegisterEntry[];
  ms: number;
  catalogue: { tables: number; columns: number; events: number; machineTokens: number; envNames: number };
};

/**
 * Scan ONE file. Exported so the Wave 84 mutation test can re-add each banned
 * class to a temporary fixture and prove the fence goes red, and prove a comment,
 * a query key and a ratified admin exception stay green — without touching the
 * product tree. `rel` is supplied by the caller so a fixture can stand in for an
 * admin-only path when the exception scope is under test.
 */
export function scanFile(
  abs: string,
  rel: string,
  cat: Catalogue,
): {
  violations: Violation[];
  exceptionsApplied: FenceResult["exceptionsApplied"];
  registered: { idx: number; file: string; line: number }[];
  nodesConsidered: number;
  copyNodes: number;
} {
  const violations: Violation[] = [];
  const exceptionsApplied: FenceResult["exceptionsApplied"] = [];
  const registered: { idx: number; file: string; line: number }[] = [];
  let nodesConsidered = 0;
  let copyNodes = 0;

  for (const node of collect(abs)) {
    nodesConsidered++;
    if (!isCopy(node)) continue;
    copyNodes++;
    if (ROUTE_ONLY.test(node.text)) continue;

    /* MAIL-MERGE TEMPLATE VARIABLES. `{{company_name}}` in the admin email
       composer is the product's OWN template language: the operator types the
       token, so the token IS the feature. Stripped before matching rather than
       registered site by site, because it is a structural non-violation. */
    const scanText = node.text.replace(/\{\{[^}]*\}\}/g, " ");

    const hits: { cls: string; match: string }[] = [];
    for (const rule of TEXT_RULES) {
      const m = rule.rx.exec(scanText);
      if (!m) continue;
      /* THE ADMIN MIGRATION TOOL is a legitimate feature name: the bare word is
         fine, a migration NUMBER never is. */
      if (rule.cls === "migration-number" && !/\d/.test(m[0])) continue;
      hits.push({ cls: rule.cls, match: m[0] });
    }
    /* `placeholder` is the one rendered position where the FORMAT of a value the
         user types is legitimately the content — see the unknown-token rule. */
      const formatExample = /placeholder/i.test(node.ctx);
      hits.push(...tokenViolations(scanText, cat, formatExample));

    const seen = new Set<string>();
    for (const h of hits) {
      const dedupe = `${h.cls}\u0000${h.match}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);

      /* ratified admin exceptions */
      let excepted: string | null = null;
      for (const ex of EXCEPTIONS) {
        if (!ex.cls.test(h.cls) || !ex.scope.test(rel) || !ex.match.test(h.match)) continue;
        if (ex.id === "W83-ADMIN-ENVVAR" && !cat.envNames.has(h.match) && !W83_PINNED_ENV.has(h.match))
          continue;
        excepted = ex.id;
        break;
      }
      if (excepted) {
        exceptionsApplied.push({ id: excepted, file: rel, line: node.line, match: h.match });
        continue;
      }

      /* the pinned register of pre-existing sites */
      const idx = REGISTER.findIndex((e) => e.file === rel && e.cls === h.cls && e.match === h.match);
      if (idx >= 0) {
        registered.push({ idx, file: rel, line: node.line });
        continue;
      }

      violations.push({
        file: rel, line: node.line, cls: h.cls, match: h.match,
        text: node.text.slice(0, 180), ctx: node.ctx,
      });
    }
  }

  return { violations, exceptionsApplied, registered, nodesConsidered, copyNodes };
}

export function runInternalLanguageFence(): FenceResult {
  const t0 = Date.now();
  const cat = buildCatalogue();

  const violations: Violation[] = [];
  const exceptionsApplied: FenceResult["exceptionsApplied"] = [];
  const registered: FenceResult["registered"] = [];
  const registerHit = new Set<number>();
  let nodesConsidered = 0;
  let copyNodes = 0;

  const files = listSourceFiles(CLIENT_SRC);
  for (const abs of files) {
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    if (EXEMPT_FILE_SET.has(rel)) continue;
    const r = scanFile(abs, rel, cat);
    violations.push(...r.violations);
    exceptionsApplied.push(...r.exceptionsApplied);
    nodesConsidered += r.nodesConsidered;
    copyNodes += r.copyNodes;
    for (const hit of r.registered) {
      registerHit.add(hit.idx);
      registered.push({ entry: REGISTER[hit.idx], file: hit.file, line: hit.line });
    }
  }

  return {
    ok: violations.length === 0,
    filesScanned: files.length,
    nodesConsidered,
    copyNodes,
    violations,
    exceptionsApplied,
    registered,
    unusedRegister: REGISTER.filter((_, i) => !registerHit.has(i)),
    ms: Date.now() - t0,
    catalogue: {
      tables: cat.tables.size, columns: cat.columns.size, events: cat.events.size,
      machineTokens: cat.machineTokens.size, envNames: cat.envNames.size,
    },
  };
}

export function formatViolations(r: FenceResult): string {
  return r.violations
    .map((v) => `  ${v.file}:${v.line} [${v.cls}] «${v.match}» (${v.ctx})\n      ${v.text}`)
    .join("\n");
}

/* ── CLI ─────────────────────────────────────────────────────────────────── */
const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]).includes("internalLanguageFence");

if (invokedDirectly) {
  const r = runInternalLanguageFence();
  const debt = r.registered.filter((x) => x.entry.status === "debt").length;
  const ratified = r.registered.filter((x) => x.entry.status === "ratified").length;
  if (r.ok) {
    console.log(
      `[internal-language-fence] OK — ${r.filesScanned} rendered source file(s), ` +
        `${r.nodesConsidered} text node(s), ${r.copyNodes} classified as copy, ` +
        `0 NEW internal-language leaks.\n` +
        `  sources of truth: ${r.catalogue.tables} tables, ${r.catalogue.columns} columns, ` +
        `${r.catalogue.events} telemetry events, ${r.catalogue.machineTokens} machine tokens, ` +
        `${r.catalogue.envNames} env vars.\n` +
        `  ${r.exceptionsApplied.length} ratified admin exception hit(s); ` +
        `${ratified} registered-ratified site(s); ${debt} registered DEBT site(s) awaiting a copy wave.\n` +
        `  ${r.ms} ms. (WAVE 84)`,
    );
    if (r.unusedRegister.length > 0) {
      console.log(
        `  NOTE — ${r.unusedRegister.length} register entr(y/ies) no longer match anything ` +
          `(the copy was fixed; delete them):\n` +
          r.unusedRegister.map((e) => `    ${e.file} [${e.cls}] «${e.match}»`).join("\n"),
      );
    }
    process.exit(0);
  }
  console.error(
    `[internal-language-fence] FAIL — internal process language is rendered to a user.\n` +
      `Fix per R44: remove the identifier, keep the sentence — state the RULE or the\n` +
      `BEHAVIOUR instead. R77: the identifier may STAY as a machine-readable value —\n` +
      `an error.code, a payload field, a props value, a query key, a data-testid or a\n` +
      `comment — it may not stay in text a user reads. Widening EXCEPTIONS or REGISTER\n` +
      `is a written decision with a\n` +
      `reason in the diff, and EXCEPTIONS is admin-only by construction.\n` +
      formatViolations(r) +
      `\n${r.violations.length} violation(s) in ${new Set(r.violations.map((v) => v.file)).size} file(s), ${r.ms} ms.`,
  );
  process.exit(1);
}

/* ── R77 · ONE DEFINITION OF "RENDERED" ───────────────────────────────────────
   `collect()` + `isCopy()` are this fence's answer to the only question R77
   asks: can a user READ this text? Wave 83's founder-screen pin was asking the
   same question with its own weaker helper (comments stripped, then a
   whole-file substring match), which is how it came to ban an identifier that
   `W58CD-A1e` requires in an `error.code`.

   Exporting them so that pin can delegate here means the fence and the pin
   cannot drift apart. If the definition of rendered copy changes, it changes
   in ONE place. Exported as internals — deliberately not part of the fence's
   public surface — because callers should normally use `scanFile`.
   ─────────────────────────────────────────────────────────────────────────── */
export const fenceInternals = { collect, isCopy };
