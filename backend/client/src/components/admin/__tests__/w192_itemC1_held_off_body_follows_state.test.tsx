/**
 * WAVE 192 · ITEM C1 · R160.4 — THE SECOND CONTRADICTION ON THE SAME RULE, AND
 * THE LAST ONE, BECAUSE THE SENTENCE IS NO LONGER A HARDCODED SENTENCE.
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT WAS ON SCREEN, LIVE. The badge for `partner_engaged_company_people` read
 * "ENABLED" — the owner enabled the rule on live — directly above a paragraph
 * whose own words were "the rule stays off until you decide otherwise" and "This
 * is not an oversight and it is not a pending owner decision".
 *
 * WAVE 177 FIXED A CONTRADICTION ON THIS SAME RULE AND DID NOT REACH THIS ONE.
 * That is the point of this file. Wave 177 replaced one false clause with another
 * hardcoded clause, so the panel was correct for exactly as long as the state did
 * not move. It moved. The body text is now DERIVED from the same two fields the
 * badges render, so no third clause can go stale.
 *
 * ══ WHICH SURFACE IS THE TRUTH ══
 * The badge, not the prose. It renders `r.enabled`, which is the server's reading
 * of the `enabled` column. A hardcoded paragraph is an opinion recorded at build
 * time; a column is a fact. §C1-0 asserts against real SQLite what the local record
 * actually holds, so this suite cannot quietly drift from the data either.
 *
 * ══ R143.1 — WHAT DID NOT MOVE ══
 * §C1-1 is the assertion this item lives or dies on: in the disabled-and-pending
 * state — the state the shipped sentence described, and the state the local record
 * holds — the DERIVED text must equal the SHIPPED sentence BYTE FOR BYTE. If that
 * equality ever breaks, wave 177's C-3/C-4/C-5 assertions break with it, which is
 * exactly the regression R143.1 exists to prevent. The state-independent prefix
 * (the R108.1 citation, the cross-organisation privacy warning, the WAVE 144 item 4
 * note) is unchanged character for character; only the trailing state-dependent
 * clauses became derived.
 *
 * ══ WHY THE STATE VARIANTS ARE TESTED AS A PURE FUNCTION ══
 * The four states cannot all be produced from one database in one process without
 * mutating a live rule row, and mutating it would make this suite order-dependent
 * with wave 177's. So the rendered-DOM assertions cover the ACTUAL state, and
 * `heldOffReasonForState` — the single function the panel calls — is exercised
 * directly for all four. There is no second implementation between them: the panel
 * has no other source for this paragraph.
 *
 * MONEY. This suite asserts no amount, fee, price or currency.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import express, { type Express } from "express";
import request from "supertest";
import { getDb, rawDb } from "../../../../../server/db/connection";
import { registerCommsRoutes } from "../../../../../server/commsStore";
import { applyCommsDelegatedContextSchema } from "../../../../../server/lib/applyCommsDelegatedContextSchema";
import { installV14TestIdentity } from "../../../../../server/__tests__/_v14TestIdentity";
import {
  MessagingAudienceRulesPanel,
  heldOffReasonForState,
  HELD_OFF_REASON_AS_SHIPPED,
} from "../MessagingAudienceRulesPanel";

const HELD_OFF = "partner_engaged_company_people";
const ADMIN = "u_admin";

/** The two badge literals, byte-for-byte as the panel renders them. These are the
 *  surfaces this item declared AUTHORITATIVE, so they are pinned. */
const BADGE_ENABLED = "ENABLED";
const BADGE_DISABLED = "DISABLED";

let app: Express;
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async (method: string, url: string, body?: unknown) => {
      let req = (request(app) as any)[method.toLowerCase()](url)
        .set("x-user-id", ADMIN)
        .set("x-actor-user-id", ADMIN)
        .set("x-role", "admin");
      if (body !== undefined) req = req.send(body);
      const res = await req;
      if (res.status < 200 || res.status >= 300) throw new Error(`HTTP ${res.status}`);
      return {
        ok: true,
        status: res.status,
        statusText: String(res.status),
        text: async () => JSON.stringify(res.body),
        json: async () => res.body,
      } as unknown as Response;
    },
  };
});

function mount() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MessagingAudienceRulesPanel />
    </QueryClientProvider>,
  );
}

beforeAll(() => {
  getDb();
  applyCommsDelegatedContextSchema(rawDb() as any);
  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: false });
  registerCommsRoutes(app);
});

