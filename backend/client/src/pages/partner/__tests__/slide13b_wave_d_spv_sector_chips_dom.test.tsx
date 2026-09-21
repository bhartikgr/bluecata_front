/**
 * slide13b WAVE D — PartnerSpvEngine mandate step: sector chips come from the
 * DATABASE (real store + routes over an in-process express app; in-memory
 * SQLite), never from a static list. Positive and negative poles:
 *
 *   • LOADING: chips disabled + "Loading sectors…" copy; a click changes nothing
 *   • ERROR (cold): the error copy is shown and NO chips are offered
 *   • ERROR (after a good read): the last list stays visible but fully locked;
 *     a value the draft already holds is KEPT (a failed read cannot drop or add)
 *   • OK: 45 chips, alphabetical by label, data-kind="active"; toggle works
 *   • RETIRED-HELD: a chip the GP selected stays when an admin retires the term
 *     and the consumer refetches through the real invalidation — data-kind
 *     becomes "retired", the value is preserved, nothing else appears
 *
 * `apiRequest` is bridged: taxonomy URLs → supertest against the real routes
 * (with a switchable failure/hang mode); the SPV list → `{ spvs: [] }` like
 * the existing wizard tests.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import express, { type Express } from "express";
import request from "supertest";

import { rawDb } from "../../../../../server/db/connection";
import { registerCompanyTaxonomyRoutes } from "../../../../../server/companyTaxonomyRoutes";
import { COLLECTIVE_SECTORS_45 } from "@shared/schema";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/sseClient", () => ({ useCollectiveStream: () => undefined }));
vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true, error: null,
    identity: {
      partnerId: "ac_consortium_partner_slide13b_d", tier: "builder", subRole: "managing_partner",
      identity: { userId: "u_slide13b_d", email: "d@example.com", name: "Wave D Partner" },
    },
  }),
}));
vi.mock("@/components/partner/PartnerShell", async () => {
  const actual = await vi.importActual<typeof import("@/components/partner/PartnerShell")>("@/components/partner/PartnerShell");
  return { ...actual, PartnerShell: ({ children }: { children: ReactNode }) => <div>{children}</div> };
});

let app: Express;
let taxonomyMode: "ok" | "fail" | "hang" = "ok";

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  const json = (status: number, body: unknown) =>
    ({ ok: status < 400, status, statusText: String(status), json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;
  return {
    ...actual,
    apiRequest: async (method: string, url: string, body?: unknown) => {
      if (url.includes("/company-taxonomy/")) {
        if (taxonomyMode === "hang") return new Promise<Response>(() => { /* never resolves */ });
        if (taxonomyMode === "fail") return json(503, { ok: false, error: "TAXONOMY_UNAVAILABLE", message: "taxonomy unavailable" });
        const m = method.toLowerCase() as "get" | "post";
        let req = request(app)[m](url).set("x-user-id", "u_admin");
        if (body !== undefined) req = req.send(body as object);
        const r = await req;
        return json(r.status, r.body);
      }
      return json(method === "GET" ? 200 : 201, method === "GET" ? { spvs: [] } : { spv: { id: "spv_d" } });
    },
  };
});

import { queryClient } from "@/lib/queryClient";
import { invalidateCompanyTaxonomy, COMPANY_TAXONOMY_LOADING_COPY, COMPANY_TAXONOMY_ERROR_COPY } from "@/lib/companyTaxonomy";
import PartnerSpvEngine from "../PartnerSpvEngine";

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerCompanyTaxonomyRoutes(app);
});
afterEach(() => { cleanup(); taxonomyMode = "ok"; });

const click = (id: string) => fireEvent.click(screen.getByTestId(id));
const set = (id: string, value: string) => fireEvent.change(screen.getByTestId(id), { target: { value } });
function openMandateStep() {
  queryClient.clear();
  render(<QueryClientProvider client={queryClient}><PartnerSpvEngine /></QueryClientProvider>);
  click("spv-engine-new");
  set("spv-w-name", "Wave D Vehicle");
  click("spv-wizard-step-tab-1");
  return screen.getByTestId("spv-w-sectors");
}
const chips = (root: HTMLElement) => within(root).queryAllByTestId(/^spv-w-sector-/) as HTMLButtonElement[];
const chip = (v: string) => screen.getByTestId(`spv-w-sector-${v}`) as HTMLButtonElement;
const isSelected = (b: HTMLButtonElement) => b.style.background !== "";

