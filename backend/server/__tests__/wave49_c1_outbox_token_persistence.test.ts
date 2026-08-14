/**
 * WAVE 49 · C-1 — no raw single-use token may ever be persisted or returned.
 *
 * ============================================================
 * WHAT WAS WRONG
 * ============================================================
 * Wave 47 (R19) routed transactional mail through `enqueueTransactional`, which
 * stored the RENDERED BODY on the outbox row; `persistOutbox` serialises the
 * whole row into `kv_emailStoreOutbox.payload_json`, and the admin outbox
 * endpoints returned the raw rows. Those bodies carried the RAW
 * `auth_redeem_tokens` value — partner invites (14 days) and password resets
 * (24 hours). Any platform admin could call the public, unmetered
 * `POST /api/auth/forgot` for any user, read that user's reset link out of the
 * outbox, and take the account over.
 *
 * ============================================================
 * BOTH POLES, ASSERTED SEPARATELY — this is the whole point
 * ============================================================
 * POLE A (R19 must survive): the durable outbox row still EXISTS and is still
 *   USEFUL — recipient, subject, template/category, status, attempt count,
 *   queued time, sent time, and the honest `deliveredAt: null` for a transport
 *   that cannot prove delivery.
 * POLE B (the secret must be gone): the raw token appears NOWHERE — not in the
 *   in-memory row, not in `kv_emailStoreOutbox.payload_json` for ANY row, not in
 *   the `GET /api/admin/email/outbox` response, not in the second reader
 *   `GET /api/admin/email/transport/outbox`.
 *
 * A redactor that destroyed everything would pass Pole B and fail Pole A, so the
 * unit poles below ALSO assert that benign text — names, org names, prose,
 * ordinary product URLs, short slugs, ISO timestamps, money strings, outbox and
 * token IDs — comes back BYTE-IDENTICAL.
 *
 * The persisted-row check uses `findTokenMaterialFields`, the SAME predicate the
 * production code enforces, walking every field of the row rather than the two
 * fields Review C happened to name. It fails if a token-shaped string is ever
 * persisted anywhere in the row.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import crypto from "crypto";

import { installV14TestIdentity } from "./_v14TestIdentity";
import { rawDb } from "../db/connection";
import { registerEmailRoutes, _testEmail, listOutbox } from "../emailStore";
import { registerEmailTransportRoutes } from "../emailCampaignStore";
import {
  sendEmail,
  __setEmailTransportForTests,
  type InjectedEmailTransport,
} from "../lib/emailSender";
import {
  redactTokenMaterial,
  containsTokenMaterial,
  findTokenMaterialFields,
  TOKEN_REDACTION_MARKER,
} from "../lib/emailTokenRedaction";

let app: express.Express;

beforeAll(() => {
  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: true });
  registerEmailRoutes(app);
  registerEmailTransportRoutes(app);
});

beforeEach(() => {
  _testEmail.reset();
  __setEmailTransportForTests(null);
});

afterAll(() => {
  __setEmailTransportForTests(null);
});

/* ── helpers ────────────────────────────────────────────────────────────── */

function fakeTransport(
  outcome: { ok: true } | { ok: false; error: string; permanent?: boolean },
  seen: Array<{ to: string; subject: string; text: string }>,
): InjectedEmailTransport {
  return {
    async send(msg) {
      seen.push({ to: msg.to, subject: msg.subject, text: msg.text });
      return outcome.ok
        ? { accepted: true }
        : { accepted: false, error: outcome.error, permanent: outcome.permanent === true };
    },
  };
}

/**
 * A token of exactly the shape this tree mints, generated freshly per test so no
 * literal in this file can ever be the thing that makes an assertion pass.
 * `authRoutes.ts:453` and `consortiumApplyStore.ts:1474` both use
 * `randomBytes(32).toString("hex")`.
 */
function mintRawToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** Every persisted payload in the durable outbox table, parsed. */
function persistedPayloads(): unknown[] {
  const rows = rawDb()
    .prepare(`SELECT payload_json FROM kv_emailStoreOutbox`)
    .all() as Array<{ payload_json: string }>;
  return rows.map((r) => JSON.parse(r.payload_json));
}

