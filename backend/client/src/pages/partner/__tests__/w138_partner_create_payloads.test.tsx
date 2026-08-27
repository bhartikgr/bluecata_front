/**
 * WAVE 138 — the two partner create paths must actually create.
 *
 * `POST /api/partner/me/spvs` and `POST /api/partner/me/funds` both returned 400
 * on every call because the client payloads did not match the server contracts
 * (see build_log/wave138/W138_PREFLIGHT.md §1-§2). The headline P0 had NO
 * regression test at all (Review F), so this file pins the CONTRACT, not the
 * fix: the required key set is READ OUT OF `server/partnerRoutes.ts` at test
 * time, so the test fails if EITHER side drifts again — the server adding a
 * required field is caught just as the client dropping one is.
 *
 * ANTI-VACUITY. Nothing here is `expect(true)` and nothing is a whole-file
 * substring match. Every pin either compares two independently-derived values
 * (server source vs. captured request body; server constant vs. rendered DOM
 * text) or asserts BOTH poles (associate disabled + managing partner enabled),
 * so a hardcoded outcome cannot satisfy it.
 */
import type { ReactNode } from "react";
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PartnerSpvs from "../PartnerSpvs";
import PartnerFunds from "../PartnerFunds";
import { attestationTextForType } from "@shared/spvAttestation"; /* WAVE 169 — the per-type resolver, pinned against the bytes extracted from source */

const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const ROUTES_SRC = fs.readFileSync(path.join(REPO_ROOT, "server/partnerRoutes.ts"), "utf8");
const SIGNOFF_STORE_SRC = fs.readFileSync(
  path.join(REPO_ROOT, "server/spvLaunchSignoffStore.ts"),
  "utf8",
);

/* ---------------------------------------------------------------------------
   Read the server's REAL requirement list out of its own source.
   --------------------------------------------------------------------------- */

/** The source text of one `app.post("<routePath>", …)` registration. */
function routeSource(routePath: string): string {
  const marker = `app.post(\n    "${routePath}",`;
  const start = ROUTES_SRC.indexOf(marker);
  if (start < 0) throw new Error(`route registration not found: ${routePath}`);
  const end = ROUTES_SRC.indexOf("\n  app.", start + marker.length);
  return ROUTES_SRC.slice(start, end < 0 ? undefined : end);
}

/**
 * Keys the route refuses without: the identifiers inside its FIRST
 * `if (!isString(…) || !isNumber(…) || !isISOCurrency(…))` guard, plus every
 * `body.signoff*` field it separately 400s on.
 */
function serverRequiredKeys(routePath: string): string[] {
  const src = routeSource(routePath);
  const guard = /if \(!is[A-Za-z]+\([\s\S]*?\)\) \{/.exec(src);
  if (!guard) throw new Error(`no validation guard found in ${routePath}`);
  const keys: string[] = [];
  const add = (k: string) => {
    if (keys.indexOf(k) < 0) keys.push(k);
  };
  for (const k of captureAll(guard[0], /is(?:String|Number|ISOCurrency)\((\w+)\)/g)) add(k);
  for (const k of captureAll(src, /body\.(signoff\w+)/g)) add(k);
  return keys;
}

/** Every group-1 capture of `re` in `text`, in order. */
function captureAll(text: string, re: RegExp): string[] {
  const out: string[] = [];
  const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  let m: RegExpExecArray | null = rx.exec(text);
  while (m) {
    out.push(m[1]);
    m = rx.exec(text);
  }
  return out;
}

/** The `const valid<Name> = [ … ] as const` enum the route accepts. */
function serverEnum(routePath: string, constName: string): string[] {
  const src = routeSource(routePath);
  const m = new RegExp(`const ${constName} = \\[([^\\]]+)\\]`).exec(src);
  if (!m) throw new Error(`enum ${constName} not found in ${routePath}`);
  return captureAll(m[1], /"([^"]+)"/g);
}