afterEach(() => cleanup());

/* ════════════════════════════════════════════════════════════════════════════
   C1-0 — WHAT THE RECORD ACTUALLY HOLDS. Read, never assumed.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W192 C1-0 — the rule row is the authority", () => {
  it("reads the enabled and pending flags straight from SQLite", () => {
    const row = rawDb()
      .prepare(
        `SELECT enabled, requires_owner_decision, decided_at FROM comms_audience_rules WHERE rule_key = ?`,
      )
      .get(HELD_OFF) as
      | { enabled: number; requires_owner_decision: number; decided_at: string | null }
      | undefined;
    expect(row, "the rule row must exist").toBeTruthy();
    /* Both flags are booleans-as-integers; asserting the SHAPE rather than a fixed
       value on purpose, because the owner may flip either on live and this suite
       must not become the next thing that contradicts the record. */
    expect([0, 1]).toContain(row!.enabled);
    expect([0, 1]).toContain(row!.requires_owner_decision);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   C1-1 — THE ASSERTION THIS ITEM LIVES OR DIES ON (R143.1).
   ════════════════════════════════════════════════════════════════════════════ */
describe("W192 C1-1 — the derived text reproduces the shipped sentence byte for byte", () => {
  it("disabled AND pending → EXACTLY the sentence this panel shipped", () => {
    const derived = heldOffReasonForState({ enabled: false, requiresOwnerDecision: true });
    expect(derived).toBe(HELD_OFF_REASON_AS_SHIPPED);
    /* And the shipped sentence itself, pinned as a literal here, so a reworded
       constant cannot make this equality pass vacuously. Every clause wave 177's
       C-4 asserts on is present, character for character. */
    expect(derived).toBe(
      "HELD OFF DELIBERATELY (R108.1). Switching this on lets a Consortium Partner message the " +
        "ACTIVE members of another organisation — their client companies' people. The privacy " +
        "prerequisite R108.1 item 2 named has been ADDRESSED in WAVE 144 item 4 (the messaging " +
        "directory payload no longer carries cap-table positions, location or capavateAngelNetwork; privacy " +
        "resolution still covers legal name and visibility only). The RULING itself has not been " +
        "revisited, so the rule stays off until you decide otherwise. This is not an oversight: it " +
        "is the pending owner decision the badge above reports, and it stays pending until you make it.",
    );
  });

  it("every wave-177 C-4 literal survives in the disabled-and-pending state", () => {
    const t = heldOffReasonForState({ enabled: false, requiresOwnerDecision: true });
    for (const literal of [
      "HELD OFF DELIBERATELY (R108.1).",
      "Switching this on lets a Consortium Partner message the ACTIVE members of another organisation",
      "ADDRESSED in WAVE 144 item 4",
      "the rule stays off until you decide otherwise",
      "This is not an oversight",
      "pending owner decision",
      "until you make it",
    ]) {
      expect(t, `wave 177 asserted on this literal: ${literal}`).toContain(literal);
    }
  });

  it("the state-INDEPENDENT prefix is present in ALL FOUR states, unchanged", () => {
    for (const enabled of [true, false]) {
      for (const requiresOwnerDecision of [true, false]) {
        const t = heldOffReasonForState({ enabled, requiresOwnerDecision });
        expect(t).toContain("HELD OFF DELIBERATELY (R108.1).");
        expect(t).toContain(
          "Switching this on lets a Consortium Partner message the ACTIVE members of another organisation — their client companies' people.",
        );
        expect(t).toContain("ADDRESSED in WAVE 144 item 4");
      }
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   C1-2 — THE CONTRADICTION IS STRUCTURALLY IMPOSSIBLE NOW.
   The stale clauses cannot appear while the rule is ENABLED, in ANY state.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W192 C1-2 — an enabled rule never claims to be off or undecided-and-off", () => {
  for (const requiresOwnerDecision of [true, false]) {
    it(`enabled=true, pending=${requiresOwnerDecision} → says ON, never "stays off"`, () => {
      const t = heldOffReasonForState({ enabled: true, requiresOwnerDecision });
      /* THE EXACT CLAUSES THAT WERE ON SCREEN WHILE THE BADGE SAID ENABLED. */
      expect(t).not.toContain("the rule stays off until you decide otherwise");
      expect(t).not.toContain("This is not an oversight");
      expect(t).not.toMatch(/is not\s+(a\s+)?pending owner decision/i);
      /* And it states the truth instead of merely omitting the falsehood — a blank
         is not a fact, which is the whole lesson of this wave's Item A. */
      expect(t).toContain("This rule is currently ON");
      expect(t).toContain("as the badge above reports");
    });
  }

  it("enabled=false, pending=false → does NOT claim a decision is outstanding", () => {
    /* The same class of false statement in the other direction: once the owner has
       ruled, pointing at a pending decision would be exactly the defect wave 177
       fixed, reintroduced. */
    const t = heldOffReasonForState({ enabled: false, requiresOwnerDecision: false });
    expect(t).not.toContain("it stays pending until you make it");
    expect(t).not.toContain("the pending owner decision the badge above reports");
    expect(t).toContain("The rule is currently OFF");
    expect(t).toContain("nothing is waiting on anyone else");
  });

  it("enabled=true, pending=true → states BOTH facts, hides neither", () => {
    /* Suppressing either is how this screen came to contradict itself twice. */
    const t = heldOffReasonForState({ enabled: true, requiresOwnerDecision: true });
    expect(t).toContain("This rule is currently ON");
    expect(t).toContain("still recorded as outstanding");
    expect(t).toContain("Both of those");
  });

  it("no state produces an ALL-CAPS underscore code, and every state reads as prose", () => {
    for (const enabled of [true, false]) {
      for (const requiresOwnerDecision of [true, false]) {
        const t = heldOffReasonForState({ enabled, requiresOwnerDecision });
        /* `capavateAngelNetwork` and the R108.1 citation survive this; a screaming
           snake-case machine token would not. */
        expect(t).not.toMatch(/\b[A-Z]{2,}_[A-Z]{2,}\b/);
        expect(/[a-z]/.test(t)).toBe(true);
        expect(t.length).toBeGreaterThan(200);
      }
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   C1-3 — RENDERED DOM: the paragraph on screen agrees with the badge on screen.
   Not a fixture — the real route, the real component, the real record.
   ════════════════════════════════════════════════════════════════════════════ */
describe("W192 C1-3 — badge and body agree on one render, whatever the record says", () => {
  it("the paragraph text is exactly what heldOffReasonForState returns for the live flags", async () => {
    mount();
    const body = await screen.findByTestId(`admin-audience-rule-held-off-${HELD_OFF}`);
    const stateBadge = await screen.findByTestId(`admin-audience-rule-state-${HELD_OFF}`);
    const badgeText = norm(stateBadge.textContent ?? "");
    expect([BADGE_ENABLED, BADGE_DISABLED]).toContain(badgeText);

    /* Read the pending flag off the DOM the same way an owner would: the pending
       badge renders if and only if the server reports `requiresOwnerDecision`. */
    const pendingBadge = screen.queryByTestId(`admin-audience-rule-pending-${HELD_OFF}`);
    const expected = heldOffReasonForState({
      enabled: badgeText === BADGE_ENABLED,
      requiresOwnerDecision: pendingBadge !== null,
    });
    /* ONE SOURCE OF TRUTH, PROVEN: the rendered paragraph is byte-identical to what
       the derivation produces from the two states the badges display. There is no
       room for a third, stale sentence between them. */
    expect(norm(body.textContent ?? "")).toBe(norm(expected));
  });

  it("the rendered body never both says ENABLED above and \"stays off\" below", async () => {
    mount();
    const stateBadge = await screen.findByTestId(`admin-audience-rule-state-${HELD_OFF}`);
    const body = await screen.findByTestId(`admin-audience-rule-held-off-${HELD_OFF}`);
    const badgeSaysEnabled = norm(stateBadge.textContent ?? "") === BADGE_ENABLED;
    const bodySaysOff = norm(body.textContent ?? "").includes(
      "the rule stays off until you decide otherwise",
    );
    /* THE SINGLE ASSERTION ITEM C1 ASKED FOR: the screen must not say both. */
    expect(
      badgeSaysEnabled && bodySaysOff,
      "the badge says ENABLED while the body says the rule stays off — the live contradiction",
    ).toBe(false);
  });

  it("the notice is still scoped to ONE rule — no blanket warning appeared", async () => {
    mount();
    await screen.findByTestId(`admin-audience-rule-held-off-${HELD_OFF}`);
    for (const other of [
      "partner_team_peers",
      "channel_participant",
      "cap_table_peer",
      "chapter_peer",
      "follow_peer",
    ]) {
      expect(screen.queryByTestId(`admin-audience-rule-held-off-${other}`)).toBeNull();
    }
  });
});
