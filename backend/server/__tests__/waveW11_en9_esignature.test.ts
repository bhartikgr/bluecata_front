/**
 * WAVE 11 — proving tests for EN-9 (third-party e-signature integration for
 * LPA / subscription-document execution).
 *
 * WHAT WAS VERIFIED AT SOURCE, NOT WHERE CITED
 * --------------------------------------------
 *   The spec's absence claim ("grep docusign|esign|countersign -> zero
 *   integration hits") is re-run below as a test rather than trusted, and it is
 *   only PARTLY true: `countersign` DOES appear — as the notification kind
 *   `spv.subscription_countersigned` at server/notificationsStore.ts, listed in
 *   the admin composer, with NO PRODUCER anywhere. So EN-9 is a BUILD whose
 *   first act is to WIRE an existing reserved slot (trap #2: ten times this
 *   wave's predecessors found the thing already there).
 *
 *   The typed-name attestation at POST /api/partner/me/agreement is a REAL
 *   signing method and is asserted below to still exist and still be reachable —
 *   EN-9 keeps it as the DEFAULT provider instead of replacing it.
 *
 * ANTI-VACUITY (the WAVE 7B / DA-3 lesson: a scope fence passed against files
 * that had never existed on disk). Block 0 proves the schema is installed, that
 * an envelope round-trips, and that a signature can actually be recorded, BEFORE
 * any "must refuse" assertion runs. Every refusal test is paired with the
 * demonstration that the happy path works.
 */
import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { rawDb } from "../db/connection";
import {
  ESIGN_INTERNAL_PROVIDER,
  ESIGN_PROVIDER_CONFIG_KEY,
  EsignError,
  appendEsignEvent,
  createEnvelope,
  declineSignature,
  envelopeDetail,
  esignSchemaInstalled,
  getEnvelope,
  listEnvelopesForSubject,
  listEsignEvents,
  listEsignProviders,
  listRecipients,
  readEsignProviderConfig,
  recordSignature,
  registerEsignProvider,
  resolveEsignAdapter,
  sendEnvelope,
  voidEnvelope,
  _resetEsignProvidersForTests,
  _resetEsignSchemaGuardForTests,
} from "../lib/esignatureStore";
import {
  ensurePlatformConfigKey,
  readConfigRow,
  updatePlatformConfigValue,
} from "../lib/platformConfigWriter";

const ROOT = process.cwd();

/** Strip comments and string literals so "must not reference X" measures CODE. */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

function newEnvelope(opts: { withCounter?: boolean; sha?: string | null } = {}) {
  const subjectId = `spv_test_${randomUUID().slice(0, 8)}`;
  return createEnvelope({
    subjectKind: "spv",
    subjectId,
    documentKind: "lpa",
    documentRef: `drf_${randomUUID().slice(0, 8)}`,
    documentTitle: "Limited Partnership Agreement",
    documentSha256: opts.sha === undefined ? "a".repeat(64) : opts.sha,
    createdBy: "test",
    recipients: [
      { role: "signer", signingOrder: 1, partyKind: "lp", fullName: "Lp One", email: "lp1@example.com" },
      ...(opts.withCounter
        ? [
            {
              role: "countersigner" as const,
              signingOrder: 2,
              partyKind: "gp",
              fullName: "Gp Two",
              email: "gp2@example.com",
            },
          ]
        : []),
    ],
  });
}

beforeAll(() => {
  _resetEsignSchemaGuardForTests();
  _resetEsignProvidersForTests();
  /* A-22 self-heal: install 0168 into the :memory: db the sacred bootstrap
     built without it. */
  esignSchemaInstalled();
});

/* ==========================================================================
 * 0. ANTI-VACUITY.
 * ======================================================================== */