/** The raw text of every persisted payload — a substring search that cannot be
 *  fooled by an unexpected field name or a nested object. */
function persistedRawText(): string {
  const rows = rawDb()
    .prepare(`SELECT payload_json FROM kv_emailStoreOutbox`)
    .all() as Array<{ payload_json: string }>;
  return rows.map((r) => r.payload_json).join("\n");
}

/* ══════════════════════════════════════════════════════════════════════════
 * PART 1 — the redactor itself, both poles
 * ══════════════════════════════════════════════════════════════════════════ */

describe("WAVE 49 · C-1 · redactor — POLE B: token-shaped material is caught", () => {
  it("removes the raw token from a password-reset URL (?token=)", () => {
    const raw = mintRawToken();
    const out = redactTokenMaterial(`Click http://localhost:5000/auth/set-password?token=${raw} to continue.`);
    expect(out).not.toContain(raw);
    expect(out).toContain(TOKEN_REDACTION_MARKER);
    // The observable part of the URL survives — this is not a blunt instrument.
    expect(out).toContain("/auth/set-password?token=");
    expect(out).toContain("to continue.");
  });

  it("removes the raw token from a partner-invite path segment", () => {
    const raw = mintRawToken();
    const out = redactTokenMaterial(`https://app.capavate.com/auth/redeem-partner-invite/${raw}`);
    expect(out).not.toContain(raw);
    expect(out).toContain("/auth/redeem-partner-invite/");
    expect(out).toContain(TOKEN_REDACTION_MARKER);
  });

  it("removes a bare token pasted into prose, with no URL around it at all", () => {
    const raw = mintRawToken();
    const out = redactTokenMaterial(`Your code is ${raw} — do not share it.`);
    expect(out).not.toContain(raw);
    expect(out).toBe(`Your code is ${TOKEN_REDACTION_MARKER} — do not share it.`);
  });

  it("removes the shorter randomBytes(24) invite token this tree also mints", () => {
    // partnerWorkspaceStore.ts:1418/1486 — 24 bytes = 48 hex characters.
    const raw = crypto.randomBytes(24).toString("hex");
    expect(raw).toHaveLength(48);
    expect(containsTokenMaterial(raw)).toBe(true);
    expect(redactTokenMaterial(raw)).not.toContain(raw);
  });

  it("removes a base64url token (routes.ts:3405 mints one)", () => {
    const raw = crypto.randomBytes(32).toString("base64url");
    const out = redactTokenMaterial(`/investor/signup?token=${raw}`);
    expect(out).not.toContain(raw);
  });

  it("removes the token from an HTML anchor href and its visible text", () => {
    const raw = mintRawToken();
    const html = `<p><a href="http://x/auth/set-password?token=${raw}">Reset password</a></p>`;
    const out = redactTokenMaterial(html);
    expect(out).not.toContain(raw);
    // The closing quote and the surrounding markup are intact, so the row stays
    // renderable in the admin UI rather than becoming broken HTML.
    expect(out).toContain(`">Reset password</a></p>`);
  });

  it("catches every token even when several appear in one body", () => {
    const a = mintRawToken();
    const b = mintRawToken();
    const out = redactTokenMaterial(`first ?token=${a} then /redeem/${b} end`);
    expect(out).not.toContain(a);
    expect(out).not.toContain(b);
  });
});

