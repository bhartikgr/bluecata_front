/**
 * WAVE 197 · ITEM A — THE MEMBER-FACING LEAK, PROVED CLOSED OVER HTTP.
 *
 * R169, owner verbatim: "I don't want any exposure of our internal process."
 *
 * ══ WHAT WAS WRONG ══════════════════════════════════════════════════════════
 * `server/sprint20Wave2Routes.ts` returned `(err as Error).message` verbatim to
 * the caller on two routes that an ORDINARY COLLECTIVE MEMBER can reach:
 *
 *   POST /api/collective/kyc-upload           (a WRITE)
 *   GET  /api/collective/kyc-document/:id     (a READ)
 *
 * `collective_kyc_blobs` is created lazily by the upload handler, so on a fresh
 * database the GET's `SELECT ... FROM collective_kyc_blobs` throws
 * `no such table: collective_kyc_blobs` — a better-sqlite3 driver sentence
 * carrying our table name — and that sentence went into the response body.
 *
 * ══ WHY THE ASSERTIONS ARE WRITTEN AS ABSENCE, NOT PRESENCE ═════════════════
 * The brief is explicit: assert that no response body contains a SQL fragment, a
 * table name, a file path, a stack frame or an internal id — not merely that the
 * new sentence is present. A presence-only test passes just as happily when the
 * new sentence is CONCATENATED with the raw driver text. So every case below
 * runs `expectNoInternalDetail` over the WHOLE serialised body, and the
 * happy-path presence checks are secondary.
 *
 * ══ THE ONE HONEST SCOPING CAVEAT ═══════════════════════════════════════════
 * These bodies legitimately contain a STABLE MACHINE ERROR CODE in the `error`
 * field — `persist_failed`, `read_failed`, `UNAUTHORIZED`. That is a documented
 * API contract field, not a leak, and clients switch on it. So the ALL-CAPS
 * machine-token family is asserted over the HUMAN TEXT fields (`message`,
 * `detail`) only, while the genuinely dangerous families — SQL, table names,
 * file paths, stack frames, driver codes, source-line references — are asserted
 * over the ENTIRE body including `error`. That split is stated, not hidden, and
 * `error` values are additionally pinned to an allow-list so a future wave
 * cannot smuggle prose into that field under cover of this exemption.
 *
 * ══ HOW A FAILURE IS PRODUCED ═══════════════════════════════════════════════
 * Not by mocking the sanitiser or throwing a synthetic Error — by making the
 * DATABASE genuinely fail, which is the only way the driver text under test is
 * real driver text:
 *
 *   READ  — the table is simply absent (the natural state; `NODE_ENV=test`
 *           resolves SQLite to `:memory:`, see server/db/connection.ts:141).
 *   WRITE — a `collective_kyc_blobs` table is pre-created MISSING the `payload`
 *           column, so the handler's `CREATE TABLE IF NOT EXISTS` is a no-op and
 *           its INSERT throws `table collective_kyc_blobs has no column named
 *           payload`. That is the same class of fault as the original report.
 *
 * ══ IDENTITY ════════════════════════════════════════════════════════════════
 * Requests are sent as `u_maya_chen`, a persona with `isAdmin: false`
 * (server/lib/userContext.ts:225-232), so what is proved is what a NON-ADMIN
 * MEMBER receives — the population R169 Item A names.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import { registerRoutes } from "../routes";
import { rawDb } from "../db/connection";
import {
  sanitizeErrorMessage,
  carriesInternalDetail,
  INTERNAL_DETAIL_PATTERNS,
} from "../lib/sanitize";
import {
  KYC_DOCUMENT_READ_FAILURE,
  KYC_UPLOAD_WRITE_FAILURE,
  BRIDGE_INBOUND_FAILURE,
  WAVE197_AUTHORED_MESSAGES,
  readFailureMessage,
  writeFailureMessage,
} from "../lib/wave197FailureCopy";
import { sanitizeBridgeFailureBody } from "../lib/wave197BridgeInboundLeakGuard";

let app: Express;
let server: http.Server;
let port = 0;

/** The client's gate, copied verbatim from `client/src/lib/queryClient.ts:60-65`. */
function looksHuman(m: unknown): boolean {
  return typeof m === "string" && m.length > 0 && m.length < 240 && /[a-z]/.test(m);
}

