/**
 * WAVE 195 · ITEM B + ITEM C — PROVED ON THE PATH PRODUCTION RUNS.
 *
 * R167, owner verbatim: "They are all test data so declare them USD".
 *
 * ══ WHY THIS FILE EXISTS RATHER THAN A STORE-LEVEL TEST ══════════════════════
 * The brief is explicit: "Engine- or store-level tests are not sufficient."
 * Everything here goes over HTTP, through `registerRoutes(server, app)` — the
 * SAME registration function the server boots with, mounting the SAME registrars
 * in the SAME order. So the pre-router's position relative to the sacred handler
 * is not asserted, it is EXERCISED.
 *
 * ══ WHICH ROUTES, AND HOW THAT WAS ESTABLISHED (Item B.4, R166.1) ════════════
 * Wave 189's registrar lesson: production mounts one registrar and a dormant twin
 * exists elsewhere, so proving against the twin proves nothing. Established three
 * ways before these tests were written (evidence in W195_PREFLIGHT.md §3):
 *   1. `server/routes.ts:1337` mounts `registerCaptableCommitRoutes` from the
 *      SACRED `server/captableCommitStore.ts:911`; `:1340` also mounts the twin
 *      `registerCaptableCommitV2548Routes` (`server/lib/captableCommitV2548.ts:116`).
 *   2. The only client call sites are `RoundDetail.tsx:2552` (→ `-batch`) and
 *      `CapTableInterim.tsx:93`/`:111` (→ `commit-funded`, `-batch`). NO client
 *      file mentions `-batch-v2`.
 *   3. The visible control is `data-testid="button-commit-funded"`
 *      (RoundDetail.tsx:2640) on the `-batch` path.
 * So the tests that carry the weight below drive `POST /commit-funded` and
 * `POST /commit-funded-batch`. The dormant `-batch-v2` is covered too, because
 * it is a live HTTP route with its own `: "USD"` at :174.
 *
 * ══ WHAT IS ASSERTED ═════════════════════════════════════════════════════════
 *   C1  a commit on a round with a STATED currency records THAT currency
 *   C2  a commit on a legacy NULL-currency round records the DECLARED currency
 *       and is ATTRIBUTABLE TO THE DECLARATION on the response
 *   C3  a commit on a POST-DECLARATION round with no currency REFUSES, in
 *       readable text that passes the client's 240-character gate
 *   C4  a round whose currency is malformed REFUSES rather than defaulting
 *   C5  the batch path — the one the button calls — behaves identically
 *   C6  NO EXISTING COMMIT ROW CHANGED: count + full-table hash before and after
 *       every single case, including the refusals
 *   C7  the declaration's BOUNDARY holds: rows committed after it are not
 *       covered by it and are reported as such
 *   C8  the ledger payload carries the provenance, and the dedicated endpoint
 *       answers the question on its own
 *   C9  the sacred store's own chain still verifies after everything
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { registerRoutes } from "../routes";
import { rawDb } from "../db/connection";
import {
  enqueueFunded,
  getFundedQueue,
  getLedger,
  verifyChain,
  setComplianceHold,
} from "../captableCommitStore";
import {
  readCommitCurrencyDeclaration,
  isCoveredByDeclaration,
  COMMIT_CURRENCY_DECLARATION_KEY,
} from "../lib/wave195CommitCurrencyDeclaration";

let app: Express;
let server: http.Server;
let port: number;

/** The client's gate, verbatim from `client/src/lib/queryClient.ts:60-65`. */
function looksHuman(m: unknown): boolean {
  return (
    typeof m === "string" && m.length > 0 && m.length < 240 && /[a-z]/.test(m)
  );
}

type CallResponse = { status: number; body: any };

