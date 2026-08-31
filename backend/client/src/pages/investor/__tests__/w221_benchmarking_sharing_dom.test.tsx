/**
 * WAVE 221 — RENDERED-DOM PROOF ON THE REAL INVESTOR SETTINGS PAGE, plus the
 * truthfulness proof and the founder-control-untouched proof.
 *
 * R137.1: a claim is only verified when the MOUNTED component is verified; a passing
 * store test is not evidence that a user sees anything. So this file mounts the
 * shipped `client/src/pages/investor/Settings.tsx` — not a stand-in, not a copy of
 * its JSX — and drives it against the REAL wave-221 routes over supertest. Only the
 * transport is in-process.
 *
 * THE THREE THINGS THIS FILE HAS TO SETTLE
 *
 * 1. DEFAULT OFF, IN THE DOM, ON A FRESH ACCOUNT (§221.6). Asserted on the rendered
 *    switch's `aria-checked`, not on a variable in the test.
 *
 * 2. THE COPY DOES NOT MISSTATE THE PLATFORM'S OWN BEHAVIOUR (§221.6 truthfulness
 *    proof, error class E2). The platform does NOT delete or withdraw figures already
 *    published, so the rendered text must not claim it does. This is asserted as an
 *    ABSENCE — and an absence assertion is worthless unless the thing it searches is
 *    proved non-empty first, so the rendered text is proved non-empty before any
 *    `not.toContain` runs. No compliance claim either: §221.7 forbids presenting the
 *    opt-out as satisfying GDPR.
 *
 * 3. THE FOUNDER CONTROL IS UNTOUCHED (§221.7's named harm). Its file's sha256 is
 *    compared against the value recorded when wave 221 began, and its switch label is
 *    compared BYTE-FOR-BYTE against the spec's verbatim quotation. There is no
 *    `.trim()`, no whitespace collapse and no case fold inside those assertions,
 *    because a normalising call inside an equality assertion is how a proof goes
 *    inert while still reporting green.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import { rawDb } from "../../../../../server/db/connection";
import {
  wave221EnsureColumn,
  WAVE221_OPT_OUT_COLUMN,
} from "../../../../../server/lib/wave221BenchmarkingOptOut";
import {
  wave221SwitchLabel,
  wave221ConsequenceLine,
  wave221PlainStatement,
  wave221NoRetrospectionLine,
  wave221StateLine,
  wave221AllCopy,
  WAVE221_FORBIDDEN_CLAIM_SUBSTRINGS,
} from "@shared/wave221BenchmarkingOptOutCopy";

const VIEWER = "u_w221dom_investor";
const TENANT = "t_w221dom";

let app: Express;

vi.mock("../../../../../server/lib/authMiddleware", () => {
  const pass = (_req: Request, _res: Response, next: NextFunction) => next();
  return {
    requireAuth: pass, requireAdmin: pass, requireFounder: pass,
    requireAuthOrThrow: pass, requireAuthenticated: pass,
  };
});

/* The page's shell and toaster are not what this wave changed; stubbing them keeps
   the test about the switch. The Card/Switch primitives and Settings.tsx itself are
   the REAL ones. */
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children, ...rest }: { children: React.ReactNode }) => <div {...rest}>{children}</div>,
  PageHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useRealtimeSync", () => ({ useRealtimeSync: () => undefined }));

/* THE BRIDGE — real routes, in-process transport. */
async function call(method: string, url: string, body?: unknown) {
  let r = (request(app) as any)[method.toLowerCase()](url);
  if (body !== undefined) r = r.send(body as any);
  const res = await r;
  return res;
}

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async (method: string, url: string, body?: unknown) => {
      const res = await call(method, url, body);
      return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        statusText: String(res.status),
        text: async () => JSON.stringify(res.body),
        json: async () => res.body,
      } as unknown as Response;
    },
  };
});

import InvestorSettings from "../Settings";
/* The REAL wave-221 route module, mounted directly.
   WHY NOT `registerRoutes`: the production registrar pulls the whole server graph,
   including `server/lib/kycStorage.ts` → `@aws-sdk/s3-request-presigner`, which the
   client vitest environment cannot resolve. That registrar IS driven, and the
   registration of these exact routes inside it IS proved, by
   `server/__tests__/w221_benchmarking_opt_out.test.ts`, which calls
   `registerRoutes(server, app)` and reaches these paths over HTTP. This file's job is
   the RENDERED DOM, and the route code it renders against is the same module. That
   split is stated rather than glossed. */