describe("WAVE 11 / EN-9 block 0 — the schema and the happy path are real", () => {
  it("0a: migration 0168 exists in BOTH migration dirs, byte-identical", () => {
    const a = path.join(ROOT, "migrations", "0168_wave11_esignature_envelope.sql");
    const b = path.join(ROOT, "server", "db", "migrations", "0168_wave11_esignature_envelope.sql");
    expect(fs.existsSync(a)).toBe(true);
    expect(fs.existsSync(b)).toBe(true);
    expect(fs.readFileSync(a)).toEqual(fs.readFileSync(b));
  });

  it("0b: all three tables exist after the self-heal", () => {
    expect(esignSchemaInstalled()).toBe(true);
    const db: any = rawDb();
    for (const t of ["esign_envelope", "esign_recipient", "esign_event"]) {
      const found = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(t);
      expect(found, `${t} must exist or every assertion below is vacuous`).toBeTruthy();
    }
  });

  it("0c: an envelope round-trips with its recipients and a creation event", () => {
    const env = newEnvelope({ withCounter: true });
    expect(getEnvelope(env.id)?.status).toBe("draft");
    expect(listRecipients(env.id).length).toBe(2);
    const events = listEsignEvents(env.id);
    expect(events.some((e) => e.eventKind === "envelope.created")).toBe(true);
    expect(listEnvelopesForSubject("spv", env.subjectId).map((e) => e.id)).toContain(env.id);
  });

  it("0d: the FULL happy path executes — send, sign, countersign, completed", () => {
    const env = newEnvelope({ withCounter: true });
    const sent = sendEnvelope(env.id, "test");
    expect(sent.status).toBe("sent");
    const [lp, gp] = listRecipients(env.id);
    const first = recordSignature({
      envelopeId: env.id,
      recipientId: lp.id,
      signedName: "Lp One",
    });
    expect(first.completed).toBe(false);
    expect(first.envelope.status).toBe("partially_signed");
    const second = recordSignature({
      envelopeId: env.id,
      recipientId: gp.id,
      signedName: "Gp Two",
    });
    expect(second.completed).toBe(true);
    expect(second.envelope.status).toBe("completed");
    expect(second.envelope.completionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(second.envelope.completedAt).toBeTruthy();
  });
});

/* ==========================================================================
 * 1. THE ABSENCE CLAIM, re-run at source.
 * ======================================================================== */
describe("WAVE 11 / EN-9 — the spec's absence claim, checked not quoted", () => {
  const serverFiles = walk(path.join(ROOT, "server"));
  const clientFiles = walk(path.join(ROOT, "client", "src"));

  it("1a: no third-party e-signature VENDOR was already integrated", () => {
    const vendorHits = [...serverFiles, ...clientFiles].filter((f) => {
      if (/esignature(Store|Routes)\.ts$/.test(f)) return false; /* this wave's own files */
      if (/__tests__/.test(f)) return false;
      return /docusign|adobe_?sign|hellosign|signature_request/i.test(codeOnly(fs.readFileSync(f, "utf8")));
    });
    expect(vendorHits, `unexpected vendor integration: ${vendorHits.join(", ")}`).toEqual([]);
  });

  it("1b: BUT `spv.subscription_countersigned` DID already exist as a reserved slot", () => {
    const notif = fs.readFileSync(path.join(ROOT, "server", "notificationsStore.ts"), "utf8");
    expect(notif).toContain("spv.subscription_countersigned");
  });

  it("1c: EN-9 is that slot's FIRST producer — exactly one emitNotification for it", () => {
    const producers = [...serverFiles].filter((f) => {
      if (/__tests__/.test(f)) return false;
      const src = fs.readFileSync(f, "utf8");
      /* The store DECLARES the kind; a producer CALLS emitNotification with it. */
      if (/notificationsStore\.ts$/.test(f)) return false;
      return /emitNotification\([\s\S]{0,400}?spv\.subscription_countersigned/.test(src);
    });
    expect(producers.map((f) => path.relative(ROOT, f))).toEqual([
      "server/lib/esignatureRoutes.ts",
    ]);
  });

  it("1d: the typed-name attestation EN-9 preserves still exists and is untouched", () => {
    const src = fs.readFileSync(path.join(ROOT, "server", "lib", "partnerSelfServiceRoutes.ts"), "utf8");
    expect(src).toContain('app.post(\n    "/api/partner/me/agreement"');
    expect(src).toContain("partner_agreement_signature_hash");
  });

  it("1e: the document seam EN-9 binds to really exposes a bytes hash", () => {
    const src = fs.readFileSync(path.join(ROOT, "server", "dataroomStore.ts"), "utf8");
    expect(src).toContain("export function listFilesForCompany");
    expect(src).toMatch(/sha256:\s*r\.sha256/);
  });
});

/* ==========================================================================
 * 2. THE SECOND PATH. Only this store may write these tables.
 * ======================================================================== */
describe("WAVE 11 / EN-9 — second-path check on the write sink", () => {
  it("2a: esignatureStore.ts is the ONLY file issuing writes to the esign tables", () => {
    const files = walk(path.join(ROOT, "server"));
    const writers = files.filter((f) => {
      if (/__tests__/.test(f)) return false;
      const code = codeOnly(fs.readFileSync(f, "utf8"));
      return /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+esign_(envelope|recipient|event)/i.test(code);
    });
    /* The SQL lives in template literals, which codeOnly() blanks — so re-scan
       raw text and then subtract the migration/DDL files, otherwise this test
       measures nothing (the anti-vacuity assertion below proves it does). */
    const rawWriters = files.filter((f) => {
      if (/__tests__/.test(f)) return false;
      if (/migrations/.test(f)) return false;
      return /(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+esign_(envelope|recipient|event)/i.test(
        fs.readFileSync(f, "utf8"),
      );
    });
    expect(rawWriters.length, "the scan must find at least the store itself").toBeGreaterThan(0);
    expect(rawWriters.map((f) => path.relative(ROOT, f))).toEqual([
      "server/lib/esignatureStore.ts",
    ]);
    expect(writers.length).toBe(0); /* all such SQL is in template literals */
  });

  it("2b: the routes layer never writes SQL of its own — it calls the store", () => {
    const code = codeOnly(
      fs.readFileSync(path.join(ROOT, "server", "lib", "esignatureRoutes.ts"), "utf8"),
    );
    expect(/INSERT\s+INTO/i.test(code)).toBe(false);
    expect(/UPDATE\s+esign/i.test(code)).toBe(false);
  });

  it("2c: EN-9 touches no money and no percentages", () => {
    const store = fs.readFileSync(path.join(ROOT, "server", "lib", "esignatureStore.ts"), "utf8");
    const code = codeOnly(store);
    expect(/amount_minor|amountMinor|Math\.round/.test(code)).toBe(false);
    expect(/n > 1 \? n \/ 100 : n/.test(code)).toBe(false);
  });

  it("2d: EN-9 does not touch permissions, nav or classification (PT-5 fence)", () => {
    for (const f of ["esignatureStore.ts", "esignatureRoutes.ts"]) {
      const code = codeOnly(fs.readFileSync(path.join(ROOT, "server", "lib", f), "utf8"));
      expect(/sub_?sector|sector_slug/i.test(code), `${f} must not read classification`).toBe(false);
      expect(/permissions|nav_items|role_permission/i.test(code), `${f} must not touch permissions`).toBe(false);
    }
  });
});

/* ==========================================================================
 * 3. THE PROVIDER FAILS CLOSED. Both ways.
 * ======================================================================== */
describe("WAVE 11 / EN-9 — provider resolution fails CLOSED, never downgrades", () => {
  it("3a: the provider key is DB-configured and defaults to internal attestation", () => {
    const cfg = readEsignProviderConfig();
    expect(cfg.configMissing).toBe(false);
    expect(cfg.configuredName).toBe(ESIGN_INTERNAL_PROVIDER);
    /* Not a constant in code — a real platform_config row exists. */
    const row = readConfigRow(ESIGN_PROVIDER_CONFIG_KEY);
    expect(row?.valueType).toBe("string");
    expect(JSON.parse(row!.valueJson)).toBe(ESIGN_INTERNAL_PROVIDER);
  });

  it("3b: the internal adapter is registered and configured (happy path is real)", () => {
    expect(resolveEsignAdapter().name).toBe(ESIGN_INTERNAL_PROVIDER);
    expect(listEsignProviders().some((p) => p.name === ESIGN_INTERNAL_PROVIDER && p.configured)).toBe(true);
  });

  it("3c: naming an UNKNOWN provider refuses the send — it is NOT downgraded", () => {
    updatePlatformConfigValue({
      key: ESIGN_PROVIDER_CONFIG_KEY,
      valueJson: JSON.stringify("some_vendor_nobody_registered"),
      changedBy: "test",
    });
    expect(() => resolveEsignAdapter()).toThrowError(EsignError);
    try {
      resolveEsignAdapter();
    } catch (e) {
      expect((e as EsignError).code).toBe("ESIGN_PROVIDER_UNKNOWN");
    }
    /* and no envelope can be created against it */
    expect(() => newEnvelope()).toThrowError(EsignError);
    updatePlatformConfigValue({
      key: ESIGN_PROVIDER_CONFIG_KEY,
      valueJson: JSON.stringify(ESIGN_INTERNAL_PROVIDER),
      changedBy: "test",
    });
    expect(resolveEsignAdapter().name).toBe(ESIGN_INTERNAL_PROVIDER);
  });

  it("3d: an EXTERNAL adapter with no credentials refuses — the exact fail-closed case", () => {
    registerEsignProvider({
      name: "vendor_unconfigured",
      external: true,
      isConfigured: () => false,
      send: () => ({ providerEnvelopeId: "should-never-happen" }),
    });
    updatePlatformConfigValue({
      key: ESIGN_PROVIDER_CONFIG_KEY,
      valueJson: JSON.stringify("vendor_unconfigured"),
      changedBy: "test",
    });
    let code = "";
    try {
      resolveEsignAdapter();
    } catch (e) {
      code = (e as EsignError).code;
    }
    expect(code).toBe("ESIGN_PROVIDER_UNCONFIGURED");
    updatePlatformConfigValue({
      key: ESIGN_PROVIDER_CONFIG_KEY,
      valueJson: JSON.stringify(ESIGN_INTERNAL_PROVIDER),
      changedBy: "test",
    });
  });

  it("3e: an external adapter that IS configured works, and its id is recorded", () => {
    registerEsignProvider({
      name: "vendor_ok",
      external: true,
      isConfigured: () => true,
      send: () => ({ providerEnvelopeId: `vext_${randomUUID().slice(0, 8)}` }),
    });
    updatePlatformConfigValue({
      key: ESIGN_PROVIDER_CONFIG_KEY,
      valueJson: JSON.stringify("vendor_ok"),
      changedBy: "test",
    });
    const env = newEnvelope();
    expect(env.provider).toBe("vendor_ok");
    const sent = sendEnvelope(env.id, "test");
    expect(sent.providerEnvelopeId).toMatch(/^vext_/);
    updatePlatformConfigValue({
      key: ESIGN_PROVIDER_CONFIG_KEY,
      valueJson: JSON.stringify(ESIGN_INTERNAL_PROVIDER),
      changedBy: "test",
    });
  });

  it("3f: a provider that THROWS on send marks the envelope failed with the reason", () => {
    registerEsignProvider({
      name: "vendor_throws",
      external: true,
      isConfigured: () => true,
      send: () => {
        throw new Error("gateway timeout");
      },
    });
    updatePlatformConfigValue({
      key: ESIGN_PROVIDER_CONFIG_KEY,
      valueJson: JSON.stringify("vendor_throws"),
      changedBy: "test",
    });
    const env = newEnvelope();
    expect(() => sendEnvelope(env.id, "test")).toThrowError(/gateway timeout/);
    const after = getEnvelope(env.id)!;
    /* NOT left looking like an untouched draft — the failure is on the row. */
    expect(after.status).toBe("failed");
    expect(after.lastError).toContain("gateway timeout");
    expect(listEsignEvents(env.id).some((e) => e.eventKind === "envelope.send_failed")).toBe(true);
    updatePlatformConfigValue({
      key: ESIGN_PROVIDER_CONFIG_KEY,
      valueJson: JSON.stringify(ESIGN_INTERNAL_PROVIDER),
      changedBy: "test",
    });
  });

  it("3g: an envelope is NOT re-pointed when configuration changes mid-flight", () => {
    const env = newEnvelope(); /* created under internal_attestation */
    registerEsignProvider({
      name: "vendor_later",
      external: true,
      isConfigured: () => true,
      send: () => ({ providerEnvelopeId: "x" }),
    });
    updatePlatformConfigValue({
      key: ESIGN_PROVIDER_CONFIG_KEY,
      valueJson: JSON.stringify("vendor_later"),
      changedBy: "test",
    });
    let code = "";
    try {
      sendEnvelope(env.id, "test");
    } catch (e) {
      code = (e as EsignError).code;
    }
    expect(code).toBe("ESIGN_PROVIDER_CHANGED");
    expect(getEnvelope(env.id)!.provider).toBe(ESIGN_INTERNAL_PROVIDER);
    updatePlatformConfigValue({
      key: ESIGN_PROVIDER_CONFIG_KEY,
      valueJson: JSON.stringify(ESIGN_INTERNAL_PROVIDER),
      changedBy: "test",
    });
  });
});

/* ==========================================================================
 * 4. SIGNING SEMANTICS.
 * ======================================================================== */
describe("WAVE 11 / EN-9 — signing order, immutability and the audit trail", () => {
  it("4a: a countersigner CANNOT sign before the signer", () => {
    const env = newEnvelope({ withCounter: true });
    sendEnvelope(env.id, "test");
    const [, gp] = listRecipients(env.id);
    let code = "";
    try {
      recordSignature({ envelopeId: env.id, recipientId: gp.id, signedName: "Gp Two" });
    } catch (e) {
      code = (e as EsignError).code;
    }
    expect(code).toBe("ESIGN_OUT_OF_ORDER");
    /* …and the same signature succeeds once the first party signs (proving the
       refusal is about ORDER, not about the countersigner being unable to sign). */
    const [lp] = listRecipients(env.id);
    recordSignature({ envelopeId: env.id, recipientId: lp.id, signedName: "Lp One" });
    const out = recordSignature({ envelopeId: env.id, recipientId: gp.id, signedName: "Gp Two" });
    expect(out.completed).toBe(true);
  });

  it("4b: a draft cannot be signed — it must be sent first", () => {
    const env = newEnvelope();
    const [lp] = listRecipients(env.id);
    let code = "";
    try {
      recordSignature({ envelopeId: env.id, recipientId: lp.id, signedName: "Lp One" });
    } catch (e) {
      code = (e as EsignError).code;
    }
    expect(code).toBe("ESIGN_NOT_SIGNABLE");
  });

  it("4c: the same recipient cannot sign twice", () => {
    const env = newEnvelope();
    sendEnvelope(env.id, "test");
    const [lp] = listRecipients(env.id);
    recordSignature({ envelopeId: env.id, recipientId: lp.id, signedName: "Lp One" });
    let code = "";
    try {
      recordSignature({ envelopeId: env.id, recipientId: lp.id, signedName: "Lp One" });
    } catch (e) {
      code = (e as EsignError).code;
    }
    /* single signer -> already completed, so the envelope is closed */
    expect(["ESIGN_ALREADY_SIGNED", "ESIGN_NOT_SIGNABLE"]).toContain(code);
  });

  it("4d: a recorded signature is DB-frozen (trg_w11_esign_signature_frozen)", () => {
    const env = newEnvelope();
    sendEnvelope(env.id, "test");
    const [lp] = listRecipients(env.id);
    recordSignature({ envelopeId: env.id, recipientId: lp.id, signedName: "Lp One" });
    const db: any = rawDb();
    expect(() =>
      db.prepare(`UPDATE esign_recipient SET signed_name='Someone Else' WHERE id=?`).run(lp.id),
    ).toThrowError(/ESIGN_SIGNATURE_IMMUTABLE/);
  });

  it("4e: a COMPLETED envelope cannot be re-pointed at another document", () => {
    const env = newEnvelope();
    sendEnvelope(env.id, "test");
    const [lp] = listRecipients(env.id);
    recordSignature({ envelopeId: env.id, recipientId: lp.id, signedName: "Lp One" });
    expect(getEnvelope(env.id)!.status).toBe("completed");
    const db: any = rawDb();
    expect(() =>
      db.prepare(`UPDATE esign_envelope SET document_ref='other_file' WHERE id=?`).run(env.id),
    ).toThrowError(/ESIGN_ENVELOPE_COMPLETED_IMMUTABLE/);
  });

  it("4f: a completed envelope cannot be voided", () => {
    const env = newEnvelope();
    sendEnvelope(env.id, "test");
    const [lp] = listRecipients(env.id);
    recordSignature({ envelopeId: env.id, recipientId: lp.id, signedName: "Lp One" });
    let code = "";
    try {
      voidEnvelope(env.id, "changed my mind", "test");
    } catch (e) {
      code = (e as EsignError).code;
    }
    expect(code).toBe("ESIGN_COMPLETED_CANNOT_VOID");
  });

  it("4g: an uncompleted envelope CAN be voided (so 4f is about completion)", () => {
    const env = newEnvelope();
    sendEnvelope(env.id, "test");
    expect(voidEnvelope(env.id, "superseded", "test").status).toBe("voided");
  });

  it("4h: declining closes the envelope and records the reason", () => {
    const env = newEnvelope({ withCounter: true });
    sendEnvelope(env.id, "test");
    const [lp] = listRecipients(env.id);
    const after = declineSignature({
      envelopeId: env.id,
      recipientId: lp.id,
      reason: "terms unacceptable",
      actor: "test",
    });
    expect(after.status).toBe("declined");
    expect(listRecipients(env.id)[0].declinedReason).toBe("terms unacceptable");
  });

  it("4i: the event log is DB-enforced append-only", () => {
    const env = newEnvelope();
    const ev = listEsignEvents(env.id)[0];
    const db: any = rawDb();
    expect(() => db.prepare(`UPDATE esign_event SET event_kind='x' WHERE id=?`).run(ev.id)).toThrowError(
      /ESIGN_EVENT_IMMUTABLE/,
    );
    expect(() => db.prepare(`DELETE FROM esign_event WHERE id=?`).run(ev.id)).toThrowError(
      /ESIGN_EVENT_IMMUTABLE/,
    );
  });

  it("4j: the signature hash binds the DOCUMENT BYTES — same name, different doc, different hash", () => {
    const mk = (sha: string) => {
      const env = createEnvelope({
        subjectKind: "spv",
        subjectId: `spv_${randomUUID().slice(0, 8)}`,
        documentKind: "lpa",
        documentRef: "same_ref",
        documentTitle: "LPA",
        documentSha256: sha,
        createdBy: "test",
        recipients: [
          { role: "signer", signingOrder: 1, partyKind: "lp", fullName: "Lp One", email: "lp1@example.com" },
        ],
      });
      sendEnvelope(env.id, "test");
      const [lp] = listRecipients(env.id);
      return recordSignature({ envelopeId: env.id, recipientId: lp.id, signedName: "Lp One" })
        .recipient.signatureHash;
    };
    const h1 = mk("b".repeat(64));
    const h2 = mk("c".repeat(64));
    expect(h1).not.toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("4k: an envelope with no signatory is refused (cc cannot execute a document)", () => {
    let code = "";
    try {
      createEnvelope({
        subjectKind: "spv",
        subjectId: "spv_x",
        documentKind: "lpa",
        documentRef: "r",
        documentTitle: "t",
        createdBy: "test",
        recipients: [{ role: "cc", partyKind: "observer", fullName: "Watcher", email: "w@example.com" }],
      });
    } catch (e) {
      code = (e as EsignError).code;
    }
    expect(code).toBe("ESIGN_NO_SIGNERS");
  });

  it("4l: a malformed recipient email is refused", () => {
    let code = "";
    try {
      createEnvelope({
        subjectKind: "spv",
        subjectId: "spv_x",
        documentKind: "lpa",
        documentRef: "r",
        documentTitle: "t",
        createdBy: "test",
        recipients: [{ partyKind: "lp", fullName: "Lp", email: "not-an-email" }],
      });
    } catch (e) {
      code = (e as EsignError).code;
    }
    expect(code).toBe("ESIGN_RECIPIENT_EMAIL_INVALID");
  });
});

/* ==========================================================================
 * 5. REPORTING PROJECTION.
 * ======================================================================== */
describe("WAVE 11 / EN-9 — the reporting projection states the next action", () => {
  it("5a: a sent envelope names WHO is being waited on", () => {
    const env = newEnvelope({ withCounter: true });
    sendEnvelope(env.id, "test");
    const d = envelopeDetail(env.id)!;
    expect(d.nextAction).toContain("Lp One");
    expect(d.documentHashBound).toBe(true);
  });

  it("5b: after the first signature it names the COUNTERSIGNATORY", () => {
    const env = newEnvelope({ withCounter: true });
    sendEnvelope(env.id, "test");
    const [lp] = listRecipients(env.id);
    recordSignature({ envelopeId: env.id, recipientId: lp.id, signedName: "Lp One" });
    const d = envelopeDetail(env.id)!;
    expect(d.nextAction).toMatch(/countersignature from Gp Two/i);
  });

  it("5c: an envelope with no document hash is flagged as unbound", () => {
    const env = newEnvelope({ sha: null });
    expect(envelopeDetail(env.id)!.documentHashBound).toBe(false);
  });

  it("5d: unknown envelope ids project to null, not to a fabricated record", () => {
    expect(envelopeDetail("esv_does_not_exist")).toBeNull();
  });
});

/* ==========================================================================
 * 6. ROUTES — an engine with no route is not shipped.
 * ======================================================================== */
describe("WAVE 11 / EN-9 — the routes exist, are fenced, and are registered", () => {
  const routesSrc = fs.readFileSync(path.join(ROOT, "server", "lib", "esignatureRoutes.ts"), "utf8");

  it("6a: all six endpoints are registered", () => {
    for (const p of [
      '"/api/partner/me/esignature/config"',
      '"/api/partner/me/spvs/:spvId/esignature"',
      '"/api/partner/me/esignature/:envelopeId/send"',
      '"/api/partner/me/esignature/:envelopeId/sign"',
      '"/api/partner/me/esignature/:envelopeId/decline"',
      '"/api/partner/me/esignature/:envelopeId/void"',
    ]) {
      expect(routesSrc, `${p} must be registered`).toContain(p);
    }
  });

  it("6b: every mutating endpoint is auth + subrole + signed-agreement fenced", () => {
    const mutating = routesSrc.split("app.post(").slice(1);
    expect(mutating.length).toBeGreaterThanOrEqual(5);
    for (const block of mutating) {
      const head = block.slice(0, 400);
      expect(head).toContain("requirePartnerAuth");
      expect(head).toContain("requirePartnerSubrole");
      expect(head).toContain("requireSignedAgreement");
    }
  });

  it("6c: partnerId always comes from req.partnerContext, never from the body", () => {
    const code = codeOnly(routesSrc);
    expect(code).toContain("req.partnerContext!.partnerId");
    expect(/body\.partnerId|params\.partnerId/.test(code)).toBe(false);
  });

  it("6d: ownership is resolved from spvs.partner_id and mismatches 404", () => {
    expect(routesSrc).toContain("SELECT partner_id AS partnerId, name FROM spvs");
    expect(routesSrc).toContain('res.status(404).json({ error: "not_found" })');
  });

  it("6e: NO duplicate path+method registration among LIVE registrars", () => {
    const files = walk(path.join(ROOT, "server")).filter((f) => !/__tests__/.test(f));
    const allSrc = new Map(files.map((f) => [f, fs.readFileSync(f, "utf8")]));

    /**
     * Call sites are detected LINE-WISE, skipping comment lines.
     *
     * Two whole-file stripping strategies were tried first and BOTH silently
     * corrupted the scan — exactly the failure mode this wave keeps meeting, a
     * check that looks strict and measures nothing:
     *   - codeOnly() (blanks string literals): its literal regex mis-tracks over
     *     a 6k-line file and blanked the real `registerPartnerRoutes(app)` call
     *     at server/routes.ts:966, mislabelling six LIVE routes as dormant.
     *   - block-comment stripping: a `/*` sequence inside a literal in
     *     routes.ts eats the region containing that same call.
     * Both poles of the resulting filter are asserted at the end of this test.
     */
    const isCommentLine = (l: string) => /^\s*(\/\/|\*|\/\*)/.test(l);
    const callsIn = (src: string, name: string): boolean =>
      src.split("\n").some((l) => !isCommentLine(l) && new RegExp(`\\b${name}\\s*\\(`).test(l));

    function isLive(file: string, src: string): boolean {
      const decls = Array.from(src.matchAll(/export function (register\w+)\s*\(/g)).map((m) => m[1]);
      if (decls.length === 0) return true; /* routes declared at module top level */
      return decls.some((name) => {
        for (const [other, osrc] of allSrc) {
          if (other === file) continue;
          if (callsIn(osrc, name)) return true;
        }
        return false;
      });
    }

    const seen = new Map<string, string[]>();
    const dormant: string[] = [];
    for (const f of files) {
      const src = allSrc.get(f)!;
      const re = /app\.(get|post|patch|put|delete)\(\s*"(\/api\/partner\/me\/(?:esignature|spvs)[^"]*)"/g;
      let m: RegExpExecArray | null;
      const live = isLive(f, src);
      while ((m = re.exec(src))) {
        const key = `${m[1].toUpperCase()} ${m[2]}`;
        if (!live) {
          dormant.push(`${key} (${path.relative(ROOT, f)})`);
          continue;
        }
        seen.set(key, [...(seen.get(key) ?? []), path.relative(ROOT, f)]);
      }
    }

    expect(seen.size, "the scan must find this wave's routes or it proves nothing").toBeGreaterThan(0);
    expect(
      Array.from(seen.keys()).some((k) => k.includes("/esignature")),
      "the EN-9 routes must be inside the LIVE set",
    ).toBe(true);
    const dupes = Array.from(seen.entries()).filter(([, v]) => v.length > 1);
    expect(dupes, `duplicate LIVE registrations: ${JSON.stringify(dupes)}`).toEqual([]);

    /**
     * A FINDING, recorded as an assertion. `server/spvFundStore.ts` declares
     * ten partner SPV routes inside `registerSpvFundRoutes`, which is DEFINED
     * AND NEVER INVOKED in the server tree — server/routes.ts:1171 replaced it
     * with `registerSpvLegacyAdapterRoutes`. Those declarations are dormant, not
     * duplicate. If somebody re-mounts that registrar, `dupes` above turns red
     * and this expectation turns red too, which is the point.
     */
    expect(dormant.length, "the live-registrar filter must actually exclude something").toBeGreaterThan(0);
    expect(
      dormant.every((d) => d.includes("spvFundStore.ts")),
      `unexpected dormant set: ${dormant.join(" | ")}`,
    ).toBe(true);
    /* The filter's two poles, asserted directly, so it cannot rot into "all live"
       or "all dormant" without a test noticing. */
    const routesRaw = allSrc.get(path.join(ROOT, "server", "routes.ts"))!;
    expect(callsIn(routesRaw, "registerPartnerRoutes"), "a LIVE registrar must be seen").toBe(true);
    expect(callsIn(routesRaw, "registerSpvFundRoutes"), "a DORMANT registrar must not be seen").toBe(
      false,
    );
  });


  it("6f: registered in server/routes.ts (an engine with no route is not shipped)", () => {
    const src = fs.readFileSync(path.join(ROOT, "server", "routes.ts"), "utf8");
    expect(src).toContain('import { registerEsignatureRoutes } from "./lib/esignatureRoutes"');
    expect(src).toContain("registerEsignatureRoutes(app)");
  });

  it("6g: the UI exists — the twelfth SpvDetailTabs tab renders the panel", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "client", "src", "components", "partner", "SpvDetailTabs.tsx"),
      "utf8",
    );
    expect(src).toContain('<TabsTrigger value="esignature"');
    expect(src).toContain('<TabsContent value="esignature">');
    expect(src).toContain("EsignaturePanel");
    /* the panel must actually call the endpoint, not just exist */
    expect(src).toContain("/esignature`");
    /* and the eleven pre-existing tabs must all still be there */
    for (const t of [
      "overview",
      "mandate",
      "fees",
      "lps",
      "deployments",
      "distributions",
      "documents",
      "transfers",
      "close",
      "winddown",
      "compliance",
    ]) {
      expect(src, `tab ${t} must not have been dropped`).toContain(`<TabsTrigger value="${t}"`);
    }
  });
});

/* ==========================================================================
 * 7. THE CONFIG GENESIS PATH this wave added.
 * ======================================================================== */
describe("WAVE 11 / EN-9 — new config keys go through the audited genesis path", () => {
  it("7a: ensurePlatformConfigKey creates a chain-valid row a plain INSERT cannot", () => {
    const key = `wave11.test.${randomUUID().slice(0, 8)}`;
    const db: any = rawDb();
    /* A plain INSERT is refused by the sacred trigger — proving the helper is
       doing something a caller could not do by hand. */
    expect(() =>
      db
        .prepare(
          `INSERT INTO platform_config (key,value_json,value_type,version,prev_revision_hash,revision_hash,created_at,updated_at)
           VALUES (?,'"x"','string',1,'0','0',?,?)`,
        )
        .run(key, new Date().toISOString(), new Date().toISOString()),
    ).toThrowError(/PLATFORM_CONFIG_UNAUDITED_INSERT|PLATFORM_CONFIG_HISTORY/);

    const row = ensurePlatformConfigKey({
      key,
      valueJson: JSON.stringify("hello"),
      valueType: "string",
      description: "test",
      createdBy: "test",
    });
    expect(row.version).toBe(1);
    expect(row.prevRevisionHash).toBe("0".repeat(64));
    /* and it is then UPDATABLE through the audited writer */
    const after = updatePlatformConfigValue({ key, valueJson: JSON.stringify("world"), changedBy: "test" });
    expect(after.version).toBe(2);
    expect(after.prevRevisionHash).toBe(row.revisionHash);
  });

  it("7b: ensurePlatformConfigKey is IDEMPOTENT (A-22: the bootstrap re-runs)", () => {
    const key = `wave11.test.idem.${randomUUID().slice(0, 8)}`;
    const a = ensurePlatformConfigKey({
      key,
      valueJson: "5",
      valueType: "number",
      description: "test",
      createdBy: "test",
    });
    const b = ensurePlatformConfigKey({
      key,
      valueJson: "9",
      valueType: "number",
      description: "test",
      createdBy: "test",
    });
    expect(b.version).toBe(1);
    expect(b.valueJson).toBe(a.valueJson); /* the second call does NOT overwrite */
  });

  it("7c: a value that disagrees with its declared type is refused", () => {
    expect(() =>
      ensurePlatformConfigKey({
        key: `wave11.test.bad.${randomUUID().slice(0, 8)}`,
        valueJson: '"a string"',
        valueType: "number",
        description: "test",
        createdBy: "test",
      }),
      /* The CODE is the contract; the message is prose. */
    ).toThrowError(/Declared 'number'/);
    let code = "";
    try {
      ensurePlatformConfigKey({
        key: `wave11.test.bad2.${randomUUID().slice(0, 8)}`,
        valueJson: '"a string"',
        valueType: "number",
        description: "test",
        createdBy: "test",
      });
    } catch (e) {
      code = (e as { code?: string }).code ?? "";
    }
    expect(code).toBe("CONFIG_VALUE_TYPE_MISMATCH");
  });
});

/* ==========================================================================
 * 8. The event helper is not a bypass.
 * ======================================================================== */
describe("WAVE 11 / EN-9 — appendEsignEvent cannot fabricate a status", () => {
  it("8a: appending an event does NOT move the envelope's status", () => {
    const env = newEnvelope();
    appendEsignEvent({
      envelopeId: env.id,
      eventKind: "test.note",
      toStatus: "completed",
      actor: "test",
    });
    /* The event records a claim; the ROW is what the system believes. */
    expect(getEnvelope(env.id)!.status).toBe("draft");
    expect(getEnvelope(env.id)!.completionHash).toBeNull();
  });
});
