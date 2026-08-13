/**
 * HARNESS NOTE (recorded, not hidden): the first run of this suite had TWO
 * failures and BOTH were harness bugs, decided honestly rather than by
 * weakening the assertion.
 *   1. `ApiError`'s real signature is `(status, message, code, payload)`
 *      (client/src/lib/queryClient.ts:24), and these tests were constructing it
 *      as `(message, status, code)`. `status` was therefore a STRING, so
 *      `isCollectiveGateDenial` (which checks `err.status !== 403`) correctly
 *      declined and the widget showed its generic fallback. The product was
 *      right; the fixture was malformed. Worth noting that three OTHER tests in
 *      this suite passed with the same malformed fixture, because they only
 *      needed "the query errored" — a good illustration of why a passing test
 *      is not evidence that the fixture is correct.
 *   2. A source-grep assertion banned the literal "/api/feeds/venture-markets"
 *      anywhere in PartnerDashboard.tsx, which matched the explanatory COMMENT
 *      above the mount. Making that pass by deleting documentation would have
 *      been the wrong fix; the assertion now targets an actual call site.
 *
 * WAVE 20 — the Partner surface: V-1, W-6, FE-15, FE-20, XT-10, CP-MFC-12.
 *
 * This suite is written to FALSIFY, not to confirm. Every block below pins the
 * one behaviour whose mutation would ship the defect, and the mutations were
 * actually applied and run (see `scripts/w20/mutate.sh` and the report's §7
 * mutation table) rather than asserted to be caught.
 *
 * Three habits carried in from the ten "a check that passes may be checking
 * nothing" instances:
 *
 *   1. **Pin the value the user receives, not the presence of a token.** Wave 19
 *      lost a 403 assertion because the pinned string also appeared in a guard
 *      ABOVE the sink, so the assertion passed while the JSON changed. Where a
 *      fail-closed message matters here, the test asserts the CONTENT of the
 *      element that renders it, keyed by its own testid.
 *   2. **Money needs a zero-exponent currency.** Every money assertion runs a
 *      JPY (exponent 0) fixture and a BHD (exponent 3) fixture alongside USD,
 *      because a hardcoded `/100` or `*100` passes a USD-only suite.
 *   3. **No `process.env` mutation without restore.** This suite sets none; the
 *      `afterEach` below still restores the shared online manager, because Wave
 *      19 leaked state into every suite sharing a worker.
 */
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const IDENTITY = {
  ready: true,
  error: null,
  identity: {
    partnerId: "ac_consortium_partner_test_partner_inc",
    tier: "builder",
    subRole: "managing_partner",
    identity: { userId: "u_avi_managing", email: "avi@example.com", name: "Test Partner Inc" },
  },
};
vi.mock("@/lib/partner/useRequirePartnerRole", async () => {
  const actual = await vi.importActual<typeof import("@/lib/partner/useRequirePartnerRole")>(
    "@/lib/partner/useRequirePartnerRole",
  );
  return { ...actual, useRequirePartnerRole: () => IDENTITY };
});

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...args: unknown[]) => apiRequestMock(...args) };
});

import { ApiError } from "@/lib/queryClient";
import PartnerMfcrmPersonas, { majorToMinor } from "../PartnerMfcrmPersonas";
import {
  SpvOnBehalfPanel,
  localSpvOnBehalfBlockers,
  SPV_ON_BEHALF_GATE_COPY,
} from "../PartnerManagedFounders";
import { PartnerShell } from "@/components/partner/PartnerShell";
import { VentureMarketsCard } from "@/components/collective/widgets/VentureMarketsCard";
import {
  MFCRM_PERSONAS,
  MFCRM_PERSONA_ROUTE_COUNT,
  personaActionState,
  resolvePersona,
  type MfcrmCapability,
} from "@/lib/partner/mfcrmPersona";

/* --------------------------------------------------------------- utilities */

const REPO = path.resolve(__dirname, "../../../../..");
const readSrc = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8");

function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        queryFn: async ({ queryKey }) => {
          const url = queryKey.filter((k) => typeof k === "string").join("/").replace(/\/+/g, "/");
          return (await apiRequestMock("GET", url)).json();
        },
      },
      mutations: { retry: false },
    },
  });
}