/**
 * The EXACT bytes the server records as `attestationText`
 * (`server/spvLaunchSignoffStore.ts:87` writes `ATTESTATION_TEXT_V1`), rebuilt
 * from source rather than imported, so this pin needs no server runtime (and no
 * db connection) and still fails on a one-character drift.
 *
 * The definition is resolved by FOLLOWING the signoff store's own export: if it
 * defines the constant locally we read that literal, and if it re-exports (as it
 * does since wave 138's de-duplication) we read the module it points at. Either
 * way the bytes are the ones that module records, and re-pointing the server at
 * a different text fails this test.
 */
function attestationTextFromSource(src: string, file: string): string {
  const local = src.indexOf("export const ATTESTATION_TEXT_V1 =");
  if (local >= 0) {
    const decl = src.slice(local, src.indexOf(";", local));
    const parts = captureAll(decl, /"([^"]*)"/g);
    if (parts.length === 0) throw new Error(`ATTESTATION_TEXT_V1 has no string parts in ${file}`);
    return parts.join("");
  }
  const reexport = /export \{[^}]*ATTESTATION_TEXT_V1[^}]*\} from "([^"]+)"/.exec(src);
  if (!reexport) throw new Error(`ATTESTATION_TEXT_V1 neither defined nor re-exported in ${file}`);
  const target = path.resolve(path.dirname(path.join(REPO_ROOT, file)), `${reexport[1]}.ts`);
  return attestationTextFromSource(fs.readFileSync(target, "utf8"), path.relative(REPO_ROOT, target));
}

function serverAttestationText(): string {
  return attestationTextFromSource(SIGNOFF_STORE_SRC, "server/spvLaunchSignoffStore.ts");
}

/* ---------------------------------------------------------------------------
   Harness (mirrors PartnerManagedFounders.createEngagement.test.tsx).
   --------------------------------------------------------------------------- */

function isDisabled(el: HTMLElement): boolean {
  return (el as HTMLButtonElement).disabled === true;
}

let subRole = "managing_partner";

vi.mock("@/components/partner/PartnerShell", () => ({
  PartnerShell: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PartnerEmptyState: ({ title }: { title?: string }) => <div data-testid="empty-state">{title}</div>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

vi.mock("wouter", () => ({
  Link: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/lib/partner/useRequirePartnerRole", () => ({
  useRequirePartnerRole: () => ({
    ready: true,
    error: null,
    identity: {
      partnerId: "p_w138",
      tier: "builder",
      subRole,
      identity: { userId: "u_w138", email: "w138@example.com", name: "W138 Partner" },
    },
  }),
}));

const sent: Array<{ method: string; url: string; body: Record<string, unknown> }> = [];

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async (method: string, url: string, body?: unknown) => {
      if (method !== "GET") sent.push({ method, url, body: (body ?? {}) as Record<string, unknown> });
      const payload =
        method === "GET"
          ? url.includes("/funds")
            ? { funds: [] }
            : { spvs: [] }
          : { spv: { id: "spv_w138" }, fund: { id: "fund_w138" } };
      return {
        ok: true,
        status: method === "GET" ? 200 : 201,
        statusText: "ok",
        text: async () => JSON.stringify(payload),
        json: async () => payload,
      } as unknown as Response;
    },
  };
});

