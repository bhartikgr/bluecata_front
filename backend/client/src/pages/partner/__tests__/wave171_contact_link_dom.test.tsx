/**
 * WAVE 171 — R137.1 RENDERED-DOM PROOF FOR CONTACT → VEHICLE LINKAGE.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY A DOM TEST AND NOT ONLY THE ROUTE TEST
 * ══════════════════════════════════════════════════════════════════════════════
 * R137.1: "an LP-facing or partner-facing claim is only verified when the MOUNTED
 * component is verified — a passing store test is not evidence that a user sees
 * anything." The wave-171 claim is specifically about a MISSING CONTROL. Thirteen
 * green route tests would prove the endpoint exists while the screen still had no
 * way to reach it, which is the exact defect the wave was opened for. So this
 * file asserts on the DOM a partner actually reads.
 *
 * NOTHING IN THE DATA PATH IS MOCKED. It boots the REAL express app with the
 * REAL registered routes against the REAL SQLite schema, seeds REAL rows, and
 * points the shipped client's `apiRequest` at that app over supertest — the same
 * bridge `wave167_itemE_partner_messaging_dom.test.tsx` established. The chain is
 * end to end:
 *
 *   spv row (sponsor_partner_id) + partner_crm_contacts row
 *     → GET /api/partner/me/crm/link-targets   (the fence)
 *       → POST /api/partner/me/crm/contacts/:id/links
 *         → GET /api/partner/me/crm/contacts/:id  (links + connections)
 *           → PartnerContacts / ContactLinksPanel
 *             → TEXT AND CONTROLS A HUMAN CAN SEE
 *
 * WHAT IT PROVES, AS SENTENCES:
 *   1. the control is REACHABLE — a picker and an "Add link" button are in the DOM;
 *   2. the picker offers the partner's OWN vehicle and NOT another partner's;
 *   3. clicking through renders the link on the screen;
 *   4. NO MONEY STRING appears in the links panel — asserted over its textContent,
 *      so the claim "a link does not imply capital" is checked where a person
 *      would actually be misled;
 *   5. the panel says in words that a link is not a commitment;
 *   6. the pre-existing CONNECTIONS panel still renders, unchanged.
 *
 * FAIL-BEFORE: with the wave-171 panel absent, `contacts-links` is not in the DOM
 * and every test here fails on `getByTestId`. Recorded in
 * `build_log/wave171/W171_TESTS.md`.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import express, { type Express } from "express";
import request from "supertest";
import { getDb, rawDb } from "../../../../../server/db/connection";
import { seedDemoData } from "../../../../../server/lib/seedDemoData";
import {
  seedTestPartnerSandbox,
  partnerTeamStore,
  TEST_PARTNER_ID,
  TEST_PARTNER_USERS,
} from "../../../../../server/partnerWorkspaceStore";
import { _registerSeedPartner } from "../../../../../server/adminContactsStoreShim";
import { hydratePartnerWorkspaceV19Store } from "../../../../../server/partnerWorkspaceV19Store";
import { storeCredential } from "../../../../../server/userCredentialsStore";
import PartnerContacts from "../PartnerContacts";

const PARTNER_A = TEST_PARTNER_ID;
const MANAGING_A = TEST_PARTNER_USERS.managing.userId;

/* A SECOND partner organisation. Its vehicle must never reach the picker. A DOM
   test that only proves the happy path proves nothing about the fence, and the
   picker is exactly where a leak would be visible to a person. */
const PARTNER_B = "ac_consortium_partner_w171dom_b";
const MANAGING_B = "u_w171dom_b_managing";

const SPV_MINE = "spv_w171dom_mine";
const SPV_MINE_NAME = "W171 DOM My Vehicle";
const SPV_THEIRS = "spv_w171dom_theirs";
const SPV_THEIRS_NAME = "W171 DOM Their Secret Vehicle";

let app: Express;

/* ── the mocks, and none of them touch the data path ───────────────────────── */
vi.mock("@/components/partner/PartnerShell", () => ({
  PartnerShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PartnerEmptyState: ({ title }: { title?: string }) => <div>{title ?? ""}</div>,
}));

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));

vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "ac_consortium_partner_test",
      tier: "builder",
      subRole: "managing_partner",
      identity: { userId: "u_partner_managing_test", email: "p@w171dom.test", name: "W171 DOM Managing" },
    },
  }),
}));

/* The SSE subscription is transport, not data — a live socket in a unit test
   would add flake without adding proof. */
vi.mock("@/lib/sseClient", () => ({ useCollectiveStream: () => undefined }));

/* THE BRIDGE — real HTTP, in process. */
const httpCalls: Array<{ method: string; url: string; status: number }> = [];

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async (method: string, url: string, body?: unknown) => {
      let r = (request(app) as any)[method.toLowerCase()](url)
        .set("x-user-id", MANAGING_A)
        .set("x-actor-user-id", MANAGING_A);
      if (body !== undefined) r = r.send(body as any);
      const res = await r;
      httpCalls.push({ method, url, status: res.status });
      if (res.status < 200 || res.status >= 300) {
        throw new actual.ApiError(
          res.status,
          (res.body as { message?: string; error?: string })?.message ??
            (res.body as { error?: string })?.error ??
            `HTTP ${res.status}`,
          null,
          res.body,
        );
      }
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

function stampSignedAgreement(partnerId: string, legalName: string): void {
  const now = new Date().toISOString();
  rawDb()
    .prepare(
      `INSERT INTO contacts
         (id, kind, legal_name, status, verification, created_at, updated_at,
          created_by, updated_by, version, prev_revision_hash, revision_hash,
          partner_agreement_version, partner_agreement_signed_at)
       VALUES (?, 'consortium_partner', ?, 'active', 'verified', ?, ?, 'u_system_seed', 'u_system_seed',
               1, ?, ?, 'CPA-v0.1-DRAFT', ?)
       ON CONFLICT(id) DO UPDATE SET
         partner_agreement_version = excluded.partner_agreement_version,
         partner_agreement_signed_at = excluded.partner_agreement_signed_at`,
    )
    .run(partnerId, legalName, now, now, "0".repeat(64), "0".repeat(64), now);
}

function insertEngineSpv(id: string, sponsorPartnerId: string, name: string): void {
  const now = new Date().toISOString();
  rawDb()
    .prepare(
      `INSERT OR IGNORE INTO spv
         (id, sponsor_partner_id, name, spv_type, jurisdiction, status,
          distribution_scope, target_raise_minor, min_check_minor, cap_minor,
          currency, carry_basis, lp_visibility, created_at, updated_at, curr_hash)
       VALUES (?, ?, ?, 'spv', 'delaware', 'fundraising', 'private',
               5000000, 2500000, 7500000, 'USD', 'committed', 'own_only', ?, ?, ?)`,
    )
    .run(id, sponsorPartnerId, name, now, now, "0".repeat(64));
}

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
  await seedDemoData(getDb());
  seedTestPartnerSandbox({ force: true });

  _registerSeedPartner({
    id: PARTNER_B,
    legalName: "W171 DOM PARTNER B, INC",
    displayName: "W171 DOM PARTNER B",
    email: "ops@w171dom-b.example",
    region: "US",
    regionCode: "US",
    tier: "builder",
    partnerType: "accelerator",
  });
  partnerTeamStore.add(PARTNER_B, MANAGING_B, "managing_partner", "u_system_seed", { isSeed: true });
  stampSignedAgreement(PARTNER_B, "W171 DOM PARTNER B, INC");
  storeCredential({
    userId: MANAGING_B,
    email: "managing-b@w171dom-b.example",
    name: "W171 DOM B Managing",
    password: "test-password-w171dom-b",
  });

  insertEngineSpv(SPV_MINE, PARTNER_A, SPV_MINE_NAME);
  insertEngineSpv(SPV_THEIRS, PARTNER_B, SPV_THEIRS_NAME);

  await hydratePartnerWorkspaceV19Store();

  /* ONLY the CRM routes are mounted, not the whole app. Importing
     `server/routes` here pulls `server/lib/kycStorage.ts` into the jsdom
     transform, which dynamically imports `@aws-sdk/s3-request-presigner` — not
     installed in this tree, so the suite failed to load at all. Mounting the one
     registrar under test is also the narrower, faster harness, and is what
     `wave167_itemE_partner_messaging_dom.test.tsx` does with `registerCommsRoutes`.
     Nothing about the routes themselves is stubbed. */
  const { registerPartnerWorkspaceV19Routes } = await import(
    "../../../../../server/partnerWorkspaceV19Store"
  );
  const { installV14TestIdentity } = await import("../../../../../server/__tests__/_v14TestIdentity");
  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: false });
  registerPartnerWorkspaceV19Routes(app);
}, 60_000);

