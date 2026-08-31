/**
 * WAVE 118 · FINDING 3, AS CORRECTED BY RULING R92 — A TARGET CLOSE DATE IN THE
 * PAST IS **ACCEPTED AND WARNED**, NEVER BLOCKED.
 *
 * ── WHY THIS FILE WAS REWRITTEN ─────────────────────────────────────────────
 * Wave 118 first implemented this guard as a REFUSAL that disabled Continue and
 * Create, and this file asserted that refusal. The wave then flagged, correctly,
 * that it contradicted `shared/roundTargetCloseRule.ts` — the ratified WAVE 83 /
 * Shadie V6 1a rule. The lead developer settled it in **ruling R92**: the
 * ratified rule wins, `closeDateInPast` was removed from `scheduleInvalid`, and
 * the field warns in amber instead of refusing in red.
 *
 * The two reasons, recorded here so nobody re-adds the block:
 *  1. A past target close is NOT a contradiction — it is a fact about a round
 *     that already happened, and a founder is entitled to record the true
 *     history of his company. (A past MATURITY date is still refused: a note
 *     already past due is a contradiction inside the instrument itself.)
 *  2. The blocking copy told the founder to "create it with a future target
 *     close and correct the date afterwards in Edit terms" — i.e. to save a date
 *     he knew to be false, putting a fabricated close date into the audit trail
 *     of a real fundraise.
 *
 * What was genuinely wrong on the live site was the SILENCE, not the acceptance.
 * The source lock `v25_53_round_mgmt_client.test.ts` still passes: it asserts the
 * guard EXISTS (`const dayInPast`), and it does — it warns rather than blocks.
 *
 * ── WHAT THIS TEST IS RESPONSIBLE FOR (five poles) ──────────────────────────
 *  · WARNING POLE   — a close date before today prints the ONE shared sentence
 *                     from `roundTargetCloseRule`, so the founder cannot meet a
 *                     different rule depending on the screen he is on.
 *  · REACH POLE     — the create POST **IS** issued with the past date. This is
 *                     the pole that proves acceptance is real and not decoration,
 *                     and it is the exact inverse of what this file asserted
 *                     before R92.
 *  · CLEARING POLE  — correcting the date to a future one clears the notice.
 *  · NEGATIVE POLE  — today and a future date are SILENT. A notice that fires on
 *                     legitimate input is worse than none, and "today" is the
 *                     boundary the string comparison has to get right.
 *  · TECHNIQUE POLE — string comparison, never `Date` arithmetic, and it must
 *                     NOT feed `scheduleInvalid`.
 *
 * The dates are computed from the clock, not typed as literals, so this test
 * cannot rot into a pass the way a hardcoded 2026 date would.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import RoundNew from "../RoundNew";
import { Toaster } from "@/components/ui/toaster";
import { RoleProvider } from "@/lib/role";
import { TooltipProvider } from "@/components/ui/tooltip";
import { w212SignOff } from "./_w212SignOff";

vi.mock("@/lib/useActiveCompany", () => ({
  useActiveCompanyId: () => "co_w118",
  useActiveCompany: () => ({
    isLoading: false,
    data: { company: { id: "co_w118", companyName: "W118 Co", billing: { plan: "founder_pro" } } },
  }),
}));

let createBodies: Array<Record<string, unknown>> = [];

function res(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    text: async () => text,
    json: async () => JSON.parse(text),
    clone: () => res(status, body),
  } as unknown as Response;
}

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      const method = (init?.method ?? "GET").toUpperCase();
      if (u === "/api/rounds" && method === "POST") {
        createBodies.push(JSON.parse(String(init?.body ?? "{}")));
        return res(200, { id: "rnd_w118" });
      }
      if (u.startsWith("/api/rounds/name-availability")) return res(200, { available: true });
      if (u.includes("/securities")) return res(200, []);
      if (u.includes("investor-crm")) return res(200, { contacts: [] });
      return res(200, {});
    }),
  );
}

function renderWizard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>
        <TooltipProvider>
          <RoundNew />
          <Toaster />
        </TooltipProvider>
      </RoleProvider>
    </QueryClientProvider>,
  );
}

/** `YYYY-MM-DD` for today shifted by whole days, built the same way the screen
 *  builds it: local calendar fields, never a UTC ISO slice, so this helper does
 *  not cross a timezone the way `toISOString().slice(0,10)` does. */
function isoDayOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Steps 1 → 2 → 3 of a priced preferred round, landing on the schedule step
 *  with the open date already far enough back that `dateRangeInvalid` (close <
 *  open, a DIFFERENT guard from wave 25.51) can never be what fires below. */
async function toSchedule() {
  fireEvent.change(await screen.findByTestId("input-round-name"), { target: { value: "W118 Series A" } });
  fireEvent.click(screen.getByTestId("round-category-priced"));
  fireEvent.click(await screen.findByTestId("instrument-preferred"));
  fireEvent.click(screen.getByTestId("button-next"));
  fireEvent.change(await screen.findByTestId("input-pre"), { target: { value: "30000000" } });
  fireEvent.change(screen.getByTestId("input-target"), { target: { value: "10000000" } });
  fireEvent.change(screen.getByTestId("input-shares"), { target: { value: "4000000" } });
  fireEvent.change(screen.getByTestId("input-fd-pre-money-shares"), { target: { value: "13000000" } });
  fireEvent.click(screen.getByTestId("button-next"));
  await screen.findByTestId("input-open");
  fireEvent.change(screen.getByTestId("input-open"), { target: { value: isoDayOffset(-400) } });
}