import { registerWave221BenchmarkingOptOutRoutes } from "../../../../../server/wave221BenchmarkingOptOutRoutes";

function mount() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        /* Every useQuery in the mounted page resolves through the REAL routes. */
        queryFn: async ({ queryKey }) => {
          const res = await call("GET", String(queryKey[0]));
          return res.body;
        },
      },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <InvestorSettings />
    </QueryClientProvider>,
  );
}

beforeAll(async () => {
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as Request & { userContext?: unknown }).userContext = {
      userId: VIEWER, tenantId: TENANT, isAdmin: false,
    } as unknown as Request["userContext"];
    next();
  });
  registerWave221BenchmarkingOptOutRoutes(app);

  rawDb()
    .prepare(
      `INSERT OR IGNORE INTO users (id, tenant_id, email, name, role, is_demo)
       VALUES (?, ?, ?, 'Wave221 DOM Investor', 'investor', 0)`,
    )
    .run(VIEWER, TENANT, `${VIEWER}@w221.test`);
  wave221EnsureColumn("investor");
  /* A FRESH account: opted out, i.e. sharing OFF, which is the documented default. */
  rawDb()
    .prepare(`UPDATE users SET ${WAVE221_OPT_OUT_COLUMN} = ? WHERE id = ?`)
    .run("2026-05-02T00:00:00.000Z", VIEWER);
}, 180_000);

afterEach(() => cleanup());

describe("W221 · DOM — the real investor Settings page", () => {
  it("G1 the sharing block renders on the REAL page", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("w221-benchmarking-sharing")).toBeTruthy());
    expect(screen.getByTestId("w221-sharing-switch")).toBeTruthy();
    /* And the page it rendered inside really is the investor Settings page, not a
       fragment mounted on its own. */
    expect(screen.getByTestId("page-investor-settings")).toBeTruthy();
  });

  it("G2 DEFAULT OFF on a fresh account, asserted on the rendered control — including on FIRST PAINT", () => {
    mount();
    /* FIRST PAINT, before the query has resolved and with NO waitFor. This is the
       assertion that actually pins the fallback: once the server answer arrives the
       switch would read false anyway, so a test that only looks after resolution
       passes even if the un-resolved default were flipped to ON. Verified by
       disarming the fallback and watching this line go red. */
    const first = screen.getByTestId("w221-sharing-switch");
    expect(first.getAttribute("aria-checked")).toBe("false");
    expect(first.getAttribute("data-state")).toBe("unchecked");
  });

  it("G2b and it is still OFF after the server answer arrives", async () => {
    mount();
    const sw = await waitFor(() => screen.getByTestId("w221-sharing-switch"));
    /* radix Switch publishes its state as aria-checked / data-state. */
    await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("false"));
    expect(sw.getAttribute("data-state")).toBe("unchecked");
  });

  it("G3 the label, the consequence line, the plain statement and the state line all render", async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId("w221-label")).toBeTruthy());
    expect(screen.getByTestId("w221-label").textContent).toBe(wave221SwitchLabel("investor"));
    expect(screen.getByTestId("w221-consequence").textContent).toBe(wave221ConsequenceLine("investor"));
    expect(screen.getByTestId("w221-statement").textContent).toBe(wave221PlainStatement("investor"));
    expect(screen.getByTestId("w221-no-retrospection").textContent).toBe(wave221NoRetrospectionLine());
    expect(screen.getByTestId("w221-state").textContent).toBe(wave221StateLine(true));
  });

  it("G4 toggling in the DOM reaches the server and the RE-READ comes back ON", async () => {
    mount();
    const sw = await waitFor(() => screen.getByTestId("w221-sharing-switch"));
    await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("false"));
    fireEvent.click(sw);
    /* The switch flips only because the invalidated query RE-READ the server. */
    await waitFor(() =>
      expect(screen.getByTestId("w221-sharing-switch").getAttribute("aria-checked")).toBe("true"),
      { timeout: 5000 },
    );
    const after = await call("GET", "/api/investor/me/benchmarking-sharing");
    expect(after.body.sharingEnabled).toBe(true);
    expect(screen.getByTestId("w221-state").textContent).toBe(wave221StateLine(false));
  });
});

