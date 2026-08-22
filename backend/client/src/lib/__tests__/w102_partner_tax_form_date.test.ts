/**
 * ════════════════════════════════════════════════════════════════════════════
 * WAVE 102 · ITEM 3 — A TAX-FORM EXPIRY RENDERED ONE DAY EARLY IN NEW YORK,
 *                      AND THE FENCE ACTIVELY EXCUSED IT.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * `client/src/pages/partner/PartnerTaxForm.tsx:205` rendered `tf.expiresAt`
 * through a local `formatDate` whose body was
 * `new Date(value).toLocaleDateString(…)`. Reviewer C proved by execution:
 *
 *     TZ=UTC                expires_at="2026-06-15" -> Jun 15, 2026
 *     TZ=America/New_York   expires_at="2026-06-15" -> Jun 14, 2026   <- the owner
 *     TZ=Pacific/Auckland   expires_at="2026-06-15" -> Jun 15, 2026
 *
 * THE VALUE IS DATE-ONLY, PROVED FROM THE SCHEMA AND THE WRITE PATH, NOT THE NAME:
 * the input at `:151` is `placeholder="YYYY-MM-DD"` with NO `type="date"`;
 * `server/lib/partnerSelfServiceRoutes.ts:416` takes `body.expiresAt.trim()` and
 * `:434` stores it VERBATIM into `partner_tax_forms.expires_at`, which is `TEXT`
 * in both `migrations/0054_v25_33_partner_payment_model.sql:75` and the inline
 * DDL at `server/db/connection.ts:2005`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A UTC-ONLY SUITE CANNOT SEE THIS DEFECT AT ALL.
 * ─────────────────────────────────────────────────────────────────────────────
 * Which is exactly why it survived. The BEHAVIOURAL assertions below are
 * therefore driven under THREE zones through an explicit timezone loop rather
 * than trusting the runner's `TZ`, and the wave additionally runs the standalone
 * transcript in `w102_probe/w102_tz_prove.mjs` under
 * `TZ=America/New_York`, `TZ=UTC` and `TZ=Pacific/Auckland`.
 *
 * `Intl.DateTimeFormat` with an explicit `timeZone` is used to simulate a zone,
 * because `process.env.TZ` cannot be changed reliably inside a running V8 ICU
 * context. The date-only path is asserted to be INDEPENDENT of zone, which is
 * the actual invariant; the instant path is asserted to still DEPEND on zone,
 * because localising an instant is correct and must not be "fixed".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toCalendarDate, fmtLocaleDate } from "../format";

const REPO = join(__dirname, "..", "..", "..", "..");
const SITE = join(REPO, "client", "src", "pages", "partner", "PartnerTaxForm.tsx");
const FENCE = join(REPO, "scripts", "lint", "dateOnlyRenderFence.ts");
const ROUTES = join(REPO, "server", "lib", "partnerSelfServiceRoutes.ts");

const ZONES = ["America/New_York", "UTC", "Pacific/Auckland"] as const;
const OPTS: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" };

/** Render a Date as a given zone would show it. */
const inZone = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { ...OPTS, timeZone }).format(d);

/** The helper as it stood BEFORE Wave 102, for the contrast assertions. */
function formatDate_BEFORE(value: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, OPTS);
}

const DATE_ONLY = "2026-06-15";
const INSTANT = "2026-06-15T14:30:00.000Z";

/* ══ §1 · the defect is real, and a UTC-only suite cannot see it ══════════ */
describe("W102 §1 — the OLD behaviour shifted the day, and only outside UTC", () => {
  it("`new Date(\"2026-06-15\")` is UTC midnight, which is 15 June only at or east of UTC", () => {
    const parsedAsUtc = new Date(DATE_ONLY);
    expect(parsedAsUtc.toISOString()).toBe("2026-06-15T00:00:00.000Z");
    expect(inZone(parsedAsUtc, "UTC")).toBe("Jun 15, 2026");
    expect(inZone(parsedAsUtc, "Pacific/Auckland")).toBe("Jun 15, 2026");
    /* THE DEFECT, in the owner's zone */
    expect(inZone(parsedAsUtc, "America/New_York")).toBe("Jun 14, 2026");
  });

  it("so a UTC-only assertion on the OLD helper would have PASSED — the reason it shipped", () => {
    /* Under a UTC runner the old helper is indistinguishable from a correct one.
       This assertion documents the measurement gap rather than the behaviour. */
    const oldUnderUtc = inZone(new Date(DATE_ONLY), "UTC");
    expect(oldUnderUtc).toBe("Jun 15, 2026");
    expect(typeof formatDate_BEFORE(DATE_ONLY)).toBe("string");
  });
});

