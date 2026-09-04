/**
 * v23.4.2 — emailSender hardening tests
 *
 * Covers the SMTP transport policy fixes that unblock Gmail STARTTLS:
 *   1. requireTLS=true when secure=false (no silent cleartext fallback)
 *   2. SMTP_PASS whitespace is stripped (Gmail App Passwords paste with spaces)
 *   3. SMTP_REPLY_TO="" is treated as undefined (some relays reject empty header)
 *   4. Explicit connection/greeting/socket timeouts
 *   5. verifyTransport() returns actionable hints for the canonical failure modes
 *   6. Mode handling: disabled / dry_run / console / smtp
 *   7. Transporter is cached but invalidated when SMTP_HOST changes
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";

// Capture createTransport calls so we can assert exact options. Each test resets.
const createdConfigs: Array<Record<string, unknown>> = [];
const sendMailMock = vi.fn();
const verifyMock = vi.fn();

vi.mock("nodemailer", () => {
  return {
    default: {
      createTransport: (opts: Record<string, unknown>) => {
        createdConfigs.push(opts);
        return {
          sendMail: sendMailMock,
          verify: verifyMock,
        };
      },
    },
  };
});

// Audit appender is fire-and-forget; stub it.
vi.mock("../adminPlatformStore", () => ({
  appendAdminAudit: vi.fn(),
}));

// Import AFTER the mocks are registered.
import {
  sendEmail,
  verifyTransport,
  _resetTransporterCacheForTests,
} from "../lib/emailSender";

function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
}

/* WAVE 281 · R245.2 — THE OTHER TRANSPORT DOOR, KEPT OUT OF THE MEASURING WINDOW.
 *
 * `sendEmail` lazily `import()`s `server/emailStore.ts` for its outbox row, and
 * that module runs a demo seed AT IMPORT which sends through a SECOND, entirely
 * separate transport module (`server/emailTransport.ts:121`, reached via
 * `emailStore.ts:637 seedDemo → :454 tickQueue → emailTransport.sendMail`). I
 * confirmed that path by stack trace, not by reading.
 *
 * So the very first `sendEmail` in this file has always created TWO nodemailer
 * transports — its own, plus the seed's — whenever the seed's mode resolved to
 * `smtp`. It used to resolve to `console` here only because SMTP_MODE was left
 * unset, which made `expect(createdConfigs).toHaveLength(1)` at :100 depend on the
 * AMBIENT ENVIRONMENT of a module this file does not test.
 *
 * Importing the store once, up front, with a non-sending mode and no host, moves
 * that one-time seed send out of every test's `createdConfigs` window for good.
 * NO ASSERTION IS TOUCHED and nothing is loosened: :100 still demands exactly one
 * transport, and it now demands it of `emailSender` alone. */
beforeAll(async () => {
  const savedMode = process.env.SMTP_MODE;
  const savedHost = process.env.SMTP_HOST;
  process.env.SMTP_MODE = "dry_run";
  delete process.env.SMTP_HOST;
  await import("../emailStore");
  if (savedMode === undefined) delete process.env.SMTP_MODE;
  else process.env.SMTP_MODE = savedMode;
  if (savedHost === undefined) delete process.env.SMTP_HOST;
  else process.env.SMTP_HOST = savedHost;
});

beforeEach(() => {
  createdConfigs.length = 0;
  sendMailMock.mockReset();
  verifyMock.mockReset();
  _resetTransporterCacheForTests();
  // Wipe relevant env between tests
  setEnv({
    SMTP_HOST: undefined,
    SMTP_PORT: undefined,
    SMTP_SECURE: undefined,
    SMTP_USER: undefined,
    SMTP_PASS: undefined,
    SMTP_FROM: undefined,
    SMTP_REPLY_TO: undefined,
    /* WAVE 281 · R243.1 — SETUP ONLY. Every case in this file exercises the SMTP
       TRANSPORT and relied on the old unsafe default to get there; it now says so
       explicitly. Not one assertion below is changed, and the cases that set their
       own mode still override this. The genuinely-unset case is covered at BOTH
       poles by server/__tests__/w281_mail_default_is_inert.test.ts, which this
       file never covered. */
    SMTP_MODE: "smtp",
  });
});

afterEach(() => {
  _resetTransporterCacheForTests();
});

/* ============================================================
 * Transporter configuration matrix
 * ============================================================ */