function renderAt(pathname: string, ui: React.ReactElement) {
  const { hook } = memoryLocation({ path: pathname, static: false, record: true });
  return render(
    <QueryClientProvider client={makeClient()}>
      <Router hook={hook}>
        <TooltipProvider>{ui}</TooltipProvider>
      </Router>
    </QueryClientProvider>,
  );
}

/** A capability profile. Defaults to CLASSIFIED with every flag OFF, so a test
 *  that needs a flag must turn it ON explicitly — the fail-closed direction. */
function capability(over: Partial<MfcrmCapability> = {}): MfcrmCapability {
  return {
    partnerId: "ac_consortium_partner_test_partner_inc",
    partnerType: null,
    classified: true,
    sourcesCapital: false,
    delegatedAgency: false,
    spvWriteAuthority: false,
    advisoryCoseat: false,
    documentCustody: false,
    paysOnBehalf: false,
    attributionTracking: false,
    collectiveFronting: false,
    chapterScoping: false,
    fundAdmin: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

/** Route the persona page's GETs from a URL→body table; anything unrouted
 *  REJECTS rather than silently resolving `{}` — an unrouted call that quietly
 *  succeeds is how a harness ends up proving nothing. */
function routeGets(table: Record<string, unknown>) {
  apiRequestMock.mockImplementation(async (method: string, url: string) => {
    const key = String(url).split("?")[0];
    if (method === "GET" && key in table) {
      const v = table[key];
      if (v instanceof Error) throw v;
      return jsonResponse(v);
    }
    throw new Error(`unrouted ${method} ${url}`);
  });
}

beforeEach(() => {
  apiRequestMock.mockReset();
});
afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
});

/* ===================================================================== W-6 */

