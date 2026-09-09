/**
 * ══════════════════════════════════════════════════════════════════════════════
 * RESIDUALS · ITEM 2 — "WHAT YOU ARE SIGNING", IN WORDS A SIGNER CAN READ.
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * THE REPORT was that the box titled "What you are signing" on the E-signature
 * tab still shows three raw strings — `Vehicle: spv_24e2f7d0e2d54c5d`,
 * `Document type: lpa`, `Statement version: esign-statement-v1` — and that "the
 * dropdown fix landed; this box was missed".
 *
 * RE-MEASURED, AND THE PREMISE NEEDED CORRECTING. The box was not missed. Those
 * three lines are THE BYTES THAT ARE HASHED AND STORED with the signature:
 * `shared/wave216SignedStatement.ts` states the invariant — "the bytes rendered
 * to the signer === the bytes hashed and stored" — and its header says "Bump —
 * never mutate". Rewording them would change the digest of every future
 * signature and break equality with every stored one. A prior wave had already
 * seen this and shipped an identifier LEGEND beside the box rather than touch
 * the bytes.
 *
 * So the fix is not a rewrite. It is a PLAIN-LANGUAGE SUMMARY rendered as a
 * SIBLING above the hashed text, saying the same three facts in human words.
 *
 * WHAT THIS FILE PROVES, FROM RENDERED TEXT ON THE REAL COMPONENT:
 *   1  CONTROL — the box is mounted, non-empty, and a false claim about it fails.
 *   2  THE VEHICLE IS NAMED — the summary says the vehicle's stored NAME.
 *   3  THE DOCUMENT TYPE USES THE DROPDOWN'S OWN WORDS — "LPA — Limited
 *      Partnership Agreement", the exact option label, from the shared map.
 *   4  THE VERSION IS LABELLED, NOT DROPPED — it is kept (it forms part of the
 *      signed record) and explained as the statement's own wording version.
 *   5  THE HASHED BYTES ARE UNTOUCHED — the statement node still contains the
 *      three original lines verbatim. This is the assertion that stops the copy
 *      fix from silently becoming a data-integrity defect, and it is why tests
 *      2-4 assert on the SUMMARY node rather than on the box as a whole.
 *   6  A MISSING NAME IS DECLARED, NEVER INVENTED AND NEVER THE ID.
 *
 * Harness modelled on `rem_w6c_spv_tab_copy.test.tsx`, which already mounts the
 * real `SpvDetailTabs`.
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SpvDetailTabs } from "../SpvDetailTabs";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: async () =>
      ({ ok: true, status: 200, json: async () => ({}), text: async () => "{}" }) as unknown as Response,
  };
});

/** The exact id QA read off the live screen. */
const SPV_ID = "spv_24e2f7d0e2d54c5d";
const VEHICLE_NAME = "Keiretsu Canada NovaPay SPV 2026";

/* eslint-disable @typescript-eslint/no-explicit-any */
function detail(name: string | null): any {
  return {
    spv: {
      status: "open", jurisdiction: "canada", lpVisibility: "own_only", closeDate: null,
      targetRaiseMinor: 10_000_000, terms: { vintage: 2026 }, revisionHash: null, updatedAt: null,
      name,
    },
    mandate: { mode: "thesis_lp_approval", sector: [], geography: [], stage: [] },
    fees: [],
    subscriptions: [],
    register: [],
    deployments: [], distributions: [], documents: [], transfers: [], capitalAccounts: [],
    closeSummary: {
      confirmedCount: 0, confirmedMinor: 0, targetMinor: 10_000_000,
      underTarget: true, shortfallMinor: 10_000_000, suggestedTargetMinor: 0, note: "",
    },
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function mountEsign(name: string | null = VEHICLE_NAME) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <SpvDetailTabs spvId={SPV_ID} detail={detail(name)} currency="USD" canWrite onChanged={() => {}} />
    </QueryClientProvider>,
  );
  const trigger = utils.container.querySelector<HTMLElement>('[data-testid="spv-tab-esignature"]');
  /* PRECONDITION: Radix does not mount an inactive panel's children, so without
     this the assertions below would run against an empty panel. */
  expect(trigger, "the E-signature tab trigger must exist before it can be activated").toBeTruthy();
  fireEvent.mouseDown(trigger!);
  fireEvent.click(trigger!);
  return utils;
}

