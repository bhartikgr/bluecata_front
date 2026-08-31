/**
 * WAVE 195 · POST-BUILD REVIEW PASS (c) — ADVERSARIAL.
 *
 * The brief does not ask whether the happy paths work; the other two wave-195
 * test files answer that. It asks for two specific attacks:
 *
 *   "actively try to make a post-declaration commit silently become USD"
 *   "actively try to mutate a declared row"
 *
 * Every case below is written to WIN, not to pass. Where an attack succeeds in
 * reaching the sacred handler, the test records that honestly rather than
 * loosening the assertion — see X1h.
 *
 * Nothing here is a duplicate of the C-series. C3/C5c prove the ordinary
 * refusal; this file assumes an attacker who knows exactly how the pre-router
 * decides, and aims at each of those decisions in turn:
 *
 *   X1  make a post-declaration commit silently become USD
 *       a  state USD in the body and hope the pre-router yields to it
 *       b  state it in lower case, padded, so a naive trim/compare misses
 *       c  hand the round a blank / whitespace currency instead of NULL
 *       d  send `currency` as a non-string so a `typeof` check falls through
 *       e  hit the path with a case-shifted / trailing-slash URL to miss the mount
 *       f  hit the batch and batch-v2 twins with a stated USD
 *       g  pre-stage the queue row with USD already on it
 *       h  omit / mistype `roundId` so the pre-router hands the request back
 *       i  repeat a refused request, in case refusal state is not idempotent
 *   X2  mutate a declared row
 *       a  replay an invitation id, which is the commit row's primary key
 *       b  find any write against `captable_commits` anywhere in wave 195
 *       c  overwrite the declaration itself and check the rows it describes
 *       d  delete the declaration row
 *       e  the sacred chain still verifies, and the whole table is byte-identical
 *          to what it was when this file started
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
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
  COMMIT_CURRENCY_DECLARATION_KEY,
} from "../lib/wave195CommitCurrencyDeclaration";

let app: Express;
let server: http.Server;
let port: number;

type CallResponse = { status: number; body: any };

function call(method: string, path: string, body?: unknown): Promise<CallResponse> {
  return new Promise((resolve, reject) => {
    const data = body !== undefined ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = { "x-user-id": "u_admin" };
    if (data) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(data));
    }
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

/** Every column of every commit row, hashed. One changed byte changes this. */
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
    `W195X ${input.id}`,
    "priced",
    "open",
    1000000,
    0,
    input.currency,
    input.createdAt,
    input.createdAt,
  );
}

const CO = "co_w195x";
let uniq = 0;
function inv(): string {
  uniq += 1;
  return `inv_w195x_${uniq}_${randomBytes(4).toString("hex")}`;
}

/** A commit body deliberately missing `currency`, so each case adds its own. */
function body(roundId: unknown, extra?: Record<string, unknown>) {
  return {
    invitationId: inv(),
    roundId,
    companyId: CO,
    investorId: "inv_actor_w195x",
    amount: "50000",
    shares: "1000",
    ...(extra ?? {}),
  };
}

