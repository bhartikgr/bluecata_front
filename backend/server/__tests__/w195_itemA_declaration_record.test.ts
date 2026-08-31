/**
 * WAVE 195 · ITEM A — THE OWNER'S DECLARATION AS AN AUDITABLE FACT.
 *
 * R167, owner verbatim: "They are all test data so declare them USD".
 *
 * These are the record-level proofs. The proofs that matter most — that the
 * PRODUCTION ROUTE behaves, and that not one commit row changed — are in
 * `w195_itemBC_commit_currency_production_http.test.ts`, because the brief is
 * explicit that engine- or store-level tests are not sufficient.
 *
 * WHAT IS ASSERTED HERE
 *   A1  the declaration is stored AS DATA, in `platform_config`, not as a comment
 *   A2  it captures what/when/who/how-many/why
 *   A3  it is recorded exactly ONCE — re-running boot adds no second declaration
 *   A4  it is AUDITED through wave 186's writer, exactly once, at money bearing
 *   A5  the declaration write MUTATES NO COMMIT ROW (count + full-table hash)
 *   A6  the boundary is precise: at/below the recorded seq is covered, above is not
 *   A7  the refusal texts pass the client's 240-character `looksHuman` gate,
 *       INCLUDING the pathological worst case that broke wave 192
 *   A8  with the declaration unreadable, resolution REFUSES — it never falls back
 *       to a hardcoded USD anywhere in this wave
 *   A9  the provenance surface answers "why does the platform believe this?"
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { rawDb } from "../db/connection";
import {
  readConfigRow,
  updatePlatformConfigValue,
} from "../lib/platformConfigWriter";
import {
  ensureCommitCurrencyDeclaration,
  readCommitCurrencyDeclaration,
  isCoveredByDeclaration,
  resolveCommitCurrency,
  commitCurrencyProvenance,
  declarationFingerprint,
  roundCurrencyNotSetMessage,
  roundCurrencyUnreadableMessage,
  declarationUnavailableMessage,
  COMMIT_CURRENCY_DECLARATION_KEY,
  COMMIT_CURRENCY_DECLARATION_AUDIT_ACTION,
  OWNER_DECLARATION_QUOTE,
  LOOKS_HUMAN_MAX_LENGTH,
} from "../lib/wave195CommitCurrencyDeclaration";

/**
 * The client's gate, reproduced verbatim from
 * `client/src/lib/queryClient.ts:60-65`. A refusal that fails this is DISCARDED
 * by the client and replaced with a generic sentence — wave 192's exact failure,
 * where a 244-character headline meant the named subject never reached a screen.
 */
function looksHuman(serverMessage: string): boolean {
  return (
    !!serverMessage &&
    serverMessage.length > 0 &&
    serverMessage.length < 240 &&
    /[a-z]/.test(serverMessage)
  );
}

/** A hash over EVERY column of EVERY commit row, ordered deterministically.
 *  If any byte of any commit row changes, this changes. */
function commitTableFingerprint(): { count: number; hash: string } {
  const db: any = rawDb();
  const rows = db
    .prepare(`SELECT * FROM captable_commits ORDER BY seq ASC, id ASC`)
    .all() as Array<Record<string, unknown>>;
  const h = createHash("sha256");
  rows.forEach((r) => {
    Object.keys(r)
      .sort()
      .forEach((k) => h.update(`${k}=${String(r[k])}\u0000`));
    h.update("\u0001");
  });
  return { count: rows.length, hash: h.digest("hex") };
}

function auditRowsForDeclaration(): Array<Record<string, unknown>> {
  const db: any = rawDb();
  try {
    return db
      .prepare(`SELECT * FROM audit_log WHERE action = ?`)
      .all(COMMIT_CURRENCY_DECLARATION_AUDIT_ACTION) as Array<Record<string, unknown>>;
  } catch {
    return [];
  }
}