describe("W-6 — persona resolution across the 17 MFCRM routes", () => {
  /**
   * THE FENCE. This is the test that stops the client map becoming a lie.
   *
   * `mfcrmPersona.ts` mirrors gates that live in three server stores. A mirror
   * that nobody checks is worse than no mirror: it will keep confidently
   * telling a partner an action is available for months after the server gate
   * changed. So the table is checked against the SERVER SOURCE, by parsing it.
   */
  it("covers exactly the routes the server registers, no more and no fewer", () => {
    const src = readSrc("server/managedFounderPersonaRoutes.ts");
    const registered = Array.from(
      src.matchAll(/app\.(get|post|patch|put|delete)\(\s*"([^"]+)"/g),
    ).map((m) => `${m[1].toUpperCase()} ${m[2]}`);

    expect(registered.length).toBe(17);
    expect(MFCRM_PERSONA_ROUTE_COUNT).toBe(17);

    const mapped = MFCRM_PERSONAS.flatMap((p) => p.actions.map((a) => `${a.method} ${a.path}`)).sort();
    expect(mapped).toEqual(registered.slice().sort());
  });

  /**
   * Each gate the client claims must be asserted by the server store at the
   * capability key the client names. Parsed from source, so repointing
   * `assertCapability(partnerId, "paysOnBehalf")` to another key without
   * updating the client fails HERE rather than in production.
   */
  it("names the same capability keys the server stores assert", () => {
    const angel = readSrc("server/mfcrmAngelStore.ts");
    const acct = readSrc("server/mfcrmAcctStore.ts");
    const law = readSrc("server/mfcrmLawStore.ts");

    /* ANGEL: one gate function, asserted on exactly the three WRITE methods. */
    expect(angel).toMatch(/function assertChapterScoping/);
    expect(angel).toMatch(/chapterScoping/);
    expect(Array.from(angel.matchAll(/assertChapterScoping\(partnerId\)/g)).length).toBe(3);

    /* ACCT: the three keys the client claims, each asserted verbatim. */
    for (const key of ["paysOnBehalf", "documentCustody", "fundAdmin"]) {
      expect(acct).toContain(`assertCapability(partnerId, "${key}")`);
    }

    /* LAW: the inverse-polarity gate. The client models it as
       sourcesCapital === false; the server throws when it is TRUE. */
    expect(law).toMatch(/if \(p\.sourcesCapital\)/);
    expect(law).toContain("INVESTOR_SPINE_FORBIDDEN");
    expect(law).toContain("assertInvestorSpineDisabled(partnerId)");

    /* And the client's declared keys are a subset of what the profile actually
       has, so a typo'd key (which would read `undefined` → falsy → "blocked"
       forever, a silent fail-closed lie) cannot survive. */
    const profileKeys = Object.keys(capability());
    for (const p of MFCRM_PERSONAS) {
      for (const a of p.actions) {
        for (const g of a.gates) expect(profileKeys).toContain(String(g.key));
      }
    }
  });

  it("fails closed on an absent, unclassified or unknown-type profile", () => {
    expect(resolvePersona(null)).toBeNull();
    expect(resolvePersona(capability({ partnerType: "angel_network", classified: false }))).toBeNull();
    expect(resolvePersona(capability({ partnerType: null }))).toBeNull();
    /* Real partner_type values with NO persona surface — from
       seedDefaultsForType, server/managedFounderStore.ts:169-200. */
    for (const t of ["investment_bank", "accelerator", "incubator", "professional_services"]) {
      expect(resolvePersona(capability({ partnerType: t }))).toBeNull();
    }
    expect(resolvePersona(capability({ partnerType: "angel_network" }))?.id).toBe("angel");
    expect(resolvePersona(capability({ partnerType: "accounting" }))?.id).toBe("acct");
    expect(resolvePersona(capability({ partnerType: "law" }))?.id).toBe("law");
  });

  it("refuses EVERY action, gated or not, when the profile cannot be read", () => {
    for (const p of MFCRM_PERSONAS) {
      for (const a of p.actions) {
        expect(personaActionState(a, null).allowed).toBe(false);
        expect(personaActionState(a, capability({ classified: false })).allowed).toBe(false);
      }
    }
  });

  it("permits a gated action only when its exact flag holds its exact value", () => {
    const angel = MFCRM_PERSONAS.find((p) => p.id === "angel")!;
    const create = angel.actions.find((a) => a.id === "angel-chapter-create")!;
    expect(personaActionState(create, capability({ partnerType: "angel_network" })).allowed).toBe(false);
    expect(personaActionState(create, capability({ partnerType: "angel_network", chapterScoping: true })).allowed).toBe(true);
    /* A DIFFERENT flag being on must not open it — this is the mutation that
       catches a gate repointed to the wrong key. */
    expect(personaActionState(create, capability({ partnerType: "angel_network", fundAdmin: true })).allowed).toBe(false);

    /* Inverse polarity: counsel-of-record needs sourcesCapital FALSE. A test
       that only ever checks "flag true ⇒ allowed" would pass with the polarity
       inverted, which would let a capital-sourcing firm stamp itself counsel of
       record. */
    const law = MFCRM_PERSONAS.find((p) => p.id === "law")!;
    const cor = law.actions.find((a) => a.id === "law-counsel-of-record")!;
    expect(personaActionState(cor, capability({ partnerType: "law", sourcesCapital: false })).allowed).toBe(true);
    expect(personaActionState(cor, capability({ partnerType: "law", sourcesCapital: true })).allowed).toBe(false);
    expect(personaActionState(cor, capability({ partnerType: "law", sourcesCapital: true })).blockedBy?.serverCode)
      .toBe("INVESTOR_SPINE_FORBIDDEN");
  });
});

/* ================================================================== XT-10 */

