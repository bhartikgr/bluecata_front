/**
 * WAVE 177 · ITEM A · R137 — RENDERED-DOM proof that the repair reaches the
 * screen a real administrator opens.
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY A ROUTE TEST WAS NOT ENOUGH. R137 records an LP fix that passed every test
 * and never reached the LP, because nothing proved the surface rendered. The
 * companion suite `server/__tests__/wave177_itemA_identity_binding.test.ts`
 * proves the four routes and the causal repair of the audience; this file proves
 * the ADMIN PAGE actually renders the controls that call them, and that the
 * honest-rendering rules hold on screen rather than only in the payload.
 *
 * IT MOUNTS THE REAL PAGE against the REAL express routes over real SQLite. The
 * bind is performed BY TYPING AN EMAIL AND CLICKING THE BUTTON — no route is
 * called directly — so a control that existed but was wired to nothing would fail.
 *
 * WHAT IT HOLDS THE SURFACE TO:
 *   · the section renders on the existing partner detail page (no parallel page);
 *   · a partner with no linked account SAYS SO, in words a non-technical owner
 *     can act on;
 *   · typing an email and clicking the button creates the binding IN THE DATABASE;
 *   · after the bind the row shows a permission tier and a linked-on date rather
 *     than the blank cells R148.1 recorded on live;
 *   · a name that is not on record prints a STATED fallback and never a blank;
 *   · the registered-name control writes the name `resolvePartnerName` reads.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { Router, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import express, { type Express } from "express";
import request from "supertest";
import { getDb, rawDb } from "../../../../../server/db/connection";
import { registerPartnerRoutes } from "../../../../../server/partnerRoutes";
import { _registerSeedPartner } from "../../../../../server/adminContactsStoreShim";
import { resolvePartnerIdForUser, resolvePartnerName } from "../../../../../server/lib/partnerDelegatedContext";
import { RoleProvider } from "@/lib/role";
import { queryClient as appQueryClient } from "@/lib/queryClient";
import AdminPartnerDetail from "../PartnerDetail";

const PARTNER = "ac_consortium_partner_w177dom";
/** A person with a name on record — the ordinary case. */
const NAMED = "u_w177dom_named";
const NAMED_EMAIL = "named@w177dom.test";
const ADMIN = "u_admin";

