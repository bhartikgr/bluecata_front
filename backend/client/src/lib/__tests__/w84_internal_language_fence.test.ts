/**
 * WAVE 84 — MUTATION TEST FOR THE POSITIVE INTERNAL-LANGUAGE FENCE.
 * ════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS. Wave 83 removed 123 instances of internal engineering
 * language from customer-facing screens, and its own mutation testing found that
 * the drop guard PASSES when that language is re-ADDED — the guard only detects
 * removals. So the tree had no check that FAILS when internal process language
 * appears in text a user can read. `scripts/lint/internalLanguageFence.ts` is
 * that check; this file proves it works, in BOTH directions:
 *
 *   POSITIVE POLE — for every banned class in the brief, re-add the language to a
 *   fixture and assert the fence goes RED. A fence that cannot catch what it
 *   exists to catch is worse than no fence.
 *
 *   NEGATIVE POLE — assert the fence stays GREEN on the things that must never
 *   fail: code comments (this project's comments legitimately cite routes,
 *   tables and owner rulings, and deleting that reasoning to satisfy a copy check
 *   destroys context and fixes nothing a customer sees), `data-testid` values,
 *   query keys, fetch arguments, route constants, props, test files, the admin
 *   Migration tool, and the four admin exceptions Wave 83 ratified and pinned.
 *
 * HOW IT AVOIDS TOUCHING THE TREE. Mutations are written to a temporary
 * directory and scanned through the fence's exported `scanFile`, with the
 * relative path supplied by the caller so an admin-only path can be simulated.
 * No product file is modified by this test, and the real catalogue (schema
 * tables and columns, the telemetry event list, machine tokens, env names) is
 * built once from the real tree so the mutations are checked against the same
 * sources of truth the fence uses in anger.
 *
 * TRANSCRIPT: build_log/wave84/W84_MUTATIONS.md.
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildCatalogue,
  scanFile,
  runInternalLanguageFence as runFence,
  EXCEPTIONS,
  REGISTER,
  R77_MACHINE_READABLE_ALLOWANCE,
  type Catalogue,
  type Violation,
} from "../../../../scripts/lint/internalLanguageFence";

let cat: Catalogue;
let tmp: string;

/** The whole-tree sweep costs ~9 s; the four tests that need it share one run. */
let cached: ReturnType<typeof runFence> | null = null;
function runInternalLanguageFence(): ReturnType<typeof runFence> {
  if (!cached) cached = runFence();
  return cached;
}

beforeAll(() => {
  cat = buildCatalogue();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "w84-fence-"));
});

/** Write a fixture and scan it as if it lived at `rel` inside the tree. */
function scan(code: string, rel = "client/src/pages/founder/W84Fixture.tsx"): Violation[] {
  const abs = path.join(tmp, `f${Math.random().toString(36).slice(2)}.tsx`);
  fs.writeFileSync(abs, code, "utf8");
  return scanFile(abs, rel, cat).violations;
}

function classes(v: Violation[]): string[] {
  return [...new Set(v.map((x) => x.cls))].sort();
}

/* ══════════════════════════════════════════════════════════════════════════
   THE SOURCES OF TRUTH ARE REAL
   ══════════════════════════════════════════════════════════════════════════ */
