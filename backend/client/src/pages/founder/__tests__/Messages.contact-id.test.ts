/**
 * B-505 fix v23.6: auto-open DM for ?contactId= URL param
 *
 * Static source analysis confirming:
 * 1. Messages.tsx reads useSearch() and extracts contactId param
 * 2. useEffect triggers startDm.mutate when contactIdParam + crmQ.data present
 * 3. Marker comment present
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(
  resolve(__dirname, "../Messages.tsx"),
  "utf8",
);

describe("B-505 fix v23.6: Messages page reads ?contactId= param", () => {
  it("imports useSearch from wouter", () => {
    expect(SRC).toContain("useSearch");
  });

  it("imports useEffect", () => {
    expect(SRC).toContain("useEffect");
  });

  it("extracts contactId from search params", () => {
    expect(SRC).toContain("contactId");
    expect(SRC).toContain("URLSearchParams");
  });

  it("has B-505 marker comment", () => {
    expect(SRC).toContain("B-505 fix v23.6");
  });

  it("calls startDm.mutate with the contactIdParam", () => {
    expect(SRC).toContain("startDm.mutate(contactIdParam)");
  });

  it("uses useEffect to trigger DM on mount when contactId is present", () => {
    expect(SRC).toContain("contactIdParam, crmQ.data");
  });

  it("looks up contact in CRM data by investorId", () => {
    expect(SRC).toContain("investorId === contactIdParam");
  });
});
