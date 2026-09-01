/**
 * WAVE 232 — THE PROGRESS PERCENTAGE STOPS MIXING THREE PROVENANCES.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE DEFECT UNDER TEST
 * ══════════════════════════════════════════════════════════════════════════════
 * `OnboardingChecklistPage` renders one number — "N / 10 complete · P%" — over
 * ten items that are three different kinds of thing:
 *
 *   ONE   is recorded by Capavate (the durable partner-agreement signature);
 *   EIGHT are ticked by the partner and checked by nobody;
 *   ONE   cannot be done on the platform at all (there is no SSO integration).
 *
 * NOTHING TICKS ITSELF. There is no server process anywhere that writes any of
 * those eight keys, so a high percentage is overwhelmingly the partner's own
 * self-attestation being read back to them as if the platform had established
 * it.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE WRONG FIX THIS FILE EXISTS TO FORBID
 * ══════════════════════════════════════════════════════════════════════════════
 * The tempting derivation is "items carrying a `support` string are the ones the
 * platform cannot do". FOUR items carry `support`; only ONE of them is
 * impossible. The other three open "Manual step" and are perfectly completable
 * off-platform. That derivation yields 1 / 6 / 3 and is a lie in the opposite
 * direction — it tells a partner that a step they really did finish is one the
 * platform can never accept. `PROV4` below pins all four items individually so
 * that shortcut cannot be reintroduced silently.
 *
 * The second wrong fix, already rejected once on this defect, is naming the
 * first bucket "platform_verified". Eight of the ten are user toggles; calling
 * any provenance here "verified" fabricates a check no code performs. `PROV8`
 * asserts the word never reaches the screen and never enters the source.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * NOTHING IN THE DATA PATH IS MOCKED
 * ══════════════════════════════════════════════════════════════════════════════
 * The page calls global `fetch` directly, so the bridge here replaces
 * `global.fetch` with one that drives the REAL express app over supertest
 * against the REAL SQLite schema and the REAL registered routes — both
 * `registerPartnerOnboardingRoutes` and `registerPartnerSelfServiceRoutes`. The
 * signed-agreement fixture in `PROV6` is moved by a REAL HTTP POST to
 * /api/partner/me/agreement, which really does UPDATE the `contacts` row, so it
 * is a fixture a server mutation can and does move.
 *
 * The one deliberate exception is `PROV5`, which needs the agreement GET to
 * FAIL, because the code path under test is the page's own
 * `setAgreementSigned(null)` catch. That single URL is answered 503 in that
 * block, and only there. Everything else in `PROV5` is the real route.
 *
 * NEVER MUTATES data.db / test.db — ordinary in-memory test handle.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import express, { type Express } from "express";
import request from "supertest";
import { RoleProvider } from "@/lib/role";
import { getDb, rawDb } from "../../../../../server/db/connection";
import { seedDemoData } from "../../../../../server/lib/seedDemoData";
import {
  seedTestPartnerSandbox,
  TEST_PARTNER_ID,
  TEST_PARTNER_USERS,
} from "../../../../../server/partnerWorkspaceStore";
import PartnerOnboardingChecklistPage, {
  PROGRESS_NOT_SUPPORTED_MARKER,
  progressProvenanceOf,
} from "../OnboardingChecklistPage";

const PARTNER_A = TEST_PARTNER_ID;
const MANAGING_A = TEST_PARTNER_USERS.managing.userId;

/* The ten keys, in the order the file declares them. Presence and order are
   protected (nothing may be removed or renumbered), so they are pinned here
   rather than derived from the component. */
const CHECKLIST_KEYS_IN_ORDER = [
  "kyc_org_doc",
  "kyc_signatory_doc",
  "signed_partner_agreement",
  "billing_contact",
  "team_invites",
  "first_pipeline_deal",
  "first_client_org",
  "sso_configured",
  "data_retention_acked",
  "go_live_review",
] as const;

/* The two protected sentences (R221.6). Byte-for-byte, no normalising call. */
const PROTECTED_UPLOAD_SUPPORT =
  "Manual step — there is no upload control on this screen. Send the document to your chapter admin, then tick this to record that you have done so.";
const PROTECTED_SSO_SUPPORT =
  "Not currently supported — Capavate has no SSO integration to configure, so this item cannot be completed on the platform. It is retained for the roadmap and for orgs whose own policy requires the record.";

let app: Express;

