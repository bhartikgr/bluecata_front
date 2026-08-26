/**
 * WAVE 159 · R126.2 — A SCREEN THAT CLAIMS A PROTECTION WHICH DOES NOT RUN.
 *
 * `SpvLaunchGate.tsx` rendered, whenever the stored mode was `enforced` (which is
 * the DEFAULT, and live has no `spv.launch_gate*` config rows):
 *
 *   "Right now the launch is REFUSED when a company in it is not a current member."
 *   "Strict refuses every SPV and fund create for any company with no membership…"
 *
 * The reviewer proved the gate is UNWIRED — `grep -c spvLaunchGateGuard
 * server/spvEngineRoutes.ts server/partnerRoutes.ts` = 0/0 and no importer of
 * `enforceLaunchGate` anywhere — so nothing is refused. The owner's first view of
 * this screen asserted a protection he does not have.
 *
 * R126.2 requires the screen to say plainly that the check is BUILT BUT NOT YET
 * CONNECTED, **before it says anything about modes**, and to state every refusal
 * claim conditionally.
 *
 * Assertions are on RENDERED DOM (jsdom), not source text, except the two
 * comment-free source checks that pin the wiring itself (which is what makes the
 * disclosure true) — a docblock is never evidence, so comments are stripped.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "fs";
import { join } from "path";
import { RoleProvider } from "@/lib/role";
import SpvLaunchGate from "../SpvLaunchGate";

const apiRequestMock = vi.fn();
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return { ...actual, apiRequest: (...a: unknown[]) => apiRequestMock(...a) };
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    statusText: "200",
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

/** The page reads its two GETs through react-query's DEFAULT queryFn (the keys
 *  are the URLs). The test supplies that queryFn so the render exercises the real
 *  component against a real payload shape rather than a stub of the component. */
function wrap(ui: React.ReactElement, mode: "enforced" | "warn" = "enforced") {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => {
          const url = String(queryKey[0] ?? "");
          if (url.includes("/settings")) {
            return {
              ok: true,
              mode,
              noCompanyPolicy: "require_company",
              freezeEnabled: mode === "enforced",
            };
          }
          return { ok: true, overrides: [], total: 0 };
        },
      },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <RoleProvider>{ui}</RoleProvider>
    </QueryClientProvider>,
  );
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}
const ROOT = process.cwd();
const SERVER = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

beforeEach(() => {
  apiRequestMock.mockReset();
  /* The shipping default: mode `enforced`, which is precisely the state the
     reviewer found overstated. */
  apiRequestMock.mockImplementation((_m: string, url: string) => {
    if (String(url).includes("/settings")) {
      return Promise.resolve(
        jsonResponse({ ok: true, mode: "enforced", noCompanyPolicy: "require_company", freezeEnabled: true }),
      );
    }
    return Promise.resolve(jsonResponse({ ok: true, overrides: [] }));
  });
});
afterEach(() => cleanup());

describe("W159 · B — the launch-gate screen discloses that the check is not connected", () => {
  it("B1 — the NOT-CONNECTED notice renders, and says no SPV or fund create is being refused", async () => {
    wrap(<SpvLaunchGate />);
    const notice = await waitFor(() => screen.getByTestId("text-launch-gate-not-connected"));
    const text = notice.textContent ?? "";
    expect(text).toMatch(/not (yet )?connected/i);
    expect(text).toMatch(/SPV/);
    expect(text).toMatch(/refus/i);
    /* R77 — plain language, no raw codes on screen. */
    expect(text).not.toMatch(/enforceLaunchGate|spvLaunchGateGuard|SPV_COMPANY_MEMBERSHIP_REQUIRED/);
  });

  it("B2 — the notice comes BEFORE any mode language in the document", async () => {
    wrap(<SpvLaunchGate />);
    await waitFor(() => screen.getByTestId("text-launch-gate-not-connected"));
    const notice = screen.getByTestId("text-launch-gate-not-connected");
    const mode = screen.getByTestId("text-launch-gate-mode");
    /* DOCUMENT_POSITION_FOLLOWING (4) means `mode` comes after `notice`. */
    expect(notice.compareDocumentPosition(mode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("B3 — no present-tense refusal claim survives anywhere in the rendered screen", async () => {
    wrap(<SpvLaunchGate />);
    await waitFor(() => {
      expect(screen.getByTestId("text-launch-gate-mode").textContent ?? "").not.toMatch(
        /Reading the setting/,
      );
    });
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/Right now the launch is REFUSED/);
    expect(body).not.toMatch(/Strict refuses every SPV/);
    /* The mode is still reported — conditionally. */
    const mode = screen.getByTestId("text-launch-gate-mode").textContent ?? "";
    expect(mode).toMatch(/would/i);
    expect(mode).toMatch(/strict/i);
  });

  it("B4 — UPPER POLE: the mode is still read and reported, and `warn` still reads differently", async () => {
    wrap(<SpvLaunchGate />, "warn");
    await waitFor(() => {
      const mode = screen.getByTestId("text-launch-gate-mode").textContent ?? "";
      expect(mode).toMatch(/warning/i);
    });
    /* The disclosure is not mode-dependent: it is true in both modes. */
    expect(screen.getByTestId("text-launch-gate-not-connected")).toBeTruthy();
  });

  it("B5 — the disclosure is TRUE: the gate is still unwired, and this wave did not wire it", () => {
    const spv = stripComments(SERVER("server/spvEngineRoutes.ts"));
    const partner = stripComments(SERVER("server/partnerRoutes.ts"));
    expect(spv).not.toMatch(/spvLaunchGateGuard|enforceLaunchGate/);
    expect(partner).not.toMatch(/spvLaunchGateGuard|enforceLaunchGate/);
  });

  it("B6 — the default mode value was NOT changed by this wave", () => {
    const gate = stripComments(SERVER("server/lib/spvEligibilityGate.ts"));
    /* R123 forbids shipping `enforced` wired; this wave neither wires it nor
       silently flips the recorded default. */
    expect(gate).toMatch(/enforced/);
  });
});
