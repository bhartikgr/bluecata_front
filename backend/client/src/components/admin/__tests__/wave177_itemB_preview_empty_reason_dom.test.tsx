/**
 * WAVE 177 · ITEM B · R148.3 item 5 — RENDERED-DOM proof that the preview now
 * says WHY a partner rule reached nobody.
 * ══════════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS PROVES FIXED. Wave 167's preview could say a rule was ENABLED,
 * applied to the viewer, and still reached NOBODY — but it offered two possible
 * reasons and could not say which was true. On live that ambiguity was the whole
 * problem: the true reason was "this person is not linked to a partner at all"
 * and a human had to cross-reference two admin pages to discover it (R148.1).
 *
 * THE TWO CASES ARE PROVED SEPARATELY, AGAINST REAL DATA, THROUGH THE REAL ROUTE.
 *   (i)  a viewer with NO partner membership row at all;
 *   (ii) a viewer WITH a membership row whose partner has no colleagues and no
 *        LPs.
 * Same component, same rule, same button — only the database differs. If the two
 * sentences were not actually driven by the data, one of these two tests fails.
 *
 * IT ALSO HOLDS THE LINE ON R143.1. The wave-167 empty-state paragraph must still
 * render, byte-for-byte, in BOTH cases. The new sentence is a SIBLING, not a
 * replacement, so B-3 asserts the original literal is still on screen unchanged.
 *
 * AND ON R77 / wave 167 test P-2: the new sentence must contain no machine
 * tokens. B-5 asserts that directly against the rendered text.
 *
 * Harness copied deliberately from
 * `wave167_itemE_audience_rule_preview_dom.test.tsx` — real express app, real
 * SQLite, real resolvers, in-process transport. ADMIN must be `u_admin`: a
 * freshly-invented admin id 401s through `requireAdmin`, which that file records
 * as having cost it a debugging round.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import express, { type Express } from "express";
import request from "supertest";
import { getDb, rawDb } from "../../../../../server/db/connection";
import { registerCommsRoutes } from "../../../../../server/commsStore";
import { applyCommsDelegatedContextSchema } from "../../../../../server/lib/applyCommsDelegatedContextSchema";
import { installV14TestIdentity } from "../../../../../server/__tests__/_v14TestIdentity";
import { AudienceRulePreview } from "../AudienceRulePreview";

/** CASE (i) — a partner-role account with NO membership row anywhere. This is the
 *  live shape R148.1 proved: the rule stops at `resolvePartnerIdForUser`. */
const UNBOUND = "u_w177b_unbound";
/** CASE (ii) — bound to an organisation that is genuinely empty of everyone else. */
const BOUND_ALONE = "u_w177b_alone";
const LONELY_ORG = "porg_w177b_lonely";
const ADMIN = "u_admin";

/** The wave-167 literal, byte-for-byte as it appears in AudienceRulePreview.tsx.
 *  Whitespace-normalised on comparison because JSX reflows text nodes. */
const W167_EMPTY_LITERAL =
  "This rule reaches nobody for this person. That is a real result, not a failure to " +
  "look: either they have no relationships of this kind on record, or the records this " +
  "rule reads are empty.";

const RULE = "partner_own_lp_peers";
const TEAM_RULE = "partner_team_peers";

let app: Express;
const now = () => new Date().toISOString();
const run = (sql: string, ...args: unknown[]): void => {
  try {
    rawDb().prepare(sql).run(...(args as any[]));
  } catch (err) {
    throw new Error(`[w177b fixture] SQL failed: ${(err as Error).message}\nSQL: ${sql}`);
  }
};
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async (method: string, url: string) => {
      const res = await (request(app) as any)
        [method.toLowerCase()](url)
        .set("x-user-id", ADMIN)
        .set("x-actor-user-id", ADMIN)
        .set("x-role", "admin");
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

async function checkFor(who: string, ruleKey = RULE) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <AudienceRulePreview ruleKey={ruleKey} />
    </QueryClientProvider>,
  );
  fireEvent.change(screen.getByTestId(`audience-preview-input-${ruleKey}`), {
    target: { value: who },
  });
  fireEvent.click(screen.getByTestId(`audience-preview-run-${ruleKey}`));
  await waitFor(() => screen.getByTestId(`audience-preview-result-${ruleKey}`));
}

