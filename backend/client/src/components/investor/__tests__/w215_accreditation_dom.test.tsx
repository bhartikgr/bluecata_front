/**
 * WAVE 215 — the accreditation surfaces, proved in a MOUNTED DOM.
 *
 * R137.1: a claim about what an investor sees is only proved when the MOUNTED
 * component is proved. Every assertion below reads text out of a real render of
 * the real components — `AccreditationDeclaration` (the one capture surface) and
 * `AccreditationForm` (retired to a reference view this wave) — and the last
 * block mounts the real `investor/Profile` page so the two are proved as the
 * investor actually meets them, side by side on one screen.
 *
 * NOTHING IS INJECTED. No `onSubmit` is supplied to `AccreditationForm`
 * anywhere in this file — that is precisely the configuration its only mount
 * uses, and precisely the configuration in which the pre-wave code told the
 * investor "awaiting compliance review" while writing nothing. The submit path
 * that DOES write is proved separately over real HTTP in
 * `server/__tests__/w215_accreditation_declaration_route.test.ts`.
 *
 * WHAT IS PROVED ON SCREEN
 *   A  no criterion is selectable before a jurisdiction is chosen — so there is
 *      no screen state in which a blanket "I am accredited" tick exists
 *   B  choosing a jurisdiction reveals only that jurisdiction's criteria
 *   C  unverified criteria render their [UNVERIFIED] marking and their counsel
 *      note, and state no figure
 *   D  the UK shows £100,000 / £250,000 and never £170K / £430K
 *   E  the posture disclosure is on screen and says Capavate does not verify
 *   F  the word "verified" is not rendered anywhere in the declaration flow
 *   G  the retired form says out loud that it records nothing
 *   H  the real Profile page mounts the retired form in reference mode and the
 *      real declaration card, and carries the posture note beside its
 *      admin-screening panel
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RoleProvider } from "@/lib/role";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { getQueryFn } from "@/lib/queryClient";
import { SEED_INVESTOR_PROFILE } from "@/lib/profile/seed";
import { AccreditationDeclaration } from "../AccreditationDeclaration";
import {
  AccreditationForm,
  SUPERSEDED_UK_PATHWAY_DETAIL_PS22_10,
  REAL_ACCREDITATION_ROUTE,
} from "@/components/AccreditationForm";
import {
  ACCREDITATION_CLAUSE_VERSION,
  ACCREDITATION_CLAUSE_TEXT,
  ACCREDITATION_JURISDICTION_CRITERIA,
  ACCREDITATION_JURISDICTIONS_V0_3,
  ACCREDITATION_JURISDICTION_CODES,
} from "@shared/accreditationClause";

/** "verified" as a claim. "unverified" is the opposite claim and is required. */
const CLAIMS_VERIFIED = /(?<!un)verified/i;

/**
 * The GET payload the real route serves, shaped exactly as the real route shapes
 * it — the fields are read off the real shared config, not retyped, so a change
 * to the served model cannot leave this harness describing a payload the server
 * no longer produces.
 */
function servedPayload(overrides: Record<string, unknown> = {}) {
  const criteriaByJurisdiction: Record<string, unknown> = {};
  for (const code of ACCREDITATION_JURISDICTION_CODES) {
    criteriaByJurisdiction[code] = ACCREDITATION_JURISDICTION_CRITERIA[code];
  }
  return {
    ok: true,
    accredited: false,
    signedCurrent: false,
    declaration: null,
    signedClause: null,
    clause: {
      version: ACCREDITATION_CLAUSE_VERSION,
      text: ACCREDITATION_CLAUSE_TEXT,
      criteria: ACCREDITATION_JURISDICTION_CODES.flatMap(
        (c) => ACCREDITATION_JURISDICTION_CRITERIA[c],
      ),
      jurisdictions: ACCREDITATION_JURISDICTIONS_V0_3,
      criteriaByJurisdiction,
      posture: "records_declaration_does_not_verify",
      clauseTextSha256: "0".repeat(64),
    },
    ...overrides,
  };
}

