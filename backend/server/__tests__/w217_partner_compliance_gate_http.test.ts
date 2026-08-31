/**
 * WAVE 217 · R190.8 · Decision A9 — THE PARTNER COMPLIANCE GATE, PROVED OVER
 * REAL HTTP THROUGH THE REAL REGISTRAR.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS HARNESS IS NOT A REPLICA (handbook §8)
 * ─────────────────────────────────────────────────────────────────────────────
 * The app under test mounts `registerConsortiumApplyRoutes` — the SAME exported
 * registrar function, imported from the SAME module, that production calls
 * exactly once at `server/routes.ts:1911`. It is the only registrar for these
 * paths; there is no dormant twin. Nothing about the handler, the schema, the
 * gate or the store is reimplemented, stubbed, or re-declared here: every
 * request below travels the real `publicApplyRateLimit` → `publicApplyHandler`
 * → `verifyComplianceAttestation` → `submitApplication` path and lands in the
 * real table.
 *
 * BOTH public POST paths are driven in every gate test, because
 * `consortiumApplyStore.ts:1887-1889` binds `/api/public/consortium/apply` AND
 * the alias `/api/consortium-applications` to the same handler. A gate proved on
 * one path only would be a gate an attacker walks around by typing the other.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS TRUE BEFORE THIS WAVE, MEASURED
 * ─────────────────────────────────────────────────────────────────────────────
 * A bare POST with NO tick and NO signature returned **201 Created** on BOTH
 * paths. The only gate was the submit button's `disabled=` expression on
 * `ConsortiumApplyPage.tsx:484`, which a `curl` does not run. That capture is in
 * `build_log/wave217/W217_TESTS.md §1`; §2 of this file is its successor and now
 * asserts 422.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NO NORMALISING CALL INSIDE AN EQUALITY ASSERTION
 * ─────────────────────────────────────────────────────────────────────────────
 * There is no `.trim()`, no `.toLowerCase()` and no whitespace collapse on
 * either side of any `toBe` in this file, and the reason is written here rather
 * than assumed: WAVE 212 shipped a GREEN test that was blind to its own subject
 * because a helper called `.trim()`, erasing the exact difference the test
 * existed to detect (R200). The declaration is compared BYTE FOR BYTE. §6 proves
 * the assertion is not blind by feeding it a one-space variant and requiring a
 * refusal.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import {
  registerConsortiumApplyRoutes,
  submitApplication,
  getApplication,
  _consortiumApplyInternal,
  _resetPublicApplyBucketsForTests,
} from "../consortiumApplyStore";
import { installV14TestIdentity } from "./_v14TestIdentity";
import {
  COMPLIANCE_FORBIDDEN_WORDS,
  PARTNER_COMPLIANCE_ATTESTATION_VERSION,
  REGULATORY_STATUS_VALUES,
  complianceAttestationText,
  complianceClauseQuote,
  verifyComplianceAttestation,
  COMPLIANCE_MISSING_MESSAGE,
  COMPLIANCE_SIGNATURE_REQUIRED_MESSAGE,
  COMPLIANCE_STATUS_INVALID_MESSAGE,
  COMPLIANCE_TEXT_MISMATCH_MESSAGE,
  COMPLIANCE_VERSION_STALE_MESSAGE,
} from "@shared/wave217PartnerComplianceAttestation";
import {
  CONSORTIUM_AGREEMENT_TEXT,
  CONSORTIUM_AGREEMENT_VERSION,
} from "@shared/consortiumAgreement";
import {
  W217_COLUMNS,
  W217_MIGRATION_PATH,
  applyW217Migration,
  consortiumApplicationColumns,
} from "./_w217ComplianceSchema";

let app: express.Express;

beforeAll(() => {
  // Apply the REAL migration file to this test database FIRST — see
  // `_w217ComplianceSchema.ts` for why the file is read off disk rather than
  // retyped, and §0 for the assertions that prove it applied. Without this the
  // `:memory:` schema (built by the inline bootstrap in the untouchable
  // `server/db/connection.ts`) lacks the five columns and every insert 500s —
  // which is exactly how the degradation path in the store was discovered.
  applyW217Migration();
  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: true });
  registerConsortiumApplyRoutes(app);
});

beforeEach(() => {
  _consortiumApplyInternal.appsCache.clear();
  _resetPublicApplyBucketsForTests();
});

/** BOTH public paths. Every gate assertion runs against each. */
const PUBLIC_PATHS = [
  "/api/public/consortium/apply",
  "/api/consortium-applications",
] as const;

const ORG = "Alpha Capital Ltd";
const SIGNER = "Alice Test";

