/**
 * slide13b WAVE D — the admin Company Taxonomy page against the REAL store and
 * routes (in-process express + in-memory SQLite; `apiRequest` bridged to
 * supertest with the `x-user-id` header). No mocked taxonomy data anywhere.
 *
 * Proves, in the DOM:
 *   • 45 seeded rows render alphabetically by label (DB order, not seed order)
 *   • add → row appears, DB row exists, audit row exists
 *   • relabel → label changes, stored VALUE unchanged in the DB
 *   • retire → badge flips, row kept; reactivate restores
 *   • every successful mutation invalidates the PUBLIC selector cache (real
 *     `queryClient.invalidateQueries`), so consumers refetch
 *   • a rejected add (duplicate) surfaces an error toast and writes nothing
 *   • the page is separate from the partner-classification page (own route id)
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import express, { type Express } from "express";
import request from "supertest";

import { rawDb } from "../../../../../server/db/connection";
import { registerCompanyTaxonomyRoutes } from "../../../../../server/companyTaxonomyRoutes";
import { COLLECTIVE_SECTORS_45 } from "@shared/schema";
import { companyTaxonomyKey } from "@/lib/companyTaxonomy";

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("@/components/AppShell", () => ({
  PageHeader: ({ title }: { title?: string }) => <h1>{title}</h1>,
  PageBody: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

let app: Express;
const ACTOR = "u_admin";

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async (method: string, url: string, body?: unknown) => {
      const m = method.toLowerCase() as "get" | "post" | "patch" | "delete";
      let req = request(app)[m](url).set("x-user-id", ACTOR);
      if (body !== undefined) req = req.send(body as object);
      const r = await req;
      return {
        ok: r.status < 400, status: r.status, statusText: String(r.status),
        json: async () => r.body, text: async () => JSON.stringify(r.body),
      } as unknown as Response;
    },
  };
});

import { queryClient } from "@/lib/queryClient";
import CompanyTaxonomyAdmin from "../CompanyTaxonomyAdmin";

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerCompanyTaxonomyRoutes(app);
});
afterEach(() => { cleanup(); toastMock.mockReset(); });

const NS = "company_sector";
const tid = (v: string) => v.replace(/\W/g, "_");
function dbRow(value: string) {
  return rawDb().prepare(`SELECT value, label, active FROM taxonomy_terms WHERE namespace=? AND value=?`).get(NS, value) as
    | { value: string; label: string; active: number } | undefined;
}
function auditN(action: string, value: string) {
  return (rawDb().prepare(`SELECT COUNT(*) n FROM audit_log WHERE action=? AND target=?`).get(action, `taxonomy_term:${NS}:${value}`) as { n: number }).n;
}
function mount() {
  queryClient.clear();
  return render(<QueryClientProvider client={queryClient}><CompanyTaxonomyAdmin /></QueryClientProvider>);
}
async function rows() {
  await waitFor(() => expect(screen.queryByTestId("text-company-taxonomy-loading")).toBeNull());
  return screen.getAllByTestId(/^row-company-sector-/);
}

describe("slide13b WAVE D · admin Company Taxonomy page (DOM ↔ DB)", () => {
  it("renders the 45 seeded terms alphabetically by label, with the counts line", async () => {
    mount();
    const r = await rows();
    expect(r.length).toBeGreaterThanOrEqual(45);
    const labels = r.map((el) => within(el).getByTestId(/^text-company-sector-label-/).textContent?.trim());
    const sorted = [...labels].sort((a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: "base" }));
    expect(labels).toEqual(sorted);
    expect(labels).not.toEqual(COLLECTIVE_SECTORS_45.slice(0, labels.length)); // not seed order
    for (const s of COLLECTIVE_SECTORS_45) expect(screen.getByTestId(`row-company-sector-${tid(s)}`)).toBeTruthy();
    expect(screen.getByTestId("text-company-sector-counts").textContent).toMatch(/45 active/);
  });

  it("add: a new term appears in the list, is in the DB with an audit row, and the public cache is invalidated", async () => {
    const inv = vi.spyOn(queryClient, "invalidateQueries");
    mount();
    await rows();
    fireEvent.change(screen.getByTestId("input-company-sector-value"), { target: { value: "Ocean Robotics" } });
    fireEvent.change(screen.getByTestId("input-company-sector-label"), { target: { value: "Ocean Robotics" } });
    fireEvent.click(screen.getByTestId("button-add-company-sector"));
    await waitFor(() => expect(screen.getByTestId(`row-company-sector-${tid("Ocean Robotics")}`)).toBeTruthy());
    expect(dbRow("Ocean Robotics")).toMatchObject({ value: "Ocean Robotics", label: "Ocean Robotics", active: 1 });
    expect(auditN("company_taxonomy.term.create", "Ocean Robotics")).toBe(1);
    expect(inv.mock.calls.some(([o]) => JSON.stringify((o as { queryKey: unknown }).queryKey) === JSON.stringify(companyTaxonomyKey(NS)))).toBe(true);
    expect(screen.getByTestId("text-company-sector-counts").textContent).toMatch(/46 active/);
    inv.mockRestore();
  });

  it("add rejected (duplicate value) → destructive toast, no new row, no audit row", async () => {
    mount();
    await rows();
    const before = (rawDb().prepare(`SELECT COUNT(*) n FROM taxonomy_terms WHERE namespace=?`).get(NS) as { n: number }).n;
    fireEvent.change(screen.getByTestId("input-company-sector-value"), { target: { value: "Ocean Robotics" } });
    fireEvent.click(screen.getByTestId("button-add-company-sector"));
    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(toastMock.mock.calls.some(([a]) => (a as { variant?: string }).variant === "destructive")).toBe(true);
    expect((rawDb().prepare(`SELECT COUNT(*) n FROM taxonomy_terms WHERE namespace=?`).get(NS) as { n: number }).n).toBe(before);
    expect(auditN("company_taxonomy.term.create", "Ocean Robotics")).toBe(1); // still only the earlier success
  });

  it("relabel: label edits, stored value is immutable", async () => {
    mount();
    await rows();
    const v = "Ocean Robotics";
    fireEvent.click(screen.getByTestId(`button-company-sector-relabel-${tid(v)}`));
    fireEvent.change(screen.getByTestId(`input-company-sector-relabel-${tid(v)}`), { target: { value: "Marine Robotics" } });
    fireEvent.click(screen.getByTestId(`button-company-sector-relabel-save-${tid(v)}`));
    await waitFor(() => expect(dbRow(v)?.label).toBe("Marine Robotics"));
    expect(dbRow(v)?.value).toBe(v);                                  // immutable stored value
    expect(dbRow("Marine Robotics")).toBeUndefined();                 // no rename
    await waitFor(() => expect(within(screen.getByTestId(`row-company-sector-${tid(v)}`)).getByTestId(/^text-company-sector-label-/).textContent?.trim()).toBe("Marine Robotics"));
    expect(auditN("company_taxonomy.term.relabel", v)).toBe(1);
  });

  it("retire keeps the row and flips the badge; reactivate restores; both audited and both invalidate", async () => {
    const inv = vi.spyOn(queryClient, "invalidateQueries");
    mount();
    await rows();
    const v = "Ocean Robotics";
    fireEvent.click(screen.getByTestId(`button-company-sector-toggle-${tid(v)}`));
    await waitFor(() => expect(dbRow(v)?.active).toBe(0));
    await waitFor(() => expect(within(screen.getByTestId(`row-company-sector-${tid(v)}`)).getByText(/retired/i)).toBeTruthy());
    expect(auditN("company_taxonomy.term.retire", v)).toBe(1);
    fireEvent.click(screen.getByTestId(`button-company-sector-toggle-${tid(v)}`));
    await waitFor(() => expect(dbRow(v)?.active).toBe(1));
    await waitFor(() => expect(within(screen.getByTestId(`row-company-sector-${tid(v)}`)).queryByText(/retired/i)).toBeNull());
    expect(auditN("company_taxonomy.term.reactivate", v)).toBe(1);
    const publicInvalidations = inv.mock.calls.filter(([o]) => JSON.stringify((o as { queryKey: unknown }).queryKey) === JSON.stringify(companyTaxonomyKey(NS))).length;
    expect(publicInvalidations).toBeGreaterThanOrEqual(2);
    inv.mockRestore();
  });

  it("is a separate surface from partner classification: different route + only taxonomy_terms created", () => {
    const appSrc = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../../../App.tsx"), "utf8") as string;
    expect(appSrc).toMatch(/path="\/admin\/company-taxonomy"/);
    expect(appSrc).toMatch(/path="\/admin\/partner-taxonomy"/);
    const shell = require("node:fs").readFileSync(require("node:path").resolve(__dirname, "../../../components/AppShell.tsx"), "utf8") as string;
    expect(shell).toContain("nav-admin-company-taxonomy");
    expect(shell).toContain("nav-admin-partner-taxonomy");
    /* The Wave D bootstrap creates ONLY taxonomy_terms; partner classification's
       own tables are neither created nor touched by this page (server-side
       separation is covered in slide13b_wave_d_company_taxonomy.test.ts). */
    const created = rawDb().prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%taxonomy%'`).all() as Array<{ name: string }>;
    expect(created.map((r) => r.name)).toEqual(["taxonomy_terms"]);
  });
});