describe("WAVE 118 · FINDING 3 (per R92) — the past target-close-date NOTICE on the create wizard", () => {
  beforeEach(() => {
    createBodies = [];
    installFetch();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("W118-D3-01 · WARNING POLE — yesterday is warned with the ONE shared sentence, and Continue stays enabled", async () => {
    renderWizard();
    await toSchedule();
    fireEvent.change(screen.getByTestId("input-close"), { target: { value: isoDayOffset(-1) } });

    const notice = await screen.findByTestId("close-date-past-warning");
    expect((notice.textContent ?? "").trim().length).toBeGreaterThan(20);
    expect(notice.textContent ?? "").toMatch(/past/i);
    /* The sentence must be the SHARED one, not a second sentence written here.
       `roundTargetCloseRule` exists so the founder meets the same rule on the
       wizard, the Edit-terms modal, the create route and the terms route. */
    expect(notice.textContent ?? "").toMatch(/accepts it/i);
    /* R92: no refusal element, and the step is NOT gated. */
    expect(screen.queryByTestId("close-date-past")).toBeNull();
    expect((screen.getByTestId("button-next") as HTMLButtonElement).disabled).toBe(false);
  });

  it("W118-D3-02 · REACH POLE — the round IS created with the past date, because recording a closed round is legitimate", async () => {
    /* THE INVERSE OF WHAT THIS FILE ASSERTED BEFORE R92, and deliberately so.
       This is the pole that proves the date is genuinely accepted rather than
       merely un-refused on screen: the value must reach the server unchanged. */
    renderWizard();
    await toSchedule();
    const past = isoDayOffset(-30);
    fireEvent.change(screen.getByTestId("input-close"), { target: { value: past } });
    await screen.findByTestId("close-date-past-warning");

    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-investors");
    fireEvent.click(screen.getByTestId("button-next"));
    const w212Create = await screen.findByTestId("button-create");
    /* WAVE 212 — a founder signs before the control is live. */
    w212SignOff();
    fireEvent.click(w212Create);
    await waitFor(() => expect(createBodies.length).toBe(1));
    expect(createBodies[0].closeDate).toBe(past);
  });

  it("W118-D3-03 · CLEARING POLE — correcting the date to a future one removes the notice", async () => {
    renderWizard();
    await toSchedule();
    fireEvent.change(screen.getByTestId("input-close"), { target: { value: isoDayOffset(-1) } });
    await screen.findByTestId("close-date-past-warning");

    fireEvent.change(screen.getByTestId("input-close"), { target: { value: isoDayOffset(120) } });
    await waitFor(() => expect(screen.queryByTestId("close-date-past-warning")).toBeNull());
    expect((screen.getByTestId("button-next") as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByTestId("button-next"));
    await screen.findByTestId("step-investors");
    fireEvent.click(screen.getByTestId("button-next"));
    const w212Create = await screen.findByTestId("button-create");
    /* WAVE 212 — a founder signs before the control is live. */
    w212SignOff();
    fireEvent.click(w212Create);
    await waitFor(() => expect(createBodies.length).toBe(1));
    expect(createBodies[0].closeDate).toBe(isoDayOffset(120));
  });

  it("W118-D3-04 · NEGATIVE POLE — TODAY is silent, and so is a future date", async () => {
    renderWizard();
    await toSchedule();

    fireEvent.change(screen.getByTestId("input-close"), { target: { value: isoDayOffset(0) } });
    await waitFor(() => expect(screen.queryByTestId("close-date-past-warning")).toBeNull());
    expect((screen.getByTestId("button-next") as HTMLButtonElement).disabled).toBe(false);

    fireEvent.change(screen.getByTestId("input-close"), { target: { value: isoDayOffset(365) } });
    await waitFor(() => expect(screen.queryByTestId("close-date-past-warning")).toBeNull());
    expect((screen.getByTestId("button-next") as HTMLButtonElement).disabled).toBe(false);
  });

  it("W118-D3-05 · TECHNIQUE POLE — string comparison, and it must NOT feed scheduleInvalid", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(here, "../RoundNew.tsx"), "utf8");
    /* The v25.53 source lock asserts the NAME; this asserts the TECHNIQUE, which
       is what keeps a 21-July date from rendering as 20 July. */
    expect(src).toContain("const dayInPast");
    expect(src).toMatch(/const closeDateInPast = dayInPast\(form\.closeDate\)/);
    expect(src).not.toMatch(/dayInPast[\s\S]{0,400}getTime\(\)/);
    /* R92 — THE REGRESSION FENCE. `closeDateInPast` must never re-enter the
       expression that gates Continue and Create. This is the assertion that
       stops a future wave re-adding the block the ruling removed. */
    const schedule = src.match(/const scheduleInvalid =[\s\S]{0,300}?;/)?.[0] ?? "";
    expect(schedule.length).toBeGreaterThan(20);
    expect(schedule).not.toContain("closeDateInPast");
    /* And the shared rule must be the source of the sentence. */
    expect(src).toContain("@shared/roundTargetCloseRule");
    expect(src).toContain('data-testid="close-date-past-warning"');
  });
});