/* ── mocks, none of which touch the data path ─────────────────────────────── */
vi.mock("@/components/partner/PartnerShell", () => ({
  PartnerShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PartnerEmptyState: ({ title }: { title?: string }) => <div>{title ?? ""}</div>,
}));

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));

/* FROZEN AND HOISTED ON PURPOSE — wave 173 recorded that a fresh object literal
   here re-runs the page's load effect on every render, an unbounded GET loop
   that holds `loading` true and makes every control disabled. Referential
   stability is a requirement of this harness. */
const ROLE_IDENTITY = Object.freeze({
  partnerId: PARTNER_A,
  tier: "builder",
  subRole: "managing_partner",
  identity: Object.freeze({
    userId: MANAGING_A,
    email: "p@w232dom.test",
    name: "W232 DOM Managing",
  }),
});
const ROLE_RESULT = Object.freeze({ ready: true, error: null, identity: ROLE_IDENTITY });
vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ROLE_RESULT,
}));

vi.mock("@/lib/sseClient", () => ({ useCollectiveStream: () => undefined }));

/* ── the bridge: real HTTP, in process, over the real handlers ─────────────── */
const httpCalls: Array<{ method: string; url: string; status: number }> = [];
/** PROV5 only: force the agreement GET to fail so the page's null path runs. */
let failAgreementRead = false;

beforeAll(async () => {
  process.env.COLLECTIVE_ENABLED = "1";
  await seedDemoData(getDb());
  seedTestPartnerSandbox({ force: true });

  const { registerPartnerOnboardingRoutes } = await import(
    "../../../../../server/consortiumApplyStore"
  );
  const { registerPartnerSelfServiceRoutes } = await import(
    "../../../../../server/lib/partnerSelfServiceRoutes"
  );
  const { installV14TestIdentity } = await import(
    "../../../../../server/__tests__/_v14TestIdentity"
  );
  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: false });
  registerPartnerOnboardingRoutes(app);
  registerPartnerSelfServiceRoutes(app);

  (global as any).fetch = async (url: string, init?: RequestInit) => {
    const method = String(init?.method ?? "GET").toLowerCase();
    if (failAgreementRead && String(url).includes("/api/partner/me/agreement")) {
      httpCalls.push({ method: method.toUpperCase(), url: String(url), status: 503 });
      return {
        ok: false,
        status: 503,
        statusText: "503",
        headers: { get: () => "application/json" },
        json: async () => ({ error: "AGREEMENT_READ_UNAVAILABLE" }),
        text: async () => '{"error":"AGREEMENT_READ_UNAVAILABLE"}',
        clone() {
          return this;
        },
      } as unknown as Response;
    }
    let r = (request(app) as any)[method](String(url))
      .set("x-user-id", MANAGING_A)
      .set("x-actor-user-id", MANAGING_A);
    if (init?.body !== undefined && init?.body !== null) {
      r = r.set("content-type", "application/json").send(String(init.body));
    }
    const res = await r;
    httpCalls.push({ method: method.toUpperCase(), url: String(url), status: res.status });
    const bodyText = JSON.stringify(res.body ?? {});
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      statusText: String(res.status),
      headers: {
        get: (k: string) =>
          k.toLowerCase() === "content-type" ? "application/json" : null,
      },
      json: async () => res.body,
      text: async () => bodyText,
      clone() {
        return this;
      },
    } as unknown as Response;
  };
}, 60_000);

afterEach(() => {
  cleanup();
  failAgreementRead = false;
});

