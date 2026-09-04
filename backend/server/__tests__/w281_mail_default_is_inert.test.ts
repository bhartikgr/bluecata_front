/**
 * server/__tests__/w281_mail_default_is_inert.test.ts
 *
 * WAVE 281 · OWNER RULING R243.1 — THE MAIL SENDER'S DEFAULT IS NON-SENDING
 * UNLESS NODE_ENV === "production".
 *
 * ── WHAT THIS PROVES, AND WHY IT IS TWO CLAIMS AND NOT ONE ────────────────────
 *
 * The defect (R243.1, the owner's own incident R241.0): `server/lib/emailSender.ts`
 * read `(process.env.SMTP_MODE ?? "smtp")` at TWO sites, so a local instance that
 * loaded the live Gmail credentials sitting in `work/.env` made REAL SEND ATTEMPTS
 * from the owner's business address. The safe modes existed; the default was the
 * unsafe one.
 *
 * The fix must therefore prove TWO OPPOSITE THINGS, and the second is the one that
 * matters more:
 *
 *   1. OUTSIDE production, with SMTP_MODE unset, the sender is INERT.
 *   2. INSIDE production, with SMTP_MODE unset, the sender behaves EXACTLY AS
 *      BEFORE. An over-tight guard would silently disable every invitation, reset
 *      and notification on the live platform — far worse than the problem it
 *      solves. §S2, §S3 and §S4b are that proof, and disarm D2 exists to show they
 *      are load-bearing rather than decorative.
 *
 * ── INERTNESS IS ASSERTED POSITIVELY, NEVER AS AN ABSENCE ─────────────────────
 *
 * "No mail was sent" is not observable by looking for nothing. Every case that
 * could reach a transport installs an IN-PROCESS SPY via
 * `__setEmailTransportForTests` and asserts the CALL COUNT — 0 when inert, 1 when
 * sending. That is inert-proof mechanism 4 applied to my own test: a guard that
 * merely EXISTS proves nothing; this proves the transport was or was not REACHED.
 *
 * NO SOCKET IS EVER OPENED AND NO CREDENTIAL IS EVER READ. `SMTP_HOST` is only
 * ever set to a `.invalid` name that cannot resolve, the spy takes precedence over
 * nodemailer inside `sendEmail`, and `verifyTransport` is only driven on paths that
 * return before `t.verify()`. `SMTP_MODE=dry_run` is additionally forced on the
 * command line for every run of this file.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  sendEmail,
  verifyTransport,
  resolveSmtpMode,
  __setEmailTransportForTests,
  _resetTransporterCacheForTests,
  type InjectedEmailTransport,
} from "../lib/emailSender";

/** Every environment key this file touches, saved once and restored after each
 *  case so no ordering between tests — or between this file and any other file in
 *  the suite — can leak a NODE_ENV of "production" into a neighbour. */
const KEYS = ["NODE_ENV", "SMTP_MODE", "SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"] as const;
const SAVED: Record<string, string | undefined> = {};

/** A transport that records that it was reached. The COUNT is the evidence. */
function spyTransport(): { transport: InjectedEmailTransport; calls: () => number } {
  let n = 0;
  return {
    transport: {
      async send() {
        n += 1;
        return { accepted: true };
      },
    },
    calls: () => n,
  };
}

function setEnv(patch: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeEach(() => {
  for (const k of KEYS) SAVED[k] = process.env[k];
  _resetTransporterCacheForTests();
  __setEmailTransportForTests(null);
});

afterEach(() => {
  __setEmailTransportForTests(null);
  _resetTransporterCacheForTests();
  for (const k of KEYS) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k] as string;
  }
});

/* ════════════════════════════════════════════════════════════════════════════ *
 *  §S1 — OUTSIDE PRODUCTION WITH SMTP_MODE UNSET, THE SENDER IS INERT.
 * ════════════════════════════════════════════════════════════════════════════ */

describe("W281 · S1 — SMTP_MODE unset outside production is INERT", () => {
  it("S1a — sendEmail returns a dry-run result and NEVER reaches the transport", async () => {
    /* The exact shape of the incident: credentials present, mode forgotten. */
    setEnv({
      NODE_ENV: "test",
      SMTP_MODE: undefined,
      SMTP_HOST: "smtp.w281-must-never-be-dialled.invalid",
      SMTP_USER: "owner@example.invalid",
      SMTP_PASS: "aaaabbbbccccdddd",
    });
    const spy = spyTransport();
    __setEmailTransportForTests(spy.transport);

    const r = await sendEmail({ to: "w281@inert.test", subject: "w281 S1a", text: "body" });

    expect(r.mode).toBe("dry_run");
    expect(r.transportAccepted).toBe(true);
    expect(r.status).toBe("sent");
    /* THE LOAD-BEARING ASSERTION. Not "no error was thrown" — the transport was
       never reached, counted. */
    expect(spy.calls()).toBe(0);
  });

  it("S1b — the resolver itself says dry_run, with credentials present", () => {
    setEnv({ NODE_ENV: "test", SMTP_MODE: undefined, SMTP_HOST: "smtp.w281.invalid" });
    expect(resolveSmtpMode()).toBe("dry_run");
  });
});