function mount(node: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

function setValue(testid: string, value: string) {
  const el = screen.getByTestId(testid) as HTMLInputElement | HTMLSelectElement;
  fireEvent.change(el, { target: { value } });
}

beforeEach(() => {
  subRole = "managing_partner";
  sent.length = 0;
});
afterEach(() => cleanup());

/* ---------------------------------------------------------------------------
   PIN 1 — the SPV payload carries every key the server requires.
   --------------------------------------------------------------------------- */

describe("W138 pin 1 — SPV create payload satisfies the server contract", () => {
  it("sends every key server/partnerRoutes.ts requires, with the types it checks", async () => {
    const required = serverRequiredKeys("/api/partner/me/spvs");
    // Sanity on the extraction itself (not the fix): the guard really does name these.
    expect(required.sort()).toEqual(
      ["currency", "jurisdiction", "signoffAccepted", "signoffLegalName", "spvName", "status", "vintage"].sort(),
    );

    mount(<PartnerSpvs />);
    fireEvent.click(screen.getByTestId("partner-spvs-new-toggle"));
    setValue("partner-spv-name", "W138 Launch SPV");
    setValue("partner-spv-signoff-legalname", "Ada Managing Partner");
    fireEvent.click(screen.getByTestId("partner-spv-signoff-accept"));
    fireEvent.click(screen.getByTestId("partner-spvs-create"));

    await waitFor(() => expect(sent.length).toBe(1));
    const body = sent[0].body;
    expect(sent[0].url).toBe("/api/partner/me/spvs");

    // Every required key is PRESENT (this is what 400'd before).
    for (const key of required) expect(Object.keys(body)).toContain(key);

    // …and well-typed by the server's own predicates.
    expect(typeof body.spvName).toBe("string");
    expect(typeof body.jurisdiction).toBe("string");
    expect(typeof body.vintage).toBe("number");
    expect(Number.isFinite(body.vintage as number)).toBe(true);
    expect(String(body.currency)).toMatch(/^[A-Z]{3}$/);
    expect(serverEnum("/api/partner/me/spvs", "validSpvStatus")).toContain(body.status as string);
    expect(String(body.signoffLegalName).trim().length).toBeGreaterThan(0);
    expect(body.signoffAccepted).toBe(true);
  });

  it("the vintage default is the CURRENT calendar year, computed — not a literal", async () => {
    mount(<PartnerSpvs />);
    fireEvent.click(screen.getByTestId("partner-spvs-new-toggle"));
    expect((screen.getByTestId("partner-spv-vintage") as HTMLInputElement).value).toBe(
      String(new Date().getFullYear()),
    );
    // and it is editable, so nothing is silently assumed
    setValue("partner-spv-vintage", "2019");
    setValue("partner-spv-name", "Vintage Edit SPV");
    setValue("partner-spv-signoff-legalname", "Ada Managing Partner");
    fireEvent.click(screen.getByTestId("partner-spv-signoff-accept"));
    fireEvent.click(screen.getByTestId("partner-spvs-create"));
    await waitFor(() => expect(sent.length).toBe(1));
    expect(sent[0].body.vintage).toBe(2019);
  });

  it("launch stays gated: no request is sent until name + attestation are given", async () => {
    mount(<PartnerSpvs />);
    fireEvent.click(screen.getByTestId("partner-spvs-new-toggle"));
    setValue("partner-spv-name", "Ungated SPV");
    // legal name typed, checkbox NOT accepted → still disabled, still no POST
    setValue("partner-spv-signoff-legalname", "Ada Managing Partner");
    expect(isDisabled(screen.getByTestId("partner-spvs-create"))).toBe(true);
    fireEvent.click(screen.getByTestId("partner-spvs-create"));
    expect(sent.length).toBe(0);
    // accepting the attestation enables it — opposite pole
    fireEvent.click(screen.getByTestId("partner-spv-signoff-accept"));
    expect(isDisabled(screen.getByTestId("partner-spvs-create"))).toBe(false);
  });
});

/* ---------------------------------------------------------------------------
   PIN 2 — the fund payload carries every key the server requires.
   --------------------------------------------------------------------------- */

describe("W138 pin 2 — fund create payload satisfies the server contract", () => {
  it("sends every key server/partnerRoutes.ts requires, with the types it checks", async () => {
    const required = serverRequiredKeys("/api/partner/me/funds");
    /* WAVE 150 · R98 UPDATE — this pin previously asserted the fund route was
       NOT sign-off gated. R111 Q11 (owner: "Yes.") deleted that behaviour, so the
       old assertion pinned a removed defect and is UPDATED to pin the correct
       contract, not reduced: the required key set now INCLUDES both sign-off
       fields, and both poles are still asserted below. */
    expect(required.sort()).toEqual(
      ["currency", "fundName", "fundType", "jurisdiction", "signoffAccepted", "signoffLegalName", "status", "vintage"].sort(),
    );
    expect(required).toContain("signoffLegalName");
    expect(required).toContain("signoffAccepted");

    mount(<PartnerFunds />);
    fireEvent.click(screen.getByTestId("partner-funds-new-toggle"));
    setValue("partner-fund-name", "W138 Growth Fund I");
    setValue("partner-fund-type", "closed_end");
    setValue("partner-fund-signoff-legalname", "Ada Managing Partner");
    fireEvent.click(screen.getByTestId("partner-fund-signoff-accept"));
    fireEvent.click(screen.getByTestId("partner-funds-create"));

    await waitFor(() => expect(sent.length).toBe(1));
    const body = sent[0].body;
    expect(sent[0].url).toBe("/api/partner/me/funds");
    for (const key of required) expect(Object.keys(body)).toContain(key);

    expect(typeof body.fundName).toBe("string");
    expect(typeof body.jurisdiction).toBe("string");
    expect(typeof body.vintage).toBe("number");
    expect(Number.isFinite(body.vintage as number)).toBe(true);
    expect(String(body.currency)).toMatch(/^[A-Z]{3}$/);
    expect(serverEnum("/api/partner/me/funds", "validFundType")).toContain(body.fundType as string);
    expect(serverEnum("/api/partner/me/funds", "validFundStatus")).toContain(body.status as string);
    // The dead key is gone: `vintageYear` was never read by the server.
    expect(Object.keys(body)).not.toContain("vintageYear");
    // WAVE 150 — the sign-off the server now records, sent by this screen.
    expect(String(body.signoffLegalName).trim().length).toBeGreaterThan(0);
    expect(body.signoffAccepted).toBe(true);
  });

  it("fundType has NO default — the partner must choose before the button works", async () => {
    mount(<PartnerFunds />);
    fireEvent.click(screen.getByTestId("partner-funds-new-toggle"));
    setValue("partner-fund-name", "Unchosen Type Fund");
    /* WAVE 150 — the sign-off is now also required, so it is satisfied here to
       keep this pin about `fundType` alone. */
    setValue("partner-fund-signoff-legalname", "Ada Managing Partner");
    fireEvent.click(screen.getByTestId("partner-fund-signoff-accept"));
    expect((screen.getByTestId("partner-fund-type") as HTMLSelectElement).value).toBe("");
    expect(isDisabled(screen.getByTestId("partner-funds-create"))).toBe(true);
    fireEvent.click(screen.getByTestId("partner-funds-create"));
    expect(sent.length).toBe(0);
    // choosing one enables it — opposite pole
    setValue("partner-fund-type", "evergreen");
    expect(isDisabled(screen.getByTestId("partner-funds-create"))).toBe(false);
  });

  it("the fund vintage default is the computed current year, not the literal 2026", async () => {
    mount(<PartnerFunds />);
    fireEvent.click(screen.getByTestId("partner-funds-new-toggle"));
    const vintage = (screen.getByTestId("partner-fund-vintage") as HTMLInputElement).value;
    expect(vintage).toBe(String(new Date().getFullYear()));
    const src = fs.readFileSync(
      path.join(REPO_ROOT, "client/src/pages/partner/PartnerFunds.tsx"),
      "utf8",
    );
    // the hardcoded seed is gone from the state initialiser / reset
    expect(src).not.toContain('vintageYear: "2026"');
  });
});

/* ---------------------------------------------------------------------------
   PIN 4 — the associate is DISABLED WITH A REASON, never silently 403'd.
   --------------------------------------------------------------------------- */

describe("W138 pin 4 — associate sees a disabled control with a reason", () => {
  it("associate: control visible, disabled, reason names the managing partner, no POST", async () => {
    subRole = "associate";
    mount(<PartnerSpvs />);
    // still VISIBLE — nothing is shut off
    const toggle = screen.getByTestId("partner-spvs-new-toggle");
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle);
    setValue("partner-spv-name", "Associate SPV");
    setValue("partner-spv-signoff-legalname", "Bea Associate");
    fireEvent.click(screen.getByTestId("partner-spv-signoff-accept"));

    const btn = screen.getByTestId("partner-spvs-create");
    expect(isDisabled(btn)).toBe(true);
    const note = screen.getByTestId("partner-spv-role-note").textContent ?? "";
    expect(note.toLowerCase()).toContain("managing partner");
    // a plain sentence, not an enum leaking to a human eye
    expect(note).not.toContain("PARTNER_SUB_ROLE_INSUFFICIENT");
    expect(note.trim().length).toBeGreaterThan(20);

    fireEvent.click(btn);
    expect(sent.length).toBe(0);
  });

  it("managing partner: same control ENABLED and the role reason is absent (opposite pole)", async () => {
    subRole = "managing_partner";
    mount(<PartnerSpvs />);
    fireEvent.click(screen.getByTestId("partner-spvs-new-toggle"));
    setValue("partner-spv-name", "Managing SPV");
    setValue("partner-spv-signoff-legalname", "Ada Managing Partner");
    fireEvent.click(screen.getByTestId("partner-spv-signoff-accept"));
    expect(isDisabled(screen.getByTestId("partner-spvs-create"))).toBe(false);
    expect((screen.getByTestId("partner-spv-role-note").textContent ?? "").trim()).toBe("");
  });

  /* WAVE 150 · R98 UPDATE — this test asserted "associates may still create
     FUNDS". R111 Q11 removed that access deliberately, so the assertion pinned a
     defect that no longer exists. It is UPDATED (never reduced: 3 assertions
     became 7) to pin the new, correct behaviour AND both poles — the control is
     still rendered and disabled with a stated reason for an associate, and the
     identical form state is accepted for a managing partner. */
  it("associates may NO LONGER create funds — control visible, disabled, reason stated (R111 Q11)", async () => {
    subRole = "associate";
    mount(<PartnerFunds />);
    const toggle = screen.getByTestId("partner-funds-new-toggle");
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle);
    setValue("partner-fund-name", "Associate Fund");
    setValue("partner-fund-type", "rolling");
    setValue("partner-fund-signoff-legalname", "Bea Associate");
    fireEvent.click(screen.getByTestId("partner-fund-signoff-accept"));
    const btn = screen.getByTestId("partner-funds-create");
    expect(isDisabled(btn)).toBe(true);
    const note = screen.getByTestId("partner-fund-role-note").textContent ?? "";
    expect(note.toLowerCase()).toContain("managing partner");
    expect(note).not.toContain("PARTNER_SUB_ROLE_INSUFFICIENT");
    expect(note.trim().length).toBeGreaterThan(20);
    fireEvent.click(btn);
    expect(sent.length).toBe(0);
  });

  it("managing partner: the SAME fund form state is accepted (opposite pole)", async () => {
    subRole = "managing_partner";
    mount(<PartnerFunds />);
    fireEvent.click(screen.getByTestId("partner-funds-new-toggle"));
    setValue("partner-fund-name", "Associate Fund");
    setValue("partner-fund-type", "rolling");
    setValue("partner-fund-signoff-legalname", "Ada Managing Partner");
    fireEvent.click(screen.getByTestId("partner-fund-signoff-accept"));
    expect(isDisabled(screen.getByTestId("partner-funds-create"))).toBe(false);
    /* The note is asserted BEFORE submitting: a successful create collapses the
       form (`setShowForm(false)` in onSuccess), so the note leaves the DOM with
       the rest of the form. */
    expect((screen.getByTestId("partner-fund-role-note").textContent ?? "").trim()).toBe("");
    fireEvent.click(screen.getByTestId("partner-funds-create"));
    await waitFor(() => expect(sent.length).toBe(1));
  });
});