describe("emailSender — transporter config (v23.4.2 hardening)", () => {
  it("sets requireTLS=true when secure=false (STARTTLS path, e.g. Gmail port 587)", async () => {
    setEnv({
      SMTP_HOST: "smtp.gmail.com",
      SMTP_PORT: "587",
      SMTP_SECURE: "false",
      SMTP_USER: "scale@example.com",
      SMTP_PASS: "aaaabbbbccccdddd",
    });
    sendMailMock.mockResolvedValue({ messageId: "<test>" });
    await sendEmail({ to: "x@y.com", subject: "s", text: "t" });
    expect(createdConfigs).toHaveLength(1);
    expect(createdConfigs[0]).toMatchObject({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      requireTLS: true,
    });
  });

  it("does NOT set requireTLS when secure=true (port 465 implicit TLS)", async () => {
    setEnv({
      SMTP_HOST: "smtp.gmail.com",
      SMTP_PORT: "465",
      SMTP_SECURE: "true",
      SMTP_USER: "scale@example.com",
      SMTP_PASS: "aaaabbbbccccdddd",
    });
    sendMailMock.mockResolvedValue({ messageId: "<test>" });
    await sendEmail({ to: "x@y.com", subject: "s", text: "t" });
    expect(createdConfigs[0]).toMatchObject({
      port: 465,
      secure: true,
      requireTLS: false,
    });
  });

  it("strips whitespace from SMTP_PASS (Gmail App Password pasted with spaces)", async () => {
    setEnv({
      SMTP_HOST: "smtp.gmail.com",
      SMTP_PORT: "587",
      SMTP_SECURE: "false",
      SMTP_USER: "scale@example.com",
      /* WAVE 139 SECURITY — this line previously hardcoded the REAL live Gmail
         App Password (confirmed byte-identical to the value in the host .env),
         with a comment naming whose account it was. It therefore shipped inside
         every release archive built from this tree, including v26.24.0's first
         two build attempts and the already-distributed v26.23.0 package.

         Replaced with an obviously-synthetic value of the SAME SHAPE (four
         space-separated four-character groups), which is all this test needs — it
         asserts that whitespace is stripped from SMTP_PASS, a property of the
         formatting, never of the specific secret. The real credential MUST STILL
         BE ROTATED: removing it here does not un-distribute the archives that
         already carried it. Tracked as the top item of the Group A security debt. */
      SMTP_PASS: "aaaa bbbb cccc dddd",
    });
    sendMailMock.mockResolvedValue({ messageId: "<test>" });
    await sendEmail({ to: "x@y.com", subject: "s", text: "t" });
    const auth = createdConfigs[0].auth as { user: string; pass: string };
    expect(auth.pass).toBe("aaaabbbbccccdddd");
    expect(auth.pass).not.toContain(" ");
  });

  it("strips tabs and newlines from SMTP_PASS as well", async () => {
    setEnv({
      SMTP_HOST: "smtp.example.com",
      SMTP_USER: "u",
      SMTP_PASS: "abc\tdef\nghi jkl",
    });
    sendMailMock.mockResolvedValue({ messageId: "<test>" });
    await sendEmail({ to: "x@y.com", subject: "s", text: "t" });
    const auth = createdConfigs[0].auth as { user: string; pass: string };
    expect(auth.pass).toBe("abcdefghijkl");
  });

  it("omits auth entirely when SMTP_USER is unset", async () => {
    setEnv({ SMTP_HOST: "smtp.example.com" });
    sendMailMock.mockResolvedValue({ messageId: "<test>" });
    await sendEmail({ to: "x@y.com", subject: "s", text: "t" });
    expect(createdConfigs[0].auth).toBeUndefined();
  });

  it("sets explicit connection / greeting / socket timeouts", async () => {
    setEnv({ SMTP_HOST: "smtp.example.com", SMTP_USER: "u", SMTP_PASS: "p" });
    sendMailMock.mockResolvedValue({ messageId: "<test>" });
    await sendEmail({ to: "x@y.com", subject: "s", text: "t" });
    expect(createdConfigs[0]).toMatchObject({
      connectionTimeout: 15000,
      greetingTimeout: 10000,
      socketTimeout: 30000,
    });
  });

  it("defaults port to 587 when SMTP_PORT is unset", async () => {
    setEnv({ SMTP_HOST: "smtp.example.com", SMTP_USER: "u", SMTP_PASS: "p" });
    sendMailMock.mockResolvedValue({ messageId: "<test>" });
    await sendEmail({ to: "x@y.com", subject: "s", text: "t" });
    expect(createdConfigs[0].port).toBe(587);
  });

  it("invalidates cached transporter when SMTP_HOST changes at runtime", async () => {
    setEnv({ SMTP_HOST: "smtp.first.com", SMTP_USER: "u", SMTP_PASS: "p" });
    sendMailMock.mockResolvedValue({ messageId: "<test>" });
    await sendEmail({ to: "x@y.com", subject: "s", text: "t" });
    setEnv({ SMTP_HOST: "smtp.second.com" });
    await sendEmail({ to: "x@y.com", subject: "s", text: "t" });
    expect(createdConfigs).toHaveLength(2);
    expect(createdConfigs[0].host).toBe("smtp.first.com");
    expect(createdConfigs[1].host).toBe("smtp.second.com");
  });
});