describe("slide13b WAVE D · SPV mandate sector chips are DB-driven", () => {
  it("LOADING: loading copy shown, chips disabled, a click cannot change the draft", async () => {
    taxonomyMode = "hang";
    const root = openMandateStep();
    expect(within(root).getByTestId("spv-w-sectors-loading").textContent).toBe(COMPANY_TAXONOMY_LOADING_COPY);
    expect(root.getAttribute("aria-busy")).toBe("true");
    expect(chips(root)).toHaveLength(0); // nothing offered from any static list
    expect(screen.queryByTestId("spv-w-sectors-error")).toBeNull();
  });

  it("ERROR: error copy shown, NO chips offered, nothing selectable", async () => {
    taxonomyMode = "fail";
    const root = openMandateStep();
    await waitFor(() => expect(screen.getByTestId("spv-w-sectors-error")).toBeTruthy());
    expect(screen.getByTestId("spv-w-sectors-error").textContent).toBe(COMPANY_TAXONOMY_ERROR_COPY);
    expect(screen.getByTestId("spv-w-sectors-error").getAttribute("role")).toBe("alert");
    expect(chips(root)).toHaveLength(0);
    expect(screen.queryByTestId("spv-w-sectors-loading")).toBeNull();
  });

  it("OK: exactly the DB's active terms as chips, alphabetical by label, all data-kind=active, toggle selects", async () => {
    const root = openMandateStep();
    await waitFor(() => expect(chips(root).length).toBe(45));
    const active = rawDb().prepare(`SELECT value, label FROM taxonomy_terms WHERE namespace='company_sector' AND active=1 ORDER BY label COLLATE NOCASE, value`).all() as Array<{ value: string; label: string }>;
    expect(chips(root).map((b) => b.textContent)).toEqual(active.map((t) => t.label));
    expect(new Set(chips(root).map((b) => b.getAttribute("data-kind")))).toEqual(new Set(["active"]));
    expect(active.map((t) => t.value).sort()).toEqual([...COLLECTIVE_SECTORS_45].sort());
    expect(chips(root).map((b) => b.textContent)).not.toEqual(COLLECTIVE_SECTORS_45); // not seed order
    expect(chips(root).every((b) => !b.disabled)).toBe(true);
    fireEvent.click(chip("Energy"));
    await waitFor(() => expect(isSelected(chip("Energy"))).toBe(true));
    fireEvent.click(chip("Energy"));
    await waitFor(() => expect(isSelected(chip("Energy"))).toBe(false));
  });

  it("RETIRED-HELD: a selected sector survives the admin retiring it — kept as data-kind=retired after the real invalidation refetch; a later ERROR keeps it too", async () => {
    const root = openMandateStep();
    await waitFor(() => expect(chips(root).length).toBe(45));
    fireEvent.click(chip("Fintech"));
    await waitFor(() => expect(isSelected(chip("Fintech"))).toBe(true));

    // Admin retires Fintech through the REAL route (DB row kept, active=0) …
    const r = await request(app).post(`/api/admin/company-taxonomy/company_sector/terms/retire`).set("x-user-id", "u_admin").send({ value: "Fintech" });
    expect(r.status).toBe(200);
    // … and the consumer refetches through the real invalidation path.
    await invalidateCompanyTaxonomy();
    await waitFor(() => expect(chip("Fintech").getAttribute("data-kind")).toBe("retired"));
    expect(isSelected(chip("Fintech"))).toBe(true);               // value preserved
    expect(chips(root)).toHaveLength(45);                          // 44 active + 1 held retired, nothing else
    expect(chips(root).filter((b) => b.getAttribute("data-kind") === "active")).toHaveLength(44);
    expect(chip("Fintech").title).toMatch(/Retired sector/);

    // A read failure AFTER selection: the held chip stays, is locked, nothing else is offered.
    taxonomyMode = "fail";
    await queryClient.refetchQueries({ queryKey: ["/api/company-taxonomy", "company_sector"] });
    await waitFor(() => expect(screen.getByTestId("spv-w-sectors-error")).toBeTruthy());
    // react-query keeps the last good list alongside the error: the chips stay
    // visible but EVERY chip is locked, the held value is still selected, and a
    // click can neither drop nor add a value.
    expect(screen.getByTestId("spv-w-sectors-error").textContent).toBe(COMPANY_TAXONOMY_ERROR_COPY);
    await waitFor(() => expect(chips(root).every((b) => b.disabled)).toBe(true));
    expect(chips(root)).toHaveLength(45);
    expect(isSelected(chip("Fintech"))).toBe(true);
    fireEvent.click(chip("Fintech"));
    expect(isSelected(chip("Fintech"))).toBe(true);               // locked: cannot be dropped on error
    fireEvent.click(chip("Energy"));
    expect(isSelected(chip("Energy"))).toBe(false);               // locked: cannot be added on error

    // restore DB state for other files (in-memory DB is per-process, but keep it honest)
    await request(app).post(`/api/admin/company-taxonomy/company_sector/terms/reactivate`).set("x-user-id", "u_admin").send({ value: "Fintech" });
  });
});