type CallResponse = { status: number; body: any; raw: string };

function call(
  method: string,
  path: string,
  opts: { body?: Buffer | string; contentType?: string; userId?: string } = {},
): Promise<CallResponse> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { "x-user-id": opts.userId ?? "u_maya_chen" };
    const data =
      opts.body === undefined
        ? undefined
        : Buffer.isBuffer(opts.body)
          ? opts.body
          : Buffer.from(opts.body, "utf8");
    if (data) {
      headers["content-type"] = opts.contentType ?? "application/json";
      headers["content-length"] = String(data.length);
    }
    const req = http.request({ hostname: "127.0.0.1", port, path, method, headers }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        let parsed: unknown = null;
        try {
          parsed = raw.length > 0 ? JSON.parse(raw) : null;
        } catch {
          parsed = raw;
        }
        resolve({ status: res.statusCode ?? 0, body: parsed, raw });
      });
    });
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

/**
 * A multipart/form-data body with one file part, built by hand so the upload
 * route is driven the way a browser drives it (multer must actually parse it).
 */
function multipartFile(field: string, filename: string, bytes: Buffer): { body: Buffer; contentType: string } {
  const boundary = "----w197boundary7f3a91c2";
  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${field}"; filename="${filename}"\r\n` +
    `Content-Type: image/png\r\n\r\n`;
  const tail = `\r\n--${boundary}--\r\n`;
  return {
    body: Buffer.concat([Buffer.from(head, "utf8"), bytes, Buffer.from(tail, "utf8")]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

/* ════════════════════════════════════════════════════════════════════════════
   THE ABSENCE INSTRUMENT.

   Written as explicit, individually-named families rather than one blob regex,
   so a failure says WHICH kind of internal detail escaped. Every family is
   checked against the FULL body text; the machine-token family additionally
   gets the narrower human-text pass documented in the header.
   ════════════════════════════════════════════════════════════════════════════ */

const FORBIDDEN_ANYWHERE: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "sqlite driver code", re: /\bSQLITE[_A-Z]*\b/ },
  { name: "schema complaint (no such table/column)", re: /\bno such (table|column|module|function|index)\b/i },
  { name: "table name collective_kyc_blobs", re: /collective_kyc_blobs/i },
  { name: "table name kyc_documents", re: /kyc_documents/i },
  { name: "any snake_case table-ish identifier with a sql verb", re: /\b(FROM|INTO|UPDATE|TABLE)\s+[a-z_][a-z0-9_]*\b/i },
  { name: "SELECT ... FROM", re: /\bSELECT\b[\s\S]*\bFROM\b/i },
  { name: "INSERT INTO", re: /\bINSERT\s+INTO\b/i },
  { name: "UPDATE ... SET", re: /\bUPDATE\b[\s\S]*\bSET\b/i },
  { name: "DELETE FROM", re: /\bDELETE\s+FROM\b/i },
  { name: "CREATE TABLE/INDEX/VIEW/TRIGGER", re: /\bCREATE\s+(TABLE|INDEX|VIEW|TRIGGER)\b/i },
  { name: "ALTER TABLE", re: /\bALTER\s+TABLE\b/i },
  { name: "DROP TABLE/INDEX/VIEW", re: /\bDROP\s+(TABLE|INDEX|VIEW)\b/i },
  { name: "PRAGMA", re: /\bPRAGMA\b/i },
  { name: "constraint text", re: /\bconstraint failed\b/i },
  { name: "sql syntax error", re: /\bsyntax error\b/i },
  { name: "stack frame with parens", re: /\bat\s+\S+\s*\([^)]*:\d+:\d+\)/ },
  { name: "bare stack frame", re: /\bat\s+[^\s(]+:\d+:\d+/ },
  { name: "posix filesystem path", re: /(^|[\s("'`])\/(home|var|usr|etc|opt|root|tmp|app|srv|proc|Users)\// },
  { name: "windows filesystem path", re: /[A-Za-z]:\\/ },
  { name: "source file with line number", re: /\.(ts|tsx|js|mjs|cjs|jsx):\d+/ },
  { name: "module internals", re: /\b(node_modules|better-sqlite3|drizzle)\b/i },
  { name: "exception class prefix", re: /\b(TypeError|RangeError|SyntaxError|ReferenceError|AssertionError)\s*:/ },
  { name: "errno code", re: /\bECONN(REFUSED|RESET|ABORTED)\b|\bENOENT\b|\bEACCES\b|\bEPIPE\b|\bETIMEDOUT\b/ },
];

const FORBIDDEN_IN_HUMAN_TEXT: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "ALL_CAPS machine token", re: /(^|[^A-Za-z0-9_])[A-Z][A-Z0-9]*(_[A-Z0-9]+)+([^A-Za-z0-9_]|$)/ },
  { name: "lowercase snake_case machine token", re: /(^|[^A-Za-z0-9_])[a-z][a-z0-9]*(_[a-z0-9]+)+([^A-Za-z0-9_]|$)/ },
];

/** The ONLY values allowed in a machine `error`/`code` field on these routes. */
const ALLOWED_ERROR_CODES = new Set([
  "persist_failed",
  "read_failed",
  "not_found",
  "not_owner",
  "UNAUTHORIZED",
  "No file received",
  "currency_not_resolved",
]);

function humanTextOf(body: unknown): string {
  const parts: string[] = [];
  const walk = (v: unknown): void => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) return void v.forEach(walk);
    if (typeof v === "object") {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (k === "message" || k === "detail" || k === "description" || k === "reason") {
          if (typeof val === "string") parts.push(val);
          else walk(val);
        } else {
          walk(val);
        }
      }
    }
  };
  walk(body);
  return parts.join("\n");
}

