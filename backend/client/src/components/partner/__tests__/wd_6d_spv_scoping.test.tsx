/**
 * WAVE D · ITEM 6d — "the information on this page must be specific to the SPV
 * being viewed; move the links to the other SPVs out of that area."
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE TWO CLAIMS PROVED HERE
 * ══════════════════════════════════════════════════════════════════════════════
 *  A. THE DEFECT WAS REAL. With one vehicle's detail open, the SPVs page used to
 *     render every OTHER vehicle's card — name, target-raise figure, publish
 *     control and two deep links — around it. That is demonstrated below by
 *     rendering the REAL page with no vehicle open (its old, always-on state) and
 *     counting the other vehicles on screen.
 *  B. NO NAVIGATION TARGET WAS LOST. The SET of vehicle ids a partner can reach
 *     from the surface is IDENTICAL before and after the scoping, for every one
 *     of the six vehicles in turn. Both sides of that comparison are asserted
 *     non-empty.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE ROWS ARE REAL ROWS
 * ══════════════════════════════════════════════════════════════════════════════
 * The six vehicles driven here are read out of the shipped `data.db` at test
 * time, read-only, and mapped into the DTO shape the endpoint returns. A feature
 * proved against an invented fixture is not proved: these particular rows
 * ALL CARRY THE SAME NAME, and that is precisely the case a naive dropdown gets
 * wrong. If `data.db` ever holds no vehicles this file fails rather than passing
 * vacuously.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT IS MOCKED, AND WHY IT IS NOT A REPLICA
 * ══════════════════════════════════════════════════════════════════════════════
 * The page under test is the REAL `PartnerSpvEngine` and the REAL
 * `PartnerSpvSwitcher`, rendered in jsdom. Exactly ONE thing is stubbed: the
 * TRANSPORT (`apiRequest`), which serves the real rows above for the SPV list,
 * a partner identity for the role bootstrap, and an empty payload for anything
 * else. The real `useRequirePartnerRole` runs. Nothing about which vehicles are
 * rendered, or how they are reached, is supplied by a stub.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * EVERY DOM QUERY IS SCOPED
 * ══════════════════════════════════════════════════════════════════════════════
 * All enumeration runs against the container returned by `render`, never against
 * `document`. An unscoped query is one of the ways this project has previously
 * manufactured a green: leftover nodes from an earlier render answer the query.
 */