/* ============================================================
 * sendMail invocation — replyTo normalization
 * ============================================================ */

describe("emailSender — sendMail call shape", () => {
  it("passes replyTo=undefined when SMTP_REPLY_TO is empty string", async () => {
    setEnv({
      SMTP_HOST: "smtp.example.com",
      SMTP_USER: "u",
      SMTP_PASS: "p",
      SMTP_FROM: "Capavate <noreply@capavate.io>",
      SMTP_REPLY_TO: "", // exactly Avi's earlier case
    });
    sendMailMock.mockResolvedValue({ messageId: "<test>" });
    await sendEmail({ to: "x@y.com", subject: "s", text: "t" });
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const callArg = sendMailMock.mock.calls[0][0];
    expect(callArg.replyTo).toBeUndefined();
  });

  it("passes replyTo through when SMTP_REPLY_TO is a real address", async () => {
    setEnv({
      SMTP_HOST: "smtp.example.com",
      SMTP_USER: "u",
      SMTP_PASS: "p",
      SMTP_REPLY_TO: "support@capavate.io",
    });
    sendMailMock.mockResolvedValue({ messageId: "<test>" });
    await sendEmail({ to: "x@y.com", subject: "s", text: "t" });
    expect(sendMailMock.mock.calls[0][0].replyTo).toBe("support@capavate.io");
  });

  it("treats whitespace-only SMTP_REPLY_TO as undefined", async () => {
    setEnv({
      SMTP_HOST: "smtp.example.com",
      SMTP_USER: "u",
      SMTP_PASS: "p",
      SMTP_REPLY_TO: "   ",
    });
    sendMailMock.mockResolvedValue({ messageId: "<test>" });
    await sendEmail({ to: "x@y.com", subject: "s", text: "t" });
    expect(sendMailMock.mock.calls[0][0].replyTo).toBeUndefined();
  });
});

/* ============================================================
 * SMTP_MODE switch
 * ============================================================ */