function expectNoInternalDetail(where: string, res: CallResponse): void {
  const whole = typeof res.body === "string" ? res.body : JSON.stringify(res.body ?? {});
  for (const f of FORBIDDEN_ANYWHERE) {
    expect(f.re.test(whole), `${where}: response body leaked ${f.name} — body was: ${whole}`).toBe(false);
  }
  const human = humanTextOf(res.body);
  for (const f of FORBIDDEN_IN_HUMAN_TEXT) {
    expect(f.re.test(human), `${where}: human text leaked ${f.name} — text was: ${human}`).toBe(false);
  }
  /* The `error` exemption above is not a blank cheque: pin the field. */
  const code = res.body && typeof res.body === "object" ? (res.body as any).error : undefined;
  if (typeof code === "string" && code.length > 0) {
    expect(
      ALLOWED_ERROR_CODES.has(code),
      `${where}: unexpected value in the machine \`error\` field: ${JSON.stringify(code)}. ` +
        `The machine-token exemption covers a fixed allow-list only — if this is a new code, add it ` +
        `deliberately; if it is prose or driver text, it is a leak.`,
    ).toBe(true);
  }
}

/** The un-sanitised text the driver really produces, for the disarm proof. */
let observedRawReadError = "";
let observedRawWriteError = "";

