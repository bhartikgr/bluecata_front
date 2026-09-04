/**
 * WAVE A2 · ITEM 7a — THE SPV TEMPLATE JURISDICTION AND CURRENCY DROPDOWNS.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHY THIS ITEM IS NOT THE SAME SHAPE AS 5a
 * ══════════════════════════════════════════════════════════════════════════════
 * On the Add-Portfolio-Company form the server stores whatever sector string it
 * is given, so the whole risk lived in the browser. Here the server is DIFFERENT:
 * `validateStructure` in `server/spvTemplateStore.ts` calls `isSpvJurisdiction`
 * and REFUSES an unknown jurisdiction with `INVALID_JURISDICTION`. That refusal
 * is correct and this wave does not touch it.
 *
 * So item 7a has two obligations, and they are different obligations:
 *
 *   (1) A jurisdiction the list does not contain must be REFUSED OUT LOUD by the
 *       server — never silently rewritten to `delaware` (the form's first option
 *       and its initial value) and then saved as though the operator chose it.
 *       A wrong jurisdiction on an SPV is a legal-entity error, not a typo.
 *
 *   (2) A value ALREADY IN THE DATABASE that the current list does not contain —
 *       a row written before a list changed, or by any other path — must still be
 *       RENDERED, not hidden and not shown as some neighbouring jurisdiction.
 *       That row is seeded here directly through `rawDb()`, which is the only way
 *       to create the situation at all now that the server validates.
 *
 * The CONTROL for the DOM mechanism itself (a naive canonical-only `<select>`
 * really does report a different value) lives in
 * `client/src/lib/__tests__/wa5a_canonical_select_preserves_stored_value.test.tsx`
 * and is not repeated here.
 *
 * R262: this file also asserts that neither dropdown offers a blank currency —
 * because `normaliseCurrency` in `server/spvTemplateStore.ts` reads
 * `(trimmed) || "USD"`, so an empty currency option would be a new silent-USD
 * site. The wave added none.
 *
 * NEVER MUTATES data.db / test.db — ordinary in-memory test handle.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import express, { type Express } from "express";
import request from "supertest";

import { rawDb, getDb } from "../../../../../server/db/connection";
import { seedTestPartnerSandbox } from "../../../../../server/partnerWorkspaceStore";
import { SPV_JURISDICTIONS, SPV_JURISDICTION_LABELS } from "@shared/spvEngine";
import { buildCurrencyOptions } from "@/lib/currencyOptions";
import PartnerSpvTemplates from "../PartnerSpvTemplates";

const MANAGING = "u_avi_managing";
const PARTNER_A = "ac_consortium_partner_test_partner_inc";
const CURRENCY_CODES = buildCurrencyOptions().map((c) => c.code);
/** Read from the partner's own row rather than assumed — see `tenantForPartner`
 *  in `server/spvTemplateStore.ts`, which falls back to this same literal. */
let TENANT_ID = "tenant_platform";

/** A jurisdiction key `SPV_JURISDICTIONS` does not contain, and a currency code
 *  ISO 4217 does not contain. Both are legitimate things to find in old data. */
const OFF_LIST_JURISDICTION = "republic_of_atlantis";
const OFF_LIST_CURRENCY = "ZWL";

let app: Express;

vi.mock("@/components/partner/PartnerShell", () => ({
  PartnerShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PartnerEmptyState: ({ title }: { title?: string }) => <div>{title ?? ""}</div>,
}));
const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));

/* FROZEN AND HOISTED — a fresh object literal here re-runs the page's effects in
   an unbounded request loop (recorded by the w232 bridge this file copies). */
const ROLE_RESULT = Object.freeze({
  ready: true,
  error: null,
  identity: Object.freeze({
    partnerId: PARTNER_A,
    tier: "builder",
    subRole: "managing_partner",
    identity: Object.freeze({ userId: MANAGING, email: "p@wa7a.test", name: "WA7a Managing" }),
  }),
});
vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ROLE_RESULT,
}));

const httpCalls: Array<{ method: string; url: string; status: number; body: unknown }> = [];
function postsTo(fragment: string): typeof httpCalls {
  return httpCalls.filter((c) => c.method === "POST" && c.url.includes(fragment));
}