describe("emailSender — SMTP_MODE", () => {
  it("disabled mode short-circuits and returns transportAccepted=false", async () => {
    setEnv({ SMTP_MODE: "disabled" });
    const r = await sendEmail({ to: "x@y.com", subject: "s", text: "t" });
    expect(r).toEqual({ transportAccepted: false, mode: "disabled" });
    expect(sendMailMock).not.toHaveBeenCalled();
    expect(createdConfigs).toHaveLength(0);
  });

  it("dry_run mode does not call sendMail and returns transportAccepted=true", async () => {
    setEnv({ SMTP_MODE: "dry_run" });
    const r = await sendEmail({ to: "x@y.com", subject: "s", text: "t" });
    expect(r.transportAccepted).toBe(true);
    expect(r.mode).toBe("dry_run");
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("console mode does not call sendMail and returns transportAccepted=true", async () => {
    setEnv({ SMTP_MODE: "console" });
    const r = await sendEmail({ to: "x@y.com", subject: "s", text: "t" });
    expect(r.transportAccepted).toBe(true);
    expect(r.mode).toBe("console");
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("smtp mode with no SMTP_HOST returns transportAccepted=false with copy-link fallback", async () => {
    setEnv({ SMTP_MODE: "smtp" });
    const r = await sendEmail({ to: "x@y.com", subject: "s", text: "t" });
    expect(r.transportAccepted).toBe(false);
    expect(r.mode).toBe("smtp");
    expect(r.error).toBe("smtp_not_configured");
    expect(r.fallback).toMatch(/SMTP_HOST/i);
  });

  it("propagates SMTP send error into result.error and result.fallback", async () => {
    setEnv({ SMTP_HOST: "smtp.example.com", SMTP_USER: "u", SMTP_PASS: "p" });
    sendMailMock.mockRejectedValue(new Error("connection refused"));
    const r = await sendEmail({ to: "x@y.com", subject: "s", text: "t" });
    expect(r.transportAccepted).toBe(false);
    expect(r.error).toBe("smtp_send_failed");
    expect(r.fallback).toContain("connection refused");
  });
});

/* ============================================================
 * verifyTransport — admin diagnostic
 * ============================================================ */

describe("emailSender — verifyTransport diagnostic", () => {
  it("returns ok=true for dry_run mode", async () => {
    setEnv({ SMTP_MODE: "dry_run" });
    const r = await verifyTransport();
    expect(r).toEqual({ ok: true, mode: "dry_run" });
  });

  it("returns ok=true for console mode", async () => {
    setEnv({ SMTP_MODE: "console" });
    const r = await verifyTransport();
    expect(r.ok).toBe(true);
    expect(r.mode).toBe("console");
  });

  it("returns mode=disabled with hint when SMTP_MODE=disabled", async () => {
    setEnv({ SMTP_MODE: "disabled" });
    const r = await verifyTransport();
    expect(r.ok).toBe(false);
    expect(r.mode).toBe("disabled");
    expect(r.hint).toMatch(/SMTP_MODE=disabled/i);
  });

  it("returns mode=not_configured with hint when SMTP_HOST unset", async () => {
    const r = await verifyTransport();
    expect(r.ok).toBe(false);
    expect(r.mode).toBe("not_configured");
    expect(r.hint).toMatch(/SMTP_HOST not set/i);
  });

  it("returns ok=true with host/port/secure when verify() succeeds", async () => {
    setEnv({
      SMTP_HOST: "smtp.gmail.com",
      SMTP_PORT: "465",
      SMTP_SECURE: "true",
      SMTP_USER: "u",
      SMTP_PASS: "p",
    });
    verifyMock.mockResolvedValue(true);
    const r = await verifyTransport();
    expect(r.ok).toBe(true);
    expect(r.host).toBe("smtp.gmail.com");
    expect(r.port).toBe(465);
    expect(r.secure).toBe(true);
  });

  it("Gmail 535-5.7.8 auth error → hint mentions App Password", async () => {
    setEnv({
      SMTP_HOST: "smtp.gmail.com",
      SMTP_PORT: "465",
      SMTP_SECURE: "true",
      SMTP_USER: "u",
      SMTP_PASS: "wrong",
    });
    verifyMock.mockRejectedValue(
      new Error("Invalid login: 535-5.7.8 Username and Password not accepted"),
    );
    const r = await verifyTransport();
    expect(r.ok).toBe(false);
    expect(r.hint).toMatch(/App Password/i);
  });

  it("TLS/SSL error → hint mentions port/secure mismatch", async () => {
    setEnv({
      SMTP_HOST: "smtp.gmail.com",
      SMTP_PORT: "465",
      SMTP_SECURE: "false", // misconfigured
      SMTP_USER: "u",
      SMTP_PASS: "p",
    });
    verifyMock.mockRejectedValue(new Error("wrong version number"));
    const r = await verifyTransport();
    expect(r.ok).toBe(false);
    expect(r.hint).toMatch(/port=465.*SMTP_SECURE=true|mutually exclusive/i);
  });

  it("ENOTFOUND → hint mentions DNS/firewall", async () => {
    setEnv({
      SMTP_HOST: "smtp.doesnotexist.example",
      SMTP_USER: "u",
      SMTP_PASS: "p",
    });
    verifyMock.mockRejectedValue(
      new Error("getaddrinfo ENOTFOUND smtp.doesnotexist.example"),
    );
    const r = await verifyTransport();
    expect(r.ok).toBe(false);
    expect(r.hint).toMatch(/firewall|outbound|DNS/i);
  });

  it("ECONNREFUSED → hint mentions network reachability", async () => {
    setEnv({ SMTP_HOST: "smtp.example.com", SMTP_USER: "u", SMTP_PASS: "p" });
    verifyMock.mockRejectedValue(new Error("connect ECONNREFUSED 1.2.3.4:587"));
    const r = await verifyTransport();
    expect(r.ok).toBe(false);
    expect(r.hint).toMatch(/firewall|outbound|DNS/i);
  });

  it("unknown error → returns ok=false with raw error and no hint", async () => {
    setEnv({ SMTP_HOST: "smtp.example.com", SMTP_USER: "u", SMTP_PASS: "p" });
    verifyMock.mockRejectedValue(new Error("something obscure"));
    const r = await verifyTransport();
    expect(r.ok).toBe(false);
    expect(r.error).toBe("something obscure");
    expect(r.hint).toBeUndefined();
  });
});