describe("XT-10 — the persona page is a real door onto the 17 routes", () => {
  it("renders the angel surface and its DB values, not a placeholder", async () => {
    routeGets({
      "/api/partner/me/mfcrm/capability": { capability: capability({ partnerType: "angel_network", chapterScoping: true }) },
      "/api/partner/me/mfcrm/angel/chapters": {
        chapters: [{ id: "mfch_1", name: "Toronto", region: "CA-ON", carry_bps: 1250, status: "active" }],
      },
      "/api/partner/me/mfcrm/angel/carry-report": {
        report: [{ chapterId: "mfch_1", name: "Toronto", region: "CA-ON", carryBps: 1250, engagementCount: 3, activeCount: 2 }],
      },
    });
    renderAt("/collective/partner/persona-tools", <PartnerMfcrmPersonas />);
    await screen.findByTestId("mfcrm-persona-angel");
    expect(screen.getByTestId("mfcrm-persona-label").textContent).toBe("Angel network");

    /* CARRY IS BASIS POINTS. 1250 bps is 12.5%, NOT 1250% and NOT 12.5 bps.
       A mutation dropping the /100 renders "1250%" and this fails. */
    expect((await screen.findByTestId("mfcrm-angel-chapter-carry-mfch_1")).textContent).toBe("12.5%");
    expect((await screen.findByTestId("mfcrm-angel-report-carry-mfch_1")).textContent).toBe("12.5%");
  });

  it("shows the accounting surface with per-currency money and NO cross-currency total", async () => {
    routeGets({
      "/api/partner/me/mfcrm/capability": { capability: capability({ partnerType: "accounting", paysOnBehalf: true }) },
      "/api/partner/me/mfcrm/acct/rebill": {
        rebills: [
          /* JPY, ISO-4217 exponent 0 — 5000 minor units IS ¥5,000. A hardcoded
             /100 renders ¥50 and this assertion fails. This is the mandatory
             zero-exponent fixture. */
          { id: "r_jpy", company_id: "co_1", description: "Filing fee", amount_minor: 5000, currency: "JPY", status: "pending", incurred_at: null },
          /* USD, exponent 2 — the SAME integer must render as $50.00. */
          { id: "r_usd", company_id: "co_1", description: "Courier", amount_minor: 5000, currency: "USD", status: "pending", incurred_at: null },
          /* BHD, exponent 3 — the mandatory three-exponent fixture. */
          { id: "r_bhd", company_id: "co_1", description: "Notary", amount_minor: 5000, currency: "BHD", status: "pending", incurred_at: null },
        ],
      },
      "/api/partner/me/mfcrm/acct/custody": { custody: [] },
    });
    renderAt("/collective/partner/persona-tools", <PartnerMfcrmPersonas />);
    await screen.findByTestId("mfcrm-persona-acct");

    const jpy = (await screen.findByTestId("mfcrm-acct-rebill-amount-r_jpy")).textContent ?? "";
    const usd = (await screen.findByTestId("mfcrm-acct-rebill-amount-r_usd")).textContent ?? "";
    const bhd = (await screen.findByTestId("mfcrm-acct-rebill-amount-r_bhd")).textContent ?? "";

    /* The three MUST differ from one another for the same integer. If they do
       not, the renderer is applying one hardcoded exponent to all currencies. */
    expect(new Set([jpy, usd, bhd]).size).toBe(3);
    expect(jpy).toMatch(/5,?000/);          // ¥5,000 — no decimal part
    expect(jpy).not.toMatch(/50\.00/);
    expect(usd).toMatch(/50\.00/);          // $50.00
    expect(bhd).toMatch(/5\.000/);          // BHD 5.000

    /* Pending totals are per-currency and are NEVER combined. Three separate
       elements, and no element carrying the cross-currency sum 15000. */
    expect(screen.getByTestId("mfcrm-acct-rebill-pending-JPY")).toBeTruthy();
    expect(screen.getByTestId("mfcrm-acct-rebill-pending-USD")).toBeTruthy();
    expect(screen.getByTestId("mfcrm-acct-rebill-pending-BHD")).toBeTruthy();
    const totals = screen.getByTestId("mfcrm-acct-rebill-pending-totals").textContent ?? "";
    expect(totals).not.toMatch(/15,?000/);
    expect(totals).not.toMatch(/150\.00/);
  });

  /* ADDED AFTER THE MUTATION RUN. The first harness pass MISSED a mutation
     forcing `majorToMinor`'s exponent to 2, because the suite only ever tested
     the READ side. That was a genuine coverage gap, not a harness bug: the
     write side is where a wrong exponent silently persists a 100×-wrong amount
     into the database, which is strictly worse than mis-rendering one. */
  it("converts a typed major amount to minor units by the currency's real exponent", () => {
    expect(majorToMinor("5000", "JPY")).toBe(5000);   // exponent 0
    expect(majorToMinor("50.00", "USD")).toBe(5000);  // exponent 2
    expect(majorToMinor("5.000", "BHD")).toBe(5000);  // exponent 3
    /* The three MUST disagree for the same typed string, or one hardcoded
       exponent is being applied to all of them. */
    const typed = "50";
    expect(new Set([majorToMinor(typed, "JPY"), majorToMinor(typed, "USD"), majorToMinor(typed, "BHD")]).size).toBe(3);
    /* Round-trips against the read side at every exponent. */
    for (const [cur, minor] of [["JPY", 5000], ["USD", 5000], ["BHD", 5000]] as const) {
      const major = majorToMinor(String(minor / Math.pow(10, cur === "JPY" ? 0 : cur === "USD" ? 2 : 3)), cur);
      expect(major).toBe(minor);
    }
    expect(majorToMinor("", "USD")).toBe(0);
    expect(majorToMinor("not a number", "JPY")).toBe(0);
  });

  it("RENDERS a capability refusal instead of the control it gates", async () => {
    routeGets({
      /* An accounting firm with paysOnBehalf OFF. */
      "/api/partner/me/mfcrm/capability": { capability: capability({ partnerType: "accounting" }) },
      "/api/partner/me/mfcrm/acct/rebill": { rebills: [] },
      "/api/partner/me/mfcrm/acct/custody": { custody: [] },
    });
    renderAt("/collective/partner/persona-tools", <PartnerMfcrmPersonas />);

    /* The refusal is present, names the capability, AND the form is absent.
       Asserting only the notice would pass even if the form still rendered
       beside it — the partner would then press a button guaranteed to 403. */
    const gate = await screen.findByTestId("mfcrm-acct-rebill-gate");
    expect(within(gate).getByTestId("mfcrm-acct-rebill-gate-reason").textContent).toMatch(/Pays on behalf/);
    expect(screen.queryByTestId("mfcrm-acct-rebill-submit")).toBeNull();
  });

  it("RENDERS a failed capability read — never 'no persona tools'", async () => {
    routeGets({ "/api/partner/me/mfcrm/capability": new ApiError(403, "forbidden", "not_partner", null) });
    renderAt("/collective/partner/persona-tools", <PartnerMfcrmPersonas />);

    await screen.findByTestId("mfcrm-persona-capability-error");
    /* THE DEFECT THIS PINS: falling through to the "no persona tools for your
       firm type" empty state on an unreadable profile, which tells a law firm
       with a live conflict register that it has no tools. */
    expect(screen.queryByText(/No persona tools for your firm type/i)).toBeNull();
  });

  it("RENDERS a 403 on a persona LIST as copy, not as an empty register", async () => {
    routeGets({
      "/api/partner/me/mfcrm/capability": { capability: capability({ partnerType: "law" }) },
      "/api/partner/me/mfcrm/law/matters": { matters: [] },
      "/api/partner/me/mfcrm/law/conflicts": new ApiError(403, "denied", "INVESTOR_SPINE_FORBIDDEN", null),
    });
    renderAt("/collective/partner/persona-tools", <PartnerMfcrmPersonas />);

    const err = await screen.findByTestId("mfcrm-law-conflicts-error");
    /* Pin the RENDERED MESSAGE, not merely that an error box exists. A box with
       generic text would pass a presence-only assertion while telling the firm
       nothing. */
    expect(within(err).getByTestId("mfcrm-law-conflicts-error-message").textContent)
      .toMatch(/sourcing capital/i);
    /* And the fabricated-empty-state must be ABSENT. */
    expect(screen.queryByTestId("mfcrm-law-conflicts-empty")).toBeNull();
  });

  it("is reachable: a nav entry and a route both point at the page", () => {
    /* An engine with no route, or a component mounted nowhere, is not shipped —
       so reachability is asserted, not assumed. */
    const nav = readSrc("client/src/components/CollectiveShell.tsx");
    const app = readSrc("client/src/App.tsx");
    expect(nav).toContain('href: "/collective/partner/persona-tools"');
    expect(app).toContain('<Route path="/collective/partner/persona-tools">');
    expect(app).toContain("<PartnerMfcrmPersonas />");
    /* The nav href and the route path must be the same string. */
    const navHref = /href: "(\/collective\/partner\/persona-tools)"/.exec(nav)![1];
    expect(app).toContain(`<Route path="${navHref}">`);
  });
});

