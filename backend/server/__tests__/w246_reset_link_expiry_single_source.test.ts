/* ════════════════════════════════════════════════════════════════════════════
   WAVE 246 (R218.1) — THE SCREEN WAS THE LIAR, NOT THE EMAIL.
   ════════════════════════════════════════════════════════════════════════════
   client/src/pages/auth/Forgot.tsx said "Magic links expire in 15 minutes".
   POST /api/auth/forgot mints a token that lives 24 hours, and the reset email
   says 24 hours. QA prescribed changing the EMAIL to 15 minutes; R218.1
   established the opposite, so the EMAIL IS NOT TOUCHED by this wave and this
   file fences it against being touched.

   WHAT THIS FILE PROVES, over the PRODUCTION REGISTRAR (`registerRoutes` from
   `server/routes.ts`) driven over a real HTTP socket, reading the real SQLite
   `auth_redeem_tokens` row the route actually wrote:

     1. THE ROUTE CONSUMES THE SHARED CONSTANT. `expires_at − created_at` on the
        minted row equals `PASSWORD_RESET_TOKEN_TTL_MS` exactly (to the second).
        This is the assertion that goes RED if the mint site is disarmed back to
        an inline literal that disagrees with the constant.
     2. THE VALUE DID NOT CHANGE. `PASSWORD_RESET_TOKEN_TTL_HOURS === 24` and
        `PASSWORD_RESET_TOKEN_TTL_MS === 86_400_000`, pinned absolutely. Wave 246
        is a copy correction; nobody's reset window may shrink (R190.10).
        Assertion 1 alone would be INERT against a constant change — it is
        parameterised on the very thing it checks — so this absolute pin is what
        makes the pair meaningful.
     3. THE EMAIL STILL SAYS 24 HOURS, in both the text and the html body, and
        those bodies AGREE with the shared constant's phrase. So the email is
        protected from this wave, and a future TTL edit cannot silently make the
        email lie: it will fail here.
     4. NO 15-MINUTE CLAIM SURVIVES anywhere in the reset flow's own output.

   ANTI-VACUITY. Every negative assertion ("15 minutes" absent) is paired on the
   SAME captured email with a positive assertion (the true duration present and
   the reset URL present), so an empty body or a thrown send cannot pass.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Express } from "express";
import http from "node:http";

import { registerRoutes } from "../routes";
import { rawDb } from "../db/connection";
import {
  PASSWORD_RESET_TOKEN_TTL_HOURS,
  PASSWORD_RESET_TOKEN_TTL_MS,
  passwordResetLinkExpiryPhrase,
} from "@shared/passwordResetLinkExpiry";
import { __setEmailTransportForTests, type InjectedEmailTransport } from "../lib/emailSender";

let app: Express;
let server: http.Server;
let port: number;

/* The transport is the ONLY seam. It is not a replica of the route: the route,
   the token minting, the SQLite write and the body composition are all the real
   production code. We capture what production would have handed to SMTP. */
type Captured = { to: string; subject: string; text?: string; html?: string };
const captured: Captured[] = [];

beforeAll(async () => {
  const transport: InjectedEmailTransport = {
    async send(msg) {
      captured.push({ to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
      return { accepted: true };
    },
  };
  __setEmailTransportForTests(transport);

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
}, 60_000);

afterAll(async () => {
  __setEmailTransportForTests(null);
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function post(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(data)) },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: raw });
          }
        });
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

const EMAIL = "maya@novapay.ai";

describe("WAVE 246 · the shared constant is the single source of truth for the reset-link lifetime", () => {
  it("W246-1 the VALUE did not change: the shared constant is still 24 hours / 86,400,000 ms", () => {
    expect(PASSWORD_RESET_TOKEN_TTL_HOURS).toBe(24);
    expect(PASSWORD_RESET_TOKEN_TTL_MS).toBe(86_400_000);
    expect(passwordResetLinkExpiryPhrase()).toBe("24 hours");
  });

  it("W246-2 the phrase is DERIVED, not written twice: it pluralises from the hours it is given", () => {
    expect(passwordResetLinkExpiryPhrase(1)).toBe("1 hour");
    expect(passwordResetLinkExpiryPhrase(24)).toBe("24 hours");
    /* and the default is not a separate literal — it is the constant */
    expect(passwordResetLinkExpiryPhrase()).toBe(passwordResetLinkExpiryPhrase(PASSWORD_RESET_TOKEN_TTL_HOURS));
  });

  it("W246-3 POST /api/auth/forgot mints expires_at from PASSWORD_RESET_TOKEN_TTL_MS (real route, real DB row)", async () => {
    const before = Date.now();
    const r = await post("/api/auth/forgot", { email: EMAIL });
    expect(r.status).toBe(200);

    const db = rawDb();
    const row = db
      .prepare(
        `SELECT id, expires_at, created_at FROM auth_redeem_tokens
          WHERE lower(email) = ? AND intent = 'reset'
          ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get(EMAIL.toLowerCase()) as { id: string; expires_at: string; created_at: string } | undefined;

    /* POSITIVE: a row really was written by the real route. */
    expect(row, "POST /api/auth/forgot wrote no reset token row").toBeTruthy();
    const createdMs = new Date(row!.created_at).getTime();
    const expiresMs = new Date(row!.expires_at).getTime();
    expect(Number.isFinite(createdMs)).toBe(true);
    expect(Number.isFinite(expiresMs)).toBe(true);
    expect(createdMs).toBeGreaterThanOrEqual(before - 5_000);

    /* THE LINK: the lifetime the route minted IS the shared constant. Tolerance
       is 2s only because created_at and expires_at are two separate Date.now()
       reads inside the handler. */
    const mintedTtlMs = expiresMs - createdMs;
    expect(Math.abs(mintedTtlMs - PASSWORD_RESET_TOKEN_TTL_MS)).toBeLessThanOrEqual(2_000);
  });

  it("W246-4 the EMAIL is untouched and AGREES with the constant — both bodies say the derived duration", async () => {
    captured.length = 0;
    const r = await post("/api/auth/forgot", { email: EMAIL });
    expect(r.status).toBe(200);

    const mail = captured.find(
      (m) => m.subject === "Reset your Capavate password" && m.to.toLowerCase() === EMAIL.toLowerCase(),
    );
    expect(mail, "no password_reset email was composed by the real route").toBeTruthy();

    const phrase = passwordResetLinkExpiryPhrase(); // "24 hours"
    /* POSITIVE — the true duration and a real link are both present. */
    expect(mail!.text ?? "").toContain(phrase);
    expect(mail!.html ?? "").toContain(phrase);
    expect(mail!.text ?? "").toContain("/auth/set-password?token=");
    expect(mail!.subject).toBe("Reset your Capavate password");
    /* The two email literals R218.1 forbids this wave from changing, verbatim. */
    expect(mail!.text ?? "").toContain("Click the link below to set a new password (valid for 24 hours):");
    expect(mail!.html ?? "").toContain("Link expires in 24 hours.");

    /* NEGATIVE — paired with the positives above, on the same captured email. */
    expect(mail!.text ?? "").not.toContain("15 minutes");
    expect(mail!.html ?? "").not.toContain("15 minutes");
  });
});