beforeAll(async () => {
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  /* The REAL registration path — the same function the server boots with, so the
     wave-197 bridge guard's position relative to the sacred handler is exercised
     rather than asserted. */
  await registerRoutes(server, app);
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });

  /* Capture the raw driver sentences OUTSIDE the routes, so the tests can prove
     the leak was real and is what the sanitiser is withholding — without ever
     needing the routes to emit it. */
  const db: any = rawDb();
  try {
    db.prepare(`SELECT user_id FROM collective_kyc_blobs WHERE id = ?`).get("nope");
  } catch (e) {
    observedRawReadError = (e as Error).message;
  }
  /* Pre-create the table WITHOUT `payload` so the upload handler's INSERT throws.
     `:memory:` under NODE_ENV=test, so this cannot touch a real database. */
  db.exec(`CREATE TABLE IF NOT EXISTS collective_kyc_blobs (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    field TEXT,
    original_name TEXT NOT NULL,
    mime TEXT NOT NULL,
    ext TEXT NOT NULL,
    created_at TEXT NOT NULL
  );`);
  try {
    db.prepare(
      `INSERT INTO collective_kyc_blobs (id, user_id, field, original_name, mime, ext, payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("x", "y", "", "n", "m", ".png", Buffer.from("z"), "now");
  } catch (e) {
    observedRawWriteError = (e as Error).message;
  }
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("W197 A0 — the leak this wave closes was real", () => {
  it("the driver really does name our table on the read path", () => {
    expect(observedRawReadError.length).toBeGreaterThan(0);
    expect(observedRawReadError).toMatch(/collective_kyc_blobs/);
    expect(carriesInternalDetail(observedRawReadError)).toBe(true);
  });

  it("the driver really does name our table and column on the write path", () => {
    expect(observedRawWriteError.length).toBeGreaterThan(0);
    expect(observedRawWriteError).toMatch(/collective_kyc_blobs|payload/);
    expect(carriesInternalDetail(observedRawWriteError)).toBe(true);
  });

  it("that raw text would have failed this file's own absence instrument", () => {
    /* If the absence instrument cannot catch the ORIGINAL leak, it proves
       nothing about the fix. This is the instrument validating itself. */
    const fake: CallResponse = {
      status: 500,
      body: { ok: false, error: "read_failed", message: observedRawReadError },
      raw: "",
    };
    expect(() => expectNoInternalDetail("self-check", fake)).toThrow();
  });
});

describe("W197 A1 — GET /api/collective/kyc-document/:id (READ) as a non-admin member", () => {
  it("returns a sanitised human message with no internal detail anywhere in the body", async () => {
    const res = await call("GET", "/api/collective/kyc-document/w197_does_not_exist");
    expect(res.status).toBeGreaterThanOrEqual(400);
    expectNoInternalDetail("kyc-document read", res);
  });

  it("the message it returns is the authored read sentence and passes the 240-char gate", async () => {
    const res = await call("GET", "/api/collective/kyc-document/w197_does_not_exist");
    const msg = res.body?.message;
    if (res.status === 500) {
      expect(msg).toBe(KYC_DOCUMENT_READ_FAILURE);
      expect(looksHuman(msg)).toBe(true);
    } else {
      /* 404/403 are the pre-existing non-error refusals and carry no message.
         Either way the absence assertion above is the one that matters. */
      expect([403, 404]).toContain(res.status);
    }
  });

  it("read copy says nothing changed, and does NOT claim the document still exists", () => {
    expect(KYC_DOCUMENT_READ_FAILURE).toMatch(/[Nn]othing was changed/);
    expect(KYC_DOCUMENT_READ_FAILURE).not.toMatch(/still (there|stored|saved|available)/i);
    expect(KYC_DOCUMENT_READ_FAILURE).not.toMatch(/is safe|remains/i);
  });
});

describe("W197 A2 — POST /api/collective/kyc-upload (WRITE) as a non-admin member", () => {
  it("returns a sanitised human message with no internal detail anywhere in the body", async () => {
    const mp = multipartFile("file", "passport.png", Buffer.from("w197-not-a-real-png"));
    const res = await call("POST", "/api/collective/kyc-upload", {
      body: mp.body,
      contentType: mp.contentType,
    });
    expect(res.status).toBe(500);
    expect(res.body?.error).toBe("persist_failed");
    expectNoInternalDetail("kyc-upload write", res);
    expect(res.body?.message).toBe(KYC_UPLOAD_WRITE_FAILURE);
    expect(looksHuman(res.body?.message)).toBe(true);
  });

  it("write copy never claims nothing was saved, and tells the member to check first", () => {
    /* R169 item 5 — the whole point. A 500 can be returned AFTER the row landed. */
    expect(KYC_UPLOAD_WRITE_FAILURE).not.toMatch(/nothing was (saved|stored|written|uploaded)/i);
    expect(KYC_UPLOAD_WRITE_FAILURE).not.toMatch(/no changes were made/i);
    expect(KYC_UPLOAD_WRITE_FAILURE).toMatch(/cannot confirm/i);
    expect(KYC_UPLOAD_WRITE_FAILURE).toMatch(/check/i);
  });

  it("the diagnostic the member never sees IS written to the operator log", async () => {
    /* ─────────────────────────────────────────────────────────────────────────
       THIS TEST EXISTS BECAUSE THE DISARM HARNESS KILLED THE CLAIM, NOT THE CODE.

       Mutation M7 silenced `log.error` at this exact site and every test in this
       file stayed GREEN. R169 item 4 is explicit — "preserve the diagnostic detail
       server-side" — so "we still log it" was a load-bearing claim resting on
       nothing but a human having read a log line once. It is now asserted.

       THE INSTRUMENT. `server/lib/logger.ts:118` exports `log` as
       `Object.freeze({...})`, so it cannot be spied on directly. Its `error`
       level writes through `console.error` (`logger.ts:52`), which is therefore
       the observation point: if the operator's stream carries the raw text, the
       diagnostic survived. This proves the DESTINATION of the detail, which is
       the thing R169 item 4 actually asks about.
     ───────────────────────────────────────────────────────────────────────── */
    const seen: string[] = [];
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]): void => {
      seen.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    };
    let res: Awaited<ReturnType<typeof call>>;
    try {
      const mp = multipartFile("file", "passport.png", Buffer.from("w197-log-probe"));
      res = await call("POST", "/api/collective/kyc-upload", {
        body: mp.body,
        contentType: mp.contentType,
      });
    } finally {
      console.error = originalConsoleError;
    }

    expect(res!.status).toBe(500);
    /* The member got the authored sentence and nothing else. */
    expect(res!.body?.message).toBe(KYC_UPLOAD_WRITE_FAILURE);
    expectNoInternalDetail("kyc-upload write, log probe", res!);

    const logged = seen.join("\n");
    expect(seen.length, "the operator log received NOTHING for a 500").toBeGreaterThan(0);
    /* The route tag, so the operator can find the handler. */
    expect(logged).toMatch(/sprint20Wave2Routes\.kycUpload/);
    /* And real diagnostic substance — a stack frame or a driver sentence. The
       exact driver text differs under vitest (see the caveat in W197_TESTS.md),
       so the assertion is on the PRESENCE of internal detail in the log, using
       the same detector that must find NONE in the body. That pairing is the
       whole proof: the same text, withheld from one channel and kept in the
       other. */
    expect(
      carriesInternalDetail(logged),
      `the log line carries no internal detail, so nothing was preserved:\n${logged}`,
    ).toBe(true);
    /* THE FIRST DRAFT OF THIS LINE WAS `carriesInternalDetail(JSON.stringify(body))`
       AND IT WENT RED — correctly. Once the injection phase forced a lowercase
       snake_case pattern into `INTERNAL_DETAIL_PATTERNS`, the detector started
       flagging `"error":"persist_failed"`, which is a LEGITIMATE stable machine
       code the client switches on. The lesson is a boundary, not a bug:
       `carriesInternalDetail` is a detector for HUMAN-FACING TEXT and must be
       applied per human field, never to a whole serialised body. `expectNoInternalDetail`
       above already draws that line (machine-token family over `message`/`detail`/
       `description`/`reason` only; SQL, path, stack and driver families over the
       whole body), so the assertion is made where it is meaningful. */
    expect(carriesInternalDetail(res!.body?.message)).toBe(false);
  });

  it("the read sentence and the write sentence are genuinely different", () => {
    /* Guards against a future wave collapsing both onto one convenient string,
       which would silently re-introduce the read/write confusion. */
    expect(KYC_UPLOAD_WRITE_FAILURE).not.toBe(KYC_DOCUMENT_READ_FAILURE);
  });
});

describe("W197 A3 — every authored sentence passes the client's 240-character gate", () => {
  it("all wave-197 server messages are human and under the bound", () => {
    expect(WAVE197_AUTHORED_MESSAGES.length).toBe(3);
    for (const m of WAVE197_AUTHORED_MESSAGES) {
      expect(looksHuman(m), `not human / too long (${m.length}): ${m}`).toBe(true);
      expect(m.length).toBeLessThan(240);
    }
  });

  it("the generated read/write copy also fits the gate for a long subject", () => {
    const longSubject = "the identity document you attached to your Collective membership application";
    expect(looksHuman(readFailureMessage(longSubject))).toBe(true);
    expect(looksHuman(writeFailureMessage(longSubject))).toBe(true);
  });

  it("no authored sentence contains internal detail of its own", () => {
    for (const m of WAVE197_AUTHORED_MESSAGES) {
      expect(carriesInternalDetail(m), `authored copy trips the leak detector: ${m}`).toBe(false);
    }
  });

  it("the authored sentences say what to do next, not merely that something failed", () => {
    for (const m of WAVE197_AUTHORED_MESSAGES) {
      expect(/again|reload|check|administrator|log/i.test(m), `no next step in: ${m}`).toBe(true);
    }
  });
});

describe("W197 A4 — the sanitiser itself, env-independent", () => {
  const originalEnv = process.env.NODE_ENV;
  afterAll(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it("withholds every internal-detail family even when NODE_ENV is not production", () => {
    process.env.NODE_ENV = "development";
    const samples = [
      "no such table: collective_kyc_blobs",
      "SQLITE_CONSTRAINT: UNIQUE constraint failed: users.email",
      "table collective_kyc_blobs has no column named payload",
      "at Object.<anonymous> (/home/user/workspace/work/server/sprint20Wave2Routes.ts:244:13)",
      "Error: ENOENT: no such file or directory, open '/var/data/x'",
      "TypeError: Cannot read properties of undefined (reading 'run')",
      "SELECT user_id, mime FROM collective_kyc_blobs WHERE id = ?",
      "PERSIST_FAILED",
      "C:\\app\\server\\routes.ts:12",
      "better-sqlite3 driver failure",
    ];
    for (const s of samples) {
      expect(sanitizeErrorMessage(new Error(s), "AUTHORED"), `passed through: ${s}`).toBe("AUTHORED");
    }
  });

  it("still lets ordinary authored prose through in development, so dev debugging is unchanged", () => {
    process.env.NODE_ENV = "development";
    expect(sanitizeErrorMessage(new Error("The invitation has already been accepted."), "AUTHORED")).toBe(
      "The invitation has already been accepted.",
    );
  });

  it("returns the fallback in production regardless, exactly as before this wave", () => {
    process.env.NODE_ENV = "production";
    expect(sanitizeErrorMessage(new Error("The invitation has already been accepted."), "AUTHORED")).toBe(
      "AUTHORED",
    );
  });

  it("can only ever withhold: it never invents text that was not already going out", () => {
    process.env.NODE_ENV = "development";
    const out = sanitizeErrorMessage(new Error("plain sentence"), "AUTHORED");
    expect(out === "plain sentence" || out === "AUTHORED").toBe(true);
  });

  it("the pattern list is non-empty and every entry is a RegExp", () => {
    expect(INTERNAL_DETAIL_PATTERNS.length).toBeGreaterThan(15);
    for (const p of INTERNAL_DETAIL_PATTERNS) expect(p).toBeInstanceOf(RegExp);
  });
});

describe("W197 A5 — the sacred bridgeRuntime.ts:254 site, intercepted from outside the frozen file", () => {
  it("the interceptor rewrites failure text that carries internal detail", () => {
    const result = sanitizeBridgeFailureBody({
      ok: false,
      error: "handler_error",
      message: "no such table: bridge_inbound_log",
    });
    expect(JSON.stringify(result.body)).not.toMatch(/no such table|bridge_inbound_log/);
    expect((result.body as any).message).toBe(BRIDGE_INBOUND_FAILURE);
    expect(result.replaced).toContain("message");
  });

  it("it preserves the raw text for the operator instead of destroying it", () => {
    const raw = "SQLITE_CONSTRAINT: UNIQUE constraint failed: bridge_events.id";
    const result = sanitizeBridgeFailureBody({ ok: false, error: "handler_error", message: raw });
    /* The diagnostic is handed back to the caller of this function, which logs
       it. Withheld from the wire, not deleted. */
    expect(result.rawSuppressed).toContain(raw);
  });

  it("it leaves a clean body completely alone, by object identity", () => {
    const clean = { ok: true, applied: 2 };
    const result = sanitizeBridgeFailureBody(clean);
    expect(result.body).toBe(clean);
    expect(result.replaced).toEqual([]);
  });

  it("a leaked value in the machine `error` field becomes a code, not a sentence", () => {
    const result = sanitizeBridgeFailureBody({
      ok: false,
      error: "no such column: bridge_events.applied_at",
    });
    expect((result.body as any).error).toBe("handler_error");
    expect((result.body as any).message).toBe(BRIDGE_INBOUND_FAILURE);
    expect(JSON.stringify(result.body)).not.toMatch(/no such column|applied_at/);
  });

  it("bridge copy does not claim nothing was applied", () => {
    expect(BRIDGE_INBOUND_FAILURE).not.toMatch(/nothing was (applied|saved|written)/i);
    expect(BRIDGE_INBOUND_FAILURE).toMatch(/unconfirmed/i);
  });

  it("a legitimate bridge machine code in `error` is NOT flattened", () => {
    /* THE COST OF THE WIDENED PATTERN, CAUGHT BY RE-READING IT AGAINST THIS CALL
       SITE. The injection phase forced a lowercase snake_case pattern into
       `INTERNAL_DETAIL_PATTERNS`. Applied naively, that pattern flags EVERY bridge
       error code — `invalid_signature`, `unknown_kind`, `replayed` — and this guard
       would have rewritten all of them to the single value `handler_error`,
       destroying a contract machine callers switch on. Sealing a leak by breaking
       an interface is not sealing a leak. */
    for (const code of ["bridge_failed", "invalid_signature", "unknown_kind", "replayed"]) {
      const r = sanitizeBridgeFailureBody({ ok: false, error: code });
      expect((r.body as any).error, `${code} was flattened`).toBe(code);
      expect(r.replaced).not.toContain("error");
    }
  });

  it("the exemption does not extend to prose, nor to the human message field", () => {
    /* The exemption is `error` + no-whitespace ONLY. Both halves are asserted, so
       a future wave cannot widen it by accident. */
    const withSpaces = sanitizeBridgeFailureBody({
      ok: false,
      error: "no such column: bridge_events.applied_at",
    });
    expect((withSpaces.body as any).error).toBe("handler_error");

    const inMessage = sanitizeBridgeFailureBody({
      ok: false,
      error: "bridge_failed",
      message: "collective_kyc_blobs",
    });
    expect((inMessage.body as any).error).toBe("bridge_failed");
    expect((inMessage.body as any).message).toBe(BRIDGE_INBOUND_FAILURE);
    expect(inMessage.replaced).toContain("message");
  });

  it("the interceptor is actually REGISTERED, and before the frozen route", async () => {
    /* ─────────────────────────────────────────────────────────────────────────
       ALSO ADDED BECAUSE THE HARNESS KILLED THE CLAIM. Mutation M8 replaced the
       registration call in `server/routes.ts` with `void registerWave197...;` —
       the guard was never installed — and every A5 test stayed green, because all
       of them tested `sanitizeBridgeFailureBody` as a pure function. A sanitiser
       that is never mounted sanitises nothing.

       Wiring is a claim about SOURCE TEXT, so it is proved against source text,
       and ORDER matters: express middleware only sees a route it was mounted
       before. `registerBridgeRuntimeRoutes` owns the sacred handler, so the guard
       must appear earlier in the file.
     ───────────────────────────────────────────────────────────────────────── */
    const fs = await import("node:fs");
    const src = fs.readFileSync("server/routes.ts", "utf8");
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

    expect(code).toMatch(
      /import\s*\{[^}]*registerWave197BridgeInboundLeakGuard[^}]*\}\s*from\s*["'][^"']*wave197BridgeInboundLeakGuard["']/,
    );
    const calls = code.match(/registerWave197BridgeInboundLeakGuard\s*\(\s*app\s*\)\s*;/g) ?? [];
    expect(calls.length, "the guard is imported but never invoked with the app").toBe(1);

    const guardAt = code.indexOf("registerWave197BridgeInboundLeakGuard(app);");
    const sacredAt = code.indexOf("registerBridgeRuntimeRoutes(");
    expect(guardAt).toBeGreaterThan(-1);
    expect(sacredAt).toBeGreaterThan(-1);
    expect(
      guardAt,
      "the guard is mounted AFTER the sacred bridge route, so it can never see it",
    ).toBeLessThan(sacredAt);
  });

  it("the frozen file is not the thing that changed", async () => {
    /* Reading the sacred file and asserting the wave's marker is ABSENT is the
       cheapest possible standing proof that the interception is external. */
    const fs = await import("node:fs");
    const src = fs.readFileSync("server/lib/bridgeRuntime.ts", "utf8");
    expect(src).not.toMatch(/WAVE 197/);
    expect(src).not.toMatch(/wave197/);
  });
});
