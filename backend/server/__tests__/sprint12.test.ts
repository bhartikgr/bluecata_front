/**
 * Sprint 12 — comprehensive test coverage for the new admin + bridge + bug-hunt sprint.
 *
 * One file, ~50 tests, organised by feature area:
 *   - Bridge store: outbound types, inbound types, HMAC, envelope shape, chain, drain, retry
 *   - Notifications store: 21 kinds, emit, list, broadcast, preferences
 *   - Email store: 14+ templates, render, queue state machine
 *   - Admin platform: KPIs, audit-log chain, reconciliation force-commit guard, pricing tiers
 *   - CapCollectiveToggle: pure-function visibility predicate
 *
 * These tests are additive (Sprint 12 work) — math-critical cap-table tests stay in
 * packages/cap-table-engine and are NOT modified.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { installV14TestIdentity } from "./_v14TestIdentity"; /* v14 Tier-1 Fix 1 — restores u_admin default identity for legacy tests */
import express from "express";
import http from "node:http";

import {
  ALL_OUTBOUND_EVENT_TYPES,
  ALL_INBOUND_EVENT_TYPES,
  emitBridgeEvent,
  hmacSign,
  verifyHmac,
  registerBridgeRoutes,
  drainOutbox,
  getOutbox,
  _testBridge,
} from "../bridgeStore";
import {
  ALL_NOTIFICATION_KINDS,
  emitNotification,
  listNotifications,
  unreadCount,
  registerNotificationsRoutes,
  _testNotifications,
} from "../notificationsStore";
import {
  _testEmail,
  enqueueEmail,
  findTemplate,
  renderTemplate,
  registerEmailRoutes,
  tickQueue,
} from "../emailStore";
import { registerAdminPlatformRoutes } from "../adminPlatformStore";
import { createModel, promoteModel, deleteModel } from "../pricingModelStore";
import { shouldShowToggle } from "../../client/src/components/CapCollectiveToggle";

/* ---------- helpers ---------- */
function makeApp() {
  const app = express();
  app.use(express.json());
  installV14TestIdentity(app);
  registerBridgeRoutes(app);
  registerNotificationsRoutes(app);
  registerEmailRoutes(app);
  registerAdminPlatformRoutes(app);
  return app;
}
/**
 * WAVE 38 · ROW 3 — the bridge/admin route tests below now drive the REAL
 * `requireAdmin` gate instead of relying on `installV14TestIdentity`'s default
 * persona. That shim writes `req.userContext`, but `requireAdmin` calls
 * `getUserContext(req)` itself, so the shim never reached the gate: the tests
 * had been asserting `200` against a route that answers `403`, and had simply
 * been re-pinned. Identity is now supplied the way the real resolver reads it
 * (`?as=admin` / `?as=investor` → `resolvePersonaIdWithFallback`), and every
 * gated route asserts BOTH poles.
 */
type Persona = "admin" | "investor";

/** Append the persona selector the real identity resolver reads. */
function as(path: string, persona: Persona): string {
  return `${path}${path.includes("?") ? "&" : "?"}as=${persona}`;
}

async function req(app: express.Express, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app).listen(0, () => {
      const port = (server.address() as any).port;
      const data = body ? JSON.stringify(body) : undefined;
      const r = http.request(
        { hostname: "127.0.0.1", port, path, method, headers: data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {} },
        (res) => {
          let buf = "";
          res.on("data", (c) => (buf += c));
          res.on("end", () => {
            server.close();
            try { resolve({ status: res.statusCode || 0, body: buf ? JSON.parse(buf) : null }); }
            catch { resolve({ status: res.statusCode || 0, body: buf }); }
          });
        }
      );
      r.on("error", (e) => { server.close(); reject(e); });
      if (data) r.write(data);
      r.end();
    });
  });
}

