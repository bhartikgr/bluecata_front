/**
 * v23.4.2 — Admin SMTP diagnostic endpoints
 *
 * Coverage:
 *   - GET  /api/admin/email/config
 *       • requires admin (non-admin → 403)
 *       • NEVER returns the password
 *       • surfaces appUrlOk=false when APP_URL points at localhost
 *       • surfaces passwordPresent=true/false based on env state
 *   - POST /api/admin/email/test
 *       • non-admin → 403
 *       • returns the underlying verifyTransport() result shape
 *       • returns mode=not_configured when SMTP_HOST is unset
 *   - POST /api/admin/email/send-test
 *       • non-admin → 403
 *       • rejects malformed { to } with 400
 *       • returns delivery result envelope including the recipient
 *
 * Note: we deliberately do NOT mock nodemailer here; we exercise the SMTP
 * code path using SMTP_MODE=dry_run, which bypasses the real send while
 * still returning transportAccepted:true (WAVE 48 · ITEM 4 rename). This proves the wiring end-to-end without
 * needing a real SMTP server.
 */
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import express, { type Express } from "express";
import http from "node:http";
import request from "supertest";
import { registerRoutes } from "../routes";
import { getDb } from "../db/connection";
import { seedDemoData } from "../lib/seedDemoData";

let app: Express;
let server: http.Server;