describe("WAVE 49 · C-1 · redactor — POLE A: benign text is byte-identical", () => {
  const benign = [
    "Reset your Capavate password",
    "Welcome to the Capavate Consortium, Northstar Capital Partners LLC",
    "Wanda Wave <wanda.wave@northstar-capital.example.com>",
    "Your application to chap_keiretsu_canada was approved on 2026-08-14T05:08:00.000Z",
    "Invoice INV-2026-000417 for USD 12,500.00 (1250000 minor units, JPY exponent 0 unaffected)",
    "Visit https://app.capavate.com/partner/workspace/overview?tab=team&sort=name",
    "https://capavate.com/pricing",
    "See http://localhost:5000/auth/set-password for instructions",
    "/auth/redeem/help",
    "/invite/new",
    "ob_9f2a1c",
    "tk_a1b2c3d4e5f6",
    "app_01HQ8ZK3",
    "550 mailbox unavailable",
    "ETIMEDOUT connecting to smtp.example.com:587",
    "canceled_by_admin",
    "partner_welcome",
    "managing_partner seat granted on org_northstar",
    "A perfectly ordinary sentence with a long hyphenated-compound-word-construction inside it.",
    "deadbeef",
    "0123456789abcdef",
    "Thank you — the Capavate team",
  ];

  for (const s of benign) {
    it(`leaves untouched: ${JSON.stringify(s.slice(0, 56))}`, () => {
      expect(redactTokenMaterial(s)).toBe(s);
      expect(containsTokenMaterial(s)).toBe(false);
    });
  }

  it("preserves null and undefined rather than coercing them to a string", () => {
    // A redactor that turned `null` into `""` would silently change the meaning
    // of "no error recorded" on every outbox row.
    expect(redactTokenMaterial(null)).toBeNull();
    expect(redactTokenMaterial(undefined)).toBeUndefined();
    expect(containsTokenMaterial(null)).toBe(false);
  });

  it("is IDEMPOTENT — redacting already-redacted text changes nothing", () => {
    /* This is a correctness requirement, not a nicety, and it was a real defect
     * found by running this test: the rule-1 value class swallowed the leading
     * `[` of the marker, so `?token=[REDACTED:TOKEN]` re-matched. Because
     * `containsTokenMaterial` is defined as "redacting changes the string", the
     * C-1 assertion then fired on a perfectly clean row — a false positive that
     * would have made the whole gate meaningless. The redactor runs at several
     * boundaries (enqueue, persist, every read projection), so scrubbed text
     * passes through it repeatedly by design. */
    const raw = mintRawToken();
    for (const input of [
      `http://localhost:5000/auth/set-password?token=${raw}`,
      `<p><a href="http://x/auth/set-password?token=${raw}">Reset password</a></p>`,
      `https://app.capavate.com/auth/redeem-partner-invite/${raw}`,
      `Your code is ${raw} — do not share it.`,
    ]) {
      const once = redactTokenMaterial(input);
      expect(redactTokenMaterial(once), "second pass must be a no-op").toBe(once);
      expect(containsTokenMaterial(once), "scrubbed output must read as clean").toBe(false);
      expect(findTokenMaterialFields({ body: once })).toEqual([]);
    }
  });

  it("leaves a 31-character hex run alone and catches a 32-character one", () => {
    // The floor is deliberate and testable from both sides.
    const thirtyOne = "a".repeat(31);
    const thirtyTwo = "a".repeat(32);
    expect(containsTokenMaterial(thirtyOne)).toBe(false);
    expect(containsTokenMaterial(thirtyTwo)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * PART 2 — the real send path, end to end, both poles
 * ══════════════════════════════════════════════════════════════════════════ */

describe("WAVE 49 · C-1 · a password-reset send leaves an observable row with NO secret in it", () => {
  it("POLE A: the durable row exists and carries everything R19 asked for", async () => {
    const raw = mintRawToken();
    const seen: Array<{ to: string; subject: string; text: string }> = [];
    __setEmailTransportForTests(fakeTransport({ ok: true }, seen));

    const before = listOutbox().length;
    const result = await sendEmail({
      to: "victim@example.com",
      subject: "Reset your Capavate password",
      text: `Click the link below to set a new password (valid for 24 hours):\n\nhttp://localhost:5000/auth/set-password?token=${raw}\n`,
      html: `<p><a href="http://localhost:5000/auth/set-password?token=${raw}">Reset password</a></p>`,
      category: "password_reset",
      refId: "tk_w49c1a",
    });

    expect(result.outboxId, "R19 requires a durable row for every transactional send").toBeTruthy();
    expect(listOutbox().length).toBe(before + 1);

    const row = listOutbox().find((r) => r.id === result.outboxId)!;
    expect(row, "the row must be findable by the id the sender was handed").toBeTruthy();
    expect(row.recipient).toBe("victim@example.com");
    expect(row.subject).toBe("Reset your Capavate password");
    expect(row.status).toBe("sent");
    expect(row.attempts).toBeGreaterThanOrEqual(1);
    expect(row.queuedAt, "queued time").toBeTruthy();
    expect(row.sentAt, "sent time").toBeTruthy();
    // Honest status: this transport accepted the message but cannot prove a
    // mailbox received it, so `delivered` is NOT claimed.
    expect(row.deliveredAt).toBeNull();

    // Observability is genuinely useful: the operator can still see the
    // template/category the send belongs to.
    expect(String(row.templateSlug ?? "")).toContain("password_reset");

    // And the RECIPIENT still got a working link — the secret was rendered at
    // dispatch time and lives only in the transport's local message.
    expect(seen).toHaveLength(1);
    expect(seen[0].text, "the real email must still contain the real token").toContain(raw);
  });

  it("POLE B: the raw token is nowhere in the row, the table, or either API reader", async () => {
    const raw = mintRawToken();
    __setEmailTransportForTests(fakeTransport({ ok: true }, []));

    const result = await sendEmail({
      to: "victim2@example.com",
      subject: "Reset your Capavate password",
      text: `http://localhost:5000/auth/set-password?token=${raw}`,
      html: `<p><a href="http://localhost:5000/auth/set-password?token=${raw}">Reset password</a></p>`,
      category: "password_reset",
      refId: "tk_w49c1b",
    });

    const row = listOutbox().find((r) => r.id === result.outboxId)!;

    // 1 — the in-memory row, every field, via the production predicate.
    expect(
      findTokenMaterialFields(row),
      "no field of the outbox row may hold token material",
    ).toEqual([]);
    expect(JSON.stringify(row)).not.toContain(raw);

    // 2 — the durable table, EVERY row, as raw text. This is the assertion that
    //     fails if a token-shaped string is ever persisted.
    const payloadText = persistedRawText();
    expect(payloadText).not.toContain(raw);
    for (const p of persistedPayloads()) {
      expect(
        findTokenMaterialFields(p),
        "kv_emailStoreOutbox.payload_json must never hold token material",
      ).toEqual([]);
    }

    // 3 — the reader Review C named.
    const r1 = await request(app)
      .get("/api/admin/email/outbox")
      .set("x-user-id", "u_admin")
      .set("x-role", "admin");
    expect(r1.status).toBe(200);
    expect(JSON.stringify(r1.body)).not.toContain(raw);
    expect(findTokenMaterialFields(r1.body)).toEqual([]);

    // 4 — the SECOND reader, which Review C did not name and which was an
    //     equally good source for a live reset link.
    const r2 = await request(app)
      .get("/api/admin/email/transport/outbox")
      .set("x-user-id", "u_admin")
      .set("x-role", "admin");
    expect(r2.status).toBe(200);
    expect(JSON.stringify(r2.body)).not.toContain(raw);
    expect(findTokenMaterialFields(r2.body)).toEqual([]);
  });

  it("POLE B: a FAILED send does not leak the token through the error path either", async () => {
    const raw = mintRawToken();
    // A relay that quotes the message back is exactly how a token reaches an
    // error string, and `error` is persisted and returned like any other field.
    __setEmailTransportForTests(
      fakeTransport({ ok: false, error: `550 rejected: body contained ${raw}`, permanent: true }, []),
    );

    const result = await sendEmail({
      to: "victim3@example.com",
      subject: "Reset your Capavate password",
      text: `http://localhost:5000/auth/set-password?token=${raw}`,
      category: "password_reset",
      refId: "tk_w49c1c",
    });

    const row = listOutbox().find((r) => r.id === result.outboxId)!;
    /* POLE A survives: the failure is still observable, with a reason. A
     * PERMANENT transport rejection is recorded as `bounced` with `bouncedAt`
     * (`recordTransactionalOutcome`); a transient one is `failed`. Asserted
     * against what the code actually does, not against a guess. */
    expect(row.status).toBe("bounced");
    expect(row.bouncedAt).toBeTruthy();
    expect(row.sentAt, "a message that did not go must carry no send time").toBeNull();
    expect(row.deliveredAt).toBeNull();
    expect(row.error, "the failure reason must still be recorded").toBeTruthy();
    // POLE B: but not the secret.
    expect(row.error!).not.toContain(raw);
    expect(row.error!).toContain("550 rejected");
    expect(findTokenMaterialFields(row)).toEqual([]);
    expect(persistedRawText()).not.toContain(raw);
    expect(JSON.stringify(result)).not.toContain(raw);
  });

  it("POLE A: a send with NO token in it is stored completely intact", async () => {
    // The counter-test for the whole mechanism. If redaction were over-broad,
    // ordinary transactional mail would arrive in the outbox mangled.
    const subject = "Your Capavate invoice INV-2026-000418 is ready";
    const text = "Your invoice for USD 12,500.00 is available at https://app.capavate.com/partner/billing";
    __setEmailTransportForTests(fakeTransport({ ok: true }, []));

    const result = await sendEmail({
      to: "cfo@northstar-capital.example.com",
      subject,
      text,
      html: `<p>${text}</p>`,
      category: "invoice_issued",
      refId: "inv_w49c1",
    });

    const row = listOutbox().find((r) => r.id === result.outboxId)!;
    expect(row.subject).toBe(subject);
    expect(row.bodyText).toBe(text);
    expect(row.bodyRedacted ?? false, "nothing was removed, so nothing is flagged").toBe(false);

    const persisted = persistedPayloads().find((p: any) => p?.id === result.outboxId) as any;
    expect(persisted, "the row must be durably persisted, not just in memory").toBeTruthy();
    expect(persisted.subject).toBe(subject);
    expect(persisted.bodyText).toBe(text);
  });

  it("a token-bearing row is FLAGGED, and the flag is what makes the consequence honest", async () => {
    const raw = mintRawToken();
    __setEmailTransportForTests(fakeTransport({ ok: true }, []));
    const result = await sendEmail({
      to: "victim4@example.com",
      subject: "Reset your Capavate password",
      text: `http://localhost:5000/auth/set-password?token=${raw}`,
      category: "password_reset",
      refId: "tk_w49c1d",
    });
    const row = listOutbox().find((r) => r.id === result.outboxId)!;
    // `bodyRedacted` is not decoration: `tickQueue` and both retry readers refuse
    // such a row, so a recipient can never be mailed a dead `[REDACTED:TOKEN]`
    // link. The secret is unrecoverable BY DESIGN — a new token must be issued.
    expect(row.bodyRedacted).toBe(true);

    /* Drive the row to `bounced` so it reaches the retry route's status gate —
     * otherwise a `sent` row is refused for an unrelated reason and this test
     * would pass without ever exercising the C-1 guard. */
    row.status = "bounced";
    const retry = await request(app)
      .post(`/api/admin/email/transport/outbox/${row.id}/retry`)
      .set("x-user-id", "u_admin")
      .set("x-role", "admin")
      .set("x-confirm", "true")
      .send({});
    // Refused with a typed reason rather than silently mailing a broken link.
    expect(retry.status, JSON.stringify(retry.body)).toBe(400);
    expect(retry.body.error).toBe("item_not_retryable");
    expect(retry.body.reason).toBe("token_bearing_body_not_resendable_reissue_required");
    expect(row.status, "the refusal must not have re-queued it").toBe("bounced");
  });

  it("POLE A: a CLEAN bounced row is still retryable — the guard is not a blanket refusal", async () => {
    /* The counter-pole for the guard above. A retry path that refused everything
     * would pass the one-sided test and break the admin's real recovery flow. */
    __setEmailTransportForTests(fakeTransport({ ok: false, error: "550 mailbox full", permanent: true }, []));
    const result = await sendEmail({
      to: "cfo2@northstar-capital.example.com",
      subject: "Your Capavate invoice INV-2026-000419 is ready",
      text: "Your invoice is available at https://app.capavate.com/partner/billing",
      category: "invoice_issued",
      refId: "inv_w49c1b",
    });
    const row = listOutbox().find((r) => r.id === result.outboxId)!;
    expect(row.status).toBe("bounced");
    expect(row.bodyRedacted ?? false).toBe(false);

    const retry = await request(app)
      .post(`/api/admin/email/transport/outbox/${row.id}/retry`)
      .set("x-user-id", "u_admin")
      .set("x-role", "admin")
      .set("x-confirm", "true")
      .send({});
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
    expect(retry.body.ok).toBe(true);
    expect(row.status, "a clean row IS re-queued").toBe("queued");
  });
});