async function mountChecklist(): Promise<void> {
  /* THE COUNTS ARE SNAPSHOTTED BEFORE THE RENDER, and the waits below require an
     INCREASE. `httpCalls` accumulates across every test in the file, so a
     `some(...)` predicate over the whole array is satisfied by a call some
     EARLIER test made and returns instantly — which let a mount be asserted
     before this mount's own agreement overlay had landed, and the recorded line
     was then read in its transient `null` state. A wait that can be satisfied by
     history is not a wait. */
  const stateCallsBefore = httpCalls.filter((c) =>
    c.url.includes("/api/partner/onboarding/state"),
  ).length;
  const agreementCallsBefore = httpCalls.filter((c) =>
    c.url.includes("/api/partner/me/agreement"),
  ).length;

  render(
    <RoleProvider>
      <PartnerOnboardingChecklistPage />
    </RoleProvider>,
  );
  await waitFor(
    () =>
      expect(
        httpCalls.filter((c) => c.url.includes("/api/partner/onboarding/state")).length,
      ).toBeGreaterThan(stateCallsBefore),
    { timeout: 5000 },
  );
  await waitFor(() => expect(screen.getByTestId("badge-progress")).toBeTruthy(), {
    timeout: 5000,
  });
  await waitFor(
    () =>
      expect(
        httpCalls.filter((c) => c.url.includes("/api/partner/me/agreement")).length,
      ).toBeGreaterThan(agreementCallsBefore),
    { timeout: 5000 },
  );
  /* The overlay is applied in a `setState` after the fetch resolves, so wait for
     the RENDERED line to leave its loading-time shape rather than for the HTTP
     call alone. */
  await waitFor(
    () => {
      const line = String(
        screen.getByTestId("text-progress-provenance-recorded").textContent ?? "",
      ).replace(/\s+/g, " ");
      expect(/on record\.|Not established/.test(line)).toBe(true);
    },
    { timeout: 5000 },
  );
}

function txt(testId: string): string {
  return String(screen.getByTestId(testId).textContent ?? "").replace(/\s+/g, " ").trim();
}