import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { render, cleanup, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import Database from "better-sqlite3";
import { resolve } from "node:path";

import {
  spvShortRef,
  spvSwitcherOptionLabel,
  spvNamesCollide,
} from "../PartnerSpvSwitcher";
import type { SpvDTO } from "@shared/spvEngine";

const ROOT = resolve(__dirname, "../../../../..");

/* ── THE REAL ROWS ─────────────────────────────────────────────────────────── */

type Row = {
  id: string;
  name: string;
  status: string;
  currency: string;
  jurisdiction: string;
  sponsor_partner_id: string;
  terms_json: string | null;
  spv_type: string;
  distribution_scope: string;
  carry_basis: string;
  lp_visibility: string;
  target_raise_minor: number | null;
  min_check_minor: number | null;
  cap_minor: number | null;
  target_company_id: string | null;
  created_at: string;
  updated_at: string;
};

let ROWS: Row[] = [];

beforeAll(() => {
  const db = new Database(resolve(ROOT, "data.db"), { readonly: true, fileMustExist: true });
  ROWS = db
    .prepare(
      "SELECT id, name, status, currency, jurisdiction, sponsor_partner_id, terms_json, spv_type, distribution_scope, carry_basis, lp_visibility, target_raise_minor, min_check_minor, cap_minor, target_company_id, created_at, updated_at FROM spv ORDER BY id",
    )
    .all() as Row[];
  db.close();
});

function dtos(): SpvDTO[] {
  return ROWS.map(
    (r) =>
      ({
        id: r.id,
        sponsorPartnerId: r.sponsor_partner_id,
        gpUserId: null,
        name: r.name,
        spvType: r.spv_type,
        jurisdiction: r.jurisdiction,
        status: r.status,
        distributionScope: r.distribution_scope,
        targetRaiseMinor: r.target_raise_minor,
        minCheckMinor: r.min_check_minor,
        capMinor: r.cap_minor,
        currency: r.currency,
        carryBasis: r.carry_basis,
        lpVisibility: r.lp_visibility,
        targetCompanyId: r.target_company_id,
        closeDate: null,
        terms: r.terms_json ? (JSON.parse(r.terms_json) as Record<string, unknown>) : null,
        migratedFrom: null,
        createdAt: r.created_at,
        createdBy: null,
        updatedAt: r.updated_at,
        updatedBy: null,
        archivedAt: null,
        revisionHash: "",
      }) as unknown as SpvDTO,
  );
}

/* ── THE TRANSPORT AND THE AUTH GATE, THE ONLY TWO STUBS ───────────────────── */



vi.mock("@/lib/queryClient", () => {
  class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return {
    ApiError,
    queryClient: undefined,
    getQueryFn: () => async () => ({}),
    apiRequest: async (_method: string, url: string) => {
      let body: unknown = {};
      if (url === "/api/partner/me") {
        body = {
          partnerId: "tenant_cp_keiretsu_ca",
          tier: "nexus",
          subRole: "managing_partner",
          identity: { userId: "u_test", email: "gp@example.com", name: "Keiretsu Canada" },
          status: "active",
        };
      } else if (url === "/api/partner/me/agreement") {
        body = { signedCurrent: true, canSign: true };
      } else if (url === "/api/partner/me/spv") {
        body = { spvs: dtos() };
      }
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    },
  };
});

/* ── THE HARNESS ───────────────────────────────────────────────────────────── */

async function renderEngine() {
  const { default: PartnerSpvEngine } = await import("../../../pages/partner/PartnerSpvEngine");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const hook = memoryLocation({ path: "/collective/partner/spv-engine" });
  let out!: ReturnType<typeof render>;
  await act(async () => {
    out = render(
      <QueryClientProvider client={qc}>
        <Router hook={hook.hook}>
          <PartnerSpvEngine />
        </Router>
      </QueryClientProvider>,
    );
  });
  /* The page bootstraps its role, then its agreement, then its vehicle list.
     Wait for the SWITCHER, which cannot appear until the vehicle list has
     resolved — so this wait proves the list arrived rather than assuming it. */
  await waitFor(() => {
    expect(out.container.querySelector('[data-testid="spv-switcher-select"]')).not.toBeNull();
  });
  return out;
}

/** Vehicle ids that have a CARD rendered in the list — the detail area. */
function idsWithCards(container: HTMLElement): Set<string> {
  const out = new Set<string>();
  container.querySelectorAll("[data-testid]").forEach((el) => {
    const t = el.getAttribute("data-testid") ?? "";
    const m = /^spv-row-(spv_[0-9a-f]+)$/.exec(t);
    if (m) out.add(m[1]);
  });
  return out;
}

/** Vehicle ids offered by the single switcher control at the top. */
function idsInSwitcher(container: HTMLElement): Set<string> {
  const out = new Set<string>();
  container.querySelectorAll('[data-testid="spv-switcher"] option').forEach((el) => {
    const v = (el as HTMLOptionElement).value;
    if (v) out.add(v);
  });
  return out;
}

/** Every vehicle id reachable from the surface, by any route the surface offers. */
function idsReachable(container: HTMLElement): Set<string> {
  const out = new Set<string>([...idsWithCards(container), ...idsInSwitcher(container)]);
  container.querySelectorAll("a[href]").forEach((el) => {
    const m = /\/collective\/partner\/spvs\/(spv_[0-9a-f]+)/.exec(el.getAttribute("href") ?? "");
    if (m) out.add(m[1]);
  });
  return out;
}

function selectSwitcher(container: HTMLElement, value: string) {
  const sel = container.querySelector('[data-testid="spv-switcher-select"]') as HTMLSelectElement | null;
  expect(sel, "the switcher select must be in the DOM").not.toBeNull();
  sel!.value = value;
  sel!.dispatchEvent(new Event("change", { bubbles: true }));
}

afterEach(() => cleanup());

/* ══════════════════════════════════════════════════════════════════════════ */

describe("WD 6d · the rows this is proved against are real and awkward", () => {
  it("data.db holds vehicles, so nothing below passes vacuously", () => {
    expect(ROWS.length).toBeGreaterThan(0);
    expect(new Set(ROWS.map((r) => r.id)).size).toBe(ROWS.length);
  });

  it("CONTROL — the real rows share one name, so a name-only dropdown could not tell them apart", () => {
    const names = new Set(ROWS.map((r) => r.name.trim()));
    expect(names.size).toBeLessThan(ROWS.length);
    expect(spvNamesCollide(dtos())).toBe(true);
    /* And the shipped label DOES tell them apart, because it carries the ref. */
    const labels = new Set(dtos().map((s) => spvSwitcherOptionLabel(s)));
    expect(labels.size).toBe(ROWS.length);
    for (const r of ROWS) {
      expect(spvSwitcherOptionLabel(dtos().find((s) => s.id === r.id)!)).toContain(spvShortRef(r.id));
    }
  });
});

describe("WD 6d · A — the defect was real, and it is gone", () => {
  it("with no vehicle open the page still shows the whole list (the old always-on state)", async () => {
    const { container } = await renderEngine();
    const cards = idsWithCards(container);
    expect(cards.size).toBe(ROWS.length);
    expect(cards.size).toBeGreaterThan(1);
  });

  it("with one vehicle open, ONLY that vehicle's card is in the detail area", async () => {
    const { container } = await renderEngine();
    const target = ROWS[0].id;
    await act(async () => {
      selectSwitcher(container, target);
    });
    const cards = idsWithCards(container);
    expect([...cards]).toEqual([target]);
    for (const r of ROWS.slice(1)) expect(cards.has(r.id)).toBe(false);
  });

  it("the page says WHY the list is short, in words, and the switcher is above it", async () => {
    const { container } = await renderEngine();
    await act(async () => {
      selectSwitcher(container, ROWS[0].id);
    });
    const note = container.querySelector('[data-testid="spv-engine-scoped-note"]');
    expect(note?.textContent).toContain("only that vehicle is shown below");
    const html = container.innerHTML;
    expect(html.indexOf('data-testid="spv-switcher"')).toBeGreaterThan(-1);
    expect(html.indexOf('data-testid="spv-switcher"')).toBeLessThan(
      html.lastIndexOf('data-testid="spv-engine-list"'),
    );
  });
});

describe("WD 6d · B — the set of reachable vehicles is unchanged", () => {
  it("BEFORE (full list) and AFTER (each vehicle open) reach the SAME set, both sides non-empty", async () => {
    const { container } = await renderEngine();
    const before = idsReachable(container);
    expect(before.size).toBe(ROWS.length);
    expect(before.size).toBeGreaterThan(0);

    for (const r of ROWS) {
      await act(async () => {
        selectSwitcher(container, r.id);
      });
      const after = idsReachable(container);
      expect(after.size).toBeGreaterThan(0);
      expect([...after].sort()).toEqual([...before].sort());
    }
  });

  it("CONTROL — the cards ALONE lose five targets, so the equality above has teeth", async () => {
    const { container } = await renderEngine();
    const all = new Set(ROWS.map((r) => r.id));
    await act(async () => {
      selectSwitcher(container, ROWS[0].id);
    });
    const cardsOnly = idsWithCards(container);
    expect(cardsOnly.size).toBe(1);
    expect(cardsOnly.size).toBeLessThan(all.size);
    /* The switcher is what closes that gap, and it is a SINGLE control. */
    expect(container.querySelectorAll('[data-testid="spv-switcher-select"]').length).toBe(1);
    expect([...idsInSwitcher(container)].sort()).toEqual([...all].sort());
  });

  it("choosing 'all vehicles' puts the full list back", async () => {
    const { container } = await renderEngine();
    await act(async () => {
      selectSwitcher(container, ROWS[0].id);
    });
    expect(idsWithCards(container).size).toBe(1);
    await act(async () => {
      selectSwitcher(container, "");
    });
    expect(idsWithCards(container).size).toBe(ROWS.length);
  });
});

describe("WD 6d · the switcher renders no money, in any branch", () => {
  it("no currency code and no amount appears inside the switcher", async () => {
    const { container } = await renderEngine();
    const sw = container.querySelector('[data-testid="spv-switcher"]');
    expect(sw).not.toBeNull();
    const text = sw!.textContent ?? "";
    expect(text.length).toBeGreaterThan(0);
    for (const cur of new Set(ROWS.map((r) => r.currency))) {
      expect(text).not.toContain(cur);
    }
    expect(text).not.toMatch(/[0-9][0-9,]*\.[0-9]{2}/);
  });
});
