/**
 * slide13b WAVE D — ApplyToCollective step 2 sector chips are DB-driven (real
 * taxonomy store + routes over in-process express; in-memory SQLite).
 *
 *   • LOADING / ERROR poles (copy, locked chips, nothing offered from a static list)
 *   • OK: the DB's active terms, alphabetical, data-kind=active
 *   • RETIRED-HELD: a selected sector survives the admin retiring it (data-kind=retired)
 *   • CATALOG > 45 (parent finding): the schema caps `sectors` at 45 SELECTED —
 *     with 47 catalog terms the applicant sees ALL 47 chips, can select 45, the
 *     46th click is refused with clear feedback, deselecting still works, and
 *     the schema itself still rejects 46 (the policy is preserved, not raised).
 *
 * Eligibility is mocked so the wizard can reach step 2; everything about
 * sectors is real.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import express, { type Express } from "express";
import request from "supertest";

import { rawDb } from "../../../../../server/db/connection";
import { registerCompanyTaxonomyRoutes } from "../../../../../server/companyTaxonomyRoutes";
import { createTaxonomyTerm } from "../../../../../server/companyTaxonomyStore";
import { COLLECTIVE_SECTORS_45, collectiveApplicationSchema, ACCREDITATION_JURISDICTIONS } from "@shared/schema";

/** A schema-valid application; only `sectors` is varied in the cap probe. */
const VALID_APP = {
  thesis: "Early-stage B2B software across North America and Europe.",
  minCheckUsd: 10_000, maxCheckUsd: 50_000,
  sectors: ["Energy"], stages: ["Seed"], geoFocus: ["North America"],
  memberTier: "silver", referralCode: "",
  passportFilename: "passport.pdf", proofOfAddressFilename: "address.pdf",
  jurisdiction: ACCREDITATION_JURISDICTIONS[0], accreditationDeclaration: "I am accredited.",
  paymentMethod: "invoice", cardholderName: "",
};

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/entitlement", () => ({ useEntitlement: () => ({ data: null, isLoading: false }) }));
vi.mock("@/lib/investor/investorSpine", () => ({ useInvestorSpine: () => ({ eligibilitySignals: { eligible: true } }) }));
vi.mock("@/components/AppShell", () => ({
  PageHeader: ({ title }: { title?: string }) => <h1>{title}</h1>,
  PageBody: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

let app: Express;
let taxonomyMode: "ok" | "fail" | "hang" = "ok";
const json = (status: number, body: unknown) =>
  ({ ok: status < 400, status, statusText: String(status), json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async (method: string, url: string, body?: unknown) => {
      if (url.includes("/company-taxonomy/")) {
        if (taxonomyMode === "hang") return new Promise<Response>(() => { /* never */ });
        if (taxonomyMode === "fail") return json(503, { ok: false, error: "TAXONOMY_UNAVAILABLE", message: "taxonomy unavailable" });
        const m = method.toLowerCase() as "get" | "post";
        let req = request(app)[m](url).set("x-user-id", "u_admin");
        if (body !== undefined) req = req.send(body as object);
        const r = await req;
        return json(r.status, r.body);
      }
      if (url.includes("/collective/applications/mine")) return json(404, { ok: false });
      if (url.includes("/collective/waitlist/mine")) return json(200, { items: [], count: 0 });
      return json(200, {});
    },
  };
});

import { queryClient } from "@/lib/queryClient";
import { invalidateCompanyTaxonomy, COMPANY_TAXONOMY_LOADING_COPY, COMPANY_TAXONOMY_ERROR_COPY } from "@/lib/companyTaxonomy";
import ApplyToCollective from "../ApplyToCollective";

beforeAll(() => {
  app = express();
  app.use(express.json());
  registerCompanyTaxonomyRoutes(app);
  // Default-queryFn reads (eligibility) go through fetch; answer them here.
  (globalThis as { fetch: unknown }).fetch = async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/api/collective/eligibility")) return json(200, { eligible: true, passes: {}, reasons: [], collectiveStatus: "none" });
    return json(200, {});
  };
});
afterEach(() => { cleanup(); taxonomyMode = "ok"; });

const tid = (v: string) => `chip-sector-${v.replace(/\W/g, "_")}`;
const chip = (v: string) => screen.getByTestId(tid(v)) as HTMLButtonElement;
const isSelected = (b: HTMLButtonElement) => b.className.includes("text-white");
const chips = () => within(screen.getByTestId("chips-sectors")).queryAllByTestId(/^chip-sector-/) as HTMLButtonElement[];

async function openStep2() {
  queryClient.clear();
  render(<QueryClientProvider client={queryClient}><ApplyToCollective /></QueryClientProvider>);
  await waitFor(() => expect(screen.getByTestId("button-next")).toBeTruthy());
  fireEvent.click(screen.getByTestId("button-next"));
  await waitFor(() => expect(screen.getByTestId("chips-sectors")).toBeTruthy());
}
const sectorsLabel = () => screen.getByText(/^Sectors \(/).textContent ?? "";

describe("slide13b WAVE D · Apply to Collective sector chips are DB-driven", () => {
  it("LOADING: loading copy, no chips from any static list", async () => {
    taxonomyMode = "hang";
    await openStep2();
    expect(screen.getByTestId("chips-sectors-loading").textContent).toBe(COMPANY_TAXONOMY_LOADING_COPY);
    expect(chips()).toHaveLength(0);
  });

  it("ERROR: error copy (role=alert), no chips offered", async () => {
    taxonomyMode = "fail";
    await openStep2();
    await waitFor(() => expect(screen.getByTestId("chips-sectors-error")).toBeTruthy());
    expect(screen.getByTestId("chips-sectors-error").textContent).toBe(COMPANY_TAXONOMY_ERROR_COPY);
    expect(chips()).toHaveLength(0);
  });

  it("OK: the DB's active terms, alphabetical by label, kind=active; label keeps 'Sectors (0 / 45)' plus the cap hint", async () => {
    await openStep2();
    await waitFor(() => expect(chips().length).toBe(45));
    const active = rawDb().prepare(`SELECT label FROM taxonomy_terms WHERE namespace='company_sector' AND active=1 ORDER BY label COLLATE NOCASE, value`).all() as Array<{ label: string }>;
    expect(chips().map((b) => b.textContent)).toEqual(active.map((t) => t.label));
    expect(chips().map((b) => b.textContent)).not.toEqual([...COLLECTIVE_SECTORS_45]);
    expect(new Set(chips().map((b) => b.getAttribute("data-kind")))).toEqual(new Set(["active"]));
    expect(sectorsLabel()).toBe("Sectors (0 / 45)");
    expect(screen.getByTestId("chips-sectors-cap-hint").textContent).toBe("Select up to 45 — the list may offer more.");
    fireEvent.click(chip("Energy"));
    await waitFor(() => expect(isSelected(chip("Energy"))).toBe(true));
    expect(sectorsLabel()).toBe("Sectors (1 / 45)");
  });

  it("RETIRED-HELD: a selected sector survives the admin retiring it — kept, kind=retired, still selected", async () => {
    await openStep2();
    await waitFor(() => expect(chips().length).toBe(45));
    fireEvent.click(chip("Fintech"));
    await waitFor(() => expect(isSelected(chip("Fintech"))).toBe(true));
    expect((await request(app).post(`/api/admin/company-taxonomy/company_sector/terms/retire`).set("x-user-id", "u_admin").send({ value: "Fintech" })).status).toBe(200);
    await invalidateCompanyTaxonomy();
    await waitFor(() => expect(chip("Fintech").getAttribute("data-kind")).toBe("retired"));
    expect(isSelected(chip("Fintech"))).toBe(true);
    expect(chips().filter((b) => b.getAttribute("data-kind") === "active")).toHaveLength(44);
    expect(chip("Fintech").title).toMatch(/Retired sector/);
    await request(app).post(`/api/admin/company-taxonomy/company_sector/terms/reactivate`).set("x-user-id", "u_admin").send({ value: "Fintech" });
  });

  it("CATALOG 47 > CAP 45: all 47 chips visible; 45 selectable; the 46th is refused with feedback; deselect still works; schema still rejects 46", async () => {
    createTaxonomyTerm("company_sector", { value: "Wave D Extra One" }, { actor: "u_admin" });
    createTaxonomyTerm("company_sector", { value: "Wave D Extra Two" }, { actor: "u_admin" });
    await openStep2();
    await waitFor(() => expect(chips().length).toBe(47));
    const values = chips().map((b) => b.getAttribute("data-testid")!);
    for (const t of values.slice(0, 45)) fireEvent.click(screen.getByTestId(t));
    await waitFor(() => expect(sectorsLabel()).toBe("Sectors (45 / 45)"));
    expect(screen.queryByTestId("chips-sectors-max")).toBeNull();

    // 46th click: refused, with feedback, count unchanged, chip NOT selected
    fireEvent.click(screen.getByTestId(values[45]));
    await waitFor(() => expect(screen.getByTestId("chips-sectors-max")).toBeTruthy());
    expect(screen.getByTestId("chips-sectors-max").textContent).toBe("Maximum of 45 sectors selected — deselect one to choose another.");
    expect(screen.getByTestId("chips-sectors-max").getAttribute("role")).toBe("alert");
    expect(sectorsLabel()).toBe("Sectors (45 / 45)");
    expect(isSelected(screen.getByTestId(values[45]) as HTMLButtonElement)).toBe(false);
    expect((screen.getByTestId(values[45]) as HTMLButtonElement).disabled).toBe(false); // still visible & focusable, not hidden

    // deselect one → feedback clears → the previously refused chip can be chosen
    fireEvent.click(screen.getByTestId(values[0]));
    await waitFor(() => expect(sectorsLabel()).toBe("Sectors (44 / 45)"));
    expect(screen.queryByTestId("chips-sectors-max")).toBeNull();
    fireEvent.click(screen.getByTestId(values[45]));
    await waitFor(() => expect(isSelected(screen.getByTestId(values[45]) as HTMLButtonElement)).toBe(true));
    expect(sectorsLabel()).toBe("Sectors (45 / 45)");

    // The policy itself is unchanged: the shared schema still rejects 46 selected sectors.
    const base = { ...VALID_APP };
    const parse = (n: number) => collectiveApplicationSchema.safeParse({ ...base, sectors: Array.from({ length: n }, (_, i) => `s${i}`) });
    expect(parse(45).success).toBe(true);
    expect(parse(46).success).toBe(false);
  });
});