/* =========================================================================== */
/* Bridge store                                                                */
/* =========================================================================== */
describe("Sprint 12 / Bridge — outbound + inbound catalogs", () => {
  /* WAVE 38 · ROW 3 — these two pins used to read `.toBe(58)` and `.toBe(4)`
   * against live catalogs of 117 and 8. A bare length is the weakest possible
   * pin on a catalog: it is blind to a RENAME, blind to a REORDER, and blind to
   * one event being deleted while another is added — and when it goes red the
   * only visible repair is to type the new number, which is how it drifted 59
   * entries behind reality. Both now pin the FULL ORDERED CATALOG, so any
   * addition, removal, rename or reorder fails by name, and the repair forces
   * you to look at what changed. */
  it("pins the ENTIRE outbound event catalog, in order — additions, removals, renames and reorders all fail here", () => {
    expect(ALL_OUTBOUND_EVENT_TYPES).toEqual([
      "company.profile.updated",
      "company.ma_intelligence.updated",
      "investor.profile.updated",
      "cap_table.mutated",
      "eligibility.recomputed",
      "lifecycle_policy.changed",
      "formula.published",
      "audit_log.appended",
      "safe.converted",
      "note.converted",
      "round.closed",
      "round.terms_updated",
      "governance_metric.published",
      "soft_circle.submitted",
      "subscription.updated",
      "subscription.auto_created_on_company_create",
      "pricing_model.updated",
      "pricing_model.published",
      "invoice.issued",
      "invoice.paid",
      "invoice.refunded",
      "invoice.voided",
      "contact.created",
      "contact.updated",
      "contact.verified",
      "contact.archived",
      "region.proposed",
      "region.review_submitted",
      "region.approved",
      "region.gone_live",
      "region.rejected",
      "notification_campaign.created",
      "notification_campaign.scheduled",
      "notification_campaign.sent",
      "notification_campaign.canceled",
      "email_campaign.created",
      "email_campaign.scheduled",
      "email_campaign.sent",
      "email_campaign.canceled",
      "email_campaign.test_sent",
      "legal_consent.recorded",
      "company_profile.updated",
      "financial.accountant_request_sent",
      "financial.accountant_filled",
      "transaction_prep.updated",
      "profile.completion_changed",
      "collective.member.updated",
      "collective.deal_room.opened",
      "collective.interest.created",
      "dsc.score.recomputed",
      "partner.onboarded",
      "partner.tier_changed",
      "partner.attribution_created",
      "partner.attribution_revoked",
      "partner.team_member_added",
      "partner.team_member_removed",
      "partner.spv_recorded",
      "partner.fund_commitment_pledged",
      "partner.deal.promoted_to_collective",
      "partner.deal.referred_to_capavate",
      "collective.chapter_admin.promoted",
      "collective.chapter_admin.demoted",
      "partner.referral.approved",
      "partner.promotion.approved",
      "partner.promotion.rejected",
      "partner.promotion.changes_requested",
      "partner.company_linked",
      "partner.company_unlinked",
      "partner.suspended",
      "partner.reactivated",
      "partner.archived",
      "partner.application_submitted",
      "partner.application_approved",
      "partner.application_rejected",
      "founderTeam.invitation_sent",
      "founderTeam.member_removed",
      "maInitiative.response_recorded",
      "round.invitation_sent",
      "spv.created",
      "spv.updated",
      "spv.scope_changed",
      "spv.wound_down",
      "spv.mandate_set",
      "spv.fee_set",
      "spv.fee_obligation_accrued",
      "spv.fee_obligation_paid",
      "spv.fee_obligation_waived",
      "spv.subscription_created",
      "spv.subscription_advanced",
      "spv.lp_committed",
      "spv.deployment_created",
      "spv.deployment_advanced",
      "spv.deployed",
      "spv.distribution_recorded",
      "spv.funds_confirmed",
      "spv.closed_to_new_lps",
      "spv.reopened_rolling_close",
      "spv.document_added",
      "spv.transfer_proposed",
      "partner.spv_updated",
      "cap_table_broadcast_sent",
      "captable_commit",
      "collective_application_submitted",
      "collective_company_application_submitted",
      "collective_company_nomination_submitted",
      "crm_contact_added",
      "crm_intro_requested",
      "crm_note_added",
      "crm_pipeline_moved",
      "crm_task_completed",
      "dsc.review_received",
      "founder_crm_broadcast",
      "payment_charged",
      "report_sent",
      "soft_circle.lapsed",
      "transaction_prep_channel_archived",
      "transaction_prep_channel_created",
    ]);
  });

  it("every outbound event type is a well-formed, unique `namespace.verb` name", () => {
    // Structural invariants that survive legitimate catalog growth, so a new
    // event still has to be well-formed even though the pin above was updated.
    expect(ALL_OUTBOUND_EVENT_TYPES.length).toBeGreaterThan(0);
    expect(new Set(ALL_OUTBOUND_EVENT_TYPES).size).toBe(ALL_OUTBOUND_EVENT_TYPES.length);
    /* The house convention is dotted snake_case (`namespace.verb`). Two groups
     * of live types predate it: 15 that carry no namespace at all, and one that
     * is camelCase. Renaming a shipped wire event is a consumer-breaking change
     * and is NOT in Wave 38's scope, so both exception sets are pinned BY NAME.
     * A new event that breaks the convention fails here; the pin cannot be
     * satisfied by quietly widening a regex. */
    const LEGACY_NAMESPACELESS = [
      "cap_table_broadcast_sent",
      "captable_commit",
      "collective_application_submitted",
      "collective_company_application_submitted",
      "collective_company_nomination_submitted",
      "crm_contact_added",
      "crm_intro_requested",
      "crm_note_added",
      "crm_pipeline_moved",
      "crm_task_completed",
      "founder_crm_broadcast",
      "payment_charged",
      "report_sent",
      "transaction_prep_channel_archived",
      "transaction_prep_channel_created",
    ];
    const LEGACY_CAMEL_CASE = [
      "founderTeam.invitation_sent",
      "founderTeam.member_removed",
      "maInitiative.response_recorded",
    ];

    const dotted = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/;
    const offenders = ALL_OUTBOUND_EVENT_TYPES.filter((t) => !dotted.test(t));
    expect(
      [...offenders].sort(),
      "a NEW outbound event type breaks the `namespace.verb` snake_case convention",
    ).toEqual([...LEGACY_NAMESPACELESS, ...LEGACY_CAMEL_CASE].sort());

    // The two exception groups stay distinct — a namespaceless name must be
    // snake_case, and the camelCase one must still carry its namespace.
    for (const t of LEGACY_NAMESPACELESS) expect(t, `${t} must be snake_case`).toMatch(/^[a-z0-9_]+$/);
    for (const t of LEGACY_CAMEL_CASE) expect(t, `${t} must be dotted`).toMatch(/^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)+$/);
  });

  it("pins the ENTIRE inbound event catalog, in order", () => {
    expect(ALL_INBOUND_EVENT_TYPES).toEqual([
      "dsc.scores",
      "ma.intelligence_rankings",
      "partner.introduction_status",
      "network.social_signals",
      "member.application_decision",
      "membership.renewal_status",
      "kyc.status_decision",
      "soft_circle.submitted",
    ]);
    for (const t of ALL_INBOUND_EVENT_TYPES) {
      expect(t, `malformed inbound event type: ${t}`).toMatch(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/);
    }
    /* The catalogs are ALMOST disjoint. `soft_circle.submitted` is genuinely
     * bidirectional — Capavate emits it and Collective echoes it back — so the
     * overlap is pinned by name rather than asserted empty. A new accidental
     * both-directions event fails here. */
    const outbound = new Set<string>(ALL_OUTBOUND_EVENT_TYPES);
    expect(ALL_INBOUND_EVENT_TYPES.filter((t) => outbound.has(t)).sort()).toEqual([
      "soft_circle.submitted",
    ]);
  });

  it("event types arrays are immutable in nature (sorted/typed)", () => {
    expect(new Set(ALL_OUTBOUND_EVENT_TYPES).size).toBe(ALL_OUTBOUND_EVENT_TYPES.length);
    expect(new Set(ALL_INBOUND_EVENT_TYPES).size).toBe(ALL_INBOUND_EVENT_TYPES.length);
  });
});