function textOf(container: HTMLElement, testid: string): string {
  const el = container.querySelector(`[data-testid="${testid}"]`);
  expect(el, `[data-testid="${testid}"] must be rendered`).toBeTruthy();
  const t = el!.textContent ?? "";
  expect(t.trim().length, `[data-testid="${testid}"] rendered but is empty`).toBeGreaterThan(0);
  return t;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

describe("RESIDUALS · Item 2 — the signing box, rendered", () => {
  it("1 · CONTROL — the summary is mounted and non-empty, and a false claim about it fails", () => {
    const { container } = mountEsign();
    const summary = squash(textOf(container, "spv-esign-plain-summary"));
    expect(summary.length).toBeGreaterThan(0);
    expect(summary).not.toContain("a sentence this box does not contain");
    /* An absent node must be reported, not passed over. */
    expect(container.querySelector('[data-testid="spv-esign-plain-summary-NOPE"]')).toBeNull();
  });

  it("2 · the vehicle is named — the summary shows the NAME, not `spv_24e2f7d0e2d54c5d`", () => {
    const { container } = mountEsign();
    const line = squash(textOf(container, "spv-esign-plain-summary-vehicle"));
    expect(line).toContain(VEHICLE_NAME);
    /* THE DEFECT, PINNED: the storage key is not in the human line. */
    expect(line).not.toContain(SPV_ID);
    expect(line).not.toContain("spv_");
  });

  it("3 · the document type uses the DROPDOWN'S OWN WORDS, not the stored token `lpa`", () => {
    const { container } = mountEsign();

    /* First read the dropdown's selected option label off the real <select>, so
       the expected words come from THE COMPONENT and not from this test. */
    const select = container.querySelector<HTMLSelectElement>('[data-testid="spv-esign-document-kind"]');
    expect(select, "the document-kind dropdown must be rendered").toBeTruthy();
    const optionLabel = squash(
      Array.from(select!.options).find((o) => o.value === select!.value)?.textContent ?? "",
    );
    expect(optionLabel.length).toBeGreaterThan(0);
    expect(optionLabel).toContain("Limited Partnership Agreement");   // the fix that already landed

    const line = squash(textOf(container, "spv-esign-plain-summary-kind"));
    expect(line).toContain(optionLabel);
    /* And the lowercase stored token is not what the signer reads. */
    expect(line).not.toMatch(/Document type:\s*lpa\b/);
  });

  it("4 · the statement version is KEPT and LABELLED — not silently removed", () => {
    const { container } = mountEsign();
    const line = squash(textOf(container, "spv-esign-plain-summary-version"));
    /* Kept: it forms part of the signed record, so removing it was not an option
       while its legal weight is undetermined. */
    expect(line).toContain("esign-statement-v1");
    /* Labelled: the signer is told what it is a version OF. */
    expect(line.toLowerCase()).toContain("signing statement");
    expect(line.toLowerCase()).toContain("not the version of your document");
  });

  it("5 · the HASHED BYTES are untouched — the statement node still recites all three original lines", () => {
    const { container } = mountEsign();
    const bytes = textOf(container, "spv-esign-pending-statement-bytes");
    /* These are the exact strings QA reported. They MUST still be there: they
       are the bytes the server hashes. The fix added a sibling; it did not
       reword the statement. */
    expect(bytes).toContain(`Vehicle: ${SPV_ID}`);
    expect(bytes).toContain("Document type: lpa");
    expect(bytes).toContain("Statement version: esign-statement-v1");
    /* And the plain summary is NOT inside the hashed node. */
    const summaryEl = container.querySelector('[data-testid="spv-esign-plain-summary"]');
    const bytesEl = container.querySelector('[data-testid="spv-esign-pending-statement-bytes"]');
    expect(summaryEl).toBeTruthy();
    expect(bytesEl).toBeTruthy();
    expect(bytesEl!.contains(summaryEl!)).toBe(false);
  });

  it("6 · a vehicle with NO stored name declares that — it never invents one and never falls back to the id", () => {
    const { container } = mountEsign(null);
    const line = squash(textOf(container, "spv-esign-plain-summary-vehicle"));
    expect(line).toContain("not on record");
    expect(line).not.toContain(SPV_ID);
    expect(line).not.toContain(VEHICLE_NAME);   // nothing fabricated
  });
});