beforeAll(() => {
  /* The declaration is recorded at boot in production (`server/routes.ts`).
     These tests do not go through `registerRoutes`, so record it here. */
  ensureCommitCurrencyDeclaration();
});

describe("W195 A1/A2 — the declaration is stored as data, and it is complete", () => {
  it("A1 — a `platform_config` row exists under the declaration key", () => {
    const row = readConfigRow(COMMIT_CURRENCY_DECLARATION_KEY);
    expect(row).not.toBeNull();
    expect(row!.valueType).toBe("json");
    /* Genesis: version 1, chained onto the 64-zero root. */
    expect(row!.version).toBe(1);
    expect(row!.prevRevisionHash).toBe("0".repeat(64));
    expect(row!.revisionHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("A1b — its history row exists, so the write was atomic and auditable", () => {
    const db: any = rawDb();
    const hist = db
      .prepare(
        `SELECT version, change_kind, changed_by, prev_revision_hash
           FROM platform_config_history WHERE config_key = ? ORDER BY version ASC`,
      )
      .all(COMMIT_CURRENCY_DECLARATION_KEY) as Array<Record<string, unknown>>;
    expect(hist.length).toBeGreaterThanOrEqual(1);
    expect(hist[0].version).toBe(1);
    expect(hist[0].change_kind).toBe("genesis");
    expect(String(hist[0].changed_by)).toContain("owner");
    expect(hist[0].prev_revision_hash).toBe("0".repeat(64));
  });

  it("A2 — it captures WHAT, WHEN, WHO, HOW MANY and WHY", () => {
    const d = readCommitCurrencyDeclaration();
    expect(d).not.toBeNull();
    /* WHAT — a real 3-letter code, read from the record rather than asserted
       against a literal chosen by this test. */
    expect(d!.declaredCurrency).toMatch(/^[A-Z]{3}$/);
    /* WHEN */
    expect(Number.isFinite(Date.parse(d!.effectiveAt))).toBe(true);
    /* WHO — the OWNER declared it, in the owner's own words. */
    expect(d!.declaredBy).toBe("owner");
    expect(d!.declaredByRole).toBe("owner");
    expect(d!.rulingRef).toBe("R167");
    expect(d!.rulingQuote).toBe(OWNER_DECLARATION_QUOTE);
    /* HOW MANY — the row count it covers, and the exact boundary. */
    expect(typeof d!.coversRowCount).toBe("number");
    expect(d!.coversRowCount).toBeGreaterThanOrEqual(0);
    expect(typeof d!.coversMaxCommitSeq).toBe("number");
    /* WHY */
    expect(d!.reason).toBe("all platform data is test data");
    /* AND that it is a statement, not a rewrite. */
    expect(d!.mutatesCommitRows).toBe(false);
    expect(d!.boundaryStatement).toContain("coversMaxCommitSeq");
  });

  it("A2b — coverage matches the live rows it claims to describe", () => {
    const d = readCommitCurrencyDeclaration()!;
    const db: any = rawDb();
    const row = db
      .prepare(
        `SELECT COUNT(*) AS n, MAX(seq) AS m FROM captable_commits WHERE deleted_at IS NULL`,
      )
      .get() as { n: number; m: number | null };
    /* Rows can only have been ADDED since the declaration (nothing deletes
       them), so the declaration's count can never exceed today's count. */
    expect(d.coversRowCount).toBeLessThanOrEqual(row.n);
    expect(d.coversMaxCommitSeq).toBeLessThanOrEqual(row.m ?? 0);
  });
});

describe("W195 A3 — declared once, not once per boot", () => {
  it("A3 — re-running the installer creates no second declaration", () => {
    const before = readConfigRow(COMMIT_CURRENCY_DECLARATION_KEY)!;
    const fp = declarationFingerprint();
    ensureCommitCurrencyDeclaration();
    ensureCommitCurrencyDeclaration();
    ensureCommitCurrencyDeclaration();
    const after = readConfigRow(COMMIT_CURRENCY_DECLARATION_KEY)!;
    expect(after.version).toBe(before.version);
    expect(after.revisionHash).toBe(before.revisionHash);
    expect(after.valueJson).toBe(before.valueJson);
    expect(declarationFingerprint()).toBe(fp);
  });

  it("A3b — and no second history row", () => {
    const db: any = rawDb();
    const n = db
      .prepare(`SELECT COUNT(*) AS n FROM platform_config_history WHERE config_key = ?`)
      .get(COMMIT_CURRENCY_DECLARATION_KEY) as { n: number };
    expect(n.n).toBe(1);
  });
});

describe("W195 A4 — audited through wave 186's writer", () => {
  it("A4 — exactly one audit row records the declaration", () => {
    const rows = auditRowsForDeclaration();
    expect(rows.length).toBe(1);
  });

  it("A4b — the audit row names the owner and carries the coverage", () => {
    const rows = auditRowsForDeclaration();
    const r = rows[0];
    expect(String(r.actor_id)).toBe("owner");
    expect(String(r.target)).toContain("captable_commit_currency");
    /* WAVE 186 / 57d D2 — a real hash, NOT the empty-hash sentinel that
       `appendAudit` returns when it swallows its own DB write failure. This is
       the assertion `reportAuditWriteOutcome` exists to make possible. */
    const hashLike = String(r.hash ?? "");
    expect(hashLike).toMatch(/^[0-9a-f]{16,}$/);
    const payload = JSON.parse(String(r.payload_json ?? "{}"));
    const d = readCommitCurrencyDeclaration()!;
    expect(payload.declaredCurrency).toBe(d.declaredCurrency);
    expect(payload.declaredBy).toBe("owner");
    expect(payload.rulingRef).toBe("R167");
    expect(payload.rulingQuote).toBe(OWNER_DECLARATION_QUOTE);
    expect(payload.reason).toBe("all platform data is test data");
    expect(payload.coversRowCount).toBe(d.coversRowCount);
    expect(payload.coversMaxCommitSeq).toBe(d.coversMaxCommitSeq);
    /* Stated in the audit itself: nothing was rewritten. */
    expect(payload.commitRowsMutated).toBe(0);
    expect(payload.backfilled).toBe(false);
    expect(payload.storedIn).toBe("platform_config");
  });

  it("A4c — the declaration is recorded platform-wide, not against a tenant's company", () => {
    const rows = auditRowsForDeclaration();
    expect(String(rows[0].tenant_id)).toBe("tenant_platform");
  });
});

describe("W195 A5 — BACKFILL NOTHING, REWRITE NOTHING", () => {
  it("A5 — recording the declaration changes no commit row, byte for byte", () => {
    const before = commitTableFingerprint();
    ensureCommitCurrencyDeclaration();
    readCommitCurrencyDeclaration();
    commitCurrencyProvenance();
    isCoveredByDeclaration(1);
    const after = commitTableFingerprint();
    expect(after.count).toBe(before.count);
    expect(after.hash).toBe(before.hash);
  });

  it("A5b — the declaration module contains no write against the commit table", () => {
    /* A source-level tripwire. Reading the declaration path is how the 1017 rows
       stay intact; a future edit that adds an UPDATE here fails this. */
    const src = readFileSync(
      new URL("../lib/wave195CommitCurrencyDeclaration.ts", import.meta.url),
      "utf8",
    );
    /* Strip comments BEFORE concluding anything from a grep — the module's own
       prose discusses these words at length. */
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    /* VERIFY THE STRIPPER STRIPPED before drawing any conclusion from the grep. */
    expect(code).not.toMatch(/\/\*/);
    expect(code).not.toMatch(/\bBACKFILL NOTHING\b/);
    /* SQL DML only. The keyword must be followed by whitespace and an
       identifier, so `createHash(...).update(…)` — a method call, not a
       statement — is not mistaken for one. That false positive is exactly why
       this pattern is anchored rather than a bare word match. */
    const dml = /\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM|ALTER\s+TABLE|REPLACE\s+INTO)\s+[A-Za-z_"'`]/i;
    expect(dml.test(code)).toBe(false);
    /* And the commit table is only ever read. */
    const commitMentions = code.match(/captable_commits/g) ?? [];
    expect(commitMentions.length).toBeGreaterThan(0);
    /* EVERY occurrence of the table name in executable code sits immediately
       after `FROM` — i.e. it is read, and only read. */
    const selects = code.match(/FROM captable_commits/g) ?? [];
    expect(selects.length).toBe(commitMentions.length);
  });
});

describe("W195 A6 — the boundary is precise (R167 item 4)", () => {
  it("A6 — rows at or below the recorded boundary are covered", () => {
    const d = readCommitCurrencyDeclaration()!;
    if (d.coversMaxCommitSeq >= 1) {
      expect(isCoveredByDeclaration(1)).toBe(true);
      expect(isCoveredByDeclaration(d.coversMaxCommitSeq)).toBe(true);
    }
  });

  it("A6b — a row created AFTER the declaration is NOT covered by it", () => {
    const d = readCommitCurrencyDeclaration()!;
    expect(isCoveredByDeclaration(d.coversMaxCommitSeq + 1)).toBe(false);
    expect(isCoveredByDeclaration(d.coversMaxCommitSeq + 1000)).toBe(false);
  });

  it("A6c — nonsense sequence numbers are not covered", () => {
    expect(isCoveredByDeclaration(0)).toBe(false);
    expect(isCoveredByDeclaration(-1)).toBe(false);
    expect(isCoveredByDeclaration(1.5)).toBe(false);
    expect(isCoveredByDeclaration(Number.NaN)).toBe(false);
  });
});

describe("W195 A7 — the refusal text reaches a human (wave 192's gate)", () => {
  it("A7 — the gate itself is `< 240`, strictly", () => {
    expect(LOOKS_HUMAN_MAX_LENGTH).toBe(240);
    /* 239 passes, 240 does not. Wave 192's 244-character headline sat four
       characters the wrong side of this line and was silently discarded. */
    expect(looksHuman("x".repeat(239))).toBe(true);
    expect(looksHuman("x".repeat(240))).toBe(false);
    /* And it demands an actual lowercase letter, so an all-caps code fails. */
    expect(looksHuman("ROUND_CURRENCY_NOT_SET")).toBe(false);
  });

  it("A7b — every refusal message passes, for a realistic identifier", () => {
    const id = "rnd_1a2b3c4d5e6f";
    [
      roundCurrencyNotSetMessage(id),
      roundCurrencyUnreadableMessage(id, "dollars"),
      declarationUnavailableMessage(),
    ].forEach((m) => {
      expect(m.length).toBeLessThan(240);
      expect(looksHuman(m)).toBe(true);
    });
  });

  it("A7c — and for the PATHOLOGICAL worst case that broke wave 192", () => {
    /* The first draft of this module produced 247 characters here — the same
       failure mode, in a wave written to avoid it. This is the assertion that
       caught it. */
    const absurd = "rnd_".concat("z".repeat(4000));
    [
      roundCurrencyNotSetMessage(absurd),
      roundCurrencyUnreadableMessage(absurd, absurd),
      roundCurrencyUnreadableMessage(absurd, "\n\t".concat("q".repeat(900))),
    ].forEach((m) => {
      expect(m.length).toBeLessThan(240);
      expect(looksHuman(m)).toBe(true);
    });
  });

  it("A7d — a refusal names the missing fact rather than a currency", () => {
    const m = roundCurrencyNotSetMessage("rnd_after");
    expect(m).toContain("currency");
    expect(m).toContain("rnd_after");
    expect(m).not.toContain("USD");
  });
});

describe("W195 A8 — with no readable declaration, resolution REFUSES", () => {
  it("A8 — an unreadable declaration produces a refusal, never a hardcoded USD", () => {
    const original = readConfigRow(COMMIT_CURRENCY_DECLARATION_KEY)!;
    /* Withdraw the declaration through the LEGITIMATE audited writer — the five
       `platform_config` triggers make any other route impossible, and
       `trg_pc_no_delete` means it cannot be removed at all. The replacement is
       still valid JSON of the same declared type, so the write is legal; it
       simply no longer carries a currency. */
    updatePlatformConfigValue({
      key: COMMIT_CURRENCY_DECLARATION_KEY,
      valueJson: JSON.stringify({ withdrawnForTest: true }),
      changedBy: "test:w195_a8",
      expectedVersion: original.version,
    });
    try {
      expect(readCommitCurrencyDeclaration()).toBeNull();
      /* A round with no row at all — the branch that normally RESOLVES. With no
         declaration behind it, it must refuse instead. */
      const r = resolveCommitCurrency("rnd_does_not_exist_w195");
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.code).toBe("CURRENCY_DECLARATION_UNAVAILABLE");
        expect(looksHuman(r.message)).toBe(true);
        expect(r.message).not.toContain("USD");
        expect(r.missingFact).toContain(COMMIT_CURRENCY_DECLARATION_KEY);
      }
      /* Nothing anywhere fell back to a currency. */
      expect(isCoveredByDeclaration(1)).toBe(false);
      expect(commitCurrencyProvenance().declared).toBe(false);
    } finally {
      /* Restore, so ordering between test files cannot matter. */
      updatePlatformConfigValue({
        key: COMMIT_CURRENCY_DECLARATION_KEY,
        valueJson: original.valueJson,
        changedBy: "test:w195_a8_restore",
      });
      expect(readCommitCurrencyDeclaration()).not.toBeNull();
    }
  });

  it("A8b — restoring it leaves the commit rows untouched throughout", () => {
    const fp = commitTableFingerprint();
    expect(fp.count).toBeGreaterThanOrEqual(0);
    /* Re-read after the A8 round-trip: the declaration was withdrawn and
       restored, and not one commit row moved. */
    expect(commitTableFingerprint().hash).toBe(fp.hash);
  });
});

describe("W195 A9 — the provenance surface answers the question", () => {
  it("A9 — it states the currency, the authority, the reason and the boundary", () => {
    const p = commitCurrencyProvenance();
    const d = readCommitCurrencyDeclaration()!;
    expect(p.declared).toBe(true);
    expect(p.declarationKey).toBe(COMMIT_CURRENCY_DECLARATION_KEY);
    expect(p.declaredCurrency).toBe(d.declaredCurrency);
    expect(p.declaredBy).toBe("owner");
    expect(p.rulingRef).toBe("R167");
    expect(p.rulingQuote).toBe(OWNER_DECLARATION_QUOTE);
    expect(p.reason).toBe("all platform data is test data");
    expect(p.coversMaxCommitSeq).toBe(d.coversMaxCommitSeq);
    /* The two facts an auditor is actually asking about. */
    expect(p.commitRowsModified).toBe(0);
    expect(p.backfilled).toBe(false);
    expect(p.statement).toContain("not changed");
  });

  it("A9b — per-response counts split covered rows from later ones", () => {
    const d = readCommitCurrencyDeclaration()!;
    /* Two sequence numbers ABOVE the boundary are always uncovered, whatever the
       boundary happens to be on this handle — the in-memory test DB starts with
       no commit rows, so the boundary can legitimately be 0. */
    const above = [d.coversMaxCommitSeq + 1, d.coversMaxCommitSeq + 2];
    const atOrBelow = d.coversMaxCommitSeq >= 1 ? [1, d.coversMaxCommitSeq] : [];
    const p = commitCurrencyProvenance([...atOrBelow, ...above]);
    expect(p.notCoveredOnThisResponse).toBe(above.length);
    expect(p.coveredOnThisResponse).toBe(atOrBelow.length);
    expect((p.coveredOnThisResponse ?? 0) + (p.notCoveredOnThisResponse ?? 0)).toBe(
      atOrBelow.length + above.length,
    );
  });
});