let effectiveAt = "";
let declaredCurrency = "";
/** Post-declaration rounds. Every one of these MUST refuse. */
let postNull = "";
let postBlank = "";
let postSpaces = "";
/** The whole-file immutability baseline. */
let fileStartFingerprint: { count: number; hash: string; maxSeq: number };

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
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
  effectiveAt = d!.effectiveAt;
  declaredCurrency = d!.declaredCurrency;

  const after = new Date(Date.parse(effectiveAt) + 86_400_000).toISOString();
  postNull = `rnd_w195x_null_${randomBytes(3).toString("hex")}`;
  postBlank = `rnd_w195x_blank_${randomBytes(3).toString("hex")}`;
  postSpaces = `rnd_w195x_sp_${randomBytes(3).toString("hex")}`;
  insertRound({ id: postNull, companyId: CO, currency: null, createdAt: after });
  insertRound({ id: postBlank, companyId: CO, currency: "", createdAt: after });
  insertRound({ id: postSpaces, companyId: CO, currency: "   ", createdAt: after });

  fileStartFingerprint = commitFingerprint();
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Asserts: the call did not write a commit row, and changed none. */
function expectNothingWritten(before: { count: number; hash: string }): void {
  const after = commitFingerprint();
  expect(after.count).toBe(before.count);
  expect(after.hash).toBe(before.hash);
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* X1 — MAKE A POST-DECLARATION COMMIT SILENTLY BECOME USD                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("W195 X1 — attacking the refusal, trying to get a silent USD", () => {
  it("X1a — stating USD in the body does not buy a commit on a post-declaration round", async () => {
    const before = commitFingerprint();
    const r = await call(
      "POST",
      "/api/founder/captable/commit-funded",
      body(postNull, { currency: "USD" }),
    );
    /* The attacker's own USD must not be treated as the missing fact. The round
       is the authority on the round's currency, and it has none. */
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("ROUND_CURRENCY_NOT_SET");
    expectNothingWritten(before);
  });

  it("X1b — lower case and padding do not slip past the check", async () => {
    const before = commitFingerprint();
    for (const attempt of ["usd", " USD ", "\tusd\n", "UsD"]) {
      const r = await call(
        "POST",
        "/api/founder/captable/commit-funded",
        body(postNull, { currency: attempt }),
      );
      expect(r.status).toBe(409);
      expect(r.body.error).toBe("ROUND_CURRENCY_NOT_SET");
    }
    expectNothingWritten(before);
  });

  it("X1c — a BLANK or WHITESPACE round currency is an absence, not a value", async () => {
    /* The obvious hole in a `currency ?? default` world: a round row that holds
       "" or "   " is not NULL, so a naive nullish check reads it as present and
       the empty string flows on to become whatever the store makes of it. */
    const before = commitFingerprint();
    for (const roundId of [postBlank, postSpaces]) {
      const r = await call("POST", "/api/founder/captable/commit-funded", body(roundId));
      expect(r.status).toBe(409);
      expect(r.body.error).toBe("ROUND_CURRENCY_NOT_SET");
      expect(r.body.roundId).toBe(roundId);
    }
    expectNothingWritten(before);
  });

  it("X1d — a non-string `currency` does not fall through into a default", async () => {
    const before = commitFingerprint();
    const hostiles: unknown[] = [0, 1, null, true, ["USD"], { toString: "USD" }, { v: "USD" }];
    for (const currency of hostiles) {
      const r = await call(
        "POST",
        "/api/founder/captable/commit-funded",
        body(postNull, { currency }),
      );
      expect(r.status).toBe(409);
      expect(r.body.error).toBe("ROUND_CURRENCY_NOT_SET");
    }
    expectNothingWritten(before);
  });

  it("X1e — URL shape games do not route around the mount", async () => {
    /* Express matching is case-insensitive and tolerant of a trailing slash by
       default, so a mount that only catches the exact literal path would be
       trivially bypassable. Both the pre-router and the sacred handler are
       registered with the same style, so either both match or neither does —
       and "neither" must not mean "committed". */
    const before = commitFingerprint();
    const variants = [
      "/api/founder/captable/commit-funded/",
      "/API/Founder/Captable/Commit-Funded",
      "/api/founder/captable/commit-funded?force=usd",
    ];
    for (const path of variants) {
      const r = await call("POST", path, body(postNull));
      /* Either the pre-router caught it (409) or the route does not exist at
         all (404). What must never happen is 200-with-a-commit. */
      expect([404, 409]).toContain(r.status);
      if (r.status === 409) expect(r.body.error).toBe("ROUND_CURRENCY_NOT_SET");
    }
    expectNothingWritten(before);
  });

  it("X1f — the batch path refuses even with USD staged and USD stated", async () => {
    const before = commitFingerprint();
    const invitationId = inv();
    /* `funded_queue.currency` is NOT NULL, so a staged row ALWAYS claims some
       currency — there is no "absent" case to stage. That makes the attack
       sharper, not weaker: the row asserts USD and is still refused. */
    enqueueFunded({
      invitationId,
      companyId: CO,
      roundId: postNull,
      investorId: "inv_actor_w195x",
      amount: "50000",
      currency: "USD",
      shares: "1000",
    } as never);
    const r = await call("POST", "/api/founder/captable/commit-funded-batch", {
      companyId: CO,
      roundId: postNull,
      currency: "USD",
    });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.error).toBe("ROUND_CURRENCY_NOT_SET");
    /* The queue row survives untouched — a refusal is not a silent discard. */
    expect(getFundedQueue().some((e) => e.invitationId === invitationId)).toBe(true);
    expectNothingWritten(before);
  });

  it("X1f2 — the DORMANT v2 twin refuses too, on its own `entries` shape", async () => {
    /* The v2 registrar reads an `entries` array off the body rather than the
       funded queue, and carries its OWN `: "USD"` (captableCommitV2548.ts:174).
       Sending it a well-formed batch is the only way to reach that line, so that
       is what is sent. A body without `entries` is handed back and the v2 handler
       answers with its own 422 attestation error — measured, and NOT counted here
       as a refusal, because it proves nothing about currency. */
    const before = commitFingerprint();
    const r = await call("POST", "/api/founder/captable/commit-funded-batch-v2", {
      companyId: CO,
      roundId: postNull,
      attestation: true,
      attested: true,
      entries: [
        {
          invitationId: inv(),
          roundId: postNull,
          companyId: CO,
          investorId: "inv_actor_w195x",
          amount: "50000",
          shares: "1000",
          currency: "USD",
        },
      ],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(409);
    expect(r.body.error).toBe("ROUND_CURRENCY_NOT_SET");
    expect(r.body.entryIndex).toBe(0);
    expectNothingWritten(before);
  });

  it("X1g — a queue row PRE-STAGED with USD is still refused", async () => {
    /* The batch handler reads the currency off the queue row, so the sharpest
       attack is to put USD there before the pre-router ever looks. The
       pre-router asks the ROUND, not the row, so the row's claim is worthless. */
    const before = commitFingerprint();
    const invitationId = inv();
    enqueueFunded({
      invitationId,
      companyId: CO,
      roundId: postNull,
      investorId: "inv_actor_w195x",
      amount: "50000",
      shares: "1000",
      currency: "USD",
    } as never);
    expect(
      getFundedQueue().find((e) => e.invitationId === invitationId)?.currency,
    ).toBe("USD");
    const r = await call("POST", "/api/founder/captable/commit-funded-batch", {
      companyId: CO,
      roundId: postNull,
    });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("ROUND_CURRENCY_NOT_SET");
    expectNothingWritten(before);
  });

  it("X1h — a MISSING or MISTYPED roundId never produces a committed row", async () => {
    /* THIS ATTACK SUCCEEDED ON THE FIRST BUILD, AND THE BUILD WAS CHANGED.
       The pre-router originally handed back every request it could not read a
       string `roundId` from (`if (!companyId || !roundId) return next()`), on the
       reasoning that inventing a 400 would take a response away from the sacred
       handler. Measured reality, printed below on every run:
         undefined -> 400   null -> 400   "" -> 400        (sacred handler's own)
         12345     -> 200   ["r"] -> 200                   (COMMITTED. Defaulted.)
       Those two wrote commit rows whose currency came from the `?? "USD"` line
       this wave exists to starve, and whose round reference did not round-trip,
       so `verifyChain()` reported the ledger BROKEN afterwards.
       `unusableRoundReference()` now refuses a present-but-non-string round
       reference with 409 ROUND_REFERENCE_UNUSABLE, while absent/empty ids are
       still left to the sacred handler's own 400. Both classes are asserted here,
       so neither can silently swap places later. */
    const before = commitFingerprint();
    const attempts: unknown[] = [undefined, null, "", 12345, ["r"], { id: "r" }];
    const observed: Array<{ sent: string; status: number }> = [];
    for (const roundId of attempts) {
      const payload: Record<string, unknown> = body(roundId, { currency: "USD" });
      if (roundId === undefined) delete payload.roundId;
      const r = await call("POST", "/api/founder/captable/commit-funded", payload);
      observed.push({ sent: JSON.stringify(roundId) ?? "undefined", status: r.status });
    }
    /* Printed so the report can state WHICH input produced WHICH status rather
       than describing the class of inputs vaguely. */
    console.log("[X1h] roundId variants ->", JSON.stringify(observed));
    observed.forEach((o) => expect(o.status).toBeGreaterThanOrEqual(400));
    /* And specifically: the two shapes that used to commit now REFUSE, named. */
    for (const roundId of [12345, ["r"], { id: "r" }] as unknown[]) {
      const r = await call(
        "POST",
        "/api/founder/captable/commit-funded",
        body(roundId, { currency: "USD" }),
      );
      expect(r.status).toBe(409);
      expect(r.body.error).toBe("ROUND_REFERENCE_UNUSABLE");
      expect(String(r.body.missingFact)).toContain("identifier");
      expect(String(r.body.message).length).toBeLessThan(240);
    }
    /* And the ledger is untouched by all of them together. */
    expectNothingWritten(before);
    expect(observed.length).toBe(attempts.length);
  });

  it("X1i — repeating a refused request stays refused and writes nothing", async () => {
    const before = commitFingerprint();
    for (let i = 0; i < 4; i += 1) {
      const r = await call("POST", "/api/founder/captable/commit-funded", body(postNull));
      expect(r.status).toBe(409);
      expect(r.body.error).toBe("ROUND_CURRENCY_NOT_SET");
    }
    expectNothingWritten(before);
  });

  it("X1j — no refusal ever names a currency instead of the missing fact", async () => {
    const r = await call("POST", "/api/founder/captable/commit-funded", body(postNull));
    expect(r.status).toBe(409);
    const text = `${r.body.message} ${r.body.missingFact}`;
    /* If a refusal mentioned USD it would be inviting the reader to assume it. */
    expect(text).not.toMatch(/USD/i);
    expect(String(r.body.missingFact)).toMatch(/currenc/i);
    expect(String(r.body.message).length).toBeLessThan(240);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* X2 — MUTATE A DECLARED ROW                                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("W195 X2 — attacking immutability of the rows the declaration describes", () => {
  it("X2a — replaying an invitation id cannot overwrite the commit it created", async () => {
    /* The commit row's id is `ccm_${sha256(invitationId).slice(0,16)}`, so a
       replayed invitation targets an EXISTING primary key. If the store used an
       upsert anywhere, this is where a declared row would be quietly rewritten. */
    const legacy = `rnd_w195x_legacy_${randomBytes(3).toString("hex")}`;
    insertRound({
      id: legacy,
      companyId: CO,
      currency: null,
      createdAt: new Date(Date.parse(effectiveAt) - 86_400_000).toISOString(),
    });
    const invitationId = inv();
    const first = await call("POST", "/api/founder/captable/commit-funded", {
      ...body(legacy),
      invitationId,
    });
    expect(first.status).toBe(200);
    const afterFirst = commitFingerprint();
    const row = getLedger().find((e) => e.invitationId === invitationId);
    expect(row).toBeTruthy();
    expect(row!.currency).toBe(declaredCurrency);

    /* Now replay it, with a different amount and a different currency, which is
       what an attacker would send if they wanted to rewrite the row. */
    const replay = await call("POST", "/api/founder/captable/commit-funded", {
      ...body(legacy),
      invitationId,
      amount: "999999",
      currency: "JPY",
    });
    expect(replay.status).toBeGreaterThanOrEqual(400);
    /* The decisive assertion: the row is byte-identical and no row was added. */
    const afterReplay = commitFingerprint();
    expect(afterReplay.hash).toBe(afterFirst.hash);
    expect(afterReplay.count).toBe(afterFirst.count);
    const rowAgain = getLedger().find((e) => e.invitationId === invitationId);
    expect(rowAgain!.currency).toBe(declaredCurrency);
    expect(String(rowAgain!.amount)).toBe(String(row!.amount));
  });

  it("X2b — wave 195 contains no write of any kind against `captable_commits`", () => {
    /* Comments are stripped FIRST, and the stripper is then verified to have
       actually stripped, because a grep conclusion drawn over comment text is
       worthless — this module's comments discuss `UPDATE captable_commits` in
       prose precisely to explain why it never does one. */
    const files = [
      "server/lib/wave195CommitCurrencyDeclaration.ts",
      "server/wave195CommitCurrencyRoutes.ts",
    ];
    for (const rel of files) {
      const src = readFileSync(rel, "utf8");
      const stripped = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      /* PROVE THE STRIPPER STRIPPED: the file has block comments, and a known
         comment-only phrase must be gone afterwards. */
      expect(src).toContain("/*");
      expect(stripped.length).toBeLessThan(src.length);
      /* CHOOSING THE WITNESS IS ITSELF A TRAP, AND TWO CANDIDATES FAILED FIRST.
         `R167` occurs in real code here (a `rulingRef` value) and `the owner`
         occurs inside refusal strings, so neither disappears when comments go.
         `SACRED` in capitals occurs in these two files ONLY inside comments, so
         its absence afterwards proves the stripper actually ran. */
      expect(src).toContain("SACRED");
      expect(stripped).not.toContain("SACRED");

      const dml =
        /\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM|ALTER\s+TABLE|REPLACE\s+INTO)\s+[A-Za-z_"'`]/gi;
      const statements = stripped.match(dml) ?? [];
      /* Any DML at all in these two files would need justifying; none may name
         the commit table. */
      const touchesCommits = stripped
        .split("\n")
        .filter((l) => /captable_commits/i.test(l))
        .filter((l) => dml.test(l));
      expect(touchesCommits).toEqual([]);
      expect(statements.filter((s) => /captable_commits/i.test(s))).toEqual([]);
    }
  });

  it("X2c — overwriting the declaration does not touch a single row it describes", () => {
    /* The declaration is a statement ABOUT the rows. So even a hostile rewrite
       of the statement must leave the rows alone — which is the property that
       makes "declare, do not backfill" meaningful. */
    const db: any = rawDb();
    const before = commitFingerprint();
    const original = db
      .prepare(`SELECT value_json, version FROM platform_config WHERE key = ?`)
      .get(COMMIT_CURRENCY_DECLARATION_KEY) as { value_json: string; version: number };
    expect(original).toBeTruthy();

    let blocked = false;
    try {
      db.prepare(`UPDATE platform_config SET value_json = ? WHERE key = ?`).run(
        JSON.stringify({ declaredCurrency: "JPY", tampered: true }),
        COMMIT_CURRENCY_DECLARATION_KEY,
      );
    } catch {
      /* A trigger may refuse the untracked write outright, which is a stronger
         result than the one being asserted. */
      blocked = true;
    }
    /* Either way — refused, or written — the commit rows are unchanged. */
    expectNothingWritten(before);

    /* Put it back exactly as it was, and confirm byte equality. */
    if (!blocked) {
      db.prepare(`UPDATE platform_config SET value_json = ? WHERE key = ?`).run(
        original.value_json,
        COMMIT_CURRENCY_DECLARATION_KEY,
      );
    }
    const restored = db
      .prepare(`SELECT value_json FROM platform_config WHERE key = ?`)
      .get(COMMIT_CURRENCY_DECLARATION_KEY) as { value_json: string };
    expect(restored.value_json).toBe(original.value_json);
    expect(readCommitCurrencyDeclaration()).not.toBeNull();
    expectNothingWritten(before);
  });

  it("X2d — the declaration row cannot be deleted", () => {
    const db: any = rawDb();
    const before = commitFingerprint();
    let refused = false;
    try {
      db.prepare(`DELETE FROM platform_config WHERE key = ?`).run(
        COMMIT_CURRENCY_DECLARATION_KEY,
      );
    } catch {
      refused = true;
    }
    /* `trg_pc_no_delete` (sacred `server/db/connection.ts`) is what makes the
       declaration durable rather than merely present. */
    expect(refused).toBe(true);
    expect(readCommitCurrencyDeclaration()).not.toBeNull();
    expectNothingWritten(before);
  });

  it("X2e — the sacred chain verifies, and the table is as this file found it plus only appends", () => {
    expect(verifyChain().ok).toBe(true);
    const now = commitFingerprint();
    /* Rows may have been APPENDED by X2a. None may have been removed, and the
       original prefix must be untouched — checked by re-hashing only the rows
       that existed when this file started. */
    expect(now.count).toBeGreaterThanOrEqual(fileStartFingerprint.count);
    const db: any = rawDb();
    const rows = db
      .prepare(`SELECT * FROM captable_commits ORDER BY seq ASC, id ASC`)
      .all() as Array<Record<string, unknown>>;
    const h = createHash("sha256");
    rows.slice(0, fileStartFingerprint.count).forEach((r) => {
      Object.keys(r)
        .sort()
        .forEach((k) => h.update(`${k}=${String(r[k])}\u0000`));
      h.update("\u0001");
    });
    expect(h.digest("hex")).toBe(fileStartFingerprint.hash);
  });
});