const SAVED_ENV: Record<string, string | undefined> = {};
function captureEnv(...names: string[]) {
  for (const n of names) SAVED_ENV[n] = process.env[n];
}
function restoreEnv() {
  for (const [k, v] of Object.entries(SAVED_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeAll(async () => {
  captureEnv(
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_SECURE",
    "SMTP_USER",
    "SMTP_PASS",
    "SMTP_FROM",
    "SMTP_REPLY_TO",
    "SMTP_MODE",
    "APP_URL",
  );
  app = express();
  app.use(express.json());
  server = http.createServer(app);
  await seedDemoData(getDb());
  await registerRoutes(server, app);
}, 30_000);

afterEach(() => {
  restoreEnv();
});

function asAdmin(req: request.Test): request.Test {
  return req.set("x-test-user-id", "u_admin").query({ as: "admin" });
}
function asFounder(req: request.Test): request.Test {
  return req.set("x-test-user-id", "u_maya").query({ as: "founder" });
}

describe("v23.4.2 — admin SMTP diagnostic endpoints", () => {
  /* ============================================================
   * GET /api/admin/email/config
   * ============================================================ */
  describe("GET /api/admin/email/config", () => {
    it("non-admin is rejected with 403", async () => {
      const r = await asFounder(request(app).get("/api/admin/email/config"));
      expect(r.status).toBe(403);
    });

    it("admin gets a sanitized config — password is never returned", async () => {
      process.env.SMTP_HOST = "smtp.gmail.com";
      process.env.SMTP_PORT = "587";
      process.env.SMTP_SECURE = "false";
      process.env.SMTP_USER = "scale@example.com";
      process.env.SMTP_PASS = "secret-app-password";
      process.env.SMTP_FROM = "Capavate <noreply@example.com>";
      process.env.SMTP_REPLY_TO = "support@example.com";
      process.env.SMTP_MODE = "smtp";
      process.env.APP_URL = "https://app.example.com";

      const r = await asAdmin(request(app).get("/api/admin/email/config"));
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        mode: "smtp",
        host: "smtp.gmail.com",
        port: 587,
        secure: false,
        user: "scale@example.com",
        from: "Capavate <noreply@example.com>",
        replyTo: "support@example.com",
        passwordPresent: true,
        appUrlOk: true,
        appUrl: "https://app.example.com",
      });
      // The password value itself must never appear in the response anywhere.
      const responseBlob = JSON.stringify(r.body);
      expect(responseBlob).not.toContain("secret-app-password");
      expect("pass" in r.body).toBe(false);
      expect("password" in r.body).toBe(false);
      expect("SMTP_PASS" in r.body).toBe(false);
    });

    it("flags appUrlOk=false when APP_URL is localhost", async () => {
      process.env.SMTP_HOST = "smtp.gmail.com";
      process.env.APP_URL = "http://localhost:5000";
      const r = await asAdmin(request(app).get("/api/admin/email/config"));
      expect(r.status).toBe(200);
      expect(r.body.appUrlOk).toBe(false);
      expect(r.body.appUrl).toBe("http://localhost:5000");
    });

    it("flags appUrlOk=false when APP_URL is 127.0.0.1", async () => {
      process.env.APP_URL = "http://127.0.0.1:5000";
      const r = await asAdmin(request(app).get("/api/admin/email/config"));
      expect(r.body.appUrlOk).toBe(false);
    });

    it("treats empty SMTP_REPLY_TO as null", async () => {
      process.env.SMTP_HOST = "smtp.example.com";
      process.env.SMTP_REPLY_TO = "";
      const r = await asAdmin(request(app).get("/api/admin/email/config"));
      expect(r.body.replyTo).toBe(null);
    });

    it("surfaces passwordPresent=false when SMTP_PASS is unset", async () => {
      process.env.SMTP_HOST = "smtp.example.com";
      delete process.env.SMTP_PASS;
      const r = await asAdmin(request(app).get("/api/admin/email/config"));
      expect(r.body.passwordPresent).toBe(false);
    });
  });

  /* ============================================================
   * POST /api/admin/email/test
   * ============================================================ */
  describe("POST /api/admin/email/test", () => {
    it("non-admin is rejected with 403", async () => {
      const r = await asFounder(request(app).post("/api/admin/email/test"));
      expect(r.status).toBe(403);
    });

    it("returns mode=not_configured when SMTP_HOST is unset", async () => {
      delete process.env.SMTP_HOST;
      /* WAVE 281 · R243.1 — SETUP ONLY. This case means "smtp is wanted but the
         host is missing"; it used to say that by DELETING the mode and leaning on
         the old unsafe default. It now says it. No assertion below is changed. */
      process.env.SMTP_MODE = "smtp";
      const r = await asAdmin(request(app).post("/api/admin/email/test"));
      expect(r.status).toBe(200);
      expect(r.body.ok).toBe(false);
      expect(r.body.mode).toBe("not_configured");
      expect(r.body.hint).toMatch(/SMTP_HOST not set/i);
    });

    it("returns ok=true in dry_run mode (no real SMTP)", async () => {
      process.env.SMTP_MODE = "dry_run";
      const r = await asAdmin(request(app).post("/api/admin/email/test"));
      expect(r.status).toBe(200);
      expect(r.body.ok).toBe(true);
      expect(r.body.mode).toBe("dry_run");
    });

    it("returns ok=false with mode=disabled when SMTP_MODE=disabled", async () => {
      process.env.SMTP_MODE = "disabled";
      const r = await asAdmin(request(app).post("/api/admin/email/test"));
      expect(r.body.ok).toBe(false);
      expect(r.body.mode).toBe("disabled");
    });
  });

  /* ============================================================
   * POST /api/admin/email/send-test
   * ============================================================ */
  describe("POST /api/admin/email/send-test", () => {
    it("non-admin is rejected with 403", async () => {
      const r = await asFounder(
        request(app).post("/api/admin/email/send-test").send({ to: "x@y.com" }),
      );
      expect(r.status).toBe(403);
    });

    it("rejects missing recipient with 400", async () => {
      process.env.SMTP_MODE = "dry_run";
      const r = await asAdmin(
        request(app).post("/api/admin/email/send-test").send({}),
      );
      expect(r.status).toBe(400);
      expect(r.body.error).toBe("bad_recipient");
    });

    it("rejects malformed recipient with 400", async () => {
      process.env.SMTP_MODE = "dry_run";
      const r = await asAdmin(
        request(app).post("/api/admin/email/send-test").send({ to: "not-an-email" }),
      );
      expect(r.status).toBe(400);
      expect(r.body.error).toBe("bad_recipient");
    });

    it("delivers in dry_run mode and returns the recipient + delivery envelope", async () => {
      process.env.SMTP_MODE = "dry_run";
      const r = await asAdmin(
        request(app)
          .post("/api/admin/email/send-test")
          .send({ to: "ozan@example.com" }),
      );
      expect(r.status).toBe(200);
      expect(r.body.to).toBe("ozan@example.com");
      expect(r.body.transportAccepted).toBe(true);
      expect(r.body.mode).toBe("dry_run");
    });
  });
});

/* ════════════════════════════════════════════════════════════════════════════ *
 *  WAVE 281 · R243.1 — THE ADMIN CONFIG CARD MUST REPORT THE **EFFECTIVE** MODE.
 *
 *  `getSanitizedConfig` used to compute `mode: process.env.SMTP_MODE ?? "smtp"`
 *  — its own private copy of the very expression this wave replaced. Left alone,
 *  it would have told an operator "mode: smtp" on a staging box whose sender is
 *  now inert: an absence rendering as reassurance, which is the defect class this
 *  programme rejects. It now calls the same `resolveSmtpMode()` the sender does.
 * ════════════════════════════════════════════════════════════════════════════ */
describe("WAVE 281 — GET /api/admin/email/config reports the effective mode", () => {
  it("SMTP_MODE unset outside production is reported as dry_run, not smtp", async () => {
    delete process.env.SMTP_MODE;
    /* ASSERTED, NOT SET. `NODE_ENV` is not in this file's captureEnv list, so
       writing it here would leak into every later file in the worker. The suite
       already runs non-production (`npm test` sets NODE_ENV=test), and if that ever
       stops being true this line fails loudly instead of the case below passing for
       the wrong reason. */
    expect(process.env.NODE_ENV).not.toBe("production");
    process.env.SMTP_HOST = "smtp.gmail.com";
    const r = await asAdmin(request(app).get("/api/admin/email/config"));
    expect(r.status).toBe(200);
    /* The load-bearing assertion: the card agrees with the sender. */
    expect(r.body.mode).toBe("dry_run");
    /* And it still reports the configured host, so nothing is hidden. */
    expect(r.body.host).toBe("smtp.gmail.com");
  });

  it("an explicit SMTP_MODE is still reported verbatim", async () => {
    process.env.SMTP_MODE = "console";
    const r = await asAdmin(request(app).get("/api/admin/email/config"));
    expect(r.status).toBe(200);
    expect(r.body.mode).toBe("console");
  });
});
