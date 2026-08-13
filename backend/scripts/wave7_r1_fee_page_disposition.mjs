/**
 * WAVE 7 R-1 — disposition evidence generator for the 13 retired admin fee
 * pages that are still on disk.
 *
 * The question R-1 asks per page is "re-route or descope". The only honest way
 * to answer it is to ask whether the page can reach an API endpoint that
 * AdminFeesConsolidated (the page that replaced all 13) cannot. If it can, the
 * consolidation dropped functionality and the page must be re-routed; if it
 * cannot, the page is genuinely redundant and can be descoped.
 *
 * Emits build_log/wave7_r1_disposition.json. Read-only; writes nothing into
 * client/ or server/.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const ADMIN = join(ROOT, "client", "src", "pages", "admin");

const RETIRED = [
  "FeeHub",
  "Payments",
  "PartnerFeeSchedules",
  "AdminApplicationFee",
  "AdminPlatformFees",
  "CollectiveSubscriptions",
  "AdminCommissionRates",
  "PartnerPL",
  "CollectivePaymentSchedules",
  "CollectivePaymentPL",
  "Pricing",
  "PricingModels",
  "PricingModelDetail",
];

/** Pull every /api/... string literal or template out of a source file. */
function endpoints(src) {
  const out = new Set();
  for (const m of src.matchAll(/["'`](\/api\/[^"'`\s]*)["'`]/g)) {
    // Normalise template interpolations to a wildcard so
    // `/api/admin/fees/${id}` and "/api/admin/fees/:id" compare equal.
    out.add(m[1].replace(/\$\{[^}]*\}/g, "*").replace(/\/:[A-Za-z0-9_]+/g, "/*").replace(/\?.*$/, ""));
  }
  return out;
}

/** Which HTTP methods a page issues — a read-only page losing its URL is a
 *  smaller loss than a page that is the only writer of something. */
function methods(src) {
  const out = new Set();
  for (const m of src.matchAll(/apiRequest\(\s*"(GET|POST|PUT|PATCH|DELETE)"/g)) out.add(m[1]);
  return out;
}

const consolidatedSrc = readFileSync(join(ADMIN, "AdminFeesConsolidated.tsx"), "utf8");
const consolidated = endpoints(consolidatedSrc);

/* An endpoint is only LOST if NO reachable client file calls it. Comparing
   against AdminFeesConsolidated alone would over-report: several of these
   endpoints are also called from other, still-routed pages. Build the union
   over the whole client tree, minus the 13 retired pages themselves. */
const RETIRED_PATHS = new Set(RETIRED.map((n) => join(ADMIN, `${n}.tsx`)));
const reachable = new Set(consolidated);
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const q = join(dir, e);
    if (statSync(q).isDirectory()) walk(q);
    else if ((q.endsWith(".tsx") || q.endsWith(".ts")) && !RETIRED_PATHS.has(q)) {
      for (const ep of endpoints(readFileSync(q, "utf8"))) reachable.add(ep);
    }
  }
})(join(ROOT, "client", "src"));

const appSrc = readFileSync(join(ROOT, "client", "src", "App.tsx"), "utf8");

/* SETTLED-RULING OVERRIDES. The endpoint-reachability pass is evidence, not a
   verdict: it cannot know that a capability was removed deliberately. These two
   pages are the sole callers of /api/admin/collective/application-fee, but D2.5
   deleted that editor on purpose because it wrote DISPLAY DOLLARS into
   collective_application_fee_config while the surviving editor writes TRUE
   MINOR UNITS into platform_fees['collective_application_fee']
   (AdminFeesConsolidated.tsx:1231). Re-routing them would restore a second
   writer, in the wrong unit, for one fee. */
const OVERRIDES = {
  AdminApplicationFee:
    "DESCOPE (settled ruling overrides the computed result) — duplicate application-fee editor in display dollars; D2.5 deleted it deliberately",
  AdminPlatformFees:
    "DESCOPE (settled ruling overrides the computed result) — same duplicate application-fee editor",
};

const report = [];
for (const name of RETIRED) {
  const p = join(ADMIN, `${name}.tsx`);
  if (!existsSync(p)) {
    report.push({ page: name, onDisk: false, disposition: "already-gone" });
    continue;
  }
  const src = readFileSync(p, "utf8");
  const eps = [...endpoints(src)];
  const missing = eps.filter((e) => !reachable.has(e));
  const ms = [...methods(src)];
  const writesMissing = missing.length > 0 && ms.some((m) => m !== "GET");
  // Is the component imported/rendered by the router at all?
  const routed = new RegExp(`<${name}\\s*/>|<Admin${name}\\s*/>`).test(appSrc);
  report.push({
    page: name,
    onDisk: true,
    routed,
    endpointsCalled: eps.length,
    endpointsNotInConsolidated: missing,
    methods: ms,
    computedDisposition: missing.length === 0
      ? "DESCOPE"
      : writesMissing
        ? "RE-ROUTE"
        : "RE-ROUTE (read-only)",
    disposition: OVERRIDES[name] ?? (missing.length === 0
      ? "DESCOPE — every endpoint it calls is reachable from a still-routed page"
      : writesMissing
        ? "RE-ROUTE — it is the ONLY client caller of a WRITE endpoint"
        : "RE-ROUTE (read-only) — it is the ONLY client caller of a READ endpoint"),
  });
}

const outPath = join(ROOT, "..", "build_log", "wave7_r1_disposition.json");
writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), report }, null, 2));
for (const r of report) {
  console.log(
    `${r.page.padEnd(28)} routed=${String(r.routed).padEnd(5)} missing=${(r.endpointsNotInConsolidated ?? []).length}  ${r.disposition}`,
  );
  for (const m of r.endpointsNotInConsolidated ?? []) console.log(`      ${m}`);
}