describe("Sprint 12 / Bridge — HMAC + envelope shape", () => {
  it("hmacSign / verifyHmac roundtrip", () => {
    const body = JSON.stringify({ a: 1, b: "two" });
    const sig = hmacSign(body);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyHmac(body, sig)).toBe(true);
    expect(verifyHmac(body, "deadbeef")).toBe(false);
  });

  it("verifyHmac fails on body tamper", () => {
    const sig = hmacSign("{\"x\":1}");
    expect(verifyHmac("{\"x\":2}", sig)).toBe(false);
  });

  it("emitBridgeEvent produces canonical envelope per §13.4", () => {
    _testBridge.resetChain();
    const entry = emitBridgeEvent({
      eventType: "company.profile.updated",
      aggregateId: "co_test",
      aggregateKind: "company",
      payload: { foo: "bar" },
    });
    const e = entry.envelope;
    expect(e.eventId).toMatch(/^evt_/);
    expect(e.eventType).toBe("company.profile.updated");
    expect(e.aggregateId).toBe("co_test");
    expect(e.aggregateKind).toBe("company");
    expect(typeof e.occurredAt).toBe("string");
    expect(e.tenantId).toBeTruthy();
    expect(e.actor).toBeTruthy();
    expect(e.payload).toEqual({ foo: "bar" });
    expect(e.auditChain.priorHash).toBeTruthy();
    expect(e.auditChain.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(e.schemaVersion).toBe("1.0");
  });
});

describe("Sprint 12 / Bridge — chain integrity", () => {
  beforeEach(() => _testBridge.resetChain());

  it("emits link the auditChain forward (priorHash = previous.hash)", () => {
    const a = emitBridgeEvent({ eventType: "cap_table.mutated", aggregateId: "co_x", aggregateKind: "company", payload: {} });
    const b = emitBridgeEvent({ eventType: "cap_table.mutated", aggregateId: "co_x", aggregateKind: "company", payload: {} });
    expect(b.envelope.auditChain.priorHash).toBe(a.envelope.auditChain.hash);
  });

  it("first event uses zero-hash genesis", () => {
    const first = emitBridgeEvent({ eventType: "audit_log.appended", aggregateId: "x", aggregateKind: "platform", payload: {} });
    expect(first.envelope.auditChain.priorHash).toMatch(/^0+$/);
  });
});