/** The valid body, built the way the real page builds it. */
function validBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    organizationName: ORG,
    contactName: SIGNER,
    contactEmail: "alice@alpha-capital.test",
    jurisdiction: "Canada",
    partnerType: "vc",
    aumRange: "10-50M",
    portfolioCompanyCount: 12,
    expectedChapter: "chap_keiretsu_canada",
    introMessage: "We invest in seed-stage SaaS in Ontario.",
    agreementSignedName: SIGNER,
    agreementVersion: CONSORTIUM_AGREEMENT_VERSION,
    complianceAttested: true,
    complianceAttestationText: complianceAttestationText(ORG, SIGNER),
    complianceAttestationVersion: PARTNER_COMPLIANCE_ATTESTATION_VERSION,
    regulatoryStatus: "licensed",
    ...over,
  };
}

/**
 * The real 5-per-hour-per-IP limiter on the public apply route is LIVE, and it
 * must not be the thing that fails a gate test — a 429 tells you nothing about
 * whether the declaration was enforced.
 *
 * I first tried rotating `X-Forwarded-For` per request. THAT DOES NOT WORK, and
 * finding out why was worth the detour: `clientIp()` deliberately ignores
 * `x-forwarded-for` unless the TCP peer is in `TRUSTED_PROXY_IPS` (v25.12 NM-6,
 * consortiumApplyStore.ts:418), so every supertest request is one bucket —
 * 127.0.0.1 — and the sixth returns 429. The header cannot rotate the bucket,
 * which is the anti-abuse property that fix exists to provide.
 *
 * So the bucket is CLEARED before each request, through the store's own exported
 * test hook. This does not weaken anything under test here: the limiter is not
 * this wave's subject and is proved by its own pre-existing tests, while the
 * compliance gate runs AFTER the limiter in the same handler and is therefore
 * still exercised on every one of these requests.
 */
function post(path: string, body: unknown) {
  _resetPublicApplyBucketsForTests();
  return request(app).post(path).send(body as object);
}

/* ══════════════════════════════════════════════════════════════════════════════
 * §0 — MIGRATION 0222 ITSELF. The real file, applied and read back.
 * ════════════════════════════════════════════════════════════════════════════ */
