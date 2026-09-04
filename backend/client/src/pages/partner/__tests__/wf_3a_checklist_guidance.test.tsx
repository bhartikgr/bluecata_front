/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * WALKTHROUGH WAVE F · ITEM 3a — WHERE TO GO, AND WHAT "COMPLETE" HONESTLY MEANS.
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * THE OWNER: "these are only 'check boxes'. Analyze each choice and ensure it is
 * relevant to the Consortium Partner. Include guidance for Consortium Partners as
 * to how/where they can complete their profiles. Ensure that these are dynamic
 * and are updated in real time."
 *
 * ── TWO PREMISES WERE RE-MEASURED, AND ONE OF THEM WAS ALREADY BUILT ────────────
 * "ONLY CHECK BOXES" AND "MAKE THEM DYNAMIC" WERE ALREADY DONE, so they are not
 * rebuilt. The page reads its state from `GET /api/partner/onboarding/state` on
 * mount, writes each tick through a PATCH, applies the change optimistically and
 * ROLLS BACK on failure, and offers a Reload control. Tests D-1..D-3 below prove
 * that by driving the seam, because "it is dynamic" asserted against a fixture no
 * server value can move is exactly the inert mechanism this brief warns about.
 *
 * "UPDATED IN REAL TIME" IS REFUSED RATHER THAN FAKED. There is no polling and no
 * server-push anywhere in this app: `client/src/lib/queryClient.ts` sets
 * `refetchInterval: false`, `refetchOnWindowFocus: false` and `staleTime: 30_000`.
 * The checklist therefore updates on open, on tick, and on Reload. Building a
 * poller for a single-actor checklist would be the "more complicated" the owner
 * explicitly asked twice to avoid, and claiming real-time without one would be a
 * false claim. Test D-4 asserts the refusal is TRUE — that no polling exists —
 * rather than asserting a sentence about it.
 *
 * ── WHAT WAS ACTUALLY MISSING: THE "WHERE" ──────────────────────────────────────
 * Two items already linked to their destination. Four more have a real place on
 * the platform where the work is done and said nothing about it. Item 3a adds
 * those four links, and — just as importantly — DELIBERATELY ADDS NONE to the
 * four items that have no platform destination, because a link that goes
 * somewhere useless is worse than no link. G-1..G-4 assert both halves.
 *
 * ── THE SSO ITEM, HANDLED HONESTLY ──────────────────────────────────────────────
 * THE BRIEF'S PREMISE IS CORRECTED HERE, NOT REPEATED. The brief states the SSO
 * item "can never be completed, so the percentage can never reach 100%". Measured:
 * the SSO row renders a real, enabled toggle (only the partner-agreement item
 * renders a non-interactive span), so 100% IS arithmetically reachable by
 * self-attestation. What is TRUE is narrower and more important: single sign-on
 * CANNOT BE CONFIGURED ON CAPAVATE — no integration exists — so a tick on that
 * row is the partner's own assertion about their own identity provider and
 * nothing Capavate observed. WAVE 232 already renders exactly that distinction,
 * bucketing the ten items into recorded-by-Capavate, self-attested, and
 * "cannot be completed on the platform". S-1..S-3 assert that the distinction is
 * on screen, that the SSO row is the one in the unsupported bucket, and that the
 * percentage is NOT quietly capped or inflated. Nothing about it is rebuilt.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleProvider } from "@/lib/role";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import OnboardingChecklistPage, {
  PROGRESS_NOT_SUPPORTED_MARKER,
  progressProvenanceOf,
} from "../OnboardingChecklistPage";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLIENT_SRC = resolve(HERE, "..", "..", "..");