/* Each test mounts the page fresh. Without this the previous render stays in the
   document and `getByTestId("contacts-links")` matches more than one node. */
afterEach(() => cleanup());

/** Mount the page and select the seeded contact, so the detail panel renders. */
async function mountAndSelectContact(name: string): Promise<void> {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={qc}>
      <PartnerContacts />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(httpCalls.some((c) => c.url.startsWith("/api/partner/me/crm/contacts") && c.status === 200)).toBe(true),
  );
  const row = await screen.findByText(new RegExp(name, "i"), {}, { timeout: 5000 });
  fireEvent.click(row);
  await waitFor(() => expect(screen.getByTestId("contacts-links")).toBeTruthy());
}

async function seedContact(first: string, last: string, email: string): Promise<string> {
  const res = await request(app)
    .post("/api/partner/me/crm/contacts")
    .set("x-user-id", MANAGING_A)
    .send({ first_name: first, last_name: last, email });
  expect([200, 201]).toContain(res.status);
  return String((res.body as any)?.contact?.id ?? "");
}

describe("wave171 · rendered DOM — the control exists on the screen", () => {
  it("DOM1: the linking control, the picker and the disclaimer are all in the DOM", async () => {
    await seedContact("Dom", "Reachable", "dom.reachable@w171.example");
    await mountAndSelectContact("Dom Reachable");

    /* 1 — THE CONTROL IS REACHABLE. This is the wave's actual claim. */
    expect(screen.getByTestId("contacts-links")).toBeTruthy();
    expect(screen.getByTestId("link-kind")).toBeTruthy();
    expect(screen.getByTestId("link-target")).toBeTruthy();
    expect(screen.getByTestId("link-relationship")).toBeTruthy();
    const addBtn = screen.getByTestId("link-add") as HTMLButtonElement;
    expect(addBtn).toBeTruthy();
    expect(addBtn.textContent).toContain("Add link");

    /* 5 — IT SAYS IN WORDS THAT A LINK IS NOT A COMMITMENT. */
    const disclaimer = screen.getByTestId("contacts-links-disclaimer");
    expect(disclaimer.textContent).toContain("not a subscription");
    expect(disclaimer.textContent).toContain("commitment");
    expect(disclaimer.textContent).toContain("does not reserve or allocate any amount");

    /* 6 — THE PRE-EXISTING PANEL IS UNTOUCHED AND STILL RENDERS. */
    expect(screen.getByTestId("contacts-connections")).toBeTruthy();
  });

  it("DOM2: the picker lists the partner's OWN vehicle and NOT another partner's", async () => {
    await seedContact("Dom", "Fenced", "dom.fenced@w171.example");
    await mountAndSelectContact("Dom Fenced");
    await waitFor(() =>
      expect(httpCalls.some((c) => c.url === "/api/partner/me/crm/link-targets" && c.status === 200)).toBe(true),
    );
    const select = (await waitFor(() => {
      const s = screen.getByTestId("link-target") as HTMLSelectElement;
      expect(s.querySelectorAll("option").length).toBeGreaterThan(1);
      return s;
    })) as HTMLSelectElement;
    const texts = Array.from(select.querySelectorAll("option")).map((o) => o.textContent ?? "");
    expect(texts.join(" | ")).toContain(SPV_MINE_NAME);
    /* ANTI-VACUITY: the other partner's vehicle genuinely exists… */
    expect(rawDb().prepare(`SELECT id FROM spv WHERE id = ?`).get(SPV_THEIRS)).toBeTruthy();
    /* …and its NAME never reaches the screen. */
    expect(texts.join(" | ")).not.toContain(SPV_THEIRS_NAME);
    expect(document.body.textContent ?? "").not.toContain(SPV_THEIRS_NAME);
  });

  it("DOM3: linking through the UI renders the link, and NO money string appears in the panel", async () => {
    await seedContact("Dom", "Linker", "dom.linker@w171.example");
    await mountAndSelectContact("Dom Linker");

    const select = (await waitFor(() => {
      const s = screen.getByTestId("link-target") as HTMLSelectElement;
      expect(s.querySelectorAll("option").length).toBeGreaterThan(1);
      return s;
    })) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: SPV_MINE } });
    fireEvent.change(screen.getByTestId("link-relationship"), { target: { value: "prospective_lp" } });
    fireEvent.click(screen.getByTestId("link-add"));

    /* 3 — THE LINK IS ON THE SCREEN, by name, after a real round trip. */
    const row = await waitFor(() => screen.getByTestId(`link-spv-${SPV_MINE}`), { timeout: 5000 });
    expect(row.textContent).toContain(SPV_MINE_NAME);
    /* The exact string the shipped `humanizeMachineKey` produces for
       `prospective_lp`. Pinned as measured, not as guessed. */
    expect(row.textContent).toContain("Prospective lp");
    /* And the raw machine key never reaches a person. */
    expect(row.textContent).not.toContain("prospective_lp");

    /* 4 — THE PROOF A PERSON CANNOT BE MISLED. The entire links panel is swept
       for anything money-shaped. The vehicle carries a 50,000.00 target and a
       75,000.00 cap in the fixture, so if any of that leaked into this panel it
       would be caught here, at the surface where it would actually be read as a
       commitment. */
    const panelText = screen.getByTestId("contacts-links").textContent ?? "";
    expect(panelText).toContain(SPV_MINE_NAME); // the sweep is over real content
    for (const moneyish of ["$", "USD", "50,000", "75,000", "25,000", "5000000", "7500000"]) {
      expect(panelText).not.toContain(moneyish);
    }
    /* No currency symbol or grouped-decimal amount of any shape. */
    expect(panelText).not.toMatch(/[$€£¥]\s?\d/);
    expect(panelText).not.toMatch(/\d[\d,]*\.\d{2}\b/);

    /* And the DERIVED commitment panel is still empty for this person, so the
       link did not become a position anywhere a person can see. */
    const conn = screen.getByTestId("contacts-connections").textContent ?? "";
    expect(conn).toContain("SPV LP memberships");
    expect(conn).not.toContain(SPV_MINE_NAME);
  });

  it("DOM4: a refused link renders the SERVER'S OWN sentence, not an enum code", async () => {
    const contactId = await seedContact("Dom", "Refused", "dom.refused@w171.example");
    /* Pre-link out of band so the UI attempt is a genuine duplicate. */
    const pre = await request(app)
      .post(`/api/partner/me/crm/contacts/${contactId}/links`)
      .set("x-user-id", MANAGING_A)
      .send({ target_kind: "spv", target_id: SPV_MINE });
    expect(pre.status).toBe(201);

    await mountAndSelectContact("Dom Refused");
    const select = (await waitFor(() => {
      const s = screen.getByTestId("link-target") as HTMLSelectElement;
      expect(s.querySelectorAll("option").length).toBeGreaterThan(1);
      return s;
    })) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: SPV_MINE } });
    fireEvent.click(screen.getByTestId("link-add"));

    const err = await waitFor(() => screen.getByTestId("link-error"), { timeout: 5000 });
    /* R58/R77 — a sentence, not `HTTP 409: LINK_ALREADY_EXISTS`. */
    expect(err.textContent).toContain("already linked");
    expect((err.textContent ?? "").length).toBeGreaterThan(60);
  });
});