describe("W217 §0 — migration 0222 itself", () => {
  it("applies, and every one of its five columns exists on the real table", () => {
    const cols = consortiumApplicationColumns();
    for (const c of W217_COLUMNS) {
      expect(cols.has(c)).toBe(true);
    }
  });

  it("is byte-identical in `migrations/` and `server/db/migrations/`", async () => {
    const fs = await import("node:fs/promises");
    const a = await fs.readFile(W217_MIGRATION_PATH);
    const b = await fs.readFile(`server/db/${W217_MIGRATION_PATH}`);
    // Buffer comparison, not string comparison, and NO normalisation: "mirror
    // byte-identically" means bytes, including line endings and the final
    // newline. A `.trim()` here would make the assertion blind to exactly the
    // divergence it exists to catch (the wave-212 defect).
    expect(a.equals(b)).toBe(true);
  });

  it("reuses the EXISTING `jurisdiction` column and adds no second one", () => {
    const cols = consortiumApplicationColumns();
    expect(cols.has("jurisdiction")).toBe(true);
    // No `compliance_jurisdiction` or `regulatory_jurisdiction`: two versions of
    // one term is the R187.2 / R187.5 defect class.
    // `Array.from`, not a spread: a `Set` spread is TS2802 under this tree's
    // compile target, which the ROOT `tsc` run never reports because it
    // `exclude`s `**/*.test.ts`. Found by compiling through a derived config.
    expect(Array.from(cols).filter((c) => c.includes("jurisdiction"))).toEqual([
      "jurisdiction",
    ]);
  });

  it("is idempotent — a second application changes nothing and throws nothing", () => {
    const before = consortiumApplicationColumns().size;
    const r = applyW217Migration();
    expect(r.alreadyPresent).toBeGreaterThan(0);
    expect(consortiumApplicationColumns().size).toBe(before);
  });

  it("the DATABASE refuses a sixth regulatory status, and still permits NULL", async () => {
    const { rawDb } = await import("../db/connection");
    // Written straight past the application layer, because that is the only way
    // to test that the CHECK constraint is real rather than that the TypeScript
    // union is real.
    const probe = submitApplication({
      organizationName: "Check Probe Ltd",
      contactName: "Probe",
      contactEmail: "check@probe.test",
      partnerType: "vc",
      expectedChapter: "chap_keiretsu_canada",
    });
    expect(() =>
      rawDb()
        .prepare("UPDATE consortium_applications SET regulatory_status = ? WHERE id = ?")
        .run("fully_compliant", probe.id),
    ).toThrow(/CHECK constraint failed/i);
    // NULL stays legal — the pre-217 rows are NOT retro-refused (R195.5).
    expect(() =>
      rawDb()
        .prepare("UPDATE consortium_applications SET regulatory_status = NULL WHERE id = ?")
        .run(probe.id),
    ).not.toThrow();
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §1 — THE CLAUSE IS SLICED FROM THE SIGNED AGREEMENT, NOT RETYPED.
 * ════════════════════════════════════════════════════════════════════════════ */
describe("W217 §1 — the quoted clause is a slice of the executed document", () => {
  it("returns a non-empty string, and never the empty string", () => {
    const q = complianceClauseQuote();
    expect(typeof q).toBe("string");
    expect(q).not.toBe("");
    expect(q).not.toBeNull();
  });

  it("is a VERBATIM SUBSTRING of CONSORTIUM_AGREEMENT_TEXT — byte for byte", () => {
    const q = complianceClauseQuote()!;
    // THIS is the assertion that makes a paraphrase impossible. If any future
    // wave retypes §4 in this module instead of slicing it, `includes` fails,
    // because the retyped copy will differ from the signed text in at least one
    // byte. No `.trim()`, no case folding, no whitespace collapse on either
    // side — a paraphrase that differs only in whitespace must still fail.
    expect(CONSORTIUM_AGREEMENT_TEXT.includes(q)).toBe(true);
  });

  it("is §4 — Eligibility, Licensing & Regulatory Compliance — and starts at its heading", () => {
    const q = complianceClauseQuote()!;
    expect(q.startsWith("## 4. Eligibility, Licensing & Regulatory Compliance")).toBe(true);
    expect(q.includes("4.1 ")).toBe(true);
    expect(q.includes("4.4 ")).toBe(true);
    // and does NOT bleed into §5, which the slicer would do if its terminator
    // were wrong.
    expect(q.includes("## 5.")).toBe(false);
  });

  it("is NOT wave 213's clause: 217 slices §4 where 213 slices §7, same helper", () => {
    const q = complianceClauseQuote()!;
    expect(q.includes("## 7.")).toBe(false);
    expect(q.includes("LP Handling")).toBe(false);
  });

  it("the attestation sentence names §4 rather than restating it", () => {
    const t = complianceAttestationText(ORG, SIGNER);
    // It must POINT at the section...
    expect(t.includes("Section 4 (Eligibility, Licensing & Regulatory Compliance)")).toBe(true);
    expect(t.includes(CONSORTIUM_AGREEMENT_VERSION)).toBe(true);
    // ...and must NOT contain the signed clause's own operative wording, which
    // would make it a second version of the term (R187.2 / R187.5).
    for (const signedPhrase of [
      "holds all licenses, registrations, and permissions required",
      "responsible for determining the lawful basis",
      "KYC/AML/CTF and sanctions screening",
      "accredited / professional / eligible-investor requirements",
    ]) {
      expect(t.includes(signedPhrase)).toBe(false);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §2 — THE GATE IS SERVER-ENFORCED. Both paths. Every omission.
 * ════════════════════════════════════════════════════════════════════════════ */
describe("W217 §2 — server-enforced on BOTH public paths", () => {
  for (const path of PUBLIC_PATHS) {
    describe(path, () => {
      it("accepts a complete, valid declaration → 201", async () => {
        const r = await post(path, validBody());
        expect(r.status).toBe(201);
        expect(String(r.body.applicationId)).toMatch(/^cpapp_/);
      });

      it("REFUSES the pre-wave bare body (no tick, no name) → 422", async () => {
        // This is the exact body that returned 201 before this wave.
        const r = await post(path, {
          organizationName: ORG,
          contactName: SIGNER,
          contactEmail: "alice@alpha-capital.test",
          jurisdiction: "Hong Kong",
          partnerType: "vc",
          expectedChapter: "chap_keiretsu_canada",
        });
        expect(r.status).toBe(422);
        expect(r.body.error).toBe("COMPLIANCE_ATTESTATION_REQUIRED");
        expect(r.body.message).toBe(COMPLIANCE_MISSING_MESSAGE);
      });

      it("REFUSES a missing tick → 422 COMPLIANCE_ATTESTATION_REQUIRED", async () => {
        const b = validBody();
        delete b.complianceAttested;
        const r = await post(path, b);
        expect(r.status).toBe(422);
        expect(r.body.error).toBe("COMPLIANCE_ATTESTATION_REQUIRED");
      });

      it("REFUSES an unticked declaration → 422", async () => {
        const r = await post(path, validBody({ complianceAttested: false }));
        expect(r.status).toBe(422);
        expect(r.body.error).toBe("COMPLIANCE_ATTESTATION_REQUIRED");
      });

      it("REFUSES a missing regulatory status → 422 COMPLIANCE_STATUS_INVALID", async () => {
        const b = validBody();
        delete b.regulatoryStatus;
        const r = await post(path, b);
        expect(r.status).toBe(422);
        expect(r.body.error).toBe("COMPLIANCE_STATUS_INVALID");
        expect(r.body.message).toBe(COMPLIANCE_STATUS_INVALID_MESSAGE);
      });

      it("REFUSES a missing signature — the declaration names its signer → 422", async () => {
        const b = validBody();
        delete b.agreementSignedName;
        const r = await post(path, b);
        expect(r.status).toBe(422);
        expect(r.body.error).toBe("COMPLIANCE_SIGNATURE_REQUIRED");
        expect(r.body.message).toBe(COMPLIANCE_SIGNATURE_REQUIRED_MESSAGE);
      });

      it("REFUSES a missing declaration text → 422", async () => {
        const b = validBody();
        delete b.complianceAttestationText;
        const r = await post(path, b);
        expect(r.status).toBe(422);
        expect(r.body.error).toBe("COMPLIANCE_ATTESTATION_REQUIRED");
      });
    });
  }

  it("no row is written by any refused request", async () => {
    const before = _consortiumApplyInternal.appsCache.size;
    for (const path of PUBLIC_PATHS) {
      await post(path, validBody({ complianceAttested: false }));
      await post(path, validBody({ regulatoryStatus: "" }));
    }
    expect(_consortiumApplyInternal.appsCache.size).toBe(before);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §3 — PRESENCE AND TYPE ARE CHECKED BEFORE ANY EQUALITY (R176.1).
 *
 * Each forged shape below is a value that a `===` would have handled WRONGLY if
 * it were reached: `"true"` and `1` are truthy, `[]` is truthy, `{}` is truthy.
 * The gate must refuse them on TYPE, before comparing anything.
 * ════════════════════════════════════════════════════════════════════════════ */
describe("W217 §3 — R176.1: presence and type before equality", () => {
  const FORGED_TICKS: unknown[] = ["true", "yes", 1, -1, {}, [], [true], null, "on"];

  for (const forged of FORGED_TICKS) {
    it(`refuses a truthy-but-wrong-typed tick: ${JSON.stringify(forged)}`, async () => {
      for (const path of PUBLIC_PATHS) {
        const r = await post(path, validBody({ complianceAttested: forged }));
        expect(r.status).toBe(422);
        expect(r.body.error).toBe("COMPLIANCE_ATTESTATION_REQUIRED");
      }
    });
  }

  const FORGED_STATUSES: unknown[] = [
    null,
    "",
    0,
    1,
    true,
    ["exempt"],
    { value: "exempt" },
    "LICENSED",
    "Licensed",
    "not required",
    "notRequired",
    "compliant",
  ];

  for (const forged of FORGED_STATUSES) {
    it(`refuses an unrecognised status: ${JSON.stringify(forged)}`, async () => {
      const r = await post(PUBLIC_PATHS[0], validBody({ regulatoryStatus: forged }));
      expect(r.status).toBe(422);
      expect(r.body.error).toBe("COMPLIANCE_STATUS_INVALID");
    });
  }

  it("AN ABSENT STATUS IS NOT `not_required` — the R176.1 defect, named", () => {
    // Stated as a unit assertion because it is the precise mistake the ruling
    // exists to prevent: reading an absence as the most permissive answer.
    const absent = verifyComplianceAttestation({
      organizationName: ORG,
      signedName: SIGNER,
      attested: true,
      text: complianceAttestationText(ORG, SIGNER),
      version: null,
      status: undefined,
    });
    expect(absent.ok).toBe(false);
    const present = verifyComplianceAttestation({
      organizationName: ORG,
      signedName: SIGNER,
      attested: true,
      text: complianceAttestationText(ORG, SIGNER),
      version: null,
      status: "not_required",
    });
    expect(present.ok).toBe(true);
  });

  it("accepts all five statuses and only those five", async () => {
    for (const s of REGULATORY_STATUS_VALUES) {
      const r = await post(PUBLIC_PATHS[0], validBody({ regulatoryStatus: s }));
      expect(r.status).toBe(201);
    }
    expect(REGULATORY_STATUS_VALUES.length).toBe(5);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §4 — A FORGED OR PARAPHRASED DECLARATION IS REFUSED.
 * ════════════════════════════════════════════════════════════════════════════ */
describe("W217 §4 — forged and paraphrased declarations", () => {
  const canonical = complianceAttestationText(ORG, SIGNER);

  const FORGERIES: Array<[string, string]> = [
    ["a plain paraphrase", "I confirm we follow all applicable laws and hold every licence we need."],
    ["one word changed", canonical.replace("does not check it", "will not check it")],
    ["one word deleted", canonical.replace("authorised ", "")],
    ["the disclaimer removed", canonical.slice(0, canonical.indexOf("Capavate records"))],
    ["a leading space", " " + canonical],
    ["a trailing newline", canonical + "\n"],
    ["an internal double space", canonical.replace(". I have read", ".  I have read")],
    ["lower-cased", canonical.toLowerCase()],
    ["a different organisation", complianceAttestationText("Someone Else Ltd", SIGNER)],
    ["a different signer", complianceAttestationText(ORG, "Bob Forger")],
    ["the empty string", ""],
  ];

  for (const [label, forged] of FORGERIES) {
    it(`refuses ${label}`, async () => {
      for (const path of PUBLIC_PATHS) {
        const r = await post(path, validBody({ complianceAttestationText: forged }));
        expect(r.status).toBe(422);
        // The empty string is an ABSENCE, refused before the equality; every
        // other forgery reaches the byte comparison and fails it. Both are
        // refusals and both are named.
        expect(["COMPLIANCE_TEXT_MISMATCH", "COMPLIANCE_ATTESTATION_REQUIRED"]).toContain(
          r.body.error,
        );
      }
    });
  }

  it("the mismatch refusal names the mismatch and tells the applicant to reload", async () => {
    const r = await post(PUBLIC_PATHS[0], validBody({ complianceAttestationText: canonical + "." }));
    expect(r.status).toBe(422);
    expect(r.body.error).toBe("COMPLIANCE_TEXT_MISMATCH");
    expect(r.body.message).toBe(COMPLIANCE_TEXT_MISMATCH_MESSAGE);
  });

  it("refuses a stale or wrong attestation version", async () => {
    for (const v of ["W217-COMPLIANCE-v1/CPA-v0.9", "W217-COMPLIANCE-v0", "", 1, {}, []]) {
      const r = await post(PUBLIC_PATHS[0], validBody({ complianceAttestationVersion: v }));
      expect(r.status).toBe(422);
      expect(r.body.error).toBe("COMPLIANCE_VERSION_STALE");
      expect(r.body.message).toBe(COMPLIANCE_VERSION_STALE_MESSAGE);
    }
  });

  it("the version identity binds the SIGNED agreement version", () => {
    expect(PARTNER_COMPLIANCE_ATTESTATION_VERSION.endsWith(`/${CONSORTIUM_AGREEMENT_VERSION}`)).toBe(
      true,
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §5 — WHAT IS RECORDED. Server-observed only (R187.1).
 * ════════════════════════════════════════════════════════════════════════════ */
describe("W217 §5 — the record", () => {
  it("persists the declaration, the version, the status, the jurisdiction and the server-observed IP and UA", async () => {
    const ua = "W217-Probe/1.0";
    const r = await request(app)
      .post(PUBLIC_PATHS[0])
      .set("X-Forwarded-For", "203.0.113.77") // forged on purpose — see below
      .set("User-Agent", ua)
      .send(validBody({ jurisdiction: "Hong Kong", regulatoryStatus: "exempt" }));
    expect(r.status).toBe(201);

    const row = getApplication(String(r.body.applicationId))!;
    expect(row).toBeTruthy();
    // BYTE-FOR-BYTE. The stored sentence is the sentence, with no normalisation
    // anywhere in this assertion.
    expect(row.complianceAttestationText).toBe(complianceAttestationText(ORG, SIGNER));
    expect(row.complianceAttestationVersion).toBe(PARTNER_COMPLIANCE_ATTESTATION_VERSION);
    expect(row.regulatoryStatus).toBe("exempt");
    expect(row.jurisdiction).toBe("Hong Kong");
    // R187.1 — SERVER-OBSERVED, never client-supplied and never fabricated.
    //
    // AND THE FORGED HEADER IS IGNORED. `X-Forwarded-For: 203.0.113.77` was sent
    // above and is NOT what was recorded: `clientIp()` (consortiumApplyStore.ts
    // :418, v25.12 NM-6) reads `x-forwarded-for` only when the immediate TCP peer
    // is in `TRUSTED_PROXY_IPS`, which is unset here, so it falls back to the
    // socket address. This assertion is therefore the R187.1 proof itself: the
    // stored address is the one the server OBSERVED, and a request cannot choose
    // it. I originally wrote this expecting the forged value and the test failed;
    // the code was right and the expectation was wrong.
    expect(row.sourceIp).not.toBe("203.0.113.77");
    expect(row.sourceIp).toBe("127.0.0.1");
    expect(row.sourceUserAgent).toBe(ua);
    // The timestamp is the server's, and it is a real ISO instant, not a
    // placeholder and not a value the request could have chosen.
    expect(typeof row.complianceAttestedAt).toBe("string");
    expect(Number.isNaN(Date.parse(String(row.complianceAttestedAt)))).toBe(false);
  });

  it("IGNORES a client-supplied attestation timestamp — R187.1", async () => {
    const forgedTime = "1999-01-01T00:00:00.000Z";
    const r = await post(PUBLIC_PATHS[0], validBody({ complianceAttestedAt: forgedTime }));
    expect(r.status).toBe(201);
    const row = getApplication(String(r.body.applicationId))!;
    expect(row.complianceAttestedAt).not.toBe(forgedTime);
  });

  it("stores the SERVER's rebuilt sentence, so a divergent client string can never land", async () => {
    // The only body that reaches the store is one whose text already matched,
    // so this asserts the invariant directly: whatever is stored equals what
    // the server itself builds.
    const r = await post(PUBLIC_PATHS[0], validBody());
    const row = getApplication(String(r.body.applicationId))!;
    expect(row.complianceAttestationText).toBe(
      complianceAttestationText(row.organizationName, String(row.agreementSignedName)),
    );
  });

  it("records the declaration on the EXISTING audit entry, with no second audit path", async () => {
    const { getAuditLog } = await import("../adminPlatformStore");
    const r = await post(PUBLIC_PATHS[0], validBody({ regulatoryStatus: "unsure" }));
    expect(r.status).toBe(201);
    const rows = getAuditLog() as unknown as Array<Record<string, unknown>>;
    const mine = rows.filter(
      (e) =>
        // `eventType`, which is the field `appendAdminAudit` actually writes
        // (adminPlatformStore.ts:586). I guessed `action`/`event` first and the
        // filter silently matched nothing — a filter that matches nothing is a
        // test that proves nothing, so the field name is read from the writer's
        // own signature rather than assumed.
        String(e.eventType ?? "") === "consortium.apply.submitted" &&
        JSON.stringify(e).includes(String(r.body.applicationId)),
    );
    expect(mine.length).toBe(1); // ONE entry, not two: no second audit path.
    const blob = JSON.stringify(mine[0]);
    expect(blob.includes("\"complianceAttested\":true")).toBe(true);
    expect(blob.includes("unsure")).toBe(true);
    expect(blob.includes(PARTNER_COMPLIANCE_ATTESTATION_VERSION)).toBe(true);
    // The 639-character sentence is NOT duplicated into the audit blob: it is
    // already stored verbatim on the row, and one copy is the point.
    expect(blob.includes("am authorised to make this declaration")).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §6 — THE OPTIONAL EVIDENCE REFERENCE IS GENUINELY OPTIONAL.
 *
 * The owner's own question. Requiring a certificate would exclude legitimate
 * partners in jurisdictions that issue none.
 * ════════════════════════════════════════════════════════════════════════════ */
describe("W217 §6 — evidence is optional and its absence is unpenalised", () => {
  it("an EXEMPT applicant with NO evidence reference is accepted", async () => {
    const b = validBody({ regulatoryStatus: "exempt" });
    delete b.complianceEvidenceRef;
    const r = await post(PUBLIC_PATHS[0], b);
    expect(r.status).toBe(201);
    const row = getApplication(String(r.body.applicationId))!;
    expect(row.complianceEvidenceRef).toBeNull();
    expect(row.regulatoryStatus).toBe("exempt");
  });

  it("`not_required` and `unsure` with no evidence are accepted on both paths", async () => {
    for (const path of PUBLIC_PATHS) {
      for (const s of ["not_required", "unsure"]) {
        const r = await post(path, validBody({ regulatoryStatus: s, complianceEvidenceRef: null }));
        expect(r.status).toBe(201);
      }
    }
  });

  it("an empty-string reference is stored as NULL, never as an answer", async () => {
    const r = await post(PUBLIC_PATHS[0], validBody({ complianceEvidenceRef: "   " }));
    expect(r.status).toBe(201);
    expect(getApplication(String(r.body.applicationId))!.complianceEvidenceRef).toBeNull();
  });

  it("a provided reference is stored verbatim", async () => {
    const r = await post(PUBLIC_PATHS[0], validBody({ complianceEvidenceRef: "OSC-12345-X" }));
    expect(getApplication(String(r.body.applicationId))!.complianceEvidenceRef).toBe("OSC-12345-X");
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §7 — THE PLATFORM NEVER SAYS "VERIFIED".
 * ════════════════════════════════════════════════════════════════════════════ */
describe("W217 §7 — no claim of verification anywhere in this wave's copy", () => {
  it("the declaration and every refusal are free of every forbidden word", () => {
    const corpus = [
      complianceAttestationText(ORG, SIGNER),
      COMPLIANCE_MISSING_MESSAGE,
      COMPLIANCE_SIGNATURE_REQUIRED_MESSAGE,
      COMPLIANCE_STATUS_INVALID_MESSAGE,
      COMPLIANCE_TEXT_MISMATCH_MESSAGE,
      COMPLIANCE_VERSION_STALE_MESSAGE,
    ].join("\n");
    for (const w of COMPLIANCE_FORBIDDEN_WORDS) {
      expect(corpus.toLowerCase().includes(w)).toBe(false);
    }
  });

  it("the declaration says out loud that Capavate does not check it", () => {
    const t = complianceAttestationText(ORG, SIGNER);
    expect(t.includes("Capavate records this declaration")).toBe(true);
    expect(t.includes("does not check it")).toBe(true);
    expect(t.includes("no regulatory advice or clearance")).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §8 — EVERY REFUSAL SURVIVES THE 240-CHARACTER `looksHuman` GATE.
 *
 * `client/src/lib/queryClient.ts:60-65` silently DROPS any server message that
 * is not strictly shorter than 240 characters. It has swallowed real refusals
 * four times. Measured, not assumed.
 * ════════════════════════════════════════════════════════════════════════════ */
describe("W217 §8 — the 240-character gate", () => {
  const MESSAGES: Array<[string, string]> = [
    ["COMPLIANCE_MISSING_MESSAGE", COMPLIANCE_MISSING_MESSAGE],
    ["COMPLIANCE_SIGNATURE_REQUIRED_MESSAGE", COMPLIANCE_SIGNATURE_REQUIRED_MESSAGE],
    ["COMPLIANCE_STATUS_INVALID_MESSAGE", COMPLIANCE_STATUS_INVALID_MESSAGE],
    ["COMPLIANCE_TEXT_MISMATCH_MESSAGE", COMPLIANCE_TEXT_MISMATCH_MESSAGE],
    ["COMPLIANCE_VERSION_STALE_MESSAGE", COMPLIANCE_VERSION_STALE_MESSAGE],
  ];
  for (const [name, msg] of MESSAGES) {
    it(`${name} is shorter than 240 characters (${msg.length})`, () => {
      expect(msg.length).toBeLessThan(240);
      expect(msg.length).toBeGreaterThan(0);
    });
  }

  it("every refusal actually SENT over HTTP is under the gate", async () => {
    const bodies = [
      validBody({ complianceAttested: false }),
      validBody({ regulatoryStatus: "nonsense" }),
      validBody({ complianceAttestationText: "paraphrase" }),
      validBody({ complianceAttestationVersion: "old" }),
      validBody({ agreementSignedName: "" }),
    ];
    for (const b of bodies) {
      const r = await post(PUBLIC_PATHS[0], b);
      expect(r.status).toBe(422);
      expect(String(r.body.message).length).toBeLessThan(240);
      expect(String(r.body.message).length).toBeGreaterThan(0);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════════
 * §9 — DO NOT BREAK ANYTHING. The gate touches ONE action and nothing else.
 *
 * This is the section the owner told me to weigh hardest: "trapping a partner
 * out of their own account is far worse than a missing acknowledgement for one
 * more day."
 * ════════════════════════════════════════════════════════════════════════════ */
describe("W217 §9 — nothing else is gated", () => {
  it("the PUBLIC status lookup still answers, and leaks no declaration", async () => {
    const r = await post(PUBLIC_PATHS[0], validBody());
    const id = String(r.body.applicationId);
    const s = await request(app).get(`/api/public/consortium/apply/${id}/status`);
    expect(s.status).toBe(200);
    expect(s.body.status).toBe("submitted");
    // `rowToApp` is an allowlist mapper, but the public route must be proved to
    // emit ONLY the two fields — a declaration is not public information.
    expect(Object.keys(s.body).sort()).toEqual(["applicationId", "status"]);
  });

  it("the ADMIN queue still lists applications and now shows the declaration", async () => {
    const r = await post(PUBLIC_PATHS[0], validBody({ regulatoryStatus: "registered" }));
    expect(r.status).toBe(201);
    const q = await request(app)
      .get("/api/admin/consortium/applications")
      .set("x-user-id", "u_admin")
      .set("x-role", "admin");
    expect(q.status).toBe(200);
    const row = (q.body.rows as Array<Record<string, unknown>>).find(
      (x) => x.id === r.body.applicationId,
    )!;
    expect(row).toBeTruthy();
    expect(row.regulatoryStatus).toBe("registered");
    expect(row.complianceAttestationText).toBe(complianceAttestationText(ORG, SIGNER));
  });

  it("the ADMIN detail route still answers for a PRE-217 row and reports NULL, not a status", () => {
    // A row written WITHOUT a declaration — exactly what every application in
    // the database looks like today. It must still read back cleanly, and its
    // absence must read as an absence and NOT as `not_required`.
    const legacy = submitApplication({
      organizationName: "Legacy Partners Ltd",
      contactName: "Old Applicant",
      contactEmail: "legacy@old.test",
      partnerType: "vc",
      expectedChapter: "chap_keiretsu_canada",
    });
    expect(legacy.complianceAttestedAt).toBeNull();
    expect(legacy.complianceAttestationText).toBeNull();
    expect(legacy.complianceAttestationVersion).toBeNull();
    expect(legacy.regulatoryStatus).toBeNull();
    expect(legacy.complianceEvidenceRef).toBeNull();
    // Not "not_required", not "", not "unsure". NULL. R176.1.
    expect(legacy.regulatoryStatus).not.toBe("not_required");
    const reread = getApplication(legacy.id)!;
    expect(reread.regulatoryStatus).toBeNull();
  });

  it("`requireSignedAgreement` is UNCHANGED — no existing partner's writes acquired a new precondition", async () => {
    const fs = await import("node:fs/promises");
    const src = await fs.readFile("server/lib/requireSignedAgreement.ts", "utf8");
    // The gate this wave added must appear NOWHERE in the 96-site write gate.
    // If a later wave wires it in, this test goes red and the reviewer reads the
    // reason above it rather than rediscovering it in production.
    expect(src.includes("compliance_attested_at")).toBe(false);
    expect(src.includes("complianceAttest")).toBe(false);
    expect(src.includes("wave217")).toBe(false);
    expect(src.includes("regulatory_status")).toBe(false);
  });

  it("no login, settings or read route acquired the gate: it exists in ONE handler only", async () => {
    const fs = await import("node:fs/promises");
    const files = [
      "server/routes.ts",
      "server/lib/partnerSelfServiceRoutes.ts",
      "server/lib/authMiddleware.ts",
      "server/lib/requirePartnerAuth.ts",
    ];
    for (const f of files) {
      const src = await fs.readFile(f, "utf8");
      expect(src.includes("verifyComplianceAttestation")).toBe(false);
    }
    const store = await fs.readFile("server/consortiumApplyStore.ts", "utf8");
    // Exactly ONE call site, in the ONE handler both public POST paths share.
    //
    // COMMENTS ARE STRIPPED FIRST, and this assertion caught itself doing it
    // wrong: the raw count is TWO, because the `publicApplySchema` comment
    // explains why zod is not the gate and names the function. A grep conclusion
    // drawn without stripping comments is not a conclusion, so the strip happens
    // here and the next two lines VERIFY THE STRIPPER STRIPPED. The subject here
    // is code, not string literals, so stripping is the right move.
    const stripped = store
      .split("\n")
      .map((l) => l.replace(/^\s*(\/\/|\*|\/\*).*$/, ""))
      .join("\n");
    expect(store.includes("Zod is NOT the gate here")).toBe(true);
    expect(stripped.includes("Zod is NOT the gate here")).toBe(false);
    const calls = stripped.split("verifyComplianceAttestation(").length - 1;
    expect(calls).toBe(1);
  });

  it("the columns are self-healed from the migration, and the gate does not depend on them", async () => {
    // The LIVE database has migrations applied only to roughly 0214, so this code
    // will reach a table without these columns. `wave217EnsureComplianceColumns`
    // reads the ALTERs out of migration 0222 and applies the missing ones,
    // idempotently — the same construction wave 211 uses for migration 0220,
    // because `server/db/connection.ts` may not be touched.
    const { wave217StorageAvailable, wave217EnsureComplianceColumns, wave217PresentColumns } =
      await import("../consortiumApplyStore");
    expect(wave217StorageAvailable()).toBe(true);
    expect(wave217PresentColumns().length).toBe(5);
    // Calling it again adds nothing: idempotent, and NOTHING IS DELETED (R195.5).
    const again = wave217EnsureComplianceColumns();
    expect(again.ok).toBe(true);
    expect(again.ok && again.added).toEqual([]);
    // Presence is INSPECTED, not cached in a boolean — a cached `true` would
    // answer "already done" for a second in-memory database that has none of
    // them. Proved structurally: the installer holds no module-level flag.
    const fs3 = await import("node:fs/promises");
    const storeSrc = await fs3.readFile("server/consortiumApplyStore.ts", "utf8");
    expect(storeSrc.includes("let w217ColumnsPresent")).toBe(false);
    // And the gate never consults the probe: it is a pure function of the request
    // body, so a database missing 0222 cannot weaken it.
    const refused = verifyComplianceAttestation({
      organizationName: ORG,
      signedName: SIGNER,
      attested: undefined,
      text: undefined,
      version: undefined,
      status: undefined,
      // NO `evidenceRef` KEY HERE, and that is the point.
      //
      // The first version of this call passed `evidenceRef: undefined`, which
      // TypeScript rejects (TS2353) because `ComplianceVerifyInput` does not
      // declare it — the root `tsc` run never saw that, because it `exclude`s
      // `**/*.test.ts`. The key was worse than useless: a reader would take it
      // as evidence that the gate inspects the licence reference. It does not,
      // deliberately. The reference is OPTIONAL (many jurisdictions issue no
      // document at all), so it is bounded by zod at
      // `server/consortiumApplyStore.ts:730` (`z.string().max(200).optional()
      // .nullable()`) and persisted at :2228 — and never gated on. The tests in
      // §6 prove the optionality behaviourally instead.
    });
    expect(refused.ok).toBe(false);
    const fs2 = await import("node:fs/promises");
    const shared = await fs2.readFile(
      "shared/wave217PartnerComplianceAttestation.ts",
      "utf8",
    );
    // Structural proof of the same thing: the gate module imports no database.
    expect(shared.includes("db/connection")).toBe(false);
    expect(shared.includes("drizzle")).toBe(false);
  });
});
