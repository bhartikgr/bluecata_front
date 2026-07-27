/**
 * w-partner F2-b — portfolio profile patch validation.
 *
 * ANTI-VACUITY: `parsePortfolioPatchDetailed` does not exist pre-wave, and the
 * pre-wave `parsePortfolioPatch` returns a bare `null` with no field-level
 * issues — so the `details[].path` assertion cannot pass against baseline.
 * The scheme-less-URL normalisation is likewise new.
 *
 * These are store-level parser tests: they exercise the exact function the
 * route at partnerRoutes.ts calls, without standing up HTTP or touching any
 * money path.
 */

import { describe, it, expect } from "vitest";

import { parsePortfolioPatch, parsePortfolioPatchDetailed } from "../partnerPortfolioStore";

describe("w-partner F2-b — parsePortfolioPatchDetailed", () => {
  it("accepts a valid enum industry and preserves ALL four sections", () => {
    const r = parsePortfolioPatchDetailed({
      contact: { companyName: "Acme Ltd", industry: "cybersecurity" },
      address: { city: "Istanbul" },
      legal: { legalEntityName: "Acme Legal Ltd" },
      ma: { readiness: { transactionStatus: "exploring" } },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // A single bad field used to 400 the WHOLE patch and silently discard the
    // other three sections; assert all four survive a good patch.
    expect((r.data.contact as Record<string, unknown>).companyName).toBe("Acme Ltd");
    expect((r.data.contact as Record<string, unknown>).industry).toBe("cybersecurity");
    expect((r.data.address as Record<string, unknown>).city).toBe("Istanbul");
    expect((r.data.legal as Record<string, unknown>).legalEntityName).toBe("Acme Legal Ltd");
    // transactionStatus lives under ma.readiness — a top-level ma.transactionStatus
    // is an unknown key and zod STRIPS it, which is exactly the silent drop the
    // dialog's step 4 used to produce.
    const readiness = (r.data.ma as Record<string, any>).readiness;
    expect(readiness.transactionStatus).toBe("exploring");
  });

  it("a top-level ma.transactionStatus is silently STRIPPED (why the dialog nests it)", () => {
    const r = parsePortfolioPatchDetailed({ ma: { transactionStatus: "exploring" } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.data.ma as Record<string, unknown>).transactionStatus).toBeUndefined();
  });

  it("rejects a free-text industry and NAMES the offending field", () => {
    const r = parsePortfolioPatchDetailed({
      contact: { companyName: "Acme Ltd", industry: "artisanal widget-craft" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.length).toBeGreaterThan(0);
    expect(r.issues.some((i) => i.path === "contact.industry")).toBe(true);
    expect(r.issues.every((i) => typeof i.message === "string" && i.message.length > 0)).toBe(true);
  });

  it("accepts a CLEARED industry as null (not empty string)", () => {
    expect(parsePortfolioPatchDetailed({ contact: { industry: null } }).ok).toBe(true);
    // "" is what a naive Radix sentinel would send; industryEnum rejects it, so
    // the dialog maps its sentinel to null instead.
    expect(parsePortfolioPatchDetailed({ contact: { industry: "" } }).ok).toBe(false);
  });

  it("prefixes https:// on a scheme-less companyWebsiteUrl instead of 400ing", () => {
    const r = parsePortfolioPatchDetailed({ contact: { companyWebsiteUrl: "acme.example" } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.data.contact as Record<string, unknown>).companyWebsiteUrl).toBe("https://acme.example");
  });

  it("leaves an already-schemed URL untouched", () => {
    const r = parsePortfolioPatchDetailed({ contact: { companyWebsiteUrl: "http://acme.example" } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.data.contact as Record<string, unknown>).companyWebsiteUrl).toBe("http://acme.example");
  });

  it("NO-DROP: the legacy parsePortfolioPatch wrapper still exists and behaves", () => {
    expect(parsePortfolioPatch({ contact: { companyName: "Acme Ltd" } })).toBeTruthy();
    expect(parsePortfolioPatch({ contact: { industry: "not-an-enum" } })).toBeNull();
  });
});