beforeAll(async () => {
  const { registerPartnerRoutes } = await import("../../../../../server/partnerRoutes");
  const { registerSpvTemplateRoutes } = await import("../../../../../server/spvTemplateRoutes");
  getDb();
  app = express();
  app.use(express.json());
  registerPartnerRoutes(app);
  registerSpvTemplateRoutes(app);
  seedTestPartnerSandbox({ force: true });
  /* Migration 0177 does not run under NODE_ENV=test; the store self-heals the
     schema on first use, so it is installed here before anything reads it.
     `wave30_engine3_spv_template.test.ts` records the same precondition. */
  const { applyWave30SpvTemplateSchema } = await import(
    "../../../../../server/lib/applyWave30SpvTemplateSchema"
  );
  applyWave30SpvTemplateSchema(rawDb() as never);
  TENANT_ID =
    (
      rawDb()
        .prepare(`SELECT tenant_id FROM partner_organizations WHERE id = ?`)
        .get(PARTNER_A) as { tenant_id?: string } | undefined
    )?.tenant_id || "tenant_platform";

  (global as never as { fetch: unknown }).fetch = async (url: string, init?: RequestInit) => {
    const method = String(init?.method ?? "GET").toLowerCase();
    let r = (request(app) as unknown as Record<string, (u: string) => never>)[method](
      String(url),
    ) as never as { set: (k: string, v: string) => typeof r; send: (b: string) => typeof r };
    r = r.set("x-user-id", MANAGING).set("x-actor-user-id", MANAGING);
    if (init?.body !== undefined && init?.body !== null) {
      r = r.set("content-type", "application/json").send(String(init.body));
    }
    const res = await (r as unknown as Promise<{ status: number; body: unknown }>);
    httpCalls.push({ method: method.toUpperCase(), url: String(url), status: res.status, body: res.body });
    const bodyText = JSON.stringify(res.body ?? {});
    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      statusText: String(res.status),
      headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "application/json" : null) },
      json: async () => res.body,
      text: async () => bodyText,
      clone() { return this; },
    } as unknown as Response;
  };
}, 60_000);

afterEach(() => cleanup());

function mount(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PartnerSpvTemplates />
    </QueryClientProvider>,
  );
}

async function openTheNewTemplateForm(): Promise<void> {
  mount();
  await waitFor(() => expect(screen.getByTestId("button-new-spv-template")).toBeTruthy(), {
    timeout: 8000,
  });
  fireEvent.click(screen.getByTestId("button-new-spv-template"));
  await waitFor(() => expect(screen.getByTestId("select-template-jurisdiction")).toBeTruthy(), {
    timeout: 8000,
  });
}

describe("0 · preconditions", () => {
  it("both dropdowns exist beside the boxes they came from, at the counts measured", async () => {
    await openTheNewTemplateForm();
    const j = screen.getByTestId("select-template-jurisdiction") as HTMLSelectElement;
    const c = screen.getByTestId("select-template-currency") as HTMLSelectElement;

    /* The free-text boxes are STILL THERE. They are the escape hatch R195.5
       requires, and removing them would have been a silent capability drop. */
    expect(screen.getByTestId("input-template-jurisdiction")).toBeTruthy();
    expect(screen.getByTestId("input-template-currency")).toBeTruthy();

    /* Bound to the shipped lists — 16 and 156 — with no blank option on either. */
    expect(j.options.length).toBe(SPV_JURISDICTIONS.length);
    expect(j.options.length).toBe(16);
    expect(c.options.length).toBe(CURRENCY_CODES.length);
    expect(c.options.length).toBe(156);
    for (const o of Array.from(j.options)) expect(o.value).not.toBe("");
    for (const o of Array.from(c.options)) expect(o.value).not.toBe("");

    /* No raw storage keys on screen: every jurisdiction reads as a place. */
    for (const o of Array.from(j.options)) {
      expect(o.textContent).toBe(
        SPV_JURISDICTION_LABELS[o.value as keyof typeof SPV_JURISDICTION_LABELS],
      );
      expect(o.textContent).not.toBe(o.value);
    }
    /* Currency reads "CODE — Name", the shipped PartnerSpvEngine pattern. */
    expect(c.options[0].textContent).toMatch(/^[A-Z]{3} — .+/);
  }, 30_000);

  it("R262 — the USD starting value is DISCLOSED, not presented as a derived fact", async () => {
    await openTheNewTemplateForm();
    const note = screen.getByTestId("template-currency-origin-note").textContent ?? "";
    expect(note).toContain("has not derived it");
    /* The wave did not remove the pre-existing initial value (that would change
       what the form accepts, on a money field) and it did not add a new one. */
    expect((screen.getByTestId("select-template-currency") as HTMLSelectElement).value).toBe("USD");
  }, 30_000);
});