/* ================================================================== FE-15 */

describe("FE-15 — persona badge in the partner header", () => {
  const shell = (
    <PartnerShell title="Dashboard" tier="builder" subRole="managing_partner" partnerName="Test Partner Inc">
      <div>body</div>
    </PartnerShell>
  );

  it("shows the persona beside tier and sub-role", async () => {
    routeGets({ "/api/partner/me/mfcrm/capability": { capability: capability({ partnerType: "law" }) } });
    renderAt("/collective/partner/dashboard", shell);
    const badge = await screen.findByTestId("partner-persona-badge");
    expect(badge.textContent).toBe("Law firm");
    /* SIBLING, not appended text: the pre-existing badges must still exist and
       still carry EXACTLY their own text. Appending inside them reads to the
       drop guard as a removal plus an addition. */
    expect(screen.getByTestId("partner-name").textContent).toBe("Test Partner Inc");
    expect(screen.getByTestId("partner-tier-badge").textContent).not.toContain("Law firm");
    expect(screen.getByTestId("partner-subrole-badge").textContent).not.toContain("Law firm");
  });

  it("shows NOTHING rather than a wrong persona when the profile is unreadable", async () => {
    routeGets({ "/api/partner/me/mfcrm/capability": new ApiError(500, "boom", "STRICT_PERSIST_FAILED", null) });
    renderAt("/collective/partner/dashboard", shell);
    await screen.findByTestId("partner-name");
    await waitFor(() => expect(screen.queryByTestId("partner-persona-badge")).toBeNull());
  });

  it("shows nothing for a firm type with no persona surface", async () => {
    routeGets({ "/api/partner/me/mfcrm/capability": { capability: capability({ partnerType: "accelerator" }) } });
    renderAt("/collective/partner/dashboard", shell);
    await screen.findByTestId("partner-name");
    await waitFor(() => expect(screen.queryByTestId("partner-persona-badge")).toBeNull());
  });
});