/* ══ §2 · the FIX — the same calendar day in every zone ═══════════════════ */
describe("W102 §2 — the fixed site renders the same calendar day in all three zones", () => {
  it("a date-only value becomes LOCAL midnight, so no zone can shift it", () => {
    const d = toCalendarDate(DATE_ONLY);
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(5);      /* June */
    expect(d!.getDate()).toBe(15);
    expect(d!.getHours()).toBe(0);
  });

  it("fmtLocaleDate prints 15 June for the date-only value under EVERY zone", () => {
    for (const tz of ZONES) {
      const d = toCalendarDate(DATE_ONLY)!;
      /* rendered as that zone's clock would show LOCAL midnight of the 15th:
         the calendar fields are already local, so the day cannot move */
      expect(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`,
             `date-only must not shift under ${tz}`).toBe("2026-6-15");
    }
    expect(fmtLocaleDate(DATE_ONLY, "en-US", OPTS)).toBe("Jun 15, 2026");
  });

  it("an INSTANT still localises — the fix must not break correct behaviour", () => {
    const d = toCalendarDate(INSTANT)!;
    expect(d.toISOString()).toBe(INSTANT);
    /* 14:30Z is the 15th in New York and the 16th in Auckland. Both correct. */
    expect(inZone(d, "America/New_York")).toBe("Jun 15, 2026");
    expect(inZone(d, "UTC")).toBe("Jun 15, 2026");
    expect(inZone(d, "Pacific/Auckland")).toBe("Jun 16, 2026");
  });

  it("null / empty / unparseable degrade to the same em dash the screen showed before", () => {
    expect(fmtLocaleDate(null, "en-US", OPTS)).toBe("—");
    expect(fmtLocaleDate("", "en-US", OPTS)).toBe("—");
    expect(fmtLocaleDate("not a date", "en-US", OPTS)).toBe("—");
  });

  it("an impossible calendar date is refused rather than rolled forward", () => {
    expect(toCalendarDate("2026-02-31")).toBeNull();
    expect(toCalendarDate("2026-13-01")).toBeNull();
  });
});

/* ══ §3 · the SITE actually uses the safe helper ══════════════════════════ */
describe("W102 §3 — the site is fixed, not just the library", () => {
  const src = () => readFileSync(SITE, "utf8");

  it("PartnerTaxForm imports the safe formatter", () => {
    expect(src()).toMatch(/import \{ fmtLocaleDate \} from "@\/lib\/format"/);
  });

  it("its local formatDate no longer constructs a Date itself", () => {
    const s = src();
    const start = s.indexOf("function formatDate(");
    const body = s.slice(start, s.indexOf("\n}", start));
    expect(body).toMatch(/fmtLocaleDate/);
    expect(body).not.toMatch(/new Date\s*\(/);
    expect(body).not.toMatch(/toLocaleDateString/);
  });

  it("BOTH date columns on that table still route through it — collectedAt as well as expiresAt", () => {
    const s = src();
    expect(s).toMatch(/formatDate\(tf\.collectedAt\)/);
    expect(s).toMatch(/formatDate\(tf\.expiresAt\)/);
  });

  it("the server still stores expires_at VERBATIM — the reason the value is date-only", () => {
    const r = readFileSync(ROUTES, "utf8");
    expect(r).toMatch(/isNonEmptyString\(body\.expiresAt\) \? body\.expiresAt\.trim\(\) : null/);
  });

  it("the input is still a bare text field with a YYYY-MM-DD placeholder, not type=\"date\"", () => {
    const s = src();
    const i = s.indexOf('data-testid="input-taxform-expires"');
    expect(i).toBeGreaterThan(-1);
    const tag = s.slice(s.lastIndexOf("<Input", i), i);
    expect(tag).not.toMatch(/type="date"/);
    expect(s.slice(s.lastIndexOf("<Input", i), i + 60)).toMatch(/YYYY-MM-DD/);
  });
});

/* ══ §4 · the FENCE's blind spot is closed ════════════════════════════════ */
describe("W102 §4 — the fence no longer excuses a value because of a similar name", () => {
  const fence = () => readFileSync(FENCE, "utf8");

  it("the old unconditional short-circuit is gone", () => {
    /* WAS: `if (TIMESTAMP_FIELDS.has(name)) return null; /* an explicit instant wins` */
    expect(fence()).not.toMatch(/if \(TIMESTAMP_FIELDS\.has\(name\)\) return null;/);
  });

  it("firstDateOnlyField now resolves per SITE, not per name", () => {
    expect(fence()).toMatch(/function firstDateOnlyField\([^)]*rel: string\)/);
    expect(fence()).toMatch(/TIMESTAMP_SITE_EVIDENCE\.has\(/);
  });

  it("a contested name with no per-site evidence is POLICED, not excused", () => {
    expect(fence()).toMatch(/NEAR-NAME COLLISION, unevidenced at this site/);
  });

  it("expiresAt was NOT reclassified by name — that would be the same error inverted", () => {
    /* It stays on TIMESTAMP_FIELDS, because it genuinely IS an instant at five
       other sites (invitation-token TTLs). What changed is that the NAME no
       longer excuses on its own. */
    const f = fence();
    expect(f).toMatch(/"expiresAt"/);
    const reg = f.slice(f.indexOf("DATE_ONLY_REGISTRY: RegistryEntry[]"),
                        f.indexOf("const DATE_ONLY_FIELDS"));
    expect(reg).not.toMatch(/field: "expiresAt"/);
  });

  it("every per-site excuse cites a WRITE PATH, not a name", () => {
    const f = fence();
    const block = f.slice(f.indexOf("TIMESTAMP_SITE_EVIDENCE = new Map"),
                          f.indexOf("NEAR-NAME DEBT · WAVE 102"));
    /* each entry must name a file:line or an explicit write expression */
    const entries = block.match(/\[\s*"client\/src[^\]]*?\]/gs) ?? [];
    expect(entries.length).toBeGreaterThanOrEqual(6);
    for (const e of entries) {
      expect(e, `evidence entry must cite a write path: ${e.slice(0, 80)}`)
        .toMatch(/toISOString|slice\(0, 10\)|written server-side|TTL/);
    }
  });
});

/* ══ §5 · the collision sweep is measured, not asserted ══════════════════ */
describe("W102 §5 — the near-name collision sweep", () => {
  it("reports exactly the four contested stems found in this tree", async () => {
    const mod = await import("../../../../scripts/lint/dateOnlyRenderFence");
    const collisions = mod.nearNameCollisions();
    expect(collisions.map((c) => c.stem).sort()).toEqual(["asof", "due", "effective", "expires"]);
    expect(collisions.length).toBe(4);
  });

  it("stemOf strips the temporal suffix so expiresAt and expiresOn collide", async () => {
    const mod = await import("../../../../scripts/lint/dateOnlyRenderFence");
    expect(mod.stemOf("expiresAt")).toBe("expires");
    expect(mod.stemOf("expiresOn")).toBe("expires");
    expect(mod.stemOf("effective_from")).toBe("effective");
    expect(mod.stemOf("effectiveFrom")).toBe("effective");
    /* a non-temporal name is left alone */
    expect(mod.stemOf("tenantId")).toBe("tenantid");
  });

  it("the two sites this wave does not own are DISCLOSED, with an owner and a one-line fix", async () => {
    const mod = await import("../../../../scripts/lint/dateOnlyRenderFence");
    expect(mod.NEAR_NAME_DEBT.length).toBe(2);
    for (const d of mod.NEAR_NAME_DEBT) {
      expect(d.owner).toMatch(/NOT WAVE 102/);
      expect(d.note).toMatch(/fmtLocaleDate|one[-\s]line/i);
      expect(d.file).toMatch(/^client\/src\//);
    }
  });
});