describe("W221 · truthfulness — the copy does not misstate platform behaviour", () => {
  it("H1 the rendered text is non-empty BEFORE any absence is asserted over it", async () => {
    mount();
    const block = await waitFor(() => screen.getByTestId("w221-benchmarking-sharing"));
    const text = block.textContent ?? "";
    /* Without this, every `not.toContain` below would pass against an empty string. */
    expect(text.length, "the sharing block rendered no text at all").toBeGreaterThan(200);
  });

  it("H2 no claim of retrospective removal, permanence, or GDPR compliance is rendered", async () => {
    mount();
    const block = await waitFor(() => screen.getByTestId("w221-benchmarking-sharing"));
    const text = block.textContent ?? "";
    expect(text.length).toBeGreaterThan(200);
    const lower = text.toLowerCase();
    for (const bad of WAVE221_FORBIDDEN_CLAIM_SUBSTRINGS) {
      expect(lower, `the rendered copy must not claim "${bad}"`).not.toContain(bad);
    }
  });

  it("H3 the copy DOES state the thing the platform actually does, in place of the claim it must not make", () => {
    /* The absence proved in H2 is only honest if something truthful stands in its
       place — otherwise the wave could have satisfied H2 by rendering nothing. */
    const line = wave221NoRetrospectionLine();
    expect(line).toContain("Switching off stops future use");
    expect(line).toContain("not withdrawn");
  });

  it("H4 every rendered string clears the 240-character looksHuman gate", () => {
    for (const s of [...wave221AllCopy("investor"), ...wave221AllCopy("partner")]) {
      expect(s.length, `"${s}" is ${s.length} chars`).toBeLessThan(240);
      expect(s.length).toBeGreaterThan(0);
    }
  });
});

describe("W221 · the founder control is untouched", () => {
  const FOUNDER_FILE = path.join(
    process.cwd(), "client", "src", "components", "founder", "MaPrivacyConsent.tsx",
  );
  /* Recorded from the working tree at the start of wave 221, before any edit. */
  const SHA_AT_WAVE_START =
    "c890fcec7f02a1c5f6b73735db4205a4ccfc541fae18022c4af3ccfbbc1833ef";

  it("I1 MaPrivacyConsent.tsx sha256 is unchanged by this wave", () => {
    const buf = fs.readFileSync(FOUNDER_FILE);
    const sha = crypto.createHash("sha256").update(buf).digest("hex");
    /* Hashed from the raw bytes. No decode, no newline normalisation, nothing that
       could make two different files hash the same. */
    expect(sha).toBe(SHA_AT_WAVE_START);
  });

  it("I2 the founder switch label is byte-verbatim the one the spec quotes", () => {
    const src = fs.readFileSync(FOUNDER_FILE, "utf8");
    /* The spec quotes the RENDERED label, which contains "M&A". The JSX SOURCE spells
       that as the HTML entity `M&amp;A`, so the source form is what a byte comparison
       against the file has to use. Both forms are pinned below so neither an entity
       change nor a wording change can slip through. */
    const SOURCE_VERBATIM =
      "Share my M&amp;A profile across the Collective for benchmarking and matchmaking? (default: chapter-only)";
    const SPEC_RENDERED =
      "Share my M&A profile across the Collective for benchmarking and matchmaking? (default: chapter-only)";
    /* Compared against the raw file text. No trim, no whitespace collapse. */
    expect(src.includes(SOURCE_VERBATIM), "the founder label has been altered").toBe(true);
    expect(SOURCE_VERBATIM.replace("&amp;", "&")).toBe(SPEC_RENDERED);
  });

  it("I3 wave 221's own copy never reuses the founder label verbatim", () => {
    const VERBATIM =
      "Share my M&A profile across the Collective for benchmarking and matchmaking? (default: chapter-only)";
    for (const s of [...wave221AllCopy("investor"), ...wave221AllCopy("partner")]) {
      expect(s).not.toBe(VERBATIM);
    }
  });

  it("I4 the founder default is still the narrower option in its own migration header", () => {
    const mig = fs.readFileSync(
      path.join(process.cwd(), "migrations", "0059_v25_44_ma_privacy_json.sql"), "utf8",
    );
    expect(mig).toContain("DEFAULT — opt-OUT of Collective-wide aggregation:");
    expect(mig).toContain('"shareWithCollective":false');
  });
});