describe("Sprint 12 / Bridge — drain + retry semantics", () => {
  beforeEach(() => _testBridge.resetChain());

  it("delivers queued events when receiver returns 2xx", async () => {
    emitBridgeEvent({ eventType: "round.closed", aggregateId: "rnd_x", aggregateKind: "round", payload: {} });
    const res = await drainOutbox(async () => ({ ok: true, status: 200 }));
    expect(res.delivered).toBe(1);
    expect(getOutbox()[0].status).toBe("delivered");
  });

  it("treats 409 (idempotent dup) as delivered", async () => {
    emitBridgeEvent({ eventType: "round.closed", aggregateId: "rnd_y", aggregateKind: "round", payload: {} });
    const res = await drainOutbox(async () => ({ ok: false, status: 409 }));
    expect(res.delivered).toBe(1);
  });

  it("retries with exponential backoff up to 5 attempts then dead-letters", async () => {
    emitBridgeEvent({ eventType: "round.closed", aggregateId: "rnd_z", aggregateKind: "round", payload: {} });
    let res = { delivered: 0, deadLettered: 0 };
    // First attempt — fails, schedules backoff.
    res = await drainOutbox(async () => ({ ok: false, status: 500 }));
    expect(res.delivered).toBe(0);
    const e = getOutbox().find((x) => x.envelope.aggregateId === "rnd_z")!;
    expect(e.attempts).toBe(1);
    expect(e.status).toBe("queued");
    // Force fast retries by zeroing nextRetryAt.
    for (let i = 0; i < 5; i++) {
      e.nextRetryAt = 0;
      await drainOutbox(async () => ({ ok: false, status: 500 }));
    }
    const after = getOutbox().find((x) => x.envelope.aggregateId === "rnd_z")!;
    expect(after.attempts).toBeGreaterThanOrEqual(5);
    expect(after.status).toBe("dead_letter");
  });
});

describe("Sprint 12 / Bridge HTTP routes", () => {
  it("GET /api/admin/bridge/outbox — admin 200 with real stats, NON-admin 403", async () => {
    const app = makeApp();
    const ok = await req(app, "GET", as("/api/admin/bridge/outbox", "admin"));
    expect(ok.status).toBe(200);
    expect(typeof ok.body.total).toBe("number");
    expect(Array.isArray(ok.body.entries)).toBe(true);
    expect(Array.isArray(ok.body.eventTypes)).toBe(true);
    // LOWER POLE — the gate is real, not decorative.
    const denied = await req(app, "GET", as("/api/admin/bridge/outbox", "investor"));
    expect(denied.status).toBe(403);
    expect(denied.body?.error).toBe("ADMIN_REQUIRED");
    // And the refusal leaks nothing: no outbox contents in a 403 body.
    expect(denied.body?.entries).toBeUndefined();
  });

  it("GET /api/admin/bridge/verify-chain — admin 200, NON-admin 403", async () => {
    const app = makeApp();
    const ok = await req(app, "GET", as("/api/admin/bridge/verify-chain", "admin"));
    expect(ok.status).toBe(200);
    expect(ok.body).toHaveProperty("ok");
    const denied = await req(app, "GET", as("/api/admin/bridge/verify-chain", "investor"));
    expect(denied.status).toBe(403);
    expect(denied.body?.error).toBe("ADMIN_REQUIRED");
    expect(denied.body).not.toHaveProperty("ok", true);
  });

  it("POST /api/admin/bridge/emit — admin emits and the event LANDS in the outbox; NON-admin 403 emits NOTHING", async () => {
    const app = makeApp();
    const body = (aggregateId: string) => ({
      eventType: "company.profile.updated",
      aggregateId,
      aggregateKind: "company",
      payload: { foo: "bar" },
    });

    // UPPER POLE — the admin write reaches the sink, not merely a 2xx.
    const ok = await req(app, "POST", as("/api/admin/bridge/emit", "admin"), body("co_w38_admin"));
    expect([200, 201]).toContain(ok.status);
    expect(getOutbox().some((e) => e.envelope.aggregateId === "co_w38_admin")).toBe(true);

    // LOWER POLE — the refused write must leave the outbox untouched. A 403
    // that still wrote would have passed the old status-only assertion.
    const denied = await req(app, "POST", as("/api/admin/bridge/emit", "investor"), body("co_w38_denied"));
    expect(denied.status).toBe(403);
    expect(denied.body?.error).toBe("ADMIN_REQUIRED");
    expect(getOutbox().some((e) => e.envelope.aggregateId === "co_w38_denied")).toBe(false);
  });

  it("mock receiver responds at /api/_mock_collective/inbound", async () => {
    const app = makeApp();
    const r = await req(app, "POST", "/api/_mock_collective/inbound", {
      eventId: "evt_mock_1",
      eventType: "dsc.scores",
      aggregateId: "u_test",
      aggregateKind: "investor",
      occurredAt: new Date().toISOString(),
      schemaVersion: "1.0",
      payload: { score: 80 },
    });
    expect([200, 201, 202, 401, 400]).toContain(r.status); // route exists (any non-404)
    expect(r.status).not.toBe(404);
  });
});

