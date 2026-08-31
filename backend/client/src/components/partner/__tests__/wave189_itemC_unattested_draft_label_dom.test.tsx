/**
 * WAVE 189 · ITEM C · R159.6 — THE UNATTESTED LABEL, ON RENDERED DOM.
 *
 * The brief, verbatim: *"Allow drafts. Label them unmistakably as unattested wherever
 * they appear."* and *"a rendered-DOM test shows the unattested label."*
 *
 * WHAT THIS FILE IS FOR, AND WHAT IT IS NOT FOR. The ENFORCEMENT is proved by
 * `server/__tests__/wave189_itemC_unattested_draft_capital_refusal.test.ts` at the
 * store and route layers, because that is where a write happens and a disabled button
 * is not enforcement (wave 182's lesson, quoted by the owner in this brief). This file
 * proves only the second half of the ruling: that a general partner is TOLD what the
 * vehicle is, so the refusal they will meet is never a surprise.
 *
 * THE THREE STATES ARE ALL PROVEN, because the wrong one appearing is the defect:
 *   · no sign-off      → the label AND the sentence render.
 *   · a sign-off       → NOTHING renders; an attested vehicle in good order is not
 *                        decorated with a warning.
 *   · loading / error / → NOTHING renders. Calling a vehicle "unattested" because its
 *     unrecognised shape    sign-off record could not be fetched would be a FALSE
 *                        statement on an investor-grade surface.
 *
 * AND THE REFUSAL IS A SENTENCE, NOT A CODE. The brief is explicit: *"Refusal must be
 * a stated fact, never an ALL-CAPS underscore code on screen."* The machine-readable
 * code exists — it is what the client keys on — but it must never reach the DOM.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  SPV_UNATTESTED_DRAFT_LABEL,
  SPV_UNATTESTED_DRAFT_CODE,
  SPV_UNATTESTED_UNNAMED_VEHICLE,
  spvUnattestedDraftNotice,
} from "@shared/spvUnattestedDraft";
import SpvAttestationStatusNotice from "@/components/partner/SpvAttestationStatusNotice";

afterEach(() => cleanup());

/** The component reads through the query client's default fetcher, so the payload is
 *  injected by pre-seeding the cache for its exact key. Nothing about the component
 *  itself is mocked. */
function renderWith(data: unknown, opts: { error?: boolean; loading?: boolean } = {}) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
        queryFn: async () => {
          if (opts.error) throw new Error("w189 signoff read failed");
          if (opts.loading) await new Promise(() => {}); /* never settles */
          return data;
        },
      },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SpvAttestationStatusNotice spvId="spv_w189_dom" spvName="W189 Draft Vehicle" />
    </QueryClientProvider>,
  );
}