/* ════════════════════════════════════════════════════════════════════════════ *
 *  §S2 — PRODUCTION IS UNCHANGED. THE MOST IMPORTANT SECTION IN THIS FILE.
 * ════════════════════════════════════════════════════════════════════════════ */

describe("W281 · S2 — NODE_ENV=production with SMTP_MODE unset still SENDS", () => {
  it("S2a — the transport IS reached exactly once and the mode is smtp", async () => {
    setEnv({
      NODE_ENV: "production",
      SMTP_MODE: undefined,
      SMTP_HOST: "smtp.w281-never-dialled.invalid",
      SMTP_USER: "u",
      SMTP_PASS: "p",
    });
    const spy = spyTransport();
    __setEmailTransportForTests(spy.transport);

    const r = await sendEmail({ to: "w281@prod.test", subject: "w281 S2a", text: "body" });

    expect(r.mode).toBe("smtp");
    expect(r.transportAccepted).toBe(true);
    expect(r.status).toBe("sent");
    /* PRODUCTION MAIL IS NOT DISABLED. Asserted as a count, not as a mode string,
       because a mode string is a claim and a call count is an observation. */
    expect(spy.calls()).toBe(1);
  });

  it("S2b — resolveSmtpMode() under production with SMTP_MODE unset is exactly 'smtp'", () => {
    setEnv({ NODE_ENV: "production", SMTP_MODE: undefined });
    expect(resolveSmtpMode()).toBe("smtp");
  });
});

/* ════════════════════════════════════════════════════════════════════════════ *
 *  §S3 — PRODUCTION PARITY ON THE MISCONFIGURED PATH.
 *
 *  Reproduces, byte for byte, what the pre-wave code returned when SMTP_MODE was
 *  unset and no host was configured. Recorded here from the pre-wave behaviour
 *  (`emailSender.test.ts` pinned the same three fields for an EXPLICIT
 *  SMTP_MODE=smtp), so this proves parity rather than re-pinning the new code.
 * ════════════════════════════════════════════════════════════════════════════ */

describe("W281 · S3 — production with no SMTP_HOST answers exactly as before", () => {
  it("S3a — smtp_not_configured, with the copy-link fallback intact", async () => {
    setEnv({ NODE_ENV: "production", SMTP_MODE: undefined, SMTP_HOST: undefined });
    /* No injected transport: this is the real `!injected && !t` branch. */
    const r = await sendEmail({ to: "w281@prod.test", subject: "w281 S3a", text: "body" });
    expect(r.transportAccepted).toBe(false);
    expect(r.mode).toBe("smtp");
    expect(r.error).toBe("smtp_not_configured");
    expect(r.fallback).toMatch(/SMTP_HOST/i);
    expect(r.status).toBe("failed");
  });
});

/* ════════════════════════════════════════════════════════════════════════════ *
 *  §S4 — THE SECOND READ SITE. verifyTransport was the other half of the defect.
 * ════════════════════════════════════════════════════════════════════════════ */

describe("W281 · S4 — verifyTransport() honours the same rule", () => {
  it("S4a — outside production with SMTP_MODE unset it reports dry_run and probes nothing", async () => {
    setEnv({ NODE_ENV: "test", SMTP_MODE: undefined, SMTP_HOST: "smtp.w281.invalid" });
    const r = await verifyTransport();
    /* Exact-shape check: the dry_run branch returns ONLY these two fields, so a
       host/port leaking in would mean the probe path had been entered. */
    expect(r).toEqual({ ok: true, mode: "dry_run" });
  });

  it("S4b — under production with SMTP_MODE unset and no host it still says not_configured", async () => {
    setEnv({ NODE_ENV: "production", SMTP_MODE: undefined, SMTP_HOST: undefined });
    const r = await verifyTransport();
    expect(r.ok).toBe(false);
    expect(r.mode).toBe("not_configured");
    expect(r.hint).toMatch(/SMTP_HOST not set/i);
  });
});

/* ════════════════════════════════════════════════════════════════════════════ *
 *  §S5 — AN EXPLICIT SMTP_MODE STILL WINS, IN BOTH DIRECTIONS.
 * ════════════════════════════════════════════════════════════════════════════ */