let posted: Array<{ url: string; body: any }> = [];

beforeEach(() => {
  posted = [];
  vi.stubGlobal("fetch", vi.fn(async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : String(input?.url ?? "");
    if (init?.method && init.method !== "GET") {
      posted.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({ ok: true, declaration: {} }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }
    /* The real `investor/Profile` page runs its own queries before it renders
       the accreditation surfaces. Those are answered here with the minimum the
       page needs, so the PAGE is real and only the network is stubbed. */
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.includes("/api/auth/me") || url.includes("/api/entitlement")) {
      /* `useEntitlement` resolves the investor identity the page keys every other
         query off. Shaped as the real endpoint shapes it. */
      return json({
        userId: "u_w215_dom",
        isAuthed: true,
        isAdmin: false,
        identity: { id: "u_w215_dom", name: "Dom Proof Investor", email: "dom@example.com", avatarColor: "#0BA5B7" },
        role: "investor",
        founder: { companies: [], activeCompanyId: null },
        investor: { invitedRounds: [], capTablePositions: [], state: "NONE" },
        collective: { status: "none", role: null, expiresAt: null },
      });
    }
    if (url.includes("/api/investors") && url.includes("profile")) {
      /* The product's OWN `InvestorProfile` shape, not a hand-rolled one — so a
         change to the profile model cannot leave this harness feeding the real
         page an envelope the real API would never send. Only the accreditation
         fields are pinned, because H2 is about what sits beside them. */
      return json({
        ...SEED_INVESTOR_PROFILE,
        id: "inv_w215_dom",
        profile: {
          ...SEED_INVESTOR_PROFILE.profile,
          countryOfTaxResidencyCode: "US",
          accreditationVerified: true,
          accreditationVerifiedAt: "2026-08-14T10:00:00.000Z",
        },
      });
    }
    return json(servedPayload());
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/**
 * The eligibility-criterion checkboxes only. `checkbox-accred-accept` is the
 * "I have read this" acknowledgement, not a criterion, and it shares the prefix;
 * counting it would have made A1 pass for the wrong reason.
 */
function criterionCheckboxes(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll('[data-testid^="checkbox-accred-"]'),
  ).filter((el) => el.getAttribute("data-testid") !== "checkbox-accred-accept") as HTMLElement[];
}

function withQuery(node: React.ReactNode) {
  /* The app's own default query function, so the real page's `useQuery` calls
     behave exactly as they do in the product. */
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, queryFn: getQueryFn({ on401: "returnNull" }) as any },
    },
  });
  /* The real providers the app wraps these pages in. Nothing about the
     components under test is substituted — only the context they run inside. */
  return (
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <TooltipProvider>{node}</TooltipProvider>
      </RoleProvider>
    </QueryClientProvider>
  );
}

async function mountDeclaration() {
  render(withQuery(<AccreditationDeclaration />));
  /* Wait for the served clause rather than a fixed sleep. */
  return await screen.findByTestId("select-accred-jurisdiction", {}, { timeout: 4000 });
}

/* ────────────────────────────────────────────────────────────────────────────
   A / B — no criterion exists on screen until a jurisdiction is chosen.
   ──────────────────────────────────────────────────────────────────────────── */
describe("W215 · A — there is no screen state offering a blanket accreditation tick", () => {
  it("A1 · before a jurisdiction is chosen, the criteria list is locked and no checkbox exists", async () => {
    const select = await mountDeclaration();
    expect((select as HTMLSelectElement).value).toBe("");
    expect(screen.getByTestId("accreditation-criteria-locked")).toBeTruthy();
    /* Anti-vacuity: the card really did render its content. */
    expect(screen.getByTestId("accreditation-posture-disclosure")).toBeTruthy();
    /* And there is no criterion control of any kind yet. */
    expect(criterionCheckboxes().length).toBe(0);
  });

  it("A2 · no criterion anywhere in the served model spans more than one jurisdiction", async () => {
    /* The structural reason A1 cannot be worked around by any UI state: there is
       no id that could mean "accredited everywhere". */
    const owners = new Map<string, string[]>();
    for (const code of ACCREDITATION_JURISDICTION_CODES) {
      for (const c of ACCREDITATION_JURISDICTION_CRITERIA[code]) {
        owners.set(c.id, [...(owners.get(c.id) ?? []), code]);
      }
    }
    expect(Array.from(owners.values()).filter((v) => v.length > 1)).toEqual([]);
  });
});