let app: Express;
const now = () => new Date().toISOString();
const run = (sql: string, ...args: unknown[]): void => {
  try {
    rawDb().prepare(sql).run(...(args as any[]));
  } catch (err) {
    throw new Error(`[w177 dom fixture] SQL failed: ${(err as Error).message}\nSQL: ${sql}`);
  }
};

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async (method: string, url: string, body?: unknown) => {
      let r = (request(app) as any)[method.toLowerCase()](url)
        .set("x-user-id", ADMIN)
        .set("x-actor-user-id", ADMIN)
        .set("x-role", "admin");
      if (body !== undefined) r = r.send(body);
      const res = await r;
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

/**
 * THE PAGE IS MOUNTED AGAINST THE APPLICATION'S OWN QueryClient SINGLETON, not a
 * fresh one. This is not incidental: the page's write handlers call
 * `queryClient.invalidateQueries(...)` on the singleton imported from
 * `@/lib/queryClient` (PartnerDetail.tsx:491-494). A test that supplied its own
 * client would leave every invalidation landing on a client nothing was rendered
 * from, so the table would never refresh and the test would be asserting against
 * a page the real app does not have. That mistake silently cost this file a
 * debugging round; it is written down so it is not repeated.
 */
function mount() {
  const qc = appQueryClient;
  qc.setDefaultOptions({ queries: { retry: false }, mutations: { retry: false } });
  const { hook } = memoryLocation({ path: `/admin/partners/${PARTNER}` });
  return render(
    /* RoleProvider is part of the real application shell this page renders inside
       (AppShell's GlossaryLink calls useRole), so the test supplies the real
       provider rather than stubbing the page's surroundings away. */
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <Router hook={hook}>
          <Route path="/admin/partners/:id" component={AdminPartnerDetail} />
        </Router>
      </RoleProvider>
    </QueryClientProvider>,
  );
}

beforeAll(() => {
  getDb();
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);

  _registerSeedPartner({
    id: PARTNER,
    legalName: "W177 DOM Partner",
    displayName: "W177 DOM Partner",
    email: `${PARTNER}@w177dom.test`,
    region: "North America",
    regionCode: "US",
    tier: "catalyst",
    partnerType: "angel_network",
  });

  run(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, is_demo, deleted_at)
     VALUES (?, 'tenant_platform', ?, 'W177 DOM Named Person', 'partner', 0, NULL)`,
    NAMED,
    NAMED_EMAIL,
  );

  /* NOTHING is linked. That absence is the live state this page must describe. */
  run(`DELETE FROM partner_team_members WHERE partner_id = ?`, PARTNER);
  run(`DELETE FROM partner_organizations WHERE id = ?`, PARTNER);
});

afterEach(() => {
  cleanup();
  /* The client is shared across cases, so its cache is cleared between them —
     otherwise one case would read another case's stale payload. */
  appQueryClient.clear();
});

describe("WAVE 177 · ITEM A — the admin surface, RENDERED", () => {
  it("A-D1 the identity section renders on the EXISTING partner detail page", async () => {
    mount();
    /* Proof it is the same page, not a parallel one: the pre-existing Team Members
       card and the new controls are both on screen at once. */
    await waitFor(() => expect(screen.getByText(/Team Members/)).toBeTruthy());
    expect(screen.getByText("Platform account links")).toBeTruthy();
    expect(await screen.findByTestId("w177-bind-email")).toBeTruthy();
    expect(screen.getByTestId("w177-org-name-input")).toBeTruthy();
  });

  it("A-D2 a partner with nobody linked SAYS SO, in words the owner can act on", async () => {
    mount();
    const empty = await screen.findByTestId("w177-no-links");
    const text = (empty.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toContain("No platform account is linked to this partner");
    /* The consequence is stated, because the consequence is the whole reason the
       owner is on this screen. */
    expect(text).toContain("recipient searches will find nobody");
    /* And the missing registered name is stated rather than left blank. */
    const org = await screen.findByTestId("w177-org-name-missing");
    expect((org.textContent ?? "")).toContain("No registered name has been entered");
  });

  it("A-D3 TYPING AN EMAIL AND CLICKING THE BUTTON creates the binding in the database", async () => {
    expect(resolvePartnerIdForUser(NAMED)).toBeNull();

    mount();
    fireEvent.change(await screen.findByTestId("w177-bind-email"), {
      target: { value: NAMED_EMAIL },
    });
    fireEvent.click(screen.getByTestId("w177-bind-submit"));

    /* Asserted against SQLite, not against the rendered optimism of a form. */
    await waitFor(() => {
      expect(resolvePartnerIdForUser(NAMED)).toBe(PARTNER);
    });
    const row = rawDb()
      .prepare(
        `SELECT status, removed_at, sub_role FROM partner_team_members
          WHERE partner_id = ? AND user_id = ?`,
      )
      .get(PARTNER, NAMED) as { status: string; removed_at: string | null; sub_role: string };
    expect(row.status).toBe("active");
    expect(row.removed_at).toBeNull();
    expect(row.sub_role).toBe("managing_partner");
  });

  it("A-D4 the linked row shows a tier and a date — NOT the blank cells seen on live", async () => {
    mount();
    const table = await screen.findByTestId("w177-identity-table");
    const text = (table.textContent ?? "").replace(/\s+/g, " ");
    /* The name IS on record for this person, so it is printed. */
    expect(text).toContain("W177 DOM Named Person");
    expect(text).toContain(NAMED_EMAIL);
    /* The two columns R148.1 found empty on live now carry values. */
    expect(text).toContain("managing_partner");
    /* No stated fallback should be needed for THIS row, because everything about
       it is on record — if a fallback appears here, the read is still broken. */
    expect(text).not.toContain("permission tier not on record");
    expect(text).not.toContain("join date not on record");
    expect(text).not.toContain("name not on record");
    /* And every cell that could have been blank has content. */
    for (const cell of Array.from(table.querySelectorAll("td"))) {
      expect((cell.textContent ?? "").trim().length).toBeGreaterThan(0);
    }
  });

  it("A-D5 a name that is genuinely not on record prints a STATED fallback, never a blank", async () => {
    /* A membership pointing at an account that does not exist at all — the only
       shape for which nothing is derivable. Written directly, because no UI path
       can create it; the point is how the screen BEHAVES if live already has one. */
    run(
      `INSERT OR REPLACE INTO partner_team_members
         (id, partner_id, user_id, sub_role, status, joined_at, removed_at, created_by, is_seed, updated_at)
       VALUES ('ptm_w177dom_ghost', ?, 'u_w177dom_ghost', 'analyst', 'active', ?, NULL, 'u_w177dom', 0, ?)`,
      PARTNER,
      now(),
      now(),
    );

    mount();
    const row = await screen.findByTestId("w177-row-ptm_w177dom_ghost");
    const text = (row.textContent ?? "").replace(/\s+/g, " ");
    expect(text).toContain("name not on record");
    expect(text).toContain("email not on record");
    /* NOTHING invented: the resolver's placeholders must not reach the screen. */
    for (const placeholder of ["Pending member", "Invited member", "Public applicant"]) {
      expect(text).not.toContain(placeholder);
    }
    /* And no cell in this row is blank. */
    for (const cell of Array.from(row.querySelectorAll("td"))) {
      expect((cell.textContent ?? "").trim().length).toBeGreaterThan(0);
    }
  });

  it("A-D6 the registered-name control writes the name resolvePartnerName reads", async () => {
    expect(resolvePartnerName(PARTNER)).toBeNull();
    mount();
    fireEvent.change(await screen.findByTestId("w177-org-name-input"), {
      target: { value: "W177 DOM Registered Name" },
    });
    fireEvent.click(screen.getByTestId("w177-org-name-save"));
    await waitFor(() => {
      expect(resolvePartnerName(PARTNER)).toBe("W177 DOM Registered Name");
    });
  });

  it("A-D7 deactivation is offered as a soft close, and it closes the link", async () => {
    /* WHY A SECOND PERSON IS BOUND HERE INSTEAD OF REUSING THE GHOST ROW.
       `partnerTeamStore.remove()` acts on the in-memory projection
       (partnerWorkspaceStore.ts:989-991), which is rebuilt from
       `partner_team_members` on boot by `hydratePartnerWorkspaceStoreV241`
       (partnerWorkspaceStore.ts:701-726). On the live server that hydration has
       already happened, so the existing `ptm_…` rows ARE in the projection and are
       deactivatable. Inside this file the ghost row was written to SQLite AFTER the
       process started, so it is absent from the projection — a fixture artefact,
       not a product defect, and recorded here so it is not mistaken for one.
       This case therefore binds through the UI (the projection's own write path)
       and deactivates that, which is also the sequence a real admin performs. */
    run(
      `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, is_demo, deleted_at)
       VALUES ('u_w177dom_second', 'tenant_platform', 'second@w177dom.test',
               'W177 DOM Second Person', 'partner', 0, NULL)`,
    );

    /* The ghost membership is released first because it OCCUPIES A SEAT, and the
       bind route refuses at the tier seat limit — the same limit
       `requirePartnerAuth.ts` enforces on the partner side. Freeing it keeps this
       case about deactivation rather than about seat arithmetic (the refusal itself
       is proved separately in the server suite). */
    run(`DELETE FROM partner_team_members WHERE id = 'ptm_w177dom_ghost'`);

    mount();
    fireEvent.change(await screen.findByTestId("w177-bind-email"), {
      target: { value: "second@w177dom.test" },
    });
    /* The permission tier is left at its default. The control is a composed
       listbox, not a native <select>, so a synthetic change event would not move
       it; asserting a value the test could not actually set would be a false proof.
       The default tier is what this case needs anyway. */
    fireEvent.click(screen.getByTestId("w177-bind-submit"));

    let memberId = "";
    await waitFor(() => {
      const r = rawDb()
        .prepare(
          `SELECT id FROM partner_team_members
            WHERE partner_id = ? AND user_id = 'u_w177dom_second' AND status = 'active'`,
        )
        .get(PARTNER) as { id: string } | undefined;
      expect(r?.id, "the second person was not bound").toBeTruthy();
      memberId = String(r!.id);
    });

    const control = await screen.findByTestId(`w177-deactivate-${memberId}`);
    expect((control.textContent ?? "")).toContain("Deactivate link");
    fireEvent.click(control);

    await waitFor(() => {
      const row = rawDb()
        .prepare(`SELECT status, removed_at FROM partner_team_members WHERE id = ?`)
        .get(memberId) as { status: string; removed_at: string | null };
      expect(row.status).not.toBe("active");
      expect(String(row.removed_at ?? "").length).toBeGreaterThan(0);
    });

    /* NEVER A HARD DELETE — the row is still on record after deactivation. */
    const still = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM partner_team_members WHERE id = ?`)
      .get(memberId) as { n: number };
    expect(still.n).toBe(1);

    /* AND THE FENCE DID NOT MOVE: the deactivated person no longer resolves to
       this partner, so a closed link cannot keep reaching the partner's people. */
    expect(resolvePartnerIdForUser("u_w177dom_second")).toBeNull();
  });
});