beforeAll(() => {
  getDb();
  applyCommsDelegatedContextSchema(rawDb() as any);
  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: false });
  registerCommsRoutes(app);

  for (const [id, name] of [
    [UNBOUND, "W177B Unbound Partner Person"],
    [BOUND_ALONE, "W177B Solitary Partner Person"],
  ] as Array<[string, string]>) {
    run(
      `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, is_demo, deleted_at)
       VALUES (?, 'tenant_platform', ?, ?, 'partner', 0, NULL)`,
      id,
      `${id}@w177b.test`,
      name,
    );
  }

  /* CASE (ii) ONLY gets a membership row. CASE (i) deliberately gets none — that
     absence IS the fixture, and seeding it would destroy the test. */
  run(
    `INSERT OR REPLACE INTO partner_team_members
       (id, partner_id, user_id, sub_role, status, joined_at, removed_at, created_by, is_seed, updated_at)
     VALUES (?, ?, ?, 'managing_partner', 'active', ?, NULL, 'u_w177b', 0, ?)`,
    `ptm_w177b_alone`,
    LONELY_ORG,
    BOUND_ALONE,
    now(),
    now(),
  );

  /* Both partner rules must be ON, or "reaches nobody" would be explained by the
     switch rather than by the data and this test would prove nothing. */
  for (const key of [RULE, TEAM_RULE]) {
    run(`UPDATE comms_audience_rules SET enabled = 1 WHERE rule_key = ?`, key);
  }
});

afterEach(() => cleanup());