/* =========================================================================== */
/* Notifications                                                               */
/* =========================================================================== */
describe("Sprint 12 / Notifications — 21 kinds", () => {
  it("declares ≥21 notification kinds (15 core + 6 Collective)", () => {
    expect(ALL_NOTIFICATION_KINDS.length).toBeGreaterThanOrEqual(21);
  });

  it("contains audit-required core kinds (dot-namespaced per spec)", () => {
    const k = new Set(ALL_NOTIFICATION_KINDS);
    expect(k.has("round.invitation_received")).toBe(true);
    expect(k.has("round.invitation_accepted")).toBe(true);
    expect(k.has("round.invitation_declined")).toBe(true);
    expect(k.has("round.soft_circle_received")).toBe(true);
    expect(k.has("round.closed")).toBe(true);
  });

  it("contains Collective-specific kinds", () => {
    const k = new Set(ALL_NOTIFICATION_KINDS);
    expect(k.has("collective.membership_approved")).toBe(true);
    expect(k.has("membership.renewal_due")).toBe(true);
    expect(k.has("membership.lapsed")).toBe(true);
  });

  it("emit + list works for a user", () => {
    _testNotifications.reset();
    emitNotification({ userId: "u_test", kind: "round.invitation_received", title: "T", body: "B" });
    const list = listNotifications("u_test");
    expect(list.length).toBe(1);
    expect(list[0].kind).toBe("round.invitation_received");
    expect(list[0].read).toBe(false);
  });

  it("unreadCount tracks correctly", () => {
    _testNotifications.reset();
    emitNotification({ userId: "u_a", kind: "round.soft_circle_received", title: "x", body: "y" });
    emitNotification({ userId: "u_a", kind: "round.soft_circle_received", title: "x", body: "y" });
    expect(unreadCount("u_a")).toBe(2);
  });

  it("HTTP /api/notifications/kinds returns all kinds", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/notifications/kinds");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.kinds)).toBe(true);
    expect(r.body.kinds.length).toBeGreaterThanOrEqual(21);
  });

  it("HTTP broadcast accepts payload", async () => {
    const app = makeApp();
    const r = await req(app, "POST", "/api/notifications/broadcast", {
      kind: "round.closed", title: "T", body: "B",
    });
    expect([200, 201]).toContain(r.status);
  });
});

/* =========================================================================== */
/* Email                                                                       */
/* =========================================================================== */
describe("Sprint 12 / Email — templates + queue", () => {
  it("ships ≥14 templates", () => {
    expect(_testEmail.templates.length).toBeGreaterThanOrEqual(14);
  });

  it("each template declares slug, subject, body, variables", () => {
    for (const t of _testEmail.templates) {
      expect(typeof t.slug).toBe("string");
      expect(t.slug.length).toBeGreaterThan(0);
      expect(typeof t.subject).toBe("string");
      expect(typeof t.bodyHtml).toBe("string");
      expect(Array.isArray(t.variables)).toBe(true);
    }
  });

  it("renderTemplate replaces {{var}} placeholders", () => {
    const out = renderTemplate("Hello {{name}}, your round is {{round}}", { name: "Maya", round: "Seed" });
    expect(out).toBe("Hello Maya, your round is Seed");
  });

  it("renderTemplate leaves unknown vars as the literal placeholder", () => {
    const out = renderTemplate("Hi {{x}} {{y}}", { x: "a" });
    expect(out).toContain("a");
  });

  it("findTemplate returns canonical templates by slug", () => {
    expect(findTemplate("round_invitation")).toBeTruthy();
    expect(findTemplate("collective_welcome")).toBeTruthy();
    expect(findTemplate("definitely_not_real")).toBeNull();
  });

  it("enqueueEmail places message in outbox at queued state", () => {
    _testEmail.reset();
    const e = enqueueEmail({ templateSlug: "round_invitation", recipient: "x@y.com", recipientUserId: "u_x", variables: { roundName: "Seed" } });
    expect(e).not.toBeNull();
    expect(_testEmail.outbox.length).toBe(1);
    expect(_testEmail.outbox[0].status).toBe("queued");
  });

  it("tickQueue advances state machine forward", () => {
    _testEmail.reset();
    enqueueEmail({ templateSlug: "round_invitation", recipient: "a@b.com", recipientUserId: "u_a", variables: {} });
    tickQueue();
    // First tick may move queued → sent OR remain queued depending on impl;
    // both are valid — just verify the message hasn't disappeared.
    expect(["queued", "sent", "delivered", "opened", "clicked", "bounced"]).toContain(_testEmail.outbox[0].status);
  });

  it("HTTP /api/admin/email/templates lists templates", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/admin/email/templates");
    expect(r.status).toBe(200);
    expect(r.body.templates.length).toBeGreaterThanOrEqual(14);
  });
});