vi.mock("@/components/partner/PartnerShell", () => ({
  PartnerShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PartnerEmptyState: ({ title }: { title?: string }) => <div>{title}</div>,
  TierBadge: () => <span />,
  SubRoleBadge: () => <span />,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
/* THE MOCK RETURNS ONE STABLE OBJECT, AND THAT DETAIL COST A DIAGNOSIS.
   The first version built a fresh identity object on every call. The page's load
   effect depends on `role.identity` (OnboardingChecklistPage.tsx:369-371), so a
   new object each render re-triggered the read forever: `loading` flipped true
   again immediately after every settle, every toggle stayed `disabled`, the click
   did nothing and three tests reddened as though the page could not write. The
   page is not at fault — a real hook returns a stable reference. A fixture that
   cannot hold still is the same class of inert mechanism as a fixture no server
   value can move, and the fix belongs in the fixture. */
const WF_ROLE = {
  ready: true as const,
  error: null,
  identity: {
    partnerId: "p_wf",
    tier: "nexus",
    subRole: "managing_partner",
    identity: { userId: "u_wf", email: "wf@example.com", name: "Northgate Capital Partners" },
  },
};
vi.mock("@/lib/partner/useRequirePartnerRole", async () => ({
  ...(await vi.importActual<typeof import("@/lib/partner/useRequirePartnerRole")>(
    "@/lib/partner/useRequirePartnerRole",
  )),
  useRequirePartnerRole: () => WF_ROLE,
}));

/* THE SEAM IS `window.fetch`, AND FINDING THAT OUT WAS PART OF THE MEASUREMENT.
   The first version of this file mocked `apiRequest` from `@/lib/queryClient`,
   which is what most partner pages use. This page does not: it calls raw `fetch`
   through its own `fetchJson` wrapper (OnboardingChecklistPage.tsx:305). With the
   wrong seam stubbed, every read returned nothing, the page rendered "0 / 10" no
   matter what the fixture said, and the toggles were disabled because the page
   was still loading — a fixture no server value can move, producing four reds
   that said nothing about the page. The stub below replaces the seam the page
   actually uses, so the page's real read, write, optimistic-apply and rollback
   code all execute.

   AND THE REAL SERVER IS ALREADY DRIVEN ELSEWHERE, WHICH THIS FILE DOES NOT
   DUPLICATE. `wave173_honest_checklist_dom.test.tsx` mounts this page against a
   real express app with the real onboarding routes and a seeded database. What is
   proved here is the DOM contract of item 3a's additions plus the read/write
   round trip; what is proved there is the server's behaviour. */
const fetchCalls: Array<{ method: string; url: string; body: unknown }> = [];
const realFetch = globalThis.fetch;

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: String(status),
    headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone() {
      return this;
    },
  } as unknown as Response;
}

/** The ten item keys the page renders, in group order. */
const ALL_KEYS = [
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
];

/** The four items item 3a gives a destination, and the four it deliberately does not. */
const LINKED = ["billing_contact", "team_invites", "first_pipeline_deal", "first_client_org"];
const LINKLESS = ["kyc_org_doc", "kyc_signatory_doc", "sso_configured", "go_live_review"];

let serverState: Record<string, boolean> = {};
let patchOutcome: "ok" | "conflict" = "ok";
/** The DURABLE agreement signature record, which the page overlays on top of the
 *  checklist blob. It is not a checkbox and cannot be ticked from this screen. */
let agreementSignedOnRecord = false;
const patchCalls: Array<{ url: string; body: unknown }> = [];

beforeEach(() => {
  serverState = Object.fromEntries(ALL_KEYS.map((k) => [k, false]));
  patchOutcome = "ok";
  agreementSignedOnRecord = false;
  patchCalls.length = 0;
  fetchCalls.length = 0;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = String(init?.method ?? "GET").toUpperCase();
    const body = init?.body === undefined || init?.body === null ? undefined : JSON.parse(String(init.body));
    fetchCalls.push({ method, url, body });
    if (url.includes("/api/partner/onboarding/state")) {
      if (method === "GET") {
        return jsonResponse({ state: { ...serverState }, savedAt: "2026-09-01T10:00:00.000Z" });
      }
      if (method === "PATCH") {
        patchCalls.push({ url, body });
        if (patchOutcome === "conflict") {
          return jsonResponse(
            {
              error: "ONBOARDING_STATE_NOT_STORABLE",
              message:
                "Capavate could not complete this, and it did not receive an explanation it can show you.",
            },
            false,
            409,
          );
        }
        serverState = { ...serverState, ...((body ?? {}) as Record<string, boolean>) };
        return jsonResponse({ state: { ...serverState }, savedAt: "2026-09-01T10:05:00.000Z" });
      }
    }
    if (url.includes("/api/partner/me/agreement")) {
      return jsonResponse({ signed: agreementSignedOnRecord, signedCurrent: agreementSignedOnRecord });
    }
    /* Any other read answers empty rather than failing, so an unrelated 500
       cannot masquerade as one of this file's assertions. */
    return jsonResponse({});
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

async function mountReady(): Promise<HTMLElement> {
  const root = document.createElement("div");
  root.setAttribute("data-product", "partner");
  document.body.appendChild(root);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  /* THE REAL RoleProvider, NOT A STUB. The page's shell reads the role context
     (`client/src/lib/role.tsx:13` throws "RoleProvider missing" without it) and
     the provider holds nothing this file depends on, so stubbing it would only
     remove a real code path from the measurement. */
  render(
    <RoleProvider>
      <QueryClientProvider client={qc}>
        <OnboardingChecklistPage />
      </QueryClientProvider>
    </RoleProvider>,
    { container: root },
  );
  /* THE SETTLE CONDITION IS PART OF THE PROOF, AND THIS FILE GOT IT WRONG ONCE.
     Waiting for `item-billing_contact` was not enough: the rows render while the
     read is still in flight, and every toggle carries `disabled={loading ||
     saving}` (OnboardingChecklistPage.tsx:588). The wait therefore returned during
     loading, `fireEvent.click` hit a disabled button, no PATCH was sent, and the
     red read as "the page does not write" when it was the test clicking too
     early. The condition below is the one that actually means "the page has
     finished loading": the Reload control is enabled. */
  await waitFor(() => {
    const reload = root.querySelector('[data-testid="button-reload"]') as HTMLButtonElement | null;
    expect(reload, "the checklist never rendered its Reload control").not.toBeNull();
    expect(reload!.hasAttribute("disabled"), "the checklist is still loading").toBe(false);
  });
  expect(root.querySelector('[data-testid="item-billing_contact"]')).not.toBeNull();
  return root;
}

describe("WAVE F · item 3a — GUIDANCE: every item that has a destination says where", () => {
  it("G-0 all ten items render, so no assertion below is measuring a partial page", async () => {
    const root = await mountReady();
    for (const k of ALL_KEYS) {
      expect(root.querySelector(`[data-testid="item-${k}"]`), `item ${k} did not render`).not.toBeNull();
    }
    expect(root.querySelectorAll('[data-testid^="item-"]').length).toBe(10);
  });

  it("G-1 THE FOUR ITEMS WITH A PLATFORM DESTINATION each render a link with WORDS, not a bare URL", async () => {
    const root = await mountReady();
    const seen: string[] = [];
    for (const k of LINKED) {
      const a = root.querySelector(`[data-testid="link-${k}"]`) as HTMLAnchorElement | null;
      expect(a, `item ${k} has a destination but renders no guidance link`).not.toBeNull();
      const href = a!.getAttribute("href") ?? "";
      const text = (a!.textContent ?? "").trim();
      expect(href).toMatch(/^\/collective\/partner\//);
      // NEVER A BARE URL AS THE LABEL — the link must say what happens there.
      expect(text.length, `link-${k} label is too short to be guidance: "${text}"`).toBeGreaterThan(25);
      expect(text).not.toContain("/collective/");
      expect(text).toMatch(/^Open /);
      seen.push(`${k} → ${href}`);
    }
    expect(seen.length).toBe(4);
    // Four DISTINCT destinations — one link copied four times would be no guidance.
    expect(new Set(seen.map((s) => s.split(" → ")[1])).size).toBe(4);
  });

  it("G-2 EVERY DESTINATION IS A REAL REGISTERED ROUTE inside the Consortium Partner shell", async () => {
    /* A guidance link to a route that does not exist is worse than no link: it
       teaches the partner the platform is broken. The router source is parsed
       here rather than trusted. */
    const app = readFileSync(resolve(CLIENT_SRC, "App.tsx"), "utf8");
    const root = await mountReady();
    const anchors = Array.from(root.querySelectorAll('a[data-testid^="link-"]')) as HTMLAnchorElement[];
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) {
      const href = a.getAttribute("href")!;
      expect(
        app.includes(`path="${href}"`) || app.includes(`path='${href}'`),
        `${a.getAttribute("data-testid")} points at ${href}, which is not a registered route`,
      ).toBe(true);
    }
  });

  it("G-3 THE FOUR ITEMS WITH NO PLATFORM DESTINATION GET NO LINK — deliberately", async () => {
    const root = await mountReady();
    for (const k of LINKLESS) {
      const row = root.querySelector(`[data-testid="item-${k}"]`);
      expect(row, `item ${k} did not render at all`).not.toBeNull();
      expect(
        root.querySelector(`[data-testid="link-${k}"]`),
        `item ${k} has no platform destination but renders a link anyway`,
      ).toBeNull();
    }
  });

  it("G-4 GUIDANCE SURVIVES COMPLETION — a ticked item still says where it was done", async () => {
    /* The link is rendered unconditionally, not gated on `!done`. A partner who
       ticked billing three months ago and wants to change the contact must still
       be able to find the page. */
    serverState = { ...serverState, billing_contact: true };
    const root = await mountReady();
    expect(root.querySelector('[data-testid="link-billing_contact"]')).not.toBeNull();
  });
});

describe("WAVE F · item 3a — DYNAMIC: measured at the seam, not asserted", () => {
  it("D-1 THE PAGE READS THE SERVER — a different stored state renders a different page", async () => {
    serverState = { ...serverState, billing_contact: true, team_invites: true };
    const root = await mountReady();
    await waitFor(() => {
      expect(root.querySelector('[data-testid="badge-progress"]')?.textContent ?? "").toMatch(/\d/);
    });
    const withTwo = root.querySelector('[data-testid="badge-progress"]')!.textContent ?? "";
    cleanup();

    serverState = Object.fromEntries(ALL_KEYS.map((k) => [k, false]));
    const root2 = await mountReady();
    const withNone = root2.querySelector('[data-testid="badge-progress"]')!.textContent ?? "";

    expect(withTwo.length).toBeGreaterThan(0);
    expect(withNone.length).toBeGreaterThan(0);
    /* IF THESE MATCHED, the page would be rendering a constant and every other
       assertion in this file about state would be meaningless. */
    expect(withTwo).not.toBe(withNone);
  });

  it("D-2 A TICK WRITES TO THE SERVER — the PATCH carries the item that was clicked", async () => {
    const root = await mountReady();
    const toggle = root.querySelector('[data-testid="toggle-billing_contact"]') as HTMLElement;
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle);
    await waitFor(() => expect(patchCalls.length).toBe(1));
    expect(JSON.stringify(patchCalls[0].body)).toContain("billing_contact");
  });

  it("D-3 A REFUSED WRITE ROLLS BACK — the tick does not survive a 409", async () => {
    /* MEASURED IN THIS TREE: the server's PATCH handler
       (server/consortiumApplyStore.ts:2839) returns 409
       ONBOARDING_STATE_NOT_STORABLE whenever its UPDATE changes no rows, and
       `partner_organizations` is empty with no INSERT path. So in this tree the
       409 is the NORMAL response, and this rollback is the behaviour the owner
       will actually see. It is reported to him as an open item; what is proved
       here is that the page never shows a tick the server did not accept. */
    patchOutcome = "conflict";
    const root = await mountReady();
    const toggle = root.querySelector('[data-testid="toggle-billing_contact"]') as HTMLElement;
    const before = root.querySelector('[data-testid="badge-progress"]')!.textContent;
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(root.querySelector('[data-testid="error-banner"]')).not.toBeNull();
    });
    expect(root.querySelector('[data-testid="badge-progress"]')!.textContent).toBe(before);
  });

  it('D-4 "REAL TIME" IS REFUSED TRUTHFULLY — there is no polling to claim', () => {
    /* The refusal is asserted against the real configuration, not against a
       sentence describing it. If a future wave switches polling on, this test
       reddens and the wording owed to the owner changes with it. */
    const qc = readFileSync(resolve(CLIENT_SRC, "lib", "queryClient.ts"), "utf8");
    expect(qc).toMatch(/refetchInterval\s*:\s*false/);
    expect(qc).toMatch(/refetchOnWindowFocus\s*:\s*false/);
    const page = readFileSync(resolve(HERE, "..", "OnboardingChecklistPage.tsx"), "utf8");
    expect(page).not.toMatch(/refetchInterval\s*:\s*\d/);
    expect(page).not.toContain("EventSource");
    expect(page).not.toContain("WebSocket");
    expect(page).not.toMatch(/setInterval\s*\(/);
  });
});

describe("WAVE F · item 3a — THE SSO ITEM: the brief's premise corrected, and handled honestly", () => {
  it("S-1 THE SSO ROW IS TICKABLE — so 100% is arithmetically reachable and is NOT capped", async () => {
    /* THE BRIEF SAYS THE PERCENTAGE CAN NEVER REACH 100. Measured: it can. Only
       the partner-agreement row renders a non-interactive control; the SSO row
       renders a real enabled toggle. Recording that as "can never complete"
       would have been a wave building a fix for a defect that is not there. */
    const root = await mountReady();
    const sso = root.querySelector('[data-testid="toggle-sso_configured"]') as HTMLButtonElement | null;
    expect(sso, "the SSO row renders no toggle").not.toBeNull();
    expect(sso!.hasAttribute("disabled")).toBe(false);

    /* AND HERE IS WHAT THE BRIEF'S PREMISE WAS ACTUALLY POINTING AT, MEASURED.
       With all ten items ticked but no signed agreement ON RECORD, the badge
       reads 9 / 10 · 90% — because the agreement row is not a checkbox at all: it
       is overlaid from the durable signature record (`GET /api/partner/me/
       agreement`, OnboardingChecklistPage.tsx:351) and renders a non-interactive
       span. So the item that can stop the percentage reaching 100 is the
       AGREEMENT, not SSO, and it stops it only until the agreement is genuinely
       signed — which is correct behaviour, not a defect. Both directions are
       asserted so neither reading can be claimed without evidence. */
    serverState = Object.fromEntries(ALL_KEYS.map((k) => [k, true]));
    cleanup();
    agreementSignedOnRecord = false;
    const unsigned = await mountReady();
    expect(unsigned.querySelector('[data-testid="badge-progress"]')!.textContent ?? "").toContain("90%");
    expect(unsigned.querySelector('[data-testid="toggle-signed_partner_agreement"]')).toBeNull();

    cleanup();
    agreementSignedOnRecord = true;
    const full = await mountReady();
    const badge = full.querySelector('[data-testid="badge-progress"]')!.textContent ?? "";
    expect(badge).toContain("100");
  });

  it("S-2 WHAT IS ACTUALLY TRUE IS ON SCREEN — SSO cannot be CONFIGURED on Capavate", async () => {
    const root = await mountReady();
    const prov = root.querySelector('[data-testid="text-progress-provenance"]');
    expect(prov, "the provenance explanation is not rendered").not.toBeNull();
    const text = prov!.textContent ?? "";
    /* THE MARKER LIVES ON THE ITEM, NOT IN THE SUMMARY — measured, not assumed.
       The first version of this test looked for it in the provenance paragraph;
       it is the SSO row's own support line that carries it, and the summary
       paragraph names the bucket in plain words instead. Both are asserted. */
    const ssoSupport = root.querySelector('[data-testid="support-sso_configured"]');
    expect(ssoSupport, "the SSO row carries no support text").not.toBeNull();
    expect(ssoSupport!.textContent ?? "").toContain(PROGRESS_NOT_SUPPORTED_MARKER);

    const unsupported = root.querySelector('[data-testid="text-progress-provenance-unsupported"]');
    expect(unsupported).not.toBeNull();
    const unsupportedText = unsupported!.textContent ?? "";
    expect(unsupportedText).toContain("Capavate cannot do at all");
    /* AND IT DOES NOT PRETEND THE TICK IS WORTHLESS EITHER — the honest position
       is that it counts, and that Capavate did not observe it. */
    expect(unsupportedText).toMatch(/counts toward the percentage/i);
    expect(text.length).toBeGreaterThan(200);
  });

  it("S-3 THE SSO ITEM IS THE ONE IN THE UNSUPPORTED BUCKET — bucketing is untouched by this wave", () => {
    /* `progressProvenanceOf` is unit-tested elsewhere and item 3a does not touch
       it. This asserts only that item 3a's linkless list and Wave 232's bucket
       still agree about SSO, which is the seam between the two waves. */
    expect(
      progressProvenanceOf({ key: "sso_configured", support: `Single sign-on ${PROGRESS_NOT_SUPPORTED_MARKER}.` }),
    ).toBe("not_supported");
    expect(LINKLESS).toContain("sso_configured");
    expect(LINKED).not.toContain("sso_configured");
  });
});