describe("W281 · S5 — an explicit SMTP_MODE overrides the NODE_ENV rule", () => {
  it("S5a — SMTP_MODE=smtp outside production still reaches the transport", async () => {
    setEnv({ NODE_ENV: "test", SMTP_MODE: "smtp", SMTP_HOST: "smtp.w281-never-dialled.invalid" });
    const spy = spyTransport();
    __setEmailTransportForTests(spy.transport);
    const r = await sendEmail({ to: "w281@optin.test", subject: "w281 S5a", text: "body" });
    expect(r.mode).toBe("smtp");
    expect(spy.calls()).toBe(1);
  });

  it("S5b — SMTP_MODE=disabled under production is still honoured (no send)", async () => {
    setEnv({ NODE_ENV: "production", SMTP_MODE: "disabled", SMTP_HOST: "smtp.w281.invalid" });
    const spy = spyTransport();
    __setEmailTransportForTests(spy.transport);
    const r = await sendEmail({ to: "w281@off.test", subject: "w281 S5b", text: "body" });
    expect(r).toEqual({ transportAccepted: false, mode: "disabled" });
    expect(spy.calls()).toBe(0);
  });
});

/* ════════════════════════════════════════════════════════════════════════════ *
 *  §S6 — THE GUARD IS KEYED TO `production`, NOT TO `test`.
 *
 *  The incident was a LOCAL DEV INSTANCE, not a test runner. A guard that only
 *  protected NODE_ENV=test would have left the very machine that caused it still
 *  sending, so this asserts the development pole explicitly rather than assuming
 *  it follows from S1.
 * ════════════════════════════════════════════════════════════════════════════ */

describe("W281 · S6 — a development instance is inert too", () => {
  for (const env of ["development", "staging", undefined] as Array<string | undefined>) {
    it(`S6 — NODE_ENV=${env ?? "(unset)"} with SMTP_MODE unset resolves to dry_run`, async () => {
      setEnv({ NODE_ENV: env, SMTP_MODE: undefined, SMTP_HOST: "smtp.w281.invalid", SMTP_USER: "u", SMTP_PASS: "p" });
      expect(resolveSmtpMode()).toBe("dry_run");
      const spy = spyTransport();
      __setEmailTransportForTests(spy.transport);
      const r = await sendEmail({ to: "w281@dev.test", subject: `w281 S6 ${env}`, text: "body" });
      expect(r.mode).toBe("dry_run");
      expect(spy.calls()).toBe(0);
    });
  }
});

/* ════════════════════════════════════════════════════════════════════════════ *
 *  §S7 — TWO INPUTS THAT ARE EASY TO GET WRONG, AND ONE NON-CHANGE.
 * ════════════════════════════════════════════════════════════════════════════ */

describe("W281 · S7 — blank, padded and unrecognised SMTP_MODE values", () => {
  it("S7a — a padded value is trimmed and honoured", () => {
    setEnv({ NODE_ENV: "test", SMTP_MODE: "  dry_run  " });
    expect(resolveSmtpMode()).toBe("dry_run");
  });

  it("S7b — an EMPTY string is not an instruction; the NODE_ENV rule applies", () => {
    setEnv({ NODE_ENV: "test", SMTP_MODE: "" });
    expect(resolveSmtpMode()).toBe("dry_run");
    setEnv({ NODE_ENV: "production", SMTP_MODE: "" });
    /* Pre-wave, `"" ?? "smtp"` returned `""`, which matched none of the three safe
       branches and therefore fell through to the smtp path. Production behaviour is
       the same; it is now merely legible. */
    expect(resolveSmtpMode()).toBe("smtp");
  });

  it("S7c — an UNRECOGNISED value is passed through unchanged: this wave adds no validation", async () => {
    setEnv({ NODE_ENV: "test", SMTP_MODE: "SMTP", SMTP_HOST: "smtp.w281-never-dialled.invalid" });
    expect(resolveSmtpMode()).toBe("SMTP");
    /* And it still falls through to the smtp branch exactly as it did before, so
       nobody's misspelled deployment starts behaving differently. */
    const spy = spyTransport();
    __setEmailTransportForTests(spy.transport);
    const r = await sendEmail({ to: "w281@raw.test", subject: "w281 S7c", text: "body" });
    expect(spy.calls()).toBe(1);
    expect(r.transportAccepted).toBe(true);
  });
});

/* ════════════════════════════════════════════════════════════════════════════ *
 *  §S8 — THIS FILE'S OWN MAIL SAFETY, ASSERTED RATHER THAN ASSUMED.
 * ════════════════════════════════════════════════════════════════════════════ */

describe("W281 · S8 — the run itself never sends", () => {
  it("S8 — the ambient suite environment is a non-sending one", () => {
    /* Restored by afterEach to whatever the runner set. NODE_ENV is `test` under
       `npm test`, and SMTP_MODE=dry_run is forced on the command line — so BOTH
       independent reasons this process cannot send are asserted, not just one. */
    expect(process.env.NODE_ENV).not.toBe("production");
    expect(resolveSmtpMode()).not.toBe("smtp");
  });
});