describe("A · an off-list jurisdiction is neither coerced nor silently saved", () => {
  it("the DOM reports the typed value verbatim — NOT the first option, NOT delaware", async () => {
    await openTheNewTemplateForm();
    const j = screen.getByTestId("select-template-jurisdiction") as HTMLSelectElement;
    expect(j.value).toBe("delaware"); // the shipped initial value, unchanged by this wave

    fireEvent.change(screen.getByTestId("input-template-jurisdiction"), {
      target: { value: OFF_LIST_JURISDICTION },
    });

    /* The high-risk assertion. A naive select would now read "delaware". */
    expect(j.value).toBe(OFF_LIST_JURISDICTION);
    expect(j.value).not.toBe("delaware");
    expect(j.value).not.toBe(SPV_JURISDICTIONS[0]);
    expect(j.options.length).toBe(SPV_JURISDICTIONS.length + 1);
    expect(j.options[j.selectedIndex].textContent)
      .toContain("not in Capavate's standard list");
  }, 30_000);

  it("the server REFUSES it out loud, and nothing is written under a different jurisdiction", async () => {
    await openTheNewTemplateForm();
    fireEvent.change(screen.getByTestId("input-template-name"), {
      target: { value: "WA7a Off List Jurisdiction" },
    });
    fireEvent.change(screen.getByTestId("input-template-jurisdiction"), {
      target: { value: OFF_LIST_JURISDICTION },
    });
    const before = postsTo("/api/partner/me/spv-templates").length;
    fireEvent.click(screen.getByTestId("button-save-spv-template"));
    await waitFor(
      () => expect(postsTo("/api/partner/me/spv-templates").length).toBeGreaterThan(before),
      { timeout: 8000 },
    );

    const call = postsTo("/api/partner/me/spv-templates").slice(-1)[0];
    expect(call.status).toBe(400);
    expect((call.body as { error?: string }).error).toBe("INVALID_JURISDICTION");

    /* AND — the point of the whole test — no row exists under ANY jurisdiction.
       A silent coercion would have produced a saved `delaware` template here. */
    const rows = rawDb()
      .prepare(`SELECT jurisdiction FROM spv_template WHERE name = ?`)
      .all("WA7a Off List Jurisdiction") as Array<{ jurisdiction: string }>;
    expect(rows.length).toBe(0);
  }, 30_000);

  it("a canonical jurisdiction still saves, and the row holds exactly what was chosen", async () => {
    await openTheNewTemplateForm();
    fireEvent.change(screen.getByTestId("input-template-name"), {
      target: { value: "WA7a Cayman Template" },
    });
    fireEvent.change(screen.getByTestId("select-template-jurisdiction"), {
      target: { value: "cayman" },
    });
    fireEvent.change(screen.getByTestId("select-template-currency"), { target: { value: "EUR" } });
    const before = postsTo("/api/partner/me/spv-templates").length;
    fireEvent.click(screen.getByTestId("button-save-spv-template"));
    await waitFor(
      () => expect(postsTo("/api/partner/me/spv-templates").length).toBeGreaterThan(before),
      { timeout: 8000 },
    );
    expect(postsTo("/api/partner/me/spv-templates").slice(-1)[0].status).toBe(201);

    const row = rawDb()
      .prepare(`SELECT jurisdiction, currency FROM spv_template WHERE name = ?`)
      .get("WA7a Cayman Template") as { jurisdiction: string; currency: string };
    expect(row).toBeTruthy();
    expect(row.jurisdiction).toBe("cayman");
    /* The currency dropdown wrote the currency the operator chose, and the
       server's `|| "USD"` fallback did not fire. */
    expect(row.currency).toBe("EUR");
    expect(row.currency).not.toBe("USD");
  }, 30_000);
});

describe("B · a value ALREADY in the database that the list does not contain is still shown", () => {
  it("an off-list jurisdiction and currency stored on a row are rendered, not hidden", async () => {
    /* Seeded through the storage layer, because the server now refuses to create
       such a row over HTTP. This is exactly the historical-data case. */
    const id = "tpl_wa7a_legacy";
    rawDb()
      .prepare(
        `INSERT OR REPLACE INTO spv_template
           (id, tenant_id, partner_id, name, spv_type, jurisdiction, carry_basis,
            currency, created_at, created_by, updated_at)
         VALUES (?, ?, ?, ?, 'spv', ?, 'committed_capital', ?, ?, ?, ?)`,
      )
      .run(
        id,
        TENANT_ID,
        PARTNER_A,
        "WA7a Legacy Row",
        OFF_LIST_JURISDICTION,
        OFF_LIST_CURRENCY,
        new Date().toISOString(),
        MANAGING,
        new Date().toISOString(),
      );

    /* PRECONDITION: the row really is in the database with the off-list values. */
    const seeded = rawDb()
      .prepare(`SELECT jurisdiction, currency FROM spv_template WHERE id = ?`)
      .get(id) as { jurisdiction: string; currency: string };
    expect(seeded.jurisdiction).toBe(OFF_LIST_JURISDICTION);
    expect(seeded.currency).toBe(OFF_LIST_CURRENCY);

    mount();
    await waitFor(() => expect(screen.getByText("WA7a Legacy Row")).toBeTruthy(), { timeout: 10_000 });

    /* The list shows the row and shows its jurisdiction — humanised, because the
       page has always humanised machine keys, but still the operator's own value
       and NOT some other jurisdiction. */
    const shown = screen.getAllByText(/Republic Of Atlantis/i);
    expect(shown.length).toBeGreaterThan(0);
    /* The row is not silently relabelled as a jurisdiction from the list. */
    for (const label of Object.values(SPV_JURISDICTION_LABELS)) {
      expect(shown[0].textContent).not.toBe(label);
    }
    /* And the stored value is untouched by having been rendered. */
    const after = rawDb()
      .prepare(`SELECT jurisdiction, currency FROM spv_template WHERE id = ?`)
      .get(id) as { jurisdiction: string; currency: string };
    expect(after.jurisdiction).toBe(OFF_LIST_JURISDICTION);
    expect(after.currency).toBe(OFF_LIST_CURRENCY);
  }, 30_000);
});