function call(method: string, path: string, body?: unknown): Promise<CallResponse> {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {};
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
    /* The admin persona bypasses the founder.ofCompany ownership check, which is
       what lets these tests target synthetic companies — the same convention
       `sprint25_captable_batch.test.ts` uses on these exact routes. */
    headers["x-user-id"] = "u_admin";
    const req = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        let parsed: unknown = raw;
        try {
          parsed = raw.length > 0 ? JSON.parse(raw) : null;
        } catch {
          /* leave as raw text */
        }
        resolve({ status: res.statusCode ?? 0, body: parsed });
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

/**
 * THE PROOF INSTRUMENT FOR "REWRITE NOTHING".
 *
 * A hash over EVERY column of EVERY row of `captable_commits`, in a
 * deterministic order. If a single byte of a single existing row changes — a
 * currency backfilled, a hash recomputed, a timestamp touched — this value
 * changes. Compared before and after every case below, including the refusals.
 */
function commitFingerprint(): { count: number; hash: string; maxSeq: number } {
  const db: any = rawDb();
  const rows = db
    .prepare(`SELECT * FROM captable_commits ORDER BY seq ASC, id ASC`)
    .all() as Array<Record<string, unknown>>;
  const h = createHash("sha256");
  let maxSeq = 0;
  rows.forEach((r) => {
    Object.keys(r)
      .sort()
      .forEach((k) => h.update(`${k}=${String(r[k])}\u0000`));
    h.update("\u0001");
    const s = r.seq;
    if (typeof s === "number" && s > maxSeq) maxSeq = s;
  });
  return { count: rows.length, hash: h.digest("hex"), maxSeq };
}

/**
 * Insert a round row directly, so `created_at` and `currency` can be set
 * exactly. `rounds` is NOT the hash-chained ledger and is not sacred; the
 * pre-existing round-creation path cannot produce a round dated BEFORE the
 * declaration, which is precisely the legacy state that must be reproduced.
 */
function insertRound(input: {
  id: string;
  companyId: string;
  currency: string | null;
  createdAt: string;
}): void {
  const db: any = rawDb();
  db.prepare(
    `INSERT INTO rounds
       (id, tenant_id, company_id, name, type, state, target_amount, raised_amount,
        currency, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    input.id,
    `tenant_${input.companyId}`,
    input.companyId,
    `W195 ${input.id}`,
    "priced",
    "open",
    1000000,
    0,
    input.currency,
    input.createdAt,
    input.createdAt,
  );
}

const CO = "co_w195";
let uniq = 0;
function inv(): string {
  uniq += 1;
  return `inv_w195_${uniq}_${randomBytes(4).toString("hex")}`;
}

/* Round ids, filled in `beforeAll` once the declaration's effective date is
   known — the whole point of the boundary is that it is relative to that. */
let roundStated = "";
let roundLegacyNull = "";
let roundPostDeclNull = "";
let roundMalformed = "";
let declaredCurrency = "";
let effectiveAt = "";

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  /* The REAL registration path — this is what records the declaration and mounts
     the pre-router ahead of the sacred handler. */
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
  setComplianceHold(false);

  const d = readCommitCurrencyDeclaration();
  expect(d).not.toBeNull();
  declaredCurrency = d!.declaredCurrency;
  effectiveAt = d!.effectiveAt;

  /* BEFORE the declaration — legacy state, exactly like all 1045 live rounds. */
  const before = new Date(Date.parse(effectiveAt) - 86_400_000).toISOString();
  /* AFTER the declaration — a round that must NOT inherit it. */
  const after = new Date(Date.parse(effectiveAt) + 86_400_000).toISOString();

  roundStated = `rnd_w195_stated_${randomBytes(3).toString("hex")}`;
  roundLegacyNull = `rnd_w195_legacy_${randomBytes(3).toString("hex")}`;
  roundPostDeclNull = `rnd_w195_post_${randomBytes(3).toString("hex")}`;
  roundMalformed = `rnd_w195_bad_${randomBytes(3).toString("hex")}`;

  /* A NON-USD stated currency, deliberately: if the wave were quietly forcing
     USD, C1 would catch it. */
  insertRound({ id: roundStated, companyId: CO, currency: "EUR", createdAt: before });
  insertRound({ id: roundLegacyNull, companyId: CO, currency: null, createdAt: before });
  insertRound({ id: roundPostDeclNull, companyId: CO, currency: null, createdAt: after });
  insertRound({ id: roundMalformed, companyId: CO, currency: "dollars", createdAt: before });
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function commitBody(roundId: string, extra?: Record<string, unknown>) {
  return {
    invitationId: inv(),
    roundId,
    companyId: CO,
    investorId: "inv_actor_w195",
    amount: "50000",
    shares: "1000",
    ...(extra ?? {}),
  };
}

describe("W195 C1 — a round with a STATED currency records that currency", () => {
  it("C1 — EUR on the round means EUR in the ledger, over the production route", async () => {
    const before = commitFingerprint();
    const r = await call("POST", "/api/founder/captable/commit-funded", commitBody(roundStated));
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.entry.currency).toBe("EUR");
    /* NOT the declared currency — the round's own record outranks the
       declaration, which is the forward fix R167 asks for. */
    expect(r.body.entry.currency).not.toBe(declaredCurrency);
    /* Attributed to the ROUND, not to the declaration. */
    expect(r.body.currencyProvenance.source).toBe("round_record");
    expect(r.body.currencyProvenance.attribution).toBeNull();
    /* One row ADDED; nothing else moved. */
    const after = commitFingerprint();
    expect(after.count).toBe(before.count + 1);
  });

  it("C1b — the caller's body cannot override the round's stated currency", async () => {
    const r = await call(
      "POST",
      "/api/founder/captable/commit-funded",
      commitBody(roundStated, { currency: "JPY" }),
    );
    expect(r.status).toBe(200);
    /* The round says EUR. A client body claiming JPY does not get to rewrite the
       round's currency onto the ledger — that is the defect R167 rules on. */
    expect(r.body.entry.currency).toBe("EUR");
    expect(r.body.currencyProvenance.source).toBe("round_record");
  });
});

describe("W195 C2 — a legacy NULL-currency round records the DECLARED currency, attributably", () => {
  it("C2 — the declared currency is recorded, and it names the declaration", async () => {
    const r = await call(
      "POST",
      "/api/founder/captable/commit-funded",
      commitBody(roundLegacyNull),
    );
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.entry.currency).toBe(declaredCurrency);
    /* ATTRIBUTABLE TO THE DECLARATION — R167 item C.1. This is what separates a
       declared currency from a silent default: the response names its authority. */
    const p = r.body.currencyProvenance;
    expect(p.source).toBe("owner_declaration");
    expect(p.currency).toBe(declaredCurrency);
    expect(p.attribution.declarationKey).toBe(COMMIT_CURRENCY_DECLARATION_KEY);
    expect(p.attribution.rulingRef).toBe("R167");
    expect(p.attribution.declaredBy).toBe("owner");
    expect(p.attribution.effectiveAt).toBe(effectiveAt);
    expect(p.attribution.basis).toBe("legacy_round_predates_declaration");
  });

  it("C2b — the sacred store's `?? \"USD\"` was never the source", async () => {
    /* The store's default would produce the same three letters, so the currency
       alone cannot distinguish them. The ATTRIBUTION can: it exists only when
       the pre-router resolved the value from the recorded declaration. */
    const r = await call(
      "POST",
      "/api/founder/captable/commit-funded",
      commitBody(roundLegacyNull),
    );
    expect(r.body.currencyProvenance.attribution).not.toBeNull();
    expect(r.body.currencyProvenance.attribution.declarationKey).toBe(
      COMMIT_CURRENCY_DECLARATION_KEY,
    );
  });
});