describe("W215 · B — choosing a jurisdiction reveals only that jurisdiction's criteria", () => {
  it("B1 · selecting US shows every US criterion and no criterion of any other jurisdiction", async () => {
    const select = await mountDeclaration();
    fireEvent.change(select, { target: { value: "US" } });

    const usIds = ACCREDITATION_JURISDICTION_CRITERIA.US.map((c) => c.id);
    for (const id of usIds) {
      expect(screen.getByTestId(`checkbox-accred-${id}`)).toBeTruthy();
    }
    /* The locked notice is gone, so the reveal really happened. */
    expect(screen.queryByTestId("accreditation-criteria-locked")).toBeNull();

    const foreign = ACCREDITATION_JURISDICTION_CODES.filter((c) => c !== "US").flatMap(
      (c) => ACCREDITATION_JURISDICTION_CRITERIA[c].map((x) => x.id),
    );
    for (const id of foreign) {
      expect(screen.queryByTestId(`checkbox-accred-${id}`)).toBeNull();
    }
  });

  it("B2 · switching jurisdiction replaces the criteria, in both directions", async () => {
    const select = await mountDeclaration();
    fireEvent.change(select, { target: { value: "HK" } });
    const hkFirst = ACCREDITATION_JURISDICTION_CRITERIA.HK[0].id;
    expect(screen.getByTestId(`checkbox-accred-${hkFirst}`)).toBeTruthy();
    expect(screen.queryByTestId("checkbox-accred-us_income")).toBeNull();

    fireEvent.change(select, { target: { value: "US" } });
    expect(screen.getByTestId("checkbox-accred-us_income")).toBeTruthy();
    expect(screen.queryByTestId(`checkbox-accred-${hkFirst}`)).toBeNull();
  });

  it("B3 · every one of the nine jurisdictions renders at least one criterion", async () => {
    const select = await mountDeclaration();
    for (const code of ACCREDITATION_JURISDICTION_CODES) {
      fireEvent.change(select, { target: { value: code } });
      const rendered = criterionCheckboxes();
      expect(rendered.length).toBeGreaterThan(0);
      /* And each rendered id belongs to THIS jurisdiction. */
      const permitted = new Set(ACCREDITATION_JURISDICTION_CRITERIA[code].map((c) => c.id));
      for (const el of rendered) {
        const id = String(el.getAttribute("data-testid")).replace("checkbox-accred-", "");
        expect(permitted.has(id)).toBe(true);
      }
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   C / D — thresholds: markings preserved, UK corrected.
   ──────────────────────────────────────────────────────────────────────────── */
describe("W215 · C — unverified criteria are marked on screen and state no figure", () => {
  it("C1 · every unverified criterion renders its marking, its counsel note, and no currency figure", async () => {
    const select = await mountDeclaration();
    const currency = /[\u00a3\u20ac\u00a5\u20b9$]\s?\d/;
    let checked = 0;
    for (const code of ACCREDITATION_JURISDICTION_CODES) {
      fireEvent.change(select, { target: { value: code } });
      for (const c of ACCREDITATION_JURISDICTION_CRITERIA[code]) {
        if (c.confidence !== "unverified") continue;
        checked++;
        expect(screen.getByTestId(`marker-accred-unverified-${c.id}`)).toBeTruthy();
        expect(screen.getByTestId(`note-accred-counsel-${c.id}`)).toBeTruthy();
        const row = screen.getByTestId(`checkbox-accred-${c.id}`).closest("label");
        expect(row).toBeTruthy();
        expect(row!.textContent ?? "").not.toMatch(currency);
      }
    }
    /* Anti-vacuity: this loop asserted something. */
    expect(checked).toBeGreaterThan(0);
  });

  it("C2 · a verified criterion carries no [UNVERIFIED] marking, so C1 is not vacuous", async () => {
    const select = await mountDeclaration();
    fireEvent.change(select, { target: { value: "HK" } });
    const verified = ACCREDITATION_JURISDICTION_CRITERIA.HK.filter((c) => c.confidence === "verified");
    expect(verified.length).toBeGreaterThan(0);
    for (const c of verified) {
      expect(screen.queryByTestId(`marker-accred-unverified-${c.id}`)).toBeNull();
    }
  });
});

describe("W215 · D — the UK figures on screen are the ones in force", () => {
  it("D1 · the declaration card shows £100,000 and £250,000 for the UK", async () => {
    const select = await mountDeclaration();
    fireEvent.change(select, { target: { value: "UK" } });
    const text = screen.getByTestId("accreditation-card").textContent ?? "";
    expect(text).toContain("100,000");
    expect(text).toContain("250,000");
    expect(text).not.toContain("170");
    expect(text).not.toContain("430");
  });

  it("D2 · the reference form shows the same corrected pair and never the superseded one", () => {
    render(<AccreditationForm initialJurisdiction="UK" mode="reference" />);
    const card = screen.getByTestId("card-accreditation-form");
    const text = card.textContent ?? "";
    expect(text).toContain("100,000");
    expect(text).toContain("250,000");
    /* The superseded pair is retained in source for the record, and is NOT on
       screen. Asserting both halves is the point. */
    expect(SUPERSEDED_UK_PATHWAY_DETAIL_PS22_10).toContain("170K");
    expect(text).not.toContain("170K");
    expect(text).not.toContain("430K");
  });

  it("D3 · the reference form states no figure where Capavate has no source", () => {
    render(<AccreditationForm initialJurisdiction="IN" mode="reference" />);
    const text = screen.getByTestId("card-accreditation-form").textContent ?? "";
    expect(text).toMatch(/awaiting confirmation by local counsel/i);
    expect(text).not.toMatch(/7\.5\s?cr/i);
    expect(text).not.toMatch(/50\s?cr/i);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   E / F / G — the platform's posture, on screen.
   ──────────────────────────────────────────────────────────────────────────── */
describe("W215 · E — the posture is unambiguous on screen", () => {
  it("E1 · the declaration card states that Capavate records and does not verify", async () => {
    await mountDeclaration();
    const panel = screen.getByTestId("accreditation-posture-disclosure");
    const text = panel.textContent ?? "";
    expect(text).toMatch(/declaration/i);
    expect(text).toMatch(/does not/i);
    /* The pre-existing honest sentence is still on screen — extended, not
       replaced. */
    const card = screen.getByTestId("accreditation-card").textContent ?? "";
    expect(card).toContain("Capavate does not perform it on your behalf");
  });

  it("E2 · for an investor who has already signed, the twelve-month re-confirmation is a re-declaration and not the expiry of any verification", async () => {
    /* This copy lives in the already-signed branch, so the served payload has to
       describe a signed investor — shaped as the real route shapes it. */
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify(servedPayload({
        accredited: true,
        /* Signed, but under the superseded wording — which is the state this
           copy exists for. */
        signedCurrent: false,
        declaration: {
          id: "iad_dom_signed",
          clauseVersion: "ACCRED-v0.2",
          criteria: ["us_income"],
          signatureName: "Already Signed",
          signedAt: "2026-08-14T10:00:00.000Z",
          jurisdiction: "US",
        },
      })),
      { status: 200, headers: { "content-type": "application/json" } },
    )));
    render(withQuery(<AccreditationDeclaration />));
    expect(await screen.findByTestId("accreditation-version-not-expiry", {}, { timeout: 4000 })).toBeTruthy();
    /* Anti-vacuity: the signed branch really rendered. */
    expect(screen.getByTestId("accreditation-signed")).toBeTruthy();
    expect(screen.getByTestId("accreditation-card").textContent ?? "").not.toMatch(CLAIMS_VERIFIED);
  });
});

describe("W215 · F — the word 'verified' is not rendered in this flow", () => {
  it("F1 · nowhere in the mounted declaration card, at any jurisdiction", async () => {
    const select = await mountDeclaration();
    for (const code of ["", ...ACCREDITATION_JURISDICTION_CODES]) {
      fireEvent.change(select, { target: { value: code } });
      const text = screen.getByTestId("accreditation-card").textContent ?? "";
      expect(text).not.toMatch(CLAIMS_VERIFIED);
      /* Anti-vacuity: the card is not empty. */
      expect(text.length).toBeGreaterThan(200);
    }
  });

  it("F2 · nowhere in the mounted reference form, at any of the nine jurisdictions", () => {
    for (const j of ACCREDITATION_JURISDICTIONS_V0_3) {
      cleanup();
      render(<AccreditationForm initialJurisdiction={j.code as any} mode="reference" />);
      const text = screen.getByTestId("card-accreditation-form").textContent ?? "";
      expect(text.length).toBeGreaterThan(100);
      expect(text).not.toMatch(CLAIMS_VERIFIED);
    }
  });
});

describe("W215 · G — the retired form no longer claims to submit anything", () => {
  it("G1 · in reference mode it says nothing is recorded and links to the real form", () => {
    render(<AccreditationForm initialJurisdiction="US" mode="reference" />);
    const notice = screen.getByTestId("accreditation-form-reference-notice");
    expect((notice.textContent ?? "")).toMatch(/nothing on this panel is recorded/i);
    const link = screen.getByTestId("link-real-accreditation-form") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(REAL_ACCREDITATION_ROUTE);
    expect(REAL_ACCREDITATION_ROUTE).toBe("/investor/accreditation");
  });

  it("G2 · in reference mode nothing it does results in a network write", () => {
    render(<AccreditationForm initialJurisdiction="US" mode="reference" />);
    fireEvent.click(screen.getByTestId("checkbox-truthful"));
    fireEvent.click(screen.getByTestId("checkbox-risk"));
    fireEvent.click(screen.getByTestId("button-submit-accreditation"));
    /* It never wrote before this wave either. What changed is that it no longer
       claims to have. */
    expect(posted).toEqual([]);
  });

  /* ── ADDED AFTER A GREEN DISARM ────────────────────────────────────────────
     Breaking the reference branch in `submit()` — so the pre-wave "Accreditation
     submitted · awaiting compliance review" toast fires again — left every test
     in this file GREEN. G1 only proved the notice was PRINTED and G2 only proved
     no request was sent, and neither is a claim about what the investor is TOLD
     after clicking. The false reassurance was the defect; it has to be the
     assertion. The real `Toaster` is mounted and the real toast text is read out
     of the DOM. */
  it("G4 · clicking submit in reference mode never tells the investor a declaration was submitted", async () => {
    const assign = vi.fn();
    /* jsdom has no navigation; replace only the navigation call, so the
       assertion below is about the message, not about the redirect. */
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, assign },
    });

    render(
      <>
        <AccreditationForm initialJurisdiction="US" mode="reference" />
        <Toaster />
      </>,
    );
    fireEvent.click(screen.getByTestId("checkbox-truthful"));
    fireEvent.click(screen.getByTestId("checkbox-risk"));
    fireEvent.click(screen.getByTestId("button-submit-accreditation"));

    /* Anti-vacuity: a toast really did appear. */
    const shown = await vi.waitFor(() => {
      const t = document.body.textContent ?? "";
      expect(t).toMatch(/Nothing was submitted from this panel/i);
      return t;
    });
    /* And it does not repeat any of the pre-wave reassurances. */
    expect(shown).not.toMatch(/awaiting compliance review/i);
    expect(shown).not.toMatch(/Accreditation submitted/i);
    /* The investor is sent to the surface that does record something. */
    expect(assign).toHaveBeenCalledWith(REAL_ACCREDITATION_ROUTE);
  });

  it("G3 · the default mode is unchanged, so no other caller was altered", () => {
    /* No `mode` passed: the historical header text is what renders, and the
       reference notice is absent. */
    render(<AccreditationForm initialJurisdiction="US" />);
    expect(screen.getByTestId("card-accreditation-form")).toBeTruthy();
    expect(screen.queryByTestId("accreditation-form-reference-notice")).toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   Submitting: the mutation carries a jurisdiction and a scoped criteria set.
   ──────────────────────────────────────────────────────────────────────────── */
describe("W215 · the declaration card cannot submit without a jurisdiction", () => {
  it("the submit control is disabled until a jurisdiction is chosen, and the payload carries it", async () => {
    const select = await mountDeclaration();
    const button = screen.getByTestId("button-sign-accreditation") as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    fireEvent.change(select, { target: { value: "US" } });
    fireEvent.change(screen.getByTestId("input-accred-signature"), {
      target: { value: "Dom Proof Signer" },
    });
    fireEvent.click(screen.getByTestId("checkbox-accred-us_income"));
    fireEvent.click(screen.getByTestId("checkbox-accred-accept"));
    expect((screen.getByTestId("button-sign-accreditation") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("button-sign-accreditation"));

    await vi.waitFor(() => expect(posted.length).toBe(1));
    expect(posted[0].url).toContain("/api/investor/compliance/accreditation-declaration");
    expect(posted[0].body.jurisdiction).toBe("US");
    expect(posted[0].body.criteria).toEqual(["us_income"]);
    /* The free-text quick-find box is never what gets sent. */
    expect(posted[0].body.criteria.every((c: string) => c.startsWith("us_"))).toBe(true);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
   H — both surfaces as the investor actually meets them, on the real page.
   ──────────────────────────────────────────────────────────────────────────── */
/**
 * The real page opens on step 1 of its own wizard; the accreditation surfaces sit
 * on step 2. This drives the page's OWN continue button rather than reaching into
 * its state, so what H1/H2 prove is what an investor actually reaches.
 */
async function gotoProfileStep2() {
  const cont = await screen.findByTestId("button-step-continue", {}, { timeout: 15000 });
  fireEvent.click(cont);
}

describe("W215 · H — the real investor Profile page carries the corrected surfaces", () => {
  it("H1 · Profile mounts the retired form in reference mode and the real declaration card beside it", { timeout: 30000 }, async () => {
    const { default: Profile } = await import("@/pages/investor/Profile");
    render(withQuery(<Profile />));

    /* The retired form is still mounted — deliberately not deleted — and is in
       reference mode, so it announces that it records nothing. */
    await gotoProfileStep2();
    const form = await screen.findByTestId("card-accreditation-form", {}, { timeout: 15000 });
    expect(form).toBeTruthy();
    expect(screen.getByTestId("accreditation-form-reference-notice")).toBeTruthy();

    /* And the single real capture surface is on the same page. */
    expect(screen.getByTestId("profile-accreditation-declaration")).toBeTruthy();
    expect(await screen.findByTestId("accreditation-card", {}, { timeout: 15000 })).toBeTruthy();
  });

  it("H2 · the posture note sits beside the admin-screening panel", { timeout: 30000 }, async () => {
    const { default: Profile } = await import("@/pages/investor/Profile");
    render(withQuery(<Profile />));
    await gotoProfileStep2();
    const note = await screen.findByTestId("accreditation-posture-profile-note", {}, { timeout: 15000 });
    const text = note.textContent ?? "";
    /* It names the confusion rather than leaving the reader to guess. */
    expect(text).toMatch(/internal admin screening/i);
    expect(text).toMatch(/not a check of it|does not assess/i);
    expect(text).toMatch(/does not perform any verification on your behalf/i);
  });
});