describe("W84-A · the banned lists are derived, not hand-maintained", () => {
  it("A1 · reads SQL tables and columns from the schema itself", () => {
    expect(cat.tables.size).toBeGreaterThan(90);
    expect(cat.columns.size).toBeGreaterThan(300);
    // spot-check names that must come from shared/schema.ts, not from a literal list
    expect(cat.tables.has("partner_organizations")).toBe(true);
    expect(cat.tables.has("round_invitations")).toBe(true);
    // `payment_ledger` and `platform_fees` are NOT sqliteTable declarations; they
    // reach the fence as machine tokens harvested from server/shared code, which
    // is why both sources of truth exist rather than just the schema.
    expect(cat.machineTokens.has("payment_ledger")).toBe(true);
  });

  it("A2 · reads the telemetry event catalogue and the machine tokens", () => {
    expect(cat.events.size).toBeGreaterThan(30);
    expect(cat.machineTokens.has("closed_round_readonly")).toBe(true);
    expect(cat.machineTokens.has("fd_base_divergence")).toBe(true);
  });

  it("A3 · accepts an env-var name only because the tree really reads it", () => {
    expect(cat.envNames.has("COLLECTIVE_RENEWAL_WORKER_ENABLED")).toBe(true);
    expect(cat.envNames.has("TOTALLY_INVENTED_KNOB_W84")).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   POSITIVE POLE — every banned class, re-added, must go RED
   ══════════════════════════════════════════════════════════════════════════ */
describe("W84-B · POSITIVE POLE: re-adding each banned class turns the fence red", () => {
  it("B1 · source file paths", () => {
    const v = scan(`export const A = () => <p>Recomputed in server/routes.ts on save.</p>;`);
    expect(classes(v)).toContain("source-path");
  });

  it("B2 · SQL table names, from the schema", () => {
    expect(classes(scan(`export const A = () => <p>Approval provisions a partner_organizations row here.</p>;`)))
      .toContain("sql-table");
    // …and a table that exists only as a machine token still fails, as a token.
    expect(classes(scan(`export const A = () => <p>Sourced from the durable payment_ledger table.</p>;`)))
      .toContain("internal-token");
  });

  it("B3 · SQL column names, from the schema", () => {
    const v = scan(`export const A = () => <p>The legal_name value is canonicalised before commit.</p>;`);
    expect(classes(v)).toContain("sql-column");
  });

  it("B4 · qualified table.column references", () => {
    const v = scan(`export const A = () => <p>Legacy free-text type from contacts.metadata_json here.</p>;`);
    expect(classes(v)).toContain("sql-qualified");
  });

  it("B5 · endpoint paths as prose, with and without the HTTP verb", () => {
    expect(classes(scan(`export const A = () => <p>The region is now included in /api/regions today.</p>;`)))
      .toContain("endpoint-prose");
    expect(classes(scan(`export const A = () => <p>Feed read via GET /api/feeds/venture-markets nightly.</p>;`)))
      .toContain("endpoint-prose");
  });

  it("B6 · error constants and error class names", () => {
    expect(classes(scan(`export const A = () => <p>TIER_PRICE_UNPRICED</p>;`))).toContain("error-const");
    expect(classes(scan(`export const A = () => <p>TierNotConfiguredError was raised on save.</p>;`)))
      .toContain("error-class");
    expect(classes(scan(`export const A = () => <p>Refused with closed_round_readonly for this round.</p>;`)))
      .toContain("internal-token");
    expect(classes(scan(`export const A = () => <p>Reported as fd_base_divergence in the comparison.</p>;`)))
      .toContain("internal-token");
  });

  it("B7 · a constant rendered only as a `??` fallback — the shape that hid PARTNER_TIER_UNRESOLVED", () => {
    const v = scan(
      `export const A = ({ t }: { t: string | null }) => <span>{t ?? "PARTNER_TIER_UNRESOLVED"}</span>;`,
    );
    expect(classes(v)).toContain("error-const");
  });

  it("B8 · function names with parentheses", () => {
    const v = scan(`export const A = () => <p>Price comes from getPlanPriceStrict() on the server.</p>;`);
    expect(classes(v)).toContain("function-name");
  });

  it("B9 · internal identifiers: ruling citation, spec section, sprint, wave, waiver, SACRED, ticket", () => {
    expect(classes(scan(`export const A = () => <p>The tiered machinery is retained under R3 here.</p>;`)))
      .toContain("ruling-citation");
    expect(classes(scan(`export const A = () => <p>Defined in STRATEGY § 4 of the plan.</p>;`)))
      .toContain("spec-section");
    expect(classes(scan(`export const A = () => <p>Shipping in Sprint 33 of the plan.</p>;`))).toContain("sprint");
    expect(classes(scan(`export const A = () => <p>Cleaned up in Wave 83 of the programme.</p>;`))).toContain("wave");
    expect(classes(scan(`export const A = () => <p>Covered by WAIVER-7 for this file.</p>;`))).toContain("waiver");
    expect(classes(scan(`export const A = () => <p>This file is SACRED and cannot change.</p>;`))).toContain("sacred");
    expect(classes(scan(`export const A = () => <p>Tracked as FE-16 in the queue.</p>;`))).toContain("ticket-code");
  });

  it("B10 · event and telemetry names", () => {
    // in the catalogue…
    expect(classes(scan(`export const A = () => <p>Saving emits a round.terms_set event downstream.</p>;`)))
      .toContain("event-name");
    // …and NOT in the catalogue: the brief's `round.terms_updated` does not exist
    // in ALL_EVENT_TYPES, so the dotted shape has to fail on its own.
    expect(classes(scan(`export const A = () => <p>Saving emits a round.terms_updated event downstream.</p>;`)))
      .toContain("event-name");
    expect(classes(scan(`export const A = () => <p>Emits round_close-tranche when the tranche closes.</p>;`)).length)
      .toBeGreaterThan(0);
    expect(classes(scan(`export const A = () => <p>Submitting will emit telemetry for this action.</p>;`)))
      .toContain("telemetry-framing");
  });

  it("B11 · raw entity ids rendered where a name belongs", () => {
    for (const id of ["u_9f2a41bc7d", "rnd_3f8a2b91cc", "spv_a1b2c3d4e5", "ccm_9988aabbcc"]) {
      expect(classes(scan(`export const A = () => <p>Owner ${id} approved the change today.</p>;`)))
        .toContain("entity-id");
    }
  });

  it("B12 · migration numbers and internal build vocabulary", () => {
    expect(classes(scan(`export const A = () => <p>Applied in migration 0192 last night.</p>;`)))
      .toContain("migration-number");
    for (const word of [
      "The preflight run will confirm this.",
      "A tripwire protects this value.",
      "A fence protects this value.",
      "Served from the hot-read mirror for speed.",
    ]) {
      expect(classes(scan(`export const A = () => <p>${word}</p>;`))).toContain("build-vocab");
    }
  });

  it("B13 · raw hex digests rendered as a value", () => {
    const v = scan(`export const A = () => <p>Chain head 9f2a41bc7d3e5f6071 verified.</p>;`);
    expect(classes(v)).toContain("hash-digest");
  });

  it("B14 · the same leak inside a copy PROP and a copy ATTRIBUTE, not only JSX text", () => {
    expect(classes(scan(`export const A = () => <Field helper="Stored in the partner_organizations table." />;`)))
      .toContain("sql-table");
    expect(classes(scan(`export const A = () => <input placeholder="e.g. seed, series_a" />;`)).length)
      .toBeGreaterThan(0);
  });

  it("B15 · a leak reached through a template literal and a ternary still counts", () => {
    expect(classes(scan("export const A = ({ n }: { n: number }) => <p>{`Applied in migration 0192 (${n})`}</p>;")))
      .toContain("migration-number");
    expect(
      classes(
        scan(`export const A = ({ b }: { b: boolean }) => <p>{b ? "Retained under R3." : "Removed."}</p>;`),
      ),
    ).toContain("ruling-citation");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   NEGATIVE POLE — the things that must stay GREEN
   ══════════════════════════════════════════════════════════════════════════ */
describe("W84-C · NEGATIVE POLE: legitimate engineering stays green", () => {
  it("C1 · CODE COMMENTS may cite routes, tables, rulings, waves and file paths", () => {
    const v = scan(`
      /**
       * WAVE 83 · ITEM 4 — per R44 § 2 and STRATEGY § 1.2.3, the fee is read from
       * the payment_ledger table by server/routes.ts and exposed at GET /api/fees.
       * Refusal codes: closed_round_readonly, fd_base_divergence. See migration 0192
       * and WAIVER-7. SACRED. Tracked as FE-16. Emits round.terms_updated.
       * Verified by preflight and by the drop guard tripwire.
       */
      // getPlanPriceStrict() is the only pricing entry point (Sprint 33).
      export const A = () => <p>Fees are shown before you confirm.</p>;
    `);
    expect(v).toEqual([]);
  });

  it("C2 · data-testid values, query keys, fetch arguments and route constants", () => {
    const v = scan(`
      import { useQuery } from "@tanstack/react-query";
      const ROUTE = "/api/rounds/close-tranche";
      export const A = () => {
        const q = useQuery({ queryKey: ["/api/rounds", "payment_ledger"], queryFn: () =>
          fetch("/api/rounds/" + ROUTE).then((r) => r.json()) });
        return <div data-testid="round_close-tranche-row" className="platform_fees" id="payment_ledger">
          {q.isLoading ? "Loading…" : "Ready"}
        </div>;
      };
    `);
    expect(v).toEqual([]);
  });

  it("C3 · props that carry plumbing, not copy", () => {
    const v = scan(`
      export const A = () => (
        <Row
          table="payment_ledger"
          column="legal_name"
          endpoint="/api/fees"
          eventType="round.terms_updated"
          code="TIER_PRICE_UNPRICED"
          queryKey={["/api/fees", "platform_fees"]}
          label="Platform fee"
        />
      );
    `);
    expect(v).toEqual([]);
  });

  it("C4 · comparisons, case labels, object keys and index access are code, not copy", () => {
    const v = scan(`
      export const A = ({ m, s }: { m: string; s: string }) => {
        const label = String(m ?? "pre_money") === "post_money" ? "Post-money" : "Pre-money";
        const map: Record<string, string> = { closed_round_readonly: "This round is closed." };
        switch (s) {
          case "fd_base_divergence":
            return <p>{map["closed_round_readonly"] ?? "Unavailable."}</p>;
          default:
            return <p>{label}</p>;
        }
      };
    `);
    expect(v).toEqual([]);
  });

  it("C5 · the admin Migration tool is a legitimate feature name; only the NUMBER is banned", () => {
    expect(scan(`export const A = () => <p>Open the Migration tool to import your roster.</p>;`)).toEqual([]);
    expect(classes(scan(`export const A = () => <p>Open Migration 0192 to import.</p>;`))).toContain(
      "migration-number",
    );
  });

  it("C6 · statutory section signs are product content, not internal spec citations", () => {
    for (const s of [
      "Relief is available under Companies Act §107-108 for this class.",
      "Reported under ITAA §83A-105 for Australian holders.",
      "Registered under MAS SFA §4A in Singapore.",
    ]) {
      expect(scan(`export const A = () => <p>${s}</p>;`)).toEqual([]);
    }
  });

  it("C7 · mail-merge template variables are the product's own template language", () => {
    expect(scan(`export const A = () => <input placeholder="{{company_name}} — {{round_name}} invitation" />;`))
      .toEqual([]);
  });

  it("C8 · the four ratified admin exceptions stay green ON ADMIN SCREENS ONLY", () => {
    const admin = "client/src/pages/admin/W84Fixture.tsx";
    const cases: string[] = [
      `export const A = () => <p>COLLECTIVE_RENEWAL_WORKER_ENABLED</p>;`, // W83-ADMIN-ENVVAR
      `export const A = () => <p>COLLECTIVE_RENEWAL_POLL_MS</p>;`, //        W83-I1e pinned knob
      `export const A = () => <Row label="Units" value="basis_points" hint="amount_minor" />;`, // UNITS
      `export const A = () => <p>TIER_PRICE_UNPRICED</p>;`, //               ERRORCODE
      `export const A = () => <Row hint="updated_by" title="last_edited_by" note="editable_via" />;`, // EDITOR
    ];
    for (const c of cases) expect(scan(c, admin)).toEqual([]);

    // …and the SAME strings fail on a customer-facing screen.
    expect(scan(cases[0], "client/src/pages/partner/W84Fixture.tsx").length).toBeGreaterThan(0);
    expect(scan(cases[3], "client/src/pages/founder/W84Fixture.tsx").length).toBeGreaterThan(0);
  });

  it("C9 · an INVENTED screaming-snake token is not an env var, even on an admin screen", () => {
    const v = scan(
      `export const A = () => <p>TOTALLY_INVENTED_KNOB_W84</p>;`,
      "client/src/pages/admin/W84Fixture.tsx",
    );
    expect(classes(v)).toContain("error-const");
  });

  it("C10 · a PLACEHOLDER may show the format of a value the user will type", () => {
    // `placeholder` is the one rendered position whose content legitimately IS a
    // machine format, so an unknown token there is green…
    expect(scan(`export const A = () => <input placeholder="my_custom_value" />;`)).toEqual([]);
    // …while a token from a real catalogue is still red even in a placeholder,
    // because that one is demonstrably ours and not the user's.
    expect(scan(`export const A = () => <input placeholder="e.g. seed, series_a" />;`).length).toBeGreaterThan(0);
    // Anywhere else — including bare JSX text — an unknown machine token is a
    // machine token. R77's own identifier is in no catalogue, and this is the rule
    // that keeps the fence from going green on it.
    expect(scan(`export const A = () => <p>my_custom_value</p>;`).length).toBeGreaterThan(0);
    expect(
      scan(`export const A = () => <p>The record is stored with my_custom_value applied to every row here.</p>;`)
        .length,
    ).toBeGreaterThan(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   R77 — RENDERED TEXT ONLY, NEVER THE PRESENCE OF A STRING IN A FILE
   ─────────────────────────────────────────────────────────────────────────
   The ruling that resolved Wave 85's contradiction: Wave 83's pin bans
   `price_contradicts_pool` anywhere in Rounds.tsx, while W58CD-A1e requires that
   identifier to exist so a caller can tell WHICH rule refused a save. Both cannot
   hold as written. R77 resolves it on the merits — a refusal must be professional
   to a human AND precise to an integration, so the identifier lives in the payload
   and never on the screen. This block is the fence's proof that it can tell those
   two apart, which is now its central purpose.
   ══════════════════════════════════════════════════════════════════════════ */
describe("W84-E · R77: the same identifier, red when readable, green when machine-readable", () => {
  const ID = "price_contradicts_pool";

  it("E1 · RED — the identifier moved into rendered text, in every rendering position", () => {
    const rendered: string[] = [
      `export const A = () => <p>Refused: ${ID}</p>;`,
      `export const A = () => <Alert title="${ID}" />;`,
      `export const A = () => <Alert description="Save blocked: ${ID}" />;`,
      `export const A = () => <button aria-label="${ID}">Retry</button>;`,
      `export const A = () => <td>{"${ID}"}</td>;`,
      `export const A = ({ e }: { e: string | null }) => <span>{e ?? "${ID}"}</span>;`,
      `export const A = () => { toast({ title: "Blocked", description: "${ID}" }); return null; };`,
    ];
    for (const code of rendered) {
      const v = scan(code);
      expect(v.length, code).toBeGreaterThan(0);
      expect(v.map((x) => x.match)).toContain(ID);
    }
  });

  it("E2 · GREEN — the identical identifier as a machine-readable value only", () => {
    const machine = `
      /**
       * W58CD-A1e — the refusal must be precise to an integration: the payload
       * carries ${ID} so a caller can tell WHICH rule refused the save.
       * R77: precise in the payload, professional on the screen.
       */
      import { useMutation } from "@tanstack/react-query";
      const REFUSAL_ROUTE = "/api/rounds/terms";
      type Refusal = { code: "${ID}" | "closed_round_readonly"; saved: number; derived: number };
      export const A = ({ refusal }: { refusal: Refusal }) => {
        const m = useMutation({
          mutationKey: ["${ID}"],
          mutationFn: () => fetch(REFUSAL_ROUTE, { method: "PATCH" }).then((r) => r.json()),
        });
        switch (refusal.code) {
          case "${ID}":
            return (
              <Alert
                data-testid="refusal-${ID}"
                code={refusal.code}
                title="This price disagrees with the option pool"
                description="Saving is blocked until the price and the pool agree."
              />
            );
          default:
            return <p>{m.isPending ? "Saving…" : "Ready"}</p>;
        }
      };
    `;
    expect(scan(machine)).toEqual([]);
  });

  it("E3 · the two poles differ ONLY in position, not in the string", () => {
    // Identical identifier, identical file, one attribute apart.
    const green = `export const A = () => <Alert code="${ID}" title="This price disagrees with the option pool" />;`;
    const red = `export const A = () => <Alert code="${ID}" title="${ID}" />;`;
    expect(scan(green)).toEqual([]);
    expect(scan(red).length).toBeGreaterThan(0);
  });

  it("E4 · the allowance is documented in the fence, not just implemented", () => {
    expect(R77_MACHINE_READABLE_ALLOWANCE.ruling).toBe("R77");
    expect(R77_MACHINE_READABLE_ALLOWANCE.allowedPositions.length).toBeGreaterThanOrEqual(10);
    expect(R77_MACHINE_READABLE_ALLOWANCE.workedExample).toContain(ID);
    // The worked example must itself be green: a documented allowance the fence
    // would flag is worse than no documentation at all.
    expect(scan(`export const A = () => { ${R77_MACHINE_READABLE_ALLOWANCE.workedExample} };`)).toEqual([]);
  });

  it("E1b · the ONE rendered position that stays green is `placeholder`, and it is documented", () => {
    // A placeholder's content is the FORMAT of what the user types. R77 governs
    // text a user READS AS A STATEMENT; a format hint is neither a statement nor a
    // refusal, and Wave 84 has no authority to rewrite the six placeholder fields
    // already registered as debt. Recorded here so the carve-out is explicit
    // rather than an accident of the classifier — see OWNER QUESTION 4.
    expect(scan(`export const A = () => <input placeholder="${ID}" />;`)).toEqual([]);
    // The same identifier one attribute away, where a user reads it as a
    // statement, is RED:
    expect(scan(`export const A = () => <input placeholder="Price" title="${ID}" />;`).length).toBeGreaterThan(0);
  });

  it("E5 · a comment or docstring may name the identifier as often as it likes", () => {
    const v = scan(`
      /** ${ID} is returned by PATCH /api/rounds/:id/terms — see W58CD-A1e. */
      // ${ID}: the saved price contradicts the pool; Wave 83 removed it from the copy.
      export const A = () => <p>This price disagrees with the option pool.</p>;
    `);
    expect(v).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   THE FENCE'S OWN SCOPE AND ITS EXCEPTION MECHANISM
   ══════════════════════════════════════════════════════════════════════════ */
describe("W84-D · scope, exceptions and the register", () => {
  it("D1 · TEST FILES ARE NOT SCANNED — a test may name anything", () => {
    const scanned = runInternalLanguageFence();
    expect(scanned.filesScanned).toBeGreaterThan(300);
    expect(
      scanned.violations.concat(scanned.registered.map((r) => ({ file: r.file }) as Violation)).filter(
        (v) => /\.(test|spec)\.|__tests__/.test(v.file),
      ),
    ).toEqual([]);
  });

  it("D2 · the tree is at ZERO new leaks — every pre-existing site is named in the register", () => {
    const r = runInternalLanguageFence();
    expect(r.violations.map((v) => `${v.file}:${v.line} [${v.cls}] ${v.match}`)).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("D3 · every exception and every register entry carries a written reason", () => {
    for (const e of EXCEPTIONS) {
      expect(e.reason.length).toBeGreaterThan(80);
      expect(e.approvedBy.length).toBeGreaterThan(0);
      // admin-only by construction: the exception path cannot silence a customer screen
      expect(e.scope.test("client/src/pages/admin/X.tsx")).toBe(true);
      expect(e.scope.test("client/src/pages/founder/X.tsx")).toBe(false);
    }
    for (const e of REGISTER) {
      expect(e.reason.length).toBeGreaterThan(60);
      expect(["ratified", "debt"]).toContain(e.status);
    }
  });

  it("D4 · the register is keyed by file+class+match, never by line number", () => {
    // R73/R74 will move every line in these files; a line-keyed register would
    // turn the fence red for reasons that have nothing to do with copy.
    for (const e of REGISTER) {
      expect(Object.keys(e).sort()).toEqual(["cls", "file", "match", "reason", "status"]);
    }
  });

  it("D5 · no register entry is stale — an entry that stops matching must be deleted", () => {
    const r = runInternalLanguageFence();
    expect(r.unusedRegister.map((e) => `${e.file} [${e.cls}] ${e.match}`)).toEqual([]);
  });

  it("D6 · the outstanding copy debt is visible, counted and non-zero", () => {
    const r = runInternalLanguageFence();
    const debt = r.registered.filter((x) => x.entry.status === "debt");
    expect(debt.length).toBeGreaterThan(0); // a silent register is theatre
    expect(new Set(debt.map((d) => d.file)).size).toBeGreaterThan(10);
  });
});