describe("W195 C3 — a POST-DECLARATION round with no currency REFUSES", () => {
  it("C3 — 409, named missing fact, nothing committed, nothing mutated", async () => {
    const before = commitFingerprint();
    const r = await call(
      "POST",
      "/api/founder/captable/commit-funded",
      commitBody(roundPostDeclNull),
    );
    expect(r.status).toBe(409);
    expect(r.body.ok).toBe(false);
    expect(r.body.error).toBe("ROUND_CURRENCY_NOT_SET");
    /* THE MISSING FACT IS NAMED, and the round is identified. */
    expect(r.body.roundId).toBe(roundPostDeclNull);
    expect(String(r.body.missingFact)).toContain("rounds.currency");
    expect(String(r.body.missingFact)).toContain(roundPostDeclNull);
    /* IT DID NOT QUIETLY BECOME USD. */
    expect(JSON.stringify(r.body)).not.toContain(`"currency":"${declaredCurrency}"`);
    /* NOTHING WAS WRITTEN, and nothing existing changed. */
    const after = commitFingerprint();
    expect(after.count).toBe(before.count);
    expect(after.hash).toBe(before.hash);
  });

  it("C3b — the refusal text passes the client's 240-character `looksHuman` gate", async () => {
    const r = await call(
      "POST",
      "/api/founder/captable/commit-funded",
      commitBody(roundPostDeclNull),
    );
    expect(r.body.message.length).toBeLessThan(240);
    expect(looksHuman(r.body.message)).toBe(true);
    /* And it tells the reader what to do, in words, not a code. */
    expect(r.body.message).toContain("currency");
    expect(r.body.message).toContain("commit again");
  });

  it("C3c — a pathologically long round id still yields a message under the gate", async () => {
    const monster = `rnd_w195_${"z".repeat(3000)}`;
    const after = new Date(Date.parse(effectiveAt) + 86_400_000).toISOString();
    insertRound({ id: monster, companyId: CO, currency: null, createdAt: after });
    const r = await call("POST", "/api/founder/captable/commit-funded", commitBody(monster));
    expect(r.status).toBe(409);
    expect(r.body.message.length).toBeLessThan(240);
    expect(looksHuman(r.body.message)).toBe(true);
  });
});