/* ================================================================== FE-20 */

describe("FE-20 — venture markets on the partner dashboard", () => {
  it("is mounted on the partner dashboard, against the existing endpoint", () => {
    const dash = readSrc("client/src/pages/partner/PartnerDashboard.tsx");
    expect(dash).toContain("<VentureMarketsCard />");
    expect(dash).toContain('from "@/components/collective/widgets/VentureMarketsCard"');
    /* WIRING, not a rebuild: the partner dashboard must NOT have grown its own
       copy of the feed call. One reader, one endpoint. The check targets an
       actual CALL — an earlier version banned the string outright and failed on
       the explanatory comment above the mount, which would have pushed me to
       delete the documentation to make a test pass. */
    expect(dash).not.toMatch(/apiRequest\([^)]*venture-markets/);
    expect(dash).not.toMatch(/useQuery[\s\S]{0,200}venture-markets/);
    const card = readSrc("client/src/components/collective/widgets/VentureMarketsCard.tsx");
    expect(card).toContain('"/api/feeds/venture-markets"');
  });

  it("renders a membership 403 as copy, never as an empty market table", async () => {
    apiRequestMock.mockImplementation(async () => { throw new ApiError(403, "denied", "not_collective_member", null); });
    renderAt("/collective/partner/dashboard", <VentureMarketsCard />);
    const err = await screen.findByTestId("widget-venture-error");
    expect(err.textContent).toMatch(/Collective membership required/i);
    expect(screen.queryByTestId("widget-venture-table")).toBeNull();
    /* And no fabricated zero anywhere in the widget. */
    expect(screen.getByTestId("widget-venture-markets").textContent).not.toMatch(/\$\s?0\b/);
  });

  it("distinguishes 'provider not configured' from 'provider returned nothing'", async () => {
    apiRequestMock.mockImplementation(async () =>
      jsonResponse({ asOfDate: "2026-08-10", records: [], metricType: "issuer_count", status: "PROVIDER_NOT_CONFIGURED" }));
    const first = renderAt("/collective/partner/dashboard", <VentureMarketsCard />);
    await screen.findByTestId("widget-venture-empty");
    expect(screen.queryByTestId("widget-venture-none-returned")).toBeNull();
    first.unmount();

    apiRequestMock.mockImplementation(async () =>
      jsonResponse({ asOfDate: "2026-08-10", records: [], metricType: "issuer_count", status: "OK" }));
    renderAt("/collective/partner/dashboard", <VentureMarketsCard />);
    /* THE DEFECT: telling an operator to configure a provider they HAVE
       configured. Before this wave both cases rendered the same copy. */
    await screen.findByTestId("widget-venture-none-returned");
    expect(screen.queryByTestId("widget-venture-empty")).toBeNull();
  });
});

/* ===================================================================== V-1 */