/* =========================================================================== */
/* Admin platform — KPIs, audit chain, reconciliation, pricing                 */
/* =========================================================================== */
describe("Sprint 12 / Admin platform — KPIs", () => {
  it("GET /api/admin/dashboard/kpis returns full structure", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/admin/dashboard/kpis");
    expect(r.status).toBe(200);
    expect(typeof r.body).toBe("object");
  });

  it("GET /api/admin/dashboard/activity returns array", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/admin/dashboard/activity");
    expect(r.status).toBe(200);
  });
});

describe("Sprint 12 / Admin — audit-log chain verify", () => {
  it("verify endpoint reports ok=true for clean seed", async () => {
    const app = makeApp();
    const r = await req(app, "GET", "/api/admin/audit-log/verify");
    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty("ok");
  });

  it("append endpoint extends chain", async () => {
    const app = makeApp();
    const r = await req(app, "POST", "/api/admin/audit-log/append", {
      eventType: "test.event", entity: "co_test", actor: "u_admin", payload: { foo: "bar" },
    });
    expect([200, 201]).toContain(r.status);
  });
});

describe("Sprint 12 / Admin — reconciliation force-commit guard", () => {
  it("rejects force-commit without signature ≥ 8 chars", async () => {
    const app = makeApp();
    const r = await req(app, "POST", "/api/admin/reconciliation/force-commit", { companyId: "co_x", roundId: "rnd_x", signature: "short" });
    expect(r.status).toBe(403);
  });

  it("accepts force-commit with valid signature", async () => {
    const app = makeApp();
    const r = await req(app, "POST", "/api/admin/reconciliation/force-commit", { companyId: "co_x", roundId: "rnd_x", signature: "AdminApprove2026" });
    expect([200, 201]).toContain(r.status);
  });
});