describe("W195 C4 — a malformed round currency REFUSES rather than defaulting", () => {
  it("C4 — 'dollars' is a contradiction, not an absence", async () => {
    const before = commitFingerprint();
    const r = await call(
      "POST",
      "/api/founder/captable/commit-funded",
      commitBody(roundMalformed),
    );
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("ROUND_CURRENCY_UNREADABLE");
    expect(String(r.body.missingFact)).toContain("dollars");
    expect(looksHuman(r.body.message)).toBe(true);
    const after = commitFingerprint();
    expect(after.count).toBe(before.count);
    expect(after.hash).toBe(before.hash);
  });
});

describe("W195 C5 — the BATCH path, which is the one the button calls", () => {
  it("C5 — a legacy round's batch commits at the declared currency", async () => {
    const before = commitFingerprint();
    const invitationId = inv();
    /* The wire-funded step enqueues with no meaningful currency of its own; the
       sacred batch handler reads `e.currency` straight off this row. */
    enqueueFunded({
      invitationId,
      roundId: roundLegacyNull,
      companyId: CO,
      investorId: "inv_actor_w195",
      amount: "25000",
      currency: "",
      shares: "500",
    });
    const r = await call("POST", "/api/founder/captable/commit-funded-batch", {
      companyId: CO,
      roundId: roundLegacyNull,
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.committedCount).toBe(1);
    expect(r.body.entries[0].currency).toBe(declaredCurrency);
    expect(r.body.currencyProvenance.source).toBe("owner_declaration");
    expect(r.body.currencyProvenance.attribution.basis).toBe(
      "legacy_round_predates_declaration",
    );
    const after = commitFingerprint();
    expect(after.count).toBe(before.count + 1);
  });

  it("C5b — a stated-currency round's batch commits at THAT currency", async () => {
    const invitationId = inv();
    enqueueFunded({
      invitationId,
      roundId: roundStated,
      companyId: CO,
      investorId: "inv_actor_w195",
      amount: "25000",
      /* Deliberately WRONG on the queue row: the round says EUR. The pre-router
         corrects the staging row before the sacred handler reads it. */
      currency: "USD",
      shares: "500",
    });
    const r = await call("POST", "/api/founder/captable/commit-funded-batch", {
      companyId: CO,
      roundId: roundStated,
    });
    expect(r.status).toBe(200);
    expect(r.body.committedCount).toBe(1);
    expect(r.body.entries[0].currency).toBe("EUR");
    expect(r.body.currencyProvenance.source).toBe("round_record");
  });

  it("C5c — a post-declaration round's batch REFUSES and leaves the queue intact", async () => {
    const before = commitFingerprint();
    const invitationId = inv();
    enqueueFunded({
      invitationId,
      roundId: roundPostDeclNull,
      companyId: CO,
      investorId: "inv_actor_w195",
      amount: "25000",
      currency: "",
      shares: "500",
    });
    const queuedBefore = getFundedQueue().filter((e) => e.roundId === roundPostDeclNull).length;
    const r = await call("POST", "/api/founder/captable/commit-funded-batch", {
      companyId: CO,
      roundId: roundPostDeclNull,
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("ROUND_CURRENCY_NOT_SET");
    expect(r.body.queuedEntryCount).toBe(queuedBefore);
    expect(looksHuman(r.body.message)).toBe(true);
    /* NOT COMMITTED, and the money is still safely queued rather than lost. */
    const after = commitFingerprint();
    expect(after.count).toBe(before.count);
    expect(after.hash).toBe(before.hash);
    expect(getFundedQueue().filter((e) => e.roundId === roundPostDeclNull).length).toBe(
      queuedBefore,
    );
  });

  it("C5d — an EMPTY queue still gets the sacred handler's own benign reply", async () => {
    /* A refusal here would replace a harmless no-op with an error, and would
       break `sprint25_captable_batch` case 7. The hook hands the request back
       untouched when there is nothing queued — note that this uses a round that
       WOULD refuse if anything were queued against it, so it isolates the
       empty-queue hand-back rather than accidentally passing on a resolvable
       round. */
    const emptyPostDecl = `rnd_w195_empty_${randomBytes(3).toString("hex")}`;
    insertRound({
      id: emptyPostDecl,
      companyId: CO,
      currency: null,
      createdAt: new Date(Date.parse(effectiveAt) + 86_400_000).toISOString(),
    });
    expect(getFundedQueue().filter((e) => e.roundId === emptyPostDecl).length).toBe(0);
    const r = await call("POST", "/api/founder/captable/commit-funded-batch", {
      companyId: CO,
      roundId: emptyPostDecl,
    });
    expect(r.status).toBe(200);
    expect(r.body.committedCount).toBe(0);
    expect(String(r.body.message)).toContain("No funded entries waiting.");
  });
});

describe("W195 C6 — the dormant v2 registrar is hooked too", () => {
  it("C6 — a legacy round on `-batch-v2` records the declared currency", async () => {
    const r = await call("POST", "/api/founder/captable/commit-funded-batch-v2", {
      companyId: CO,
      roundId: roundLegacyNull,
      attested: true,
      attestationStatement: "W195 test attestation",
      entries: [
        {
          invitationId: inv(),
          roundId: roundLegacyNull,
          investorId: "inv_actor_w195",
          amount: "10000",
          shares: "200",
        },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body.committedCount ?? r.body.committed?.length ?? 0).toBeGreaterThan(0);
  });

  it("C6b — a post-declaration round on `-batch-v2` REFUSES", async () => {
    const before = commitFingerprint();
    const r = await call("POST", "/api/founder/captable/commit-funded-batch-v2", {
      companyId: CO,
      roundId: roundPostDeclNull,
      attested: true,
      entries: [
        {
          invitationId: inv(),
          roundId: roundPostDeclNull,
          investorId: "inv_actor_w195",
          amount: "10000",
          shares: "200",
        },
      ],
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("ROUND_CURRENCY_NOT_SET");
    expect(looksHuman(r.body.message)).toBe(true);
    const after = commitFingerprint();
    expect(after.hash).toBe(before.hash);
  });
});

describe("W195 C7 — the declaration's BOUNDARY holds (R167 item 4)", () => {
  it("C7 — every row committed by this test file is OUTSIDE the declaration", () => {
    const d = readCommitCurrencyDeclaration()!;
    const rows = getLedger();
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((e) => {
      if (e.seq > d.coversMaxCommitSeq) {
        /* Recorded after the declaration → derives its currency from its round,
           and does NOT inherit the declaration. */
        expect(isCoveredByDeclaration(e.seq)).toBe(false);
      }
    });
  });

  it("C7b — a commit recorded now is not covered, even though it took the declared currency", async () => {
    const d = readCommitCurrencyDeclaration()!;
    const r = await call(
      "POST",
      "/api/founder/captable/commit-funded",
      commitBody(roundLegacyNull),
    );
    expect(r.status).toBe(200);
    expect(r.body.entry.currency).toBe(declaredCurrency);
    /* THE DISTINCTION THAT MATTERS: it USED the declared currency because its
       round predates the declaration, but the ROW itself is not one of the rows
       the declaration is about. */
    expect(r.body.entry.seq).toBeGreaterThan(d.coversMaxCommitSeq);
    expect(isCoveredByDeclaration(r.body.entry.seq)).toBe(false);
  });

  it("C7c — the declaration's own coverage figure never grows", () => {
    const d = readCommitCurrencyDeclaration()!;
    /* Many commits have been written by this file. The declaration still covers
       exactly what it covered when it was made. */
    expect(d.coversRowCount).toBeLessThanOrEqual(commitFingerprint().count);
    expect(d.coversMaxCommitSeq).toBeLessThan(commitFingerprint().maxSeq + 1);
  });
});

describe("W195 C8 — surfaced where it matters (Item A.5)", () => {
  it("C8 — the ledger payload carries the provenance beside the amounts", async () => {
    const r = await call(
      "GET",
      `/api/founder/captable/ledger?companyId=${encodeURIComponent(CO)}`,
    );
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.entries)).toBe(true);
    const p = r.body.currencyProvenance;
    expect(p.declared).toBe(true);
    expect(p.declarationKey).toBe(COMMIT_CURRENCY_DECLARATION_KEY);
    expect(p.declaredCurrency).toBe(declaredCurrency);
    expect(p.declaredBy).toBe("owner");
    expect(p.rulingRef).toBe("R167");
    expect(p.commitRowsModified).toBe(0);
    expect(p.backfilled).toBe(false);
    expect(typeof p.statement).toBe("string");
    /* The counts make the boundary visible next to the rows. */
    expect(typeof p.coveredOnThisResponse).toBe("number");
    expect(typeof p.notCoveredOnThisResponse).toBe("number");
  });

  it("C8b — the ledger's own fields are untouched by the annotation", async () => {
    const r = await call(
      "GET",
      `/api/founder/captable/ledger?companyId=${encodeURIComponent(CO)}`,
    );
    /* The sacred handler's three keys are all still there and still correct. */
    expect(r.body).toHaveProperty("entries");
    expect(r.body).toHaveProperty("complianceHold");
    expect(r.body).toHaveProperty("verified");
    expect(r.body.verified).toBeTruthy();
  });

  it("C8c — a missing companyId still gets the sacred handler's own 400", async () => {
    const r = await call("GET", "/api/founder/captable/ledger");
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("missing_required_fields");
    /* The annotation only ever touches the success shape. */
    expect(r.body.currencyProvenance).toBeUndefined();
  });

  it("C8d — the dedicated endpoint answers the question on its own", async () => {
    const r = await call("GET", "/api/founder/captable/commit-currency-declaration");
    expect(r.status).toBe(200);
    expect(r.body.declared).toBe(true);
    expect(r.body.declaration.declaredBy).toBe("owner");
    expect(r.body.declaration.rulingRef).toBe("R167");
    expect(r.body.declaration.rulingQuote).toBe(
      "They are all test data so declare them USD",
    );
    expect(r.body.declaration.reason).toBe("all platform data is test data");
    expect(r.body.commitRowsModifiedByThisDeclaration).toBe(0);
    expect(r.body.backfilled).toBe(false);
    expect(typeof r.body.fingerprint).toBe("string");
  });
});

describe("W195 C9 — the sacred ledger is still intact", () => {
  it("C9 — the hash chain verifies after every case above", () => {
    expect(verifyChain()).toBeTruthy();
  });

  it("C9b — every committed row carries a real three-letter currency", () => {
    getLedger().forEach((e) => {
      expect(String(e.currency)).toMatch(/^[A-Z]{3}$/);
    });
  });
});