/* ---------------------------------------------------------------------------
   PIN 5 — the attestation shown is BYTE-IDENTICAL to the one recorded.
   --------------------------------------------------------------------------- */

describe("W138 pin 5 — attestation anti-divergence", () => {
  it("the text rendered to the partner equals, byte for byte, the text the server records", () => {
    const serverText = serverAttestationText();
    // guard the extraction itself
    expect(serverText.startsWith("I certify that I am authorized to launch")).toBe(true);
    expect(serverText.endsWith("(ESIGN/UETA).")).toBe(true);
    /* ══ WAVE 169 — RE-ARGUED IN PLACE, NOT LOWERED (R98, wave-168 precedent). ══
       WAS: `expect(SIGNOFF_STORE_SRC).toContain("attestationText: ATTESTATION_TEXT_V1")`.
       WHAT IT WAS PROTECTING: that the store records the SHARED constant and not a
       retyped literal — an anti-divergence pin, not a pin on the constant's name.
       WHY IT CHANGED: the store now records `resolveAttestation(input.spvType)`,
       because a fund must not be attested as a special-purpose vehicle (R77). The
       literal source string it looked for no longer exists.
       WHAT IS PINNED INSTEAD — the same property, more of it: the store records
       from the shared resolver (source-level), records text and version TOGETHER
       so they cannot desync, and the resolver's default/`spv` answer is still
       byte-identical to the v1 bytes extracted from source above. */
    expect(SIGNOFF_STORE_SRC).toContain("resolveAttestation(input.spvType)");
    expect(SIGNOFF_STORE_SRC).toContain("attestationText: attestation.text");
    expect(SIGNOFF_STORE_SRC).toContain("attestationVersion: attestation.version");
    expect(SIGNOFF_STORE_SRC).not.toContain("attestationText: \"I certify");
    expect(attestationTextForType("spv")).toBe(serverText);
    expect(attestationTextForType(undefined)).toBe(serverText);

    mount(<PartnerSpvs />);
    fireEvent.click(screen.getByTestId("partner-spvs-new-toggle"));
    const shown = screen.getByTestId("partner-spv-attestation-text").textContent ?? "";
    expect(shown).toBe(serverText);
    expect(shown.length).toBe(serverText.length);
  });

  it("there is exactly ONE definition of the attestation text in the shipped tree", () => {
    const needle = "I certify that I am authorized to launch this special-purpose vehicle on ";
    const roots = ["client/src", "server", "shared"];
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === "__tests__") continue;
          walk(p);
        } else if (/\.tsx?$/.test(entry.name)) {
          if (fs.readFileSync(p, "utf8").includes(`"${needle}"`)) hits.push(path.relative(REPO_ROOT, p));
        }
      }
    };
    for (const r of roots) walk(path.join(REPO_ROOT, r));
    expect(hits).toEqual(["shared/spvAttestation.ts"]);
    /* WAVE 169 — and the per-type wordings are DERIVED from that one definition,
       never retyped: no file outside it contains a second full attestation
       sentence for any other vehicle noun. */
    const derivedNeedles = [
      "I certify that I am authorized to launch this fund on ",
      "I certify that I am authorized to launch this syndicate on ",
      "I certify that I am authorized to launch this rolling fund on ",
    ];
    const derivedHits: string[] = [];
    const walk2 = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === "__tests__") continue;
          walk2(p);
        } else if (/\.tsx?$/.test(entry.name)) {
          const src = fs.readFileSync(p, "utf8");
          if (derivedNeedles.some((n) => src.includes(n))) derivedHits.push(path.relative(REPO_ROOT, p));
        }
      }
    };
    for (const r of roots) walk2(path.join(REPO_ROOT, r));
    expect(derivedHits).toEqual([]);
  });
});
