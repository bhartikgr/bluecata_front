/* ════════════════════════════════════════════════════════════════════════════
   WAVE 209 · ITEM A §209.2(d) — WHAT A SIGNER ACTUALLY SEES.
   ════════════════════════════════════════════════════════════════════════════
   WHY A RENDER AND NOT A GREP. The owner's third instruction is explicit: *"Do
   not silently drop the field … make sure anything rendering the metadata says so
   plainly rather than showing a blank."* That is a claim about the DOM. The
   silent-drop guard cannot see an expression-valued JSX child, and a source grep
   cannot tell a rendered sentence from a comment. So the two surfaces that
   display a completed signature are MOUNTED FOR REAL (handbook §8: mount the
   real component, never a replica), fed by the REAL zustand store
   (`useTermSheetStore`) carrying a signature produced by the REAL `signSES()`
   over the REAL `captureSessionMetadata()`.

   WHAT IS PROVED BY RENDERING:
     T-1..T-4  `founder/TermSheet` signed view: the address row renders, it reads
               "not captured", it is NOT blank, and no RFC 5737 / RFC 3849
               documentation address appears anywhere in the document.
     I-1..I-3  `investor/InvitationDetail` "Soft-circle recorded" card: same
               three assertions on the other surface.
     R-1..R-4  R143.1 — every pre-existing literal these siblings were appended
               beside is still present BYTE FOR BYTE. That is a claim about
               source text and is asserted against source text, via the
               TypeScript AST so this file's own comments cannot satisfy it.
     N-1       A NEGATIVE CONTROL: a signature carrying a real address renders
               THAT address, not the sentinel. Without this, every assertion
               above would also pass on a component that hardcoded the words
               "not captured".

   NOT PROVED HERE, and said plainly rather than implied: `founder/RoundDetail`
   and `investor/CompanyDetail` are not mounted in jsdom — the first needs the
   full round/cap-table/waterfall query graph, the second is behind
   `RequireEntitlement`. Their appended siblings are asserted at AST level in
   R-3/R-4 and their shared render helper is unit-proved in
   `client/src/lib/esign/__tests__/wave209_signer_metadata.test.ts`.
   ════════════════════════════════════════════════════════════════════════════ */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RoleProvider } from "@/lib/role";
import { Router, Route } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import fs from "node:fs";
import path from "node:path";
import * as ts from "typescript";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }), toast: vi.fn() }));

import { getQueryFn } from "@/lib/queryClient";
import { useTermSheetStore } from "@/lib/termsheet/store";
import { signSES, captureSessionMetadata, type SESSignature } from "@/lib/esign/ses";
import { SIGNER_ADDRESS_NOT_CAPTURED, SIGNER_ADDRESS_NOT_CAPTURED_SENTENCE } from "@/lib/esign/wave209SignerMetadata";
import TermSheet from "@/pages/founder/TermSheet";
import InvitationDetail from "@/pages/investor/InvitationDetail";

const ROOT = path.resolve(__dirname, "../../../..");
const DOCUMENTATION_PREFIXES = ["192.0.2.", "198.51.100.", "203.0.113.", "2001:db8:"];

/** Rendered text only, via the real TypeScript parser — comments excluded
 *  exactly, not heuristically. Same extraction wave 80 established. */
function renderedText(rel: string): string {
  const file = path.join(ROOT, rel);
  const code = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, rel.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) out.push(n.text);
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) out.push((n as ts.TemplateHead).text);
    else if (ts.isJsxText(n)) out.push(n.text);
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(sf, visit);
  return out.join("\n").replace(/\s+/g, " ");
}

/** A signature exactly as the client builds one today: real capture, real sign. */
function clientSignature(over: Record<string, unknown> = {}): SESSignature {
  const meta = captureSessionMetadata();
  return signSES({
    documentId: "ts-rnd_w209",
    documentType: "termsheet",
    signerName: "Avi Founder",
    signerEmail: "avi@capavate.test",
    signerRole: "founder",
    intentText: "I agree to the term sheet.",
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
    timestamp: meta.timestamp,
    sessionId: meta.sessionId,
    prevHash: "0".repeat(64),
    ...over,
  } as never);
}

/** Mounts the page THROUGH A REAL ROUTE, so `useParams()` resolves the round or
 *  invitation id exactly as it does in the running app. Rendering the component
 *  bare would silently fall back to its default id and prove nothing. */
