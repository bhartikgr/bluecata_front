// @vitest-environment jsdom
/**
 * FIX #10 (Wave 3) — Glossary search field red-outline on load/focus.
 *
 * ROOT CAUSE: the shared <Input> applies `focus-visible:ring-ring`, and --ring
 * is the brand RED (index.css). Combined with the search field's `autoFocus`,
 * the input grabbed a RED focus ring the instant the page loaded — reading as
 * an invalid/error state even though empty search is VALID (shows all terms).
 *
 * FIX: no sacred-token edit — at the component-class level, drop the load-time
 * `autoFocus` and override the focus ring to a NEUTRAL token
 * (`focus-visible:ring-input`). Empty query still lists ALL terms.
 *
 * Part 1 (behavioral): renders the REAL InvestorGlossaryPage and asserts the
 * search input has the neutral ring class, is NOT auto-focused, carries no
 * invalid/error styling or aria-invalid, and that all terms render on an empty
 * query.
 * Part 2 (source invariants): pins the fix.
 *
 * Plain `.test.ts` + React.createElement (no JSX) → excluded from the tsc budget.
 */
import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { RoleProvider } from "@/lib/role";
import InvestorGlossaryPage from "@/pages/investor/Glossary";
import { ENTRIES } from "@/components/Glossary";

afterEach(() => cleanup());

// The page renders PageHeader → GlossaryLink (useRole) and consumes the query
// client, so wrap in the minimal providers the header chain needs.
function renderGlossary() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, queryFn: async () => ({}) } },
  });
  window.history.pushState({}, "", "/investor/glossary");
  return render(
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(
        Router,
        null,
        React.createElement(RoleProvider, null, React.createElement(InvestorGlossaryPage, null)),
      ),
    ),
  );
}

describe("FIX #10 — Glossary search ring is neutral, no invalid styling", () => {
  it("uses a neutral focus ring and is not auto-focused on load", () => {
    renderGlossary();
    const input = screen.getByTestId("input-glossary-search");
    // Neutral ring override present; brand-red ring NOT applied on this input.
    expect(input.className).toContain("focus-visible:ring-input");
    expect(input.className).not.toContain("focus-visible:ring-ring");
    // Not force-focused red on mount.
    expect(document.activeElement).not.toBe(input);
    // No invalid / error semantics on a valid (empty) field.
    expect(input.getAttribute("aria-invalid")).not.toBe("true");
    expect(input.className).not.toMatch(/border-destructive|ring-destructive|border-red|ring-red/);
  });

  it("lists ALL glossary terms when the search query is empty", () => {
    renderGlossary();
    // "Showing N terms" reflects the full unfiltered set on an empty query.
    expect(screen.getByText(new RegExp(`Showing ${ENTRIES.length} terms`))).toBeTruthy();
  });
});

describe("FIX #10 — Glossary source invariants", () => {
  const SRC = fs.readFileSync(
    path.resolve(__dirname, "..", "Glossary.tsx"),
    "utf8",
  );

  it("no longer force-focuses the search input on load", () => {
    // The search <Input> block must not carry an autoFocus prop.
    const inputBlock = SRC.slice(SRC.indexOf('data-testid="input-glossary-search"') - 400,
                                SRC.indexOf('data-testid="input-glossary-search"'));
    expect(inputBlock).not.toMatch(/\bautoFocus\b/);
  });

  it("applies the neutral focus ring token to the search input", () => {
    expect(SRC).toMatch(/focus-visible:ring-input/);
  });

  it("preserves the search input data-testid", () => {
    expect(SRC).toContain('data-testid="input-glossary-search"');
  });
});