describe("wave232 · the progress percentage discloses what it mixes", () => {
  it("PROV0 (precondition) the harness really drives the real routes, and the checklist really is untouched at rest", async () => {
    await mountChecklist();
    /* Anti-vacuity: if this were 0 the whole file would be asserting about a
       page that never loaded. */
    expect(httpCalls.filter((c) => c.url.includes("/api/partner/onboarding/state")).length)
      .toBeGreaterThanOrEqual(1);
    /* `partner_organizations` is empty and has no server INSERT path, so every
       self-attested item is unticked in this tree. Stated so the done counts
       below are read against a known floor rather than a guess. */
    const row = rawDb()
      .prepare(`SELECT COUNT(*) AS n FROM partner_organizations WHERE id = ?`)
      .get(PARTNER_A) as { n: number };
    expect(row.n).toBe(0);
  }, 30_000);

  it("PROV1: all ten items still render, in their original order, none removed and none renumbered", async () => {
    await mountChecklist();
    for (const key of CHECKLIST_KEYS_IN_ORDER) {
      expect(screen.getByTestId(`item-${key}`)).toBeTruthy();
    }
    /* Order, not merely presence. `compareDocumentPosition` reads the real
       rendered tree, so a reordering that kept every testid would still fail. */
    const nodes = CHECKLIST_KEYS_IN_ORDER.map((k) => screen.getByTestId(`item-${k}`));
    for (let i = 1; i < nodes.length; i += 1) {
      const rel = nodes[i - 1].compareDocumentPosition(nodes[i]);
      // eslint-disable-next-line no-bitwise
      expect(rel & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    /* WAVE 219's anchor must still be the last sibling in the retention item. */
    const retentionBody = screen.getByTestId("item-data_retention_acked");
    const anchor = screen.getByTestId("link-data-retention-privacy");
    expect(retentionBody.contains(anchor)).toBe(true);
  }, 30_000);

  it("PROV2 (R221.6): both protected support sentences render VERBATIM, with no normalising call", async () => {
    await mountChecklist();
    /* Read straight off the DOM node's textContent with no trim, no collapse,
       no lowercase. A normaliser inside the assertion would let a reworded
       sentence pass. */
    expect(screen.getByTestId("support-kyc_org_doc").textContent).toBe(
      PROTECTED_UPLOAD_SUPPORT,
    );
    expect(screen.getByTestId("support-sso_configured").textContent).toBe(
      PROTECTED_SSO_SUPPORT,
    );
    /* The classifier keys off a substring of the SSO sentence, so this doubles
       as the proof that the marker and the protected copy have not drifted
       apart. If someone reworded the sentence, the classification would move
       silently; this makes it loud. */
    expect(PROTECTED_SSO_SUPPORT).toContain(PROGRESS_NOT_SUPPORTED_MARKER);
  }, 30_000);

  it("PROV3: the badge and the bar are unchanged — this wave adds a statement, it does not restate the number", async () => {
    await mountChecklist();
    /* The existing badge format is pinned so the wave cannot have quietly
       rewritten the very figure it is explaining. */
    expect(txt("badge-progress")).toMatch(/^\d+ \/ \d+ complete · \d+%$/);
    expect(screen.getByTestId("bar-progress")).toBeTruthy();
    /* The muted note that preceded the new block is still there, and the new
       block really is AFTER it (guard rule: append last). */
    const card = screen.getByTestId("badge-progress").closest("div.flex")?.parentElement;
    expect(card).toBeTruthy();
    const note = Array.from(card!.children).find((c) =>
      String(c.textContent ?? "").includes("Your progress is saved against your organisation"),
    );
    expect(note).toBeTruthy();
    const block = screen.getByTestId("text-progress-provenance");
    // eslint-disable-next-line no-bitwise
    expect(note!.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(block.parentElement).toBe(note!.parentElement);
    expect(Array.from(card!.children).indexOf(block)).toBe(card!.children.length - 1);
  }, 30_000);

  it("PROV4: the classifier keys off MECHANISM, so the three 'Manual step' items are NOT called impossible", () => {
    /* THE 1/6/3 TRAP, pinned item by item. All four of these carry a `support`
       string; only one of them is impossible. */
    expect(
      progressProvenanceOf({ key: "kyc_org_doc", support: PROTECTED_UPLOAD_SUPPORT }),
    ).toBe("self_attested");
    expect(
      progressProvenanceOf({
        key: "kyc_signatory_doc",
        support: PROTECTED_UPLOAD_SUPPORT.replace("document", "ID"),
      }),
    ).toBe("self_attested");
    expect(
      progressProvenanceOf({
        key: "go_live_review",
        support:
          "Manual step — arranged directly with your chapter admin. Nothing on the platform books this review.",
      }),
    ).toBe("self_attested");
    expect(
      progressProvenanceOf({ key: "sso_configured", support: PROTECTED_SSO_SUPPORT }),
    ).toBe("not_supported");
    /* MOVE THE FIXTURE — items that do not exist in CHECKLIST at all, so a
       hardcoded 1 / 8 / 1 cannot satisfy this. */
    expect(progressProvenanceOf({ key: "signed_partner_agreement" })).toBe(
      "recorded_by_capavate",
    );
    expect(progressProvenanceOf({ key: "w232_invented_key" })).toBe("self_attested");
    expect(
      progressProvenanceOf({
        key: "w232_invented_impossible",
        support: `Nothing here — this cannot be completed on the platform at present.`,
      }),
    ).toBe("not_supported");
    expect(
      progressProvenanceOf({ key: "w232_invented_manual", support: "Manual step — off platform." }),
    ).toBe("self_attested");
  });

  it("PROV5: an UNREADABLE signature record says 'not established' — it does not report a zero", async () => {
    failAgreementRead = true;
    await mountChecklist();
    const recorded = txt("text-progress-provenance-recorded");
    /* The prohibition, at the one place in this wave where it could be broken.
       `agreementSigned === null` means Capavate does not know, and "0 of 1 on
       record" would be a fabricated zero standing in for an absent value. */
    expect(recorded).toContain("Not established");
    expect(recorded).not.toContain("0 of 1 on record");
    /* And the screen admits the consequence rather than hiding it: the
       percentage above is treating the unknown as incomplete. */
    expect(recorded).toContain("the percentage counts it as incomplete");
  }, 30_000);

  it("PROV6: MOVE THE FIXTURE — a real signature POST moves the recorded bucket and the badge together", async () => {
    /* `seedTestPartnerSandbox` seeds this partner WITH a current signature, so
       the unsigned baseline has to be established first. This clears the three
       canonical columns the real route reads and the real route writes — the
       same columns, by name, not a stub and not a store double. Verified to have
       taken effect below before anything is asserted about the screen. */
    rawDb()
      .prepare(
        `UPDATE contacts
            SET partner_agreement_version = NULL,
                partner_agreement_signed_at = NULL,
                partner_agreement_signature_hash = NULL
          WHERE id = ? AND kind = 'consortium_partner'`,
      )
      .run(PARTNER_A);
    const cleared = rawDb()
      .prepare(`SELECT partner_agreement_signed_at AS a FROM contacts WHERE id = ?`)
      .get(PARTNER_A) as { a: string | null };
    expect(cleared.a).toBeNull();

    await mountChecklist();
    const beforeBadge = txt("badge-progress");
    const beforeRecorded = txt("text-progress-provenance-recorded");
    expect(beforeRecorded).toContain("0 of 1 on record");
    const beforeDone = Number(beforeBadge.split(" / ")[0]);
    expect(Number.isFinite(beforeDone)).toBe(true);
    cleanup();

    /* A REAL server mutation: this UPDATEs contacts.partner_agreement_signed_at.
       No fixture is edited and no store is stubbed. */
    const signRes = await request(app)
      .post("/api/partner/me/agreement")
      .set("x-user-id", MANAGING_A)
      .set("x-actor-user-id", MANAGING_A)
      .set("content-type", "application/json")
      .send({ signatureName: "W232 DOM Managing" });
    expect(signRes.status).toBe(200);

    await mountChecklist();
    const afterRecorded = txt("text-progress-provenance-recorded");
    const afterBadge = txt("badge-progress");
    /* The breakdown followed the durable record, not a literal. */
    expect(afterRecorded).toContain("1 of 1 on record");
    expect(afterRecorded).not.toContain("0 of 1 on record");
    /* And it followed the SAME number the badge reports, so the disclosure and
       the percentage cannot drift apart. */
    expect(Number(afterBadge.split(" / ")[0])).toBe(beforeDone + 1);
  }, 40_000);

  it("PROV7: the three buckets account for every item, and the denominator matches the badge", async () => {
    await mountChecklist();
    const recorded = txt("text-progress-provenance-recorded");
    const self = txt("text-progress-provenance-self");
    const unsupported = txt("text-progress-provenance-unsupported");

    /* Read the rendered totals back out of the prose. Deliberately parsed from
       what a partner actually reads, not from a data attribute the test could
       be handed. */
    const recordedTotal = Number(/Recorded by Capavate — (\d+)/.exec(recorded)?.[1]);
    const selfTotal = Number(/Ticked by you — (\d+)/.exec(self)?.[1]);
    const unsupportedTotal = Number(/cannot do at all — (\d+)/.exec(unsupported)?.[1]);
    expect(Number.isFinite(recordedTotal)).toBe(true);
    expect(Number.isFinite(selfTotal)).toBe(true);
    expect(Number.isFinite(unsupportedTotal)).toBe(true);

    expect(recordedTotal).toBe(1);
    expect(unsupportedTotal).toBe(1);
    expect(selfTotal).toBe(8);

    /* THE STRUCTURAL CLAIM: no item is dropped from the breakdown and none is
       counted twice. The denominator comes from the badge, which is computed by
       the untouched `progress` memo over CHECKLIST.length. */
    const badgeTotal = Number(txt("badge-progress").split(" / ")[1].split(" ")[0]);
    expect(badgeTotal).toBe(CHECKLIST_KEYS_IN_ORDER.length);
    expect(recordedTotal + selfTotal + unsupportedTotal).toBe(badgeTotal);
  }, 30_000);

  it("PROV8: nothing on the screen calls any of this 'verified', and the rejected state name is absent from the source", async () => {
    await mountChecklist();
    const block = txt("text-progress-provenance");
    /* The fabrication that was caught and rejected once already on this defect.
       Eight of the ten are user toggles; a "platform_verified" provenance would
       assert a check nothing performs. */
    expect(block.toLowerCase()).not.toContain("verified");
    expect(block.toLowerCase()).not.toContain("we confirm");
    /* Said positively instead: the screen states the opposite about the eight. */
    const self = txt("text-progress-provenance-self");
    expect(self).toContain("Capavate does not check them");
    /* And the lead sentence names the distinction the percentage was blurring. */
    expect(txt("text-progress-provenance-lead")).toContain("recorded");
    expect(txt("text-progress-provenance-lead")).toContain(
      "not steps Capavate has checked",
    );
  }, 30_000);

  it("PROV9: no rendered line exceeds the 240-character client copy ceiling", async () => {
    await mountChecklist();
    /* The 240-character `looksHuman` gate in `client/src/lib/queryClient.ts:60`
       applies to SERVER MESSAGES surfaced through `apiRequest`, and this wave
       adds none — so `fitToGate()` is not the right instrument here and is
       deliberately not used. The ceiling is still honoured as a readability
       discipline, and checked rather than asserted. */
    for (const id of [
      "text-progress-provenance-lead",
      "text-progress-provenance-recorded",
      "text-progress-provenance-self",
      "text-progress-provenance-unsupported",
    ]) {
      const line = txt(id);
      expect(line.length).toBeGreaterThan(40); // anti-vacuity: the node has prose in it
      expect(line.length).toBeLessThan(240);
    }
  }, 30_000);
});
