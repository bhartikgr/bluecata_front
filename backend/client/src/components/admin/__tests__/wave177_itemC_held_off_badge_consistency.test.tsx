/**
 * WAVE 177 · ITEM C · R148.3 item 3 — RENDERED-DOM proof that the badge and the
 * body text no longer contradict each other.
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT WAS ON SCREEN. For `partner_engaged_company_people` the panel rendered a
 * badge reading "awaiting an owner decision" directly above a paragraph whose
 * final clause read "it is not a pending owner decision". Both were visible at
 * once. One of them was wrong, and an owner reading that row could not tell which.
 *
 * WHICH ONE WAS WRONG WAS DECIDED BY THE DATA, NOT BY TASTE. The badge renders if
 * and only if the server reports `requiresOwnerDecision`, which is
 * `requires_owner_decision` on the rule row. C-0 below asserts, against real
 * SQLite, that the column is 1 and `decided_at` is NULL for this rule — and
 * migration 0199 shows what a real ruling does: it sets the flag to 0 alongside
 * `decided_at` and `decided_by`. So a decision genuinely IS outstanding, the badge
 * was truthful, and the clause was the false statement. Only the clause changed.
 *
 * THIS TEST DRIVES THE REAL ROUTE, NOT A FIXTURE. `GET /api/comms/audience-policy`
 * over a real express app and real SQLite, so if someone later flips
 * `requires_owner_decision` to 0 in a migration, C-0 fails loudly rather than
 * letting the prose silently become wrong again in the other direction.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import express, { type Express } from "express";
import request from "supertest";
import { getDb, rawDb } from "../../../../../server/db/connection";
import { registerCommsRoutes } from "../../../../../server/commsStore";
import { applyCommsDelegatedContextSchema } from "../../../../../server/lib/applyCommsDelegatedContextSchema";
import { installV14TestIdentity } from "../../../../../server/__tests__/_v14TestIdentity";
import { MessagingAudienceRulesPanel } from "../MessagingAudienceRulesPanel";

const HELD_OFF = "partner_engaged_company_people";
const ADMIN = "u_admin";

/** The badge literal, byte-for-byte as MessagingAudienceRulesPanel.tsx renders it.
 *  Item C required exactly ONE of the two strings to move; this is the one that
 *  did NOT, so it is pinned here. */
const BADGE_LITERAL = "awaiting an owner decision";

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

describe("WAVE 177 · ITEM C — the badge and the body agree with the record", () => {
  it("C-0 THE DATA IS AUTHORITATIVE: the rule really is flagged as awaiting a decision", () => {
    const row = rawDb()
      .prepare(
        `SELECT requires_owner_decision, decided_at FROM comms_audience_rules WHERE rule_key = ?`,
      )
      .get(HELD_OFF) as { requires_owner_decision: number; decided_at: string | null } | undefined;
    expect(row).toBeTruthy();
    /* 1 with no decision stamp = genuinely outstanding. Migration 0199 sets the
       flag to 0 AND writes decided_at/decided_by when a real ruling happens; that
       never happened for this rule. */
    expect(row!.requires_owner_decision).toBe(1);
    expect(row!.decided_at).toBeNull();
  });

  it("C-1 the badge is rendered, byte-verbatim, exactly as it was", async () => {
    mount();
    const badge = await screen.findByTestId(`admin-audience-rule-pending-${HELD_OFF}`);
    expect(norm(badge.textContent ?? "")).toBe(BADGE_LITERAL);
  });

  it("C-2 THE CONTRADICTION IS GONE: the body no longer denies a pending decision", async () => {
    mount();
    const body = await screen.findByTestId(`admin-audience-rule-held-off-${HELD_OFF}`);
    const text = norm(body.textContent ?? "");
    /* The exact false clause, in every spacing a reflow could produce. */
    expect(text).not.toContain("it is not a pending owner decision");
    expect(text).not.toContain("not a pending owner decision");
    expect(text).not.toMatch(/is not\s+(a\s+)?pending owner decision/i);
  });

  it("C-3 the body now AGREES with the badge, in words", async () => {
    mount();
    const body = await screen.findByTestId(`admin-audience-rule-held-off-${HELD_OFF}`);
    const text = norm(body.textContent ?? "");
    expect(text).toContain("pending owner decision");
    /* And it points at the badge, so the two are read as one statement rather
       than as two independent claims that happen not to clash. */
    expect(text).toContain("badge");
    expect(text).toContain("until you make it");
  });

  it("C-4 the parts of the notice that were NOT in conflict are untouched", async () => {
    mount();
    const body = await screen.findByTestId(`admin-audience-rule-held-off-${HELD_OFF}`);
    const text = norm(body.textContent ?? "");
    /* Smallest-correct-change proof: the R108.1 citation, the WAVE 144 item 4
       privacy note and the "stays off" statement all survive verbatim. */
    expect(text).toContain("HELD OFF DELIBERATELY (R108.1).");
    expect(text).toContain(
      "Switching this on lets a Consortium Partner message the ACTIVE members of another organisation",
    );
    expect(text).toContain("ADDRESSED in WAVE 144 item 4");
    expect(text).toContain("the rule stays off until you decide otherwise");
    expect(text).toContain("This is not an oversight");
  });

  it("C-5 badge and body are consistent AS A PAIR, asserted on one render", async () => {
    mount();
    const badge = await screen.findByTestId(`admin-audience-rule-pending-${HELD_OFF}`);
    const body = await screen.findByTestId(`admin-audience-rule-held-off-${HELD_OFF}`);
    const badgeSaysPending = norm(badge.textContent ?? "").includes("owner decision");
    const bodyDeniesPending = /is not\s+(a\s+)?pending owner decision/i.test(
      norm(body.textContent ?? ""),
    );
    /* The single assertion Item C asked for: the screen must not say both. */
    expect(badgeSaysPending && bodyDeniesPending).toBe(false);
    expect(badgeSaysPending).toBe(true);
    expect(bodyDeniesPending).toBe(false);
  });

  it("C-6 the notice is still scoped to ONE rule — no blanket warning appeared", async () => {
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