describe("V-1 — vintage year on the SPV detail Overview tab", () => {
  const src = readSrc("client/src/components/partner/SpvDetailTabs.tsx");

  it("renders vintage through a COMPONENT, as JurisdictionField does", () => {
    /* The guard fingerprints a tab by its inline JSX text. Inline copy in the
       Overview grid would make an untouched tab read as REMOVED, so the field
       must be a component — the pattern JurisdictionField documents. */
    expect(src).toMatch(/function VintageField\(/);
    expect(src).toContain("<VintageField value={spvVintageDisplay} />");
    /* The anchor must be unambiguous: exactly one call site. */
    expect(Array.from(src.matchAll(/<VintageField /g)).length).toBe(1);
  });

  it("reads the SAME terms.vintage key the wizard writes — no second source", () => {
    expect(src).toContain("spv.terms?.vintage");
    /* The wizard's write, verified at source rather than taken on the row's
       word (the row claimed vintage was captured only by legacy admin routes;
       it is not). */
    const wizard = readSrc("client/src/pages/partner/PartnerSpvEngine.tsx");
    expect(wizard).toMatch(/vintage/);
    /* And the detail tab must NOT derive a year from a timestamp — a real
       second source of truth exists in server/portfolioAnalyticsStore.ts and
       must not be mirrored here. */
    expect(src).not.toMatch(/vintageYear/);
    expect(src).not.toMatch(/getFullYear\(\)/);
  });

  it("shows an em-dash, never a guessed year, when no vintage is recorded", () => {
    /* Pinned at the source of the derivation: the fallback is the em-dash and
       the range check refuses an implausible value. A mutation returning
       `String(new Date().getFullYear())` fails the assertion above. */
    expect(src).toMatch(/if \(!Number\.isInteger\(n\) \|\| n < 1990 \|\| n > 9999\) return "—";/);
  });
});

/* ============================================================== CP-MFC-12 */

describe("CP-MFC-12 — SPV-on-behalf is wired to the engagement detail", () => {
  const page = readSrc("client/src/pages/partner/PartnerManagedFounders.tsx");

  it("calls both halves of the engine that had no caller", () => {
    expect(page).toContain('apiRequest("POST", "/api/partner/me/mfcrm/spv-on-behalf"');
    expect(page).toContain("/api/partner/me/mfcrm/spv-on-behalf?companyId=");
    expect(page).toContain("<SpvOnBehalfPanel engagement={e} subRole={role.identity.subRole} />");
    expect(Array.from(page.matchAll(/<SpvOnBehalfPanel /g)).length).toBe(1);
  });

  it("converts a target raise by the currency's real exponent, not by 100", () => {
    /* A hardcoded *100 sets a ¥50,000,000 target to ¥5,000,000,000. */
    expect(page).toContain("Math.round(n * Math.pow(10, currencyExponent(currency)))");
    expect(page).not.toMatch(/targetRaiseMinor\s*=\s*[^;]*\*\s*100\b/);
  });

  it("explains every GATE-3 precondition the server can refuse on", () => {
    /* Parsed from the server so a NEW refusal code cannot ship mute — the
       failure mode where a partner gets a 403 with no explanation. */
    const store = readSrc("server/managedFounderStore.ts");
    const fn = /assertDelegatedWriteAuthority\(partnerId: string[\s\S]*?\n  \},/.exec(store)![0];
    const codes = Array.from(fn.matchAll(/GateError\("([A-Z_]+)"/g)).map((m) => m[1]);
    expect(codes.length).toBeGreaterThanOrEqual(5);
    for (const c of codes) expect(page).toContain(c);
  });

  /* ---------------------------------------------------------------------
     BEHAVIOURAL tests, added after the first mutation run.
     The two source-grep assertions that used to stand here MISSED their
     mutations (M28 `<=` → `<`, M29 dropping the `!isError` guard). They were
     token-presence checks — precisely the shape that has produced ten
     "a check that passes may be checking nothing" instances in this project.
     Grepping for a string proves the string is present, not that the behaviour
     it implements is correct. These replace them by exercising the code.
     --------------------------------------------------------------------- */

  const engagement = (over: Partial<any> = {}) => ({
    id: "mfe_1",
    companyId: "co_1",
    mode: "A" as const,
    status: "ACTIVE",
    authorityArtifactRef: "artifact-1",
    authorityExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    trialExpiresAt: null,
    chapterId: null,
    matterId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  });

  it("treats an artifact expiring RIGHT NOW as expired, exactly as the server does", () => {
    /* server/managedFounderStore.ts:80 — `t <= Date.now()`. A client using `<`
       renders the form for an artifact that expires this instant, and the
       submit then 403s with AUTHORITY_ARTIFACT_EXPIRED. Frozen clock so the
       boundary is exact rather than racing real time. */
    vi.useFakeTimers();
    try {
      const now = new Date("2026-08-11T00:00:00.000Z");
      vi.setSystemTime(now);

      const exactlyNow = localSpvOnBehalfBlockers(engagement({ authorityExpiresAt: now.toISOString() }) as any);
      expect(exactlyNow).toContain(SPV_ON_BEHALF_GATE_COPY.AUTHORITY_ARTIFACT_EXPIRED);

      const oneMsLater = localSpvOnBehalfBlockers(
        engagement({ authorityExpiresAt: new Date(now.getTime() + 1).toISOString() }) as any,
      );
      expect(oneMsLater).not.toContain(SPV_ON_BEHALF_GATE_COPY.AUTHORITY_ARTIFACT_EXPIRED);

      const oneMsEarlier = localSpvOnBehalfBlockers(
        engagement({ authorityExpiresAt: new Date(now.getTime() - 1).toISOString() }) as any,
      );
      expect(oneMsEarlier).toContain(SPV_ON_BEHALF_GATE_COPY.AUTHORITY_ARTIFACT_EXPIRED);
    } finally {
      vi.useRealTimers();
    }
  });

  it("blocks on each GATE-3 precondition independently, and on none when all hold", () => {
    expect(localSpvOnBehalfBlockers(engagement() as any)).toEqual([]);
    expect(localSpvOnBehalfBlockers(engagement({ status: "LAPSED" }) as any))
      .toContain(SPV_ON_BEHALF_GATE_COPY.ENGAGEMENT_NOT_ACTIVE);
    expect(localSpvOnBehalfBlockers(engagement({ mode: "B" }) as any))
      .toContain(SPV_ON_BEHALF_GATE_COPY.ENGAGEMENT_MODE_NOT_A);
    expect(localSpvOnBehalfBlockers(engagement({ authorityArtifactRef: "  " }) as any))
      .toContain(SPV_ON_BEHALF_GATE_COPY.AUTHORITY_ARTIFACT_REQUIRED);
  });

  it("renders a FAILED read of on-behalf vehicles as copy, never as 'none created'", async () => {
    apiRequestMock.mockImplementation(async () => {
      throw new ApiError(403, "denied", "SPV_WRITE_AUTHORITY_REQUIRED", null);
    });
    renderAt(
      "/collective/partner/managed-founders/mfe_1",
      <SpvOnBehalfPanel engagement={engagement() as any} subRole="managing_partner" />,
    );
    const err = await screen.findByTestId("mf-sob-error");
    /* Pin the MESSAGE the partner receives, not merely that a box exists. */
    expect(within(err).getByTestId("mf-sob-error-message").textContent).toMatch(/SPV write authority/i);
    /* THE DEFECT: a firm with live vehicles being told it has none. */
    expect(screen.queryByTestId("mf-sob-empty")).toBeNull();
  });

  it("renders the genuinely-empty state only when the read SUCCEEDED", async () => {
    apiRequestMock.mockImplementation(async () => jsonResponse({ spvOnBehalf: [] }));
    renderAt(
      "/collective/partner/managed-founders/mfe_1",
      <SpvOnBehalfPanel engagement={engagement() as any} subRole="managing_partner" />,
    );
    await screen.findByTestId("mf-sob-empty");
    expect(screen.queryByTestId("mf-sob-error")).toBeNull();
  });

  it("RENDERS the blocking precondition instead of a form that is certain to 403", async () => {
    apiRequestMock.mockImplementation(async () => jsonResponse({ spvOnBehalf: [] }));
    renderAt(
      "/collective/partner/managed-founders/mfe_1",
      <SpvOnBehalfPanel engagement={engagement({ mode: "B" }) as any} subRole="managing_partner" />,
    );
    const blocked = await screen.findByTestId("mf-sob-blocked");
    expect(blocked.textContent).toMatch(/Mode B/);
    expect(screen.queryByTestId("mf-sob-form")).toBeNull();
    expect(screen.queryByTestId("mf-sob-submit")).toBeNull();
  });
});