describe("wave 189 · item C — the unattested label on rendered DOM", () => {
  it("NO sign-off → the label renders, and it is unmistakable", async () => {
    renderWith({ signoffs: [] });
    await waitFor(() => expect(screen.getByTestId("spv-attestation-status")).toBeTruthy());
    expect(screen.getByTestId("spv-attestation-status-label").textContent)
      .toBe(SPV_UNATTESTED_DRAFT_LABEL);
    expect(SPV_UNATTESTED_DRAFT_LABEL).toBe("Unattested draft");
  });

  it("NO sign-off → the SENTENCE renders too, naming the vehicle and what cannot happen yet", async () => {
    renderWith({ signoffs: [] });
    await waitFor(() => expect(screen.getByTestId("spv-attestation-status-notice")).toBeTruthy());
    const text = screen.getByTestId("spv-attestation-status-notice").textContent ?? "";
    expect(text).toBe(spvUnattestedDraftNotice("W189 Draft Vehicle"));
    expect(text).toContain("W189 Draft Vehicle");
    expect(text.trim().length).toBeGreaterThan(40);
  });

  it("the rendered refusal is a STATED FACT — no ALL-CAPS underscore code reaches the DOM", async () => {
    renderWith({ signoffs: [] });
    await waitFor(() => expect(screen.getByTestId("spv-attestation-status")).toBeTruthy());
    const text = screen.getByTestId("spv-attestation-status").textContent ?? "";
    /* The machine code EXISTS and is what the client keys on — it simply must never
       be shown to a person. Both halves are asserted so this cannot pass by the code
       having been deleted. */
    expect(SPV_UNATTESTED_DRAFT_CODE).toBe("SPV_ATTESTATION_REQUIRED");
    expect(text).not.toContain(SPV_UNATTESTED_DRAFT_CODE);
    expect(text).not.toMatch(/[A-Z]{3,}_[A-Z_]{2,}/);
  });

  it("an UNNAMED vehicle still renders a readable sentence, never a blank or an 'undefined'", async () => {
    for (const name of [null, undefined, "", "   "]) {
      cleanup();
      const qc = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0, queryFn: async () => ({ signoffs: [] }) } },
      });
      render(
        <QueryClientProvider client={qc}>
          <SpvAttestationStatusNotice spvId="spv_w189_dom" spvName={name as string | null} />
        </QueryClientProvider>,
      );
      await waitFor(() => expect(screen.getByTestId("spv-attestation-status-notice")).toBeTruthy());
      const text = screen.getByTestId("spv-attestation-status-notice").textContent ?? "";
      expect(text).toContain(SPV_UNATTESTED_UNNAMED_VEHICLE);
      expect(text).not.toContain("undefined");
      expect(text).not.toContain("null");
    }
  });

  it("A SIGN-OFF EXISTS → nothing renders. An attested vehicle is not decorated with a warning", async () => {
    renderWith({ signoffs: [{ id: "so_1", signerLegalName: "Ozan Isinak", signedAt: "2026-08-01T00:00:00Z" }] });
    await waitFor(() => expect(screen.queryByTestId("spv-attestation-status")).toBeNull());
    /* Settle-proof: give the query a real chance to have resolved before absence is
       read as a verdict. */
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("spv-attestation-status")).toBeNull();
  });

  it("A READ FAILURE → nothing renders. 'Unattested' is never asserted from a failed fetch", async () => {
    renderWith(null, { error: true });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId("spv-attestation-status")).toBeNull();
  });

  it("WHILE LOADING → nothing renders", async () => {
    renderWith(null, { loading: true });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("spv-attestation-status")).toBeNull();
  });

  it("AN UNRECOGNISED PAYLOAD SHAPE → nothing renders, rather than a guess", async () => {
    for (const junk of [{}, { signoffs: null }, { signoffs: "none" }, { foo: 1 }, null]) {
      cleanup();
      renderWith(junk);
      await new Promise((r) => setTimeout(r, 20));
      expect(screen.queryByTestId("spv-attestation-status"), JSON.stringify(junk)).toBeNull();
    }
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   THE MOUNT — a label nobody renders labels nothing.
   ════════════════════════════════════════════════════════════════════════════ */
describe("wave 189 · item C — the label is MOUNTED on the vehicle's own surface", () => {
  it("SpvDetailTabs imports and renders it, as a SIBLING and not as a new table cell", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("client/src/components/partner/SpvDetailTabs.tsx", "utf8");
    const stripped = src
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    /* Verify the stripper actually stripped, per the standing rule. */
    expect(stripped.length).toBeLessThan(src.length);

    expect(stripped).toContain("SpvAttestationStatusNotice");
    expect(stripped).toContain("<SpvAttestationStatusNotice");
    /* R143.1 / wave 182 — the mount must NOT be a `<td>`: adding a cell renumbers its
       siblings and trips the panels inventory. The mount is asserted not to be
       immediately preceded by a table-cell open tag. */
    const idx = stripped.indexOf("<SpvAttestationStatusNotice");
    const before = stripped.slice(Math.max(0, idx - 200), idx);
    expect(before).not.toMatch(/<td[\s>]/);
    expect(before).not.toMatch(/<th[\s>]/);
  });
});