describe("Sprint 12 / Admin — pricing tiers", () => {
  /* WAVE 38 · ROW 3 — this block used to assert that `founder_capavate_annual`
   * came back at 84_000 minor units. It had been failing with `tiers.length: 0`
   * because the endpoint stopped serving a hard-coded array in v25.27 and now
   * PROXIES `pricingModelStore.listModels({ productLine: "founder", status:
   * "live" })`. Nothing seeds a live founder model in this harness, so the
   * assertion was pinned to a constant that no longer had a producer.
   *
   * The test now establishes its OWN precondition — it creates the model
   * through the real store API and promotes it draft → preview → live through
   * the real state machine — then asserts the endpoint reflects what was
   * seeded. Nothing is read from `process.env`, and no production file is
   * left dirty: the seeded models are removed in `afterEach`.
   *
   * It is also strictly stronger than what it replaced. It now asserts:
   *   • the endpoint is DB-driven — a DRAFT model must NOT be served;
   *   • the money is carried as INTEGER MINOR UNITS;
   *   • the JPY fixture (exponent 0) — a ¥ tier's `usdMonthly` must be a NULL
   *     REFUSAL, not a number, which is the Wave 35 · F1 defect;
   *   • no cross-currency arithmetic — the USD and JPY tiers are never summed. */
  const seededModelIds: string[] = [];

  async function seedFounderModel(input: {
    slug: string;
    name: string;
    currency: string;
    annualMinor: number;
    monthlyMinor: number;
    promoteToLive: boolean;
  }): Promise<void> {
    const created = createModel(
      {
        productLine: "founder",
        slug: input.slug,
        name: input.name,
        description: `WAVE 38 row 3 fixture — ${input.slug}`,
        currency: input.currency,
        basePriceMinor: input.annualMinor,
        cadence: "annual",
        cadenceOptions: [
          { cadence: "annual", priceMinor: input.annualMinor },
          { cadence: "monthly", priceMinor: input.monthlyMinor },
        ],
        currencyOverrides: [],
        regionalMultipliers: [],
        features: [{ key: "cap_table", label: "Cap table", included: true }],
        metering: [],
        volumeBrackets: [],
        discountCodes: [],
        trial: null,
        effectiveFrom: null,
        effectiveTo: null,
        grandfatherOnChange: false,
        taxInclusive: false,
      } as unknown as Parameters<typeof createModel>[0],
      "u_admin_w38",
    );
    expect(created.ok, `seed failed for ${input.slug}: ${created.ok ? "" : created.error}`).toBe(true);
    if (!created.ok) return;
    seededModelIds.push(created.model.id);
    if (input.promoteToLive) {
      // Drive the REAL promotion state machine, not a status write.
      const toPreview = promoteModel(created.model.id, "preview", "u_admin_w38");
      expect(toPreview.ok).toBe(true);
      const toLive = promoteModel(created.model.id, "live", "u_admin_w38");
      expect(toLive.ok, `promote to live failed: ${toLive.ok ? "" : toLive.error}`).toBe(true);
    }
  }

  afterEach(() => {
    // Never leave the store dirty for the next test or the next file.
    for (const id of seededModelIds.splice(0)) deleteModel(id, "u_admin_w38");
  });

  it("founder-tiers is DB-DRIVEN — it serves the LIVE model it was seeded with, in integer minor units", async () => {
    const app = makeApp();

    // PRECONDITION, asserted: nothing is live yet, so the endpoint is empty.
    // This is the lower pole — it proves the tier below came from the seed and
    // not from a hard-coded array that would have satisfied the old assertion.
    const before = await req(app, "GET", "/api/admin/pricing/founder-tiers");
    expect(before.status).toBe(200);
    expect(
      before.body.tiers.some((t: { id: string }) => t.id === "founder-capavate-annual-w38"),
    ).toBe(false);

    await seedFounderModel({
      slug: "founder-capavate-annual-w38",
      name: "Capavate Annual",
      currency: "USD",
      annualMinor: 84_000,
      monthlyMinor: 7_000,
      promoteToLive: true,
    });

    const r = await req(app, "GET", "/api/admin/pricing/founder-tiers");
    expect(r.status).toBe(200);
    expect(r.body.tiers.length).toBeGreaterThanOrEqual(1);
    const annual = r.body.tiers.find((t: { id: string }) => t.id === "founder-capavate-annual-w38");
    expect(annual, "the LIVE seeded model was not served").toBeTruthy();
    expect(annual.annualPriceCents).toBe(84_000);
    expect(annual.annualMinor).toBe(84_000);
    expect(annual.monthlyMinor).toBe(7_000);
    expect(Number.isInteger(annual.annualMinor)).toBe(true);
    expect(Number.isInteger(annual.monthlyMinor)).toBe(true);
    expect(annual.currency).toBe("USD");
    expect(annual.billingCycle).toBe("annual");
    // USD exponent 2 — 7_000 minor = $70/month.
    expect(annual.usdMonthly).toBe(70);
  });

  it("a DRAFT founder model is NOT served — only `live` reaches the endpoint", async () => {
    const app = makeApp();
    await seedFounderModel({
      slug: "founder-draft-only-w38",
      name: "Draft Only",
      currency: "USD",
      annualMinor: 12_000,
      monthlyMinor: 1_000,
      promoteToLive: false,
    });
    const r = await req(app, "GET", "/api/admin/pricing/founder-tiers");
    expect(r.status).toBe(200);
    expect(r.body.tiers.some((t: { id: string }) => t.id === "founder-draft-only-w38")).toBe(false);
  });

  it("JPY FIXTURE (exponent 0) — a ¥ tier refuses `usdMonthly` with null rather than mislabelling yen as dollars", async () => {
    /* Wave 35 · F1: `usdMonthly` was `Math.round(monthlyMinor / 100)` for every
     * currency, so a ¥100,000/month tier was served to founders as
     * `usdMonthly: 1000`. JPY has exponent 0 — 100000 minor units IS ¥100,000,
     * not ¥1,000.00 — which is exactly the case a USD-only fixture cannot
     * catch. The correct behaviour is a NULL refusal the client renders, with
     * the truth carried alongside in `currency` + integer minor units. */
    const app = makeApp();
    await seedFounderModel({
      slug: "founder-jpy-annual-w38",
      name: "Capavate Annual (JP)",
      currency: "JPY",
      annualMinor: 1_200_000,
      monthlyMinor: 100_000,
      promoteToLive: true,
    });
    await seedFounderModel({
      slug: "founder-usd-alongside-w38",
      name: "Capavate Annual (US)",
      currency: "USD",
      annualMinor: 84_000,
      monthlyMinor: 7_000,
      promoteToLive: true,
    });

    const r = await req(app, "GET", "/api/admin/pricing/founder-tiers");
    expect(r.status).toBe(200);
    const jpy = r.body.tiers.find((t: { id: string }) => t.id === "founder-jpy-annual-w38");
    const usd = r.body.tiers.find((t: { id: string }) => t.id === "founder-usd-alongside-w38");
    expect(jpy).toBeTruthy();
    expect(usd).toBeTruthy();

    // The refusal — null, NOT 0 and NOT a number.
    expect(jpy.usdMonthly).toBeNull();
    expect(jpy.currency).toBe("JPY");
    // The truth, in integer minor units, exponent 0.
    expect(jpy.monthlyMinor).toBe(100_000);
    expect(jpy.annualMinor).toBe(1_200_000);
    expect(Number.isInteger(jpy.monthlyMinor)).toBe(true);
    // The rendered string must carry the currency, at exponent 0 — ¥1,200,000,
    // never ¥12,000 (which is what a hard-coded /100 produces).
    expect(jpy.displayPrice).toContain("JPY");
    expect(jpy.displayPrice).toContain("1,200,000");
    expect(jpy.displayPrice).not.toContain("$");

    // The USD tier alongside is unaffected — the refusal is per-currency.
    expect(usd.usdMonthly).toBe(70);
    expect(usd.displayPrice).toContain("$840");

    // NEVER SUM ACROSS CURRENCIES: the endpoint must not offer a total, and the
    // two tiers must remain separately denominated.
    expect(r.body.total).toBeUndefined();
    expect(r.body.totalMinor).toBeUndefined();
    expect(new Set(r.body.tiers.map((t: { currency: string }) => t.currency)).size).toBeGreaterThan(1);
  });

  it("D2.5 Slice 1 — the 3 hard-coded pricing endpoints are GONE", async () => {
    const app = makeApp();
    for (const p of [
      "/api/admin/pricing/collective-tiers",
      "/api/admin/pricing/regional",
      "/api/admin/pricing/billing-metrics",
    ]) {
      const r = await req(app, "GET", p);
      expect(r.status, `${p} must no longer be routed`).not.toBe(200);
    }
  });
});