function wrap(node: React.ReactNode, at: string, routePath: string) {
  /* The REAL default query function the app installs (`@/lib/queryClient`), so
     these pages fetch exactly the way they do in the browser. A QueryClient
     without it silently answers every query with an error, which is how an
     earlier version of this file "rendered" nothing but a not-found card. */
  const qc = new QueryClient({
    defaultOptions: {
      queries: { queryFn: getQueryFn({ on401: "returnNull" }), retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  const { hook } = memoryLocation({ path: at, static: true });
  return render(
    <QueryClientProvider client={qc}>
      <Router hook={hook}>
        <RoleProvider>
          <TooltipProvider>
            <Route path={routePath}>{node}</Route>
          </TooltipProvider>
        </RoleProvider>
      </Router>
    </QueryClientProvider>,
  );
}

/** Seed the REAL store the pages read from. Not a mock of the store — the store. */
function seedSignedTermSheet(roundId: string, sig: SESSignature) {
  useTermSheetStore.getState().saveTermSheet({
    roundId,
    source: "generated" as never,
    region: "US" as never,
    instrument: "preferred" as never,
    templateId: "US-preferred-1.0.0",
    templateName: "US — NVCA Model Series A Preferred Term Sheet",
    sections: [{ id: "preamble", heading: "Preamble", body: "Sample preamble body", edited: false } as never],
    citations: [],
    status: "signed" as never,
    documentHash: "a".repeat(64),
    signature: sig,
    signedAt: "2026-08-29T12:00:00.000Z",
  } as never);
}

function seedSoftCircle(invitationId: string, sig: SESSignature) {
  useTermSheetStore.getState().saveSoftCircleSig({
    softCircleId: `sc-${invitationId}`,
    roundId: "rnd_w209",
    invitationId,
    signature: sig,
    amount: 250_000,
  } as never);
}

beforeEach(() => {
  useTermSheetStore.setState({ termSheets: {}, softCircleSigs: {}, consortiumRequests: [] } as never);
  /* A route-aware stub of the network boundary ONLY. The COMPONENTS under test
     are the real ones and the store is the real one; what is stubbed is the
     server, because there is no server in jsdom. The two records below are the
     minimum each page needs to get past its "not found" gate — they carry NO
     network address of any kind, deliberately, so the address the surface shows
     can only have come from the signature in the store. */
  const round = {
    id: "rnd_w209", companyId: "co_w209", name: "Series A", type: "priced", state: "open",
    instrument: "preferred", currency: "USD", targetAmount: 5_000_000, minTicket: 25_000,
    preMoney: null, postMoney: null, pricePerShare: null, closeDate: null,
  };
  const invitation = {
    id: "inv_w209",
    company: { id: "co_w209", name: "NovaPay Labs Inc.", sector: "Fintech" },
    round: { id: "rnd_w209", name: "Series A", type: "priced", state: "open" },
    state: "soft_circled", receivedAt: "2026-08-01T00:00:00.000Z", expiresAt: null,
    minTicket: 25_000, targetAmount: 5_000_000, raisedAmount: 0,
    preMoney: null, postMoney: null, pricePerShare: null, currency: "USD",
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : String((input as Request).url);
      if (url.includes("/api/rounds/rnd_w209") && !url.includes("/invitations")) return json(round);
      if (url.includes("/api/investor/invitations/inv_w209")) return json(invitation);
      if (url.includes("/api/auth/me")) return json({ id: "u_founder", displayName: "Avi Founder", role: "founder" });
      /* Everything else answers an empty list / object, which is what each page's
         own empty branch is written for. */
      return json([]);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/* ─────────────── T · the founder term-sheet signed view ─────────────────── */
describe("W209-T · founder/TermSheet signed view states the absence in words", () => {
  it("T-1. the signer-address row renders and is not blank", async () => {
    seedSignedTermSheet("rnd_w209", clientSignature());
    wrap(<TermSheet />, "/founder/rounds/rnd_w209/termsheet", "/founder/rounds/:id/termsheet");
    const row = await screen.findByTestId("text-termsheet-signer-address");
    expect(row.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    expect(row.textContent).toContain("Signer network address");
  });

  it("T-2. it reads 'not captured', which is what the record holds", async () => {
    seedSignedTermSheet("rnd_w209", clientSignature());
    wrap(<TermSheet />, "/founder/rounds/rnd_w209/termsheet", "/founder/rounds/:id/termsheet");
    const row = await screen.findByTestId("text-termsheet-signer-address");
    expect(row.textContent).toContain(SIGNER_ADDRESS_NOT_CAPTURED);
  });

  it("T-3. the explanatory sentence renders beside it", async () => {
    seedSignedTermSheet("rnd_w209", clientSignature());
    wrap(<TermSheet />, "/founder/rounds/rnd_w209/termsheet", "/founder/rounds/:id/termsheet");
    const note = await screen.findByTestId("text-termsheet-address-not-captured");
    expect(note.textContent).toBe(SIGNER_ADDRESS_NOT_CAPTURED_SENTENCE);
    expect(await screen.findByTestId("text-termsheet-address-server-observed")).toBeTruthy();
  });

  it("T-4. no documentation-space address appears anywhere in the rendered document", async () => {
    seedSignedTermSheet("rnd_w209", clientSignature());
    const { container } = wrap(<TermSheet />, "/founder/rounds/rnd_w209/termsheet", "/founder/rounds/:id/termsheet");
    await screen.findByTestId("text-termsheet-signer-address");
    for (const p of DOCUMENTATION_PREFIXES) expect(container.textContent ?? "").not.toContain(p);
  });
});

/* ─────────────── I · the investor soft-circle card ──────────────────────── */
describe("W209-I · investor/InvitationDetail soft-circle card states the absence", () => {
  const INV = "inv_w209";

  it("I-1. the signer-address row renders, not blank, and reads 'not captured'", async () => {
    seedSoftCircle(INV, clientSignature({ documentId: `sc-${INV}`, documentType: "softcircle" }));
    wrap(<InvitationDetail />, `/investor/invitations/${INV}?tab=decision`, "/investor/invitations/:id");
    const row = await waitFor(() => screen.getByTestId("text-softcircle-signer-address"), { timeout: 5000 });
    expect(row.textContent).toContain("Signer network address");
    expect(row.textContent).toContain(SIGNER_ADDRESS_NOT_CAPTURED);
  });

  it("I-2. the explanatory sentence renders on the card", async () => {
    seedSoftCircle(INV, clientSignature({ documentId: `sc-${INV}`, documentType: "softcircle" }));
    wrap(<InvitationDetail />, `/investor/invitations/${INV}?tab=decision`, "/investor/invitations/:id");
    const note = await waitFor(() => screen.getByTestId("text-softcircle-address-not-captured"), { timeout: 5000 });
    expect(note.textContent).toBe(SIGNER_ADDRESS_NOT_CAPTURED_SENTENCE);
  });

  it("I-3. the pre-existing 'Verifiable hash' row is STILL THERE — nothing replaced", async () => {
    seedSoftCircle(INV, clientSignature({ documentId: `sc-${INV}`, documentType: "softcircle" }));
    wrap(<InvitationDetail />, `/investor/invitations/${INV}?tab=decision`, "/investor/invitations/:id");
    const hash = await waitFor(() => screen.getByTestId("text-softcircle-hash"), { timeout: 5000 });
    expect(hash.textContent).toContain("Verifiable hash");
  });
});

/* ─────────────── N · the negative control ──────────────────────────────── */
describe("W209-N · negative control — a real address is shown as itself", () => {
  it("N-1. a signature carrying a real observed address renders that address", async () => {
    /* If the surface hardcoded the words "not captured", this test fails. It is
       the assertion that makes T-2 and I-1 mean something. */
    seedSignedTermSheet("rnd_w209", clientSignature({ ipAddress: "198.18.0.7" }));
    wrap(<TermSheet />, "/founder/rounds/rnd_w209/termsheet", "/founder/rounds/:id/termsheet");
    const row = await screen.findByTestId("text-termsheet-signer-address");
    expect(row.textContent).toContain("198.18.0.7");
    expect(row.textContent).not.toContain(SIGNER_ADDRESS_NOT_CAPTURED);
  });
});

/* ─────────────── R · R143.1, appended never replaced ───────────────────── */
describe("W209-R · R143.1 — every literal these siblings sit beside survives", () => {
  const SITES: Array<{ file: string; kept: string[] }> = [
    {
      file: "client/src/pages/founder/TermSheet.tsx",
      kept: ["Signature hash", "Document hash", "Signed at", "Signer"],
    },
    {
      file: "client/src/pages/investor/InvitationDetail.tsx",
      kept: ["Verifiable hash: ", "Soft-circle recorded"],
    },
    {
      file: "client/src/pages/founder/RoundDetail.tsx",
      kept: ["founder confirmed"],
    },
    {
      file: "client/src/pages/investor/CompanyDetail.tsx",
      kept: ["Your full legal name (typed signature)", "Your email"],
    },
  ];

  for (const site of SITES) {
    it(`R · ${site.file} keeps its pre-existing literals and gained the new sentence`, () => {
      const text = renderedText(site.file);
      for (const k of site.kept) expect(text).toContain(k);
      /* The sentence is NOT copied into these files — it is imported from the one
         module that owns it, so there is exactly one place it can be edited. What
         is asserted here is therefore the import and the reference, which is what
         actually puts the sentence on screen. */
      expect(text).toContain("@/lib/esign/wave209SignerMetadata");
      const raw = fs.readFileSync(path.join(ROOT, site.file), "utf8");
      expect(raw).toContain("SIGNER_ADDRESS_NOT_CAPTURED_SENTENCE");
    });
  }

  it("R · no surface hardcodes a documentation address in its rendered copy", () => {
    for (const site of SITES) {
      const text = renderedText(site.file);
      for (const p of DOCUMENTATION_PREFIXES) expect(text).not.toContain(p);
    }
  });
});