describe("WAVE 177 · ITEM B — the preview names the ACTUAL reason", () => {
  it("B-0 ANTI-VACUITY: the fixture really is what the two cases claim", () => {
    const unboundRows = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM partner_team_members WHERE user_id = ?`)
      .get(UNBOUND) as { n: number };
    expect(unboundRows.n).toBe(0);

    const boundRows = rawDb()
      .prepare(
        `SELECT partner_id FROM partner_team_members
          WHERE user_id = ? AND status = 'active' AND removed_at IS NULL`,
      )
      .all(BOUND_ALONE) as Array<{ partner_id: string }>;
    expect(boundRows.map((r) => r.partner_id)).toEqual([LONELY_ORG]);

    /* And the organisation really is empty of everyone else, so case (ii)'s
       emptiness is a property of the data and not of the rule. */
    const others = rawDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM partner_team_members
          WHERE partner_id = ? AND status = 'active' AND removed_at IS NULL AND user_id <> ?`,
      )
      .get(LONELY_ORG, BOUND_ALONE) as { n: number };
    expect(others.n).toBe(0);

    const rule = rawDb()
      .prepare(`SELECT enabled FROM comms_audience_rules WHERE rule_key = ?`)
      .get(RULE) as { enabled: number };
    expect(rule.enabled).toBe(1);
  });

  it("B-1 CASE (i) — an unbound viewer is told the binding is missing, and told who fixes it", async () => {
    await checkFor(UNBOUND);
    const reason = await screen.findByTestId(`audience-preview-reason-${RULE}`);
    const text = norm(reason.textContent ?? "");
    expect(text).toContain("not linked to any partner organisation");
    /* The sentence must point at the ACTION, not just the state. This is the one
       fact a human had to find by hand on live. */
    expect(text).toContain("administrator");
    /* And it must NOT blame the partner's records, which is the other case. */
    expect(text).not.toContain("no investors on record");
  });

  it("B-2 CASE (ii) — a bound viewer whose partner is empty gets the OTHER reason", async () => {
    await checkFor(BOUND_ALONE);
    const reason = await screen.findByTestId(`audience-preview-reason-${RULE}`);
    const text = norm(reason.textContent ?? "");
    expect(text).toContain("is linked to a partner organisation");
    /* The distinguishing half: the binding EXISTS, the records are empty. */
    expect(text).toMatch(/no colleagues|no investors/);
    expect(text).not.toContain("not linked to any partner organisation");
  });

  it("B-2b the two cases produce DIFFERENT sentences (the distinction is real, not cosmetic)", async () => {
    await checkFor(UNBOUND);
    const a = norm((await screen.findByTestId(`audience-preview-reason-${RULE}`)).textContent ?? "");
    cleanup();
    await checkFor(BOUND_ALONE);
    const b = norm((await screen.findByTestId(`audience-preview-reason-${RULE}`)).textContent ?? "");
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
  });

  it("B-3 R143.1 — the wave-167 empty-state literal is STILL rendered, unchanged, in BOTH cases", async () => {
    for (const who of [UNBOUND, BOUND_ALONE]) {
      await checkFor(who);
      const nobody = await screen.findByTestId(`audience-preview-nobody-${RULE}`);
      expect(norm(nobody.textContent ?? "")).toBe(norm(W167_EMPTY_LITERAL));
      /* And the new sentence is a SEPARATE node, not text appended inside it. */
      expect(nobody.querySelector(`[data-testid="audience-preview-reason-${RULE}"]`)).toBeNull();
      cleanup();
    }
  });

  it("B-4 the team rule gets a reason phrased for COLLEAGUES, not for investors", async () => {
    await checkFor(BOUND_ALONE, TEAM_RULE);
    const reason = await screen.findByTestId(`audience-preview-reason-${TEAM_RULE}`);
    const text = norm(reason.textContent ?? "");
    expect(text).toContain("only account linked to it");
    /* Saying "no investors on record" for the TEAM rule would be a true fact
       offered as the wrong explanation. */
    expect(text).not.toContain("no investors on record");
  });

  it("B-5 R77 / wave167 P-2 — the new sentence leaks no machine vocabulary", async () => {
    for (const who of [UNBOUND, BOUND_ALONE]) {
      await checkFor(who);
      const text = (await screen.findByTestId(`audience-preview-reason-${RULE}`)).textContent ?? "";
      for (const token of [
        "partner_own_lp_peers",
        "partner_team_peers",
        "partner_team_members",
        "sponsor_partner_id",
        "audienceUserIds",
        "viewerRole",
        "emptyReason",
        "no_partner_binding",
        "resolvePartnerIdForUser",
        "SELECT",
        "null",
      ]) {
        expect(text).not.toContain(token);
      }
      /* Nor the account reference itself, inside this sentence. */
      expect(text).not.toContain(who);
      cleanup();
    }
  });

  it("B-6 NO reason is rendered when the rule actually reaches somebody", async () => {
    /* Bind a colleague so the team rule becomes genuinely non-empty. A sentence
       explaining an emptiness that is not there would be a fabrication, and the
       server returns null for exactly this case. */
    const COLLEAGUE = "u_w177b_colleague";
    run(
      `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, is_demo, deleted_at)
       VALUES (?, 'tenant_platform', ?, 'W177B Colleague', 'partner', 0, NULL)`,
      COLLEAGUE,
      `${COLLEAGUE}@w177b.test`,
    );
    run(
      `INSERT OR REPLACE INTO partner_team_members
         (id, partner_id, user_id, sub_role, status, joined_at, removed_at, created_by, is_seed, updated_at)
       VALUES (?, ?, ?, 'associate', 'active', ?, NULL, 'u_w177b', 0, ?)`,
      `ptm_w177b_colleague`,
      LONELY_ORG,
      COLLEAGUE,
      now(),
      now(),
    );

    await checkFor(BOUND_ALONE, TEAM_RULE);
    /* Non-empty now, so BOTH the wave-167 empty node and the new reason node are
       absent — the reason never appears on a working rule. */
    expect(screen.queryByTestId(`audience-preview-nobody-${TEAM_RULE}`)).toBeNull();
    expect(screen.queryByTestId(`audience-preview-reason-${TEAM_RULE}`)).toBeNull();
    expect(screen.getByTestId(`audience-preview-people-${TEAM_RULE}`)).toBeTruthy();
  });
});