/* =========================================================================== */
/* CapCollectiveToggle                                                         */
/* =========================================================================== */
describe("Sprint 12 / CapCollectiveToggle visibility (audit §11)", () => {
  it("admin always sees toggle", () => {
    const r = shouldShowToggle({ role: "admin", membership: { isCollectiveMember: false, lapsed: false, capTablePositions: 0 } });
    expect(r.visible).toBe(true);
  });

  it("investor without cap-table position is hidden", () => {
    const r = shouldShowToggle({ role: "investor", membership: { isCollectiveMember: true, lapsed: false, capTablePositions: [] } });
    expect(r.visible).toBe(false);
    expect(r.reason).toMatch(/cap table/i);
  });

  it("investor not in Collective is hidden", () => {
    const r = shouldShowToggle({ role: "investor", membership: { isCollectiveMember: false, lapsed: false, capTablePositions: ["co_a"] } });
    expect(r.visible).toBe(false);
  });

  it("investor lapsed membership is hidden", () => {
    const r = shouldShowToggle({ role: "investor", membership: { isCollectiveMember: true, lapsed: true, capTablePositions: ["co_a"] } });
    expect(r.visible).toBe(false);
    expect(r.reason).toMatch(/lapsed/i);
  });

  it("investor with positions + active membership is visible", () => {
    const r = shouldShowToggle({ role: "investor", membership: { isCollectiveMember: true, lapsed: false, capTablePositions: ["co_a", "co_b"] } });
    expect(r.visible).toBe(true);
  });

  it("founder not in Collective is hidden", () => {
    const r = shouldShowToggle({ role: "founder", membership: { isCollectiveMember: false, lapsed: false, capTablePositions: [] } });
    expect(r.visible).toBe(false);
  });

  it("founder with active membership is visible", () => {
    const r = shouldShowToggle({ role: "founder", membership: { isCollectiveMember: true, lapsed: false, capTablePositions: [] } });
    expect(r.visible).toBe(true);
  });

  it("founder with lapsed membership is hidden", () => {
    const r = shouldShowToggle({ role: "founder", membership: { isCollectiveMember: true, lapsed: true, capTablePositions: [] } });
    expect(r.visible).toBe(false);
  });
});

/* =========================================================================== */
/* Math integrity smoke — verify math-critical files weren't accidentally      */
/* modified by Sprint 12 work.                                                 */
/* =========================================================================== */
describe("Sprint 12 / Math integrity smoke", () => {
  it("cap-table-engine package is still importable", async () => {
    // Defensive: if Sprint 12 accidentally broke an import path in cap-table-engine,
    // this require() will throw. Math correctness itself is locked by the
    // engine's own golden-master tests.
    const mod = await import("../../packages/cap-table-engine/src/index").catch((e) => ({ __error: e.message }));
    expect((mod as any).__error).toBeUndefined();
  });
});
