/**
 * WAVE 176 · ITEM C · R147.3(4) — EVERY JURISDICTION CITES ITS SOURCE AND SAYS
 * IT IS NOT TAX ADVICE. DELAWARE INCLUDED.
 *
 * THE DEFECT, on live 26.29.0: the Hong Kong and Cayman panels both carried
 * "Where this comes from:" with government links AND the standalone sentence
 * "It is information, not tax advice." — and DELAWARE, the panel making the
 * strongest claim of all (that a Schedule K-1 IS the investor tax document),
 * carried NEITHER. `GpTaxDocumentNotice` early-returned for `doc.code ===
 * "delaware"` before it reached either block. The DATA was never at fault:
 * wave 175 gave Delaware three IRS citations, including the Partner's
 * Instructions for Schedule K-1 (Form 1065).
 *
 * RENDERED DOM, on the real component that the live GP K-1 tab mounts
 * (SpvK1Panel.tsx:295). Nothing here reads source text or a table directly for
 * its pass condition; every assertion is `textContent` / `href` from a render.
 *
 * EXHAUSTIVENESS IS THE POINT. The suite iterates `SPV_JURISDICTIONS` itself, so
 * a seventeenth jurisdiction added to the enum without source/disclaimer
 * handling FAILS this file rather than shipping silently. The count is pinned at
 * 16 as well, so a value being REMOVED from the enum is also visible.
 *
 * NO AUTHORITY IS INVENTED. The "has a citation" assertion is driven by the
 * jurisdiction's own `sources` array, so Cayman and BVI — which correctly name
 * no tax authority — are never required to produce one, and the test can never
 * be satisfied by a hardcoded link.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { GpTaxDocumentNotice } from "../GpTaxDocumentNotice";
import { LpTaxDocumentNote } from "@/components/investor/LpTaxDocumentNote";
import {
  SPV_JURISDICTIONS,
  SPV_JURISDICTION_TAX_DOCUMENT,
  SPV_TAX_DOCUMENT_SOURCES_LABEL,
} from "@shared/spvEngine";

/** The standalone sentence the owner found on Cayman and Hong Kong but not on
 *  Delaware. Written out here rather than imported so the test cannot be
 *  satisfied by a shared constant being changed to something meaningless. */
const NOT_TAX_ADVICE = "It is information, not tax advice.";
const IRS_K1_URL = "https://www.irs.gov/instructions/i1065sk1";

afterEach(() => cleanup());

function panelText(): string {
  return document.body.textContent ?? "";
}
function linkHrefs(): string[] {
  return Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
}

describe("W176 ITEM C — the GP tax panel, for EVERY jurisdiction in SPV_JURISDICTIONS", () => {
  it("the enum is the 16 values this wave was written against", () => {
    expect(SPV_JURISDICTIONS).toHaveLength(16);
  });

  for (const code of SPV_JURISDICTIONS) {
    const doc = SPV_JURISDICTION_TAX_DOCUMENT[code];

    it(`${code} — renders the not-tax-advice sentence`, () => {
      render(<GpTaxDocumentNotice jurisdiction={code} />);
      expect(screen.getByTestId("spv-k1-jurisdiction-informational").textContent ?? "").toContain(NOT_TAX_ADVICE);
      expect(panelText()).toContain(NOT_TAX_ADVICE);
    });

    it(`${code} — renders every citation it HAS, and none it does not`, () => {
      render(<GpTaxDocumentNotice jurisdiction={code} />);
      if (doc.sources.length === 0) {
        // `other` only: an unrecorded jurisdiction has nothing to cite, and the
        // panel must not invent one.
        expect(screen.queryByTestId("spv-k1-jurisdiction-sources")).toBeNull();
        expect(code).toBe("other");
        return;
      }
      const sources = screen.getByTestId("spv-k1-jurisdiction-sources");
      const t = sources.textContent ?? "";
      expect(t).toContain(SPV_TAX_DOCUMENT_SOURCES_LABEL);
      for (const s of doc.sources) {
        expect(t).toContain(s.label);
        expect(linkHrefs()).toContain(s.url);
      }
    });
  }

  it("DELAWARE specifically renders the IRS Schedule K-1 (Form 1065) citation, beside its unchanged claim", () => {
    render(<GpTaxDocumentNotice jurisdiction="delaware" />);
    // The original claim is byte-verbatim and still on screen (R143.1).
    const us = screen.getByTestId("spv-k1-jurisdiction-us").textContent ?? "";
    expect(us).toContain("A Schedule K-1 is this vehicle's investor tax document.");
    expect(us).toContain("Vehicle jurisdiction: United States (Delaware).");
    // …and now carries the citation and the disclaimer it lacked on live.
    const sources = screen.getByTestId("spv-k1-jurisdiction-sources").textContent ?? "";
    expect(sources).toContain("Internal Revenue Service");
    expect(sources).toContain("Schedule K-1 (Form 1065)");
    expect(linkHrefs()).toContain(IRS_K1_URL);
    expect(screen.getByTestId("spv-k1-jurisdiction-informational").textContent ?? "").toContain(NOT_TAX_ADVICE);
  });

  it("Delaware is no longer the odd one out: it renders the SAME two blocks Cayman and Hong Kong do", () => {
    const seen: Record<string, { sources: boolean; notice: boolean }> = {};
    for (const code of ["delaware", "cayman", "hong_kong"] as const) {
      render(<GpTaxDocumentNotice jurisdiction={code} />);
      seen[code] = {
        sources: (screen.getByTestId("spv-k1-jurisdiction-sources").textContent ?? "").includes(
          SPV_TAX_DOCUMENT_SOURCES_LABEL,
        ),
        notice: (screen.getByTestId("spv-k1-jurisdiction-informational").textContent ?? "").includes(NOT_TAX_ADVICE),
      };
      cleanup();
    }
    expect(seen).toEqual({
      delaware: { sources: true, notice: true },
      cayman: { sources: true, notice: true },
      hong_kong: { sources: true, notice: true },
    });
  });

  it("an unrecognised jurisdiction value still gets the disclaimer and still invents no authority", () => {
    render(<GpTaxDocumentNotice jurisdiction="atlantis" />);
    expect(panelText()).toContain(NOT_TAX_ADVICE);
    expect(screen.queryByTestId("spv-k1-jurisdiction-sources")).toBeNull();
    expect(linkHrefs()).toEqual([]);
  });
});

describe("W176 ITEM C — the LP-facing twin is held to the same standard", () => {
  for (const code of SPV_JURISDICTIONS) {
    const doc = SPV_JURISDICTION_TAX_DOCUMENT[code];
    it(`${code} — LP panel renders the not-tax-advice sentence and its own citations`, () => {
      render(<LpTaxDocumentNote jurisdiction={code} />);
      expect(screen.getByTestId("investor-lp-tax-document-informational").textContent ?? "").toContain(NOT_TAX_ADVICE);
      if (doc.sources.length === 0) {
        expect(screen.queryByTestId("investor-lp-tax-document-sources")).toBeNull();
      } else {
        const t = screen.getByTestId("investor-lp-tax-document-sources").textContent ?? "";
        for (const s of doc.sources) expect(t).toContain(s.label);
      }
    });
  }

  it("DELAWARE on the LP panel cites the IRS Schedule K-1 instructions too", () => {
    render(<LpTaxDocumentNote jurisdiction="delaware" />);
    expect(linkHrefs()).toContain(IRS_K1_URL);
  });
});
