/**
 * WAVE 106 · FINDINGS 2-5 — what a human reads on a partner screen.
 *
 * Governing ruling being fenced: rendered text must never expose an internal
 * identifier, a machine code, a storage unit, or this project's internals.
 * Machine-readable VALUES are explicitly fine — a `data-testid`, an error `code`
 * in a payload, a query key. This file therefore checks LABELS, HELP TEXT and
 * RENDERED VALUES, and deliberately never objects to a testid.
 *
 * Pre-wave failures each block below reproduces:
 *   F2  the SPV Fees tab printed its own storage keys next to a correct value —
 *       `managementCarryPct 0.2`, `commitmentMinor $1,000.00` — beside "carry 20%".
 *   F3  money fields asked for "(minor)" / "(minor units)" with no statement of
 *       what the digits meant: a 100x error one keystroke away.
 *   F4  raw round-stage tokens, a raw jurisdiction enum, snake_case waterfall
 *       tiers, raw company/user ids and raw ISO timestamps.
 *   F5  a field's border did not follow its validity.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  activityTypeLabel,
  attributionSourceLabel,
  formatTimestamp,
  formatDateOnly,
  actorDisplay,
} from "../partnerDisplay";
import { fieldValidityClass, fieldValidityProps, INVALID_FIELD_CLASS } from "../fieldValidityClass";
import { formatFractionAsPercent } from "../percentDisplay";
import { feeFieldLabel, feeFieldValue } from "@/components/partner/SpvOperationsPanels";
import { minorUnitsLabel, minorUnitsLabelNoCurrency, waterfallTierLabel } from "@/components/partner/SpvDetailTabs";

const ROOT = path.resolve(__dirname, "../../../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/* The partner-facing surfaces this wave is responsible for. */
const PARTNER_SURFACES = [
  "client/src/pages/partner/PartnerSpvEngine.tsx",
  "client/src/pages/partner/PartnerClients.tsx",
  "client/src/pages/partner/PartnerDashboard.tsx",
  "client/src/components/partner/SpvDetailTabs.tsx",
  "client/src/components/partner/SpvOperationsPanels.tsx",
  "client/src/components/partner/AttributionProvenancePanel.tsx",
];

describe("W106 F2 — the fee ledger reads as money and percentages, not as storage keys", () => {
  it("labels every field in human words, with no camelCase, no `Minor`, no `Pct`", () => {
    const keys = [
      "managementCarryPct",
      "commitmentMinor",
      "managementFeeMinor",
      "carriedInterestMinor",
      "netToLpMinor",
      "grossProceedsMinor",
      "feesUnknown",
      "someFieldNobodyMappedYetMinor",
    ];
    for (const k of keys) {
      const label = feeFieldLabel(k);
      expect(label, k).not.toMatch(/[a-z][A-Z]/); // camelCase
      expect(label, k).not.toMatch(/_/); // snake_case
      expect(label, k).not.toMatch(/Minor|minor units/);
      expect(label, k).not.toMatch(/\bPct\b/);
      expect(label.trim().length, k).toBeGreaterThan(2);
    }
  });

  it("renders a stored fraction of 0.2 as 20% — never 0.2% and never 2000%", () => {
    const rendered = feeFieldValue("managementCarryPct", 0.2, "USD");
    expect(rendered).toBe("20%");
    expect(rendered).not.toBe("0.2%");
    expect(rendered).not.toBe("2000%");
    /* the shared renderer the rest of the product uses, pinned alongside */
    expect(formatFractionAsPercent(0.2)).toBe("20%");
  });

  it("renders stored minor-unit money as formatted currency, and states an unknown", () => {
    expect(feeFieldValue("commitmentMinor", 100000, "USD")).toBe("$1,000.00");
    expect(feeFieldValue("feesUnknown", true, "USD").toLowerCase()).not.toContain("true");
    expect(String(feeFieldValue("commitmentMinor", null, "USD"))).not.toContain("null");
  });
});

describe("W106 F3 — a smallest-unit money field says so, in words", () => {
  it("names the currency and its smallest unit, and never the phrase 'minor units'", () => {
    const label = minorUnitsLabel("Gross proceeds", "USD");
    expect(label).toContain("Gross proceeds");
    expect(label).toContain("USD");
    expect(label).toContain("cents");
    expect(label.toLowerCase()).not.toContain("minor");
    expect(minorUnitsLabelNoCurrency("Minimum check").toLowerCase()).not.toContain("minor");
  });

  it("no partner-facing money field is labelled '(minor)' or 'minor units' any more", () => {
    for (const rel of PARTNER_SURFACES) {
      /* Comments are not screen copy: this wave's own explanatory comments name
         the old wording on purpose, so they are removed before scanning. */
      const src = read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      /* Only LABEL/placeholder text is policed. Identifiers in code (a
         `commitmentMinor` property, a `minorUnitsLabel` helper name) are values,
         not rendered copy, and are explicitly allowed. */
      const rendered = src.match(/(?:>|")[^"<>{}]*\bminor units\b[^"<>{}]*(?:<|")/gi) ?? [];
      expect(rendered, rel).toEqual([]);
      expect(src, rel).not.toContain("(minor)</Label>");
      expect(src, rel).not.toContain("proceeds (minor)");
    }
  });
});

describe("W106 F4 — machine codes, ids and timestamps do not reach the screen", () => {
  it("waterfall tiers render in Title Case words", () => {
    expect(waterfallTierLabel("return_of_capital")).toBe("Return of Capital");
    expect(waterfallTierLabel("preferred_return")).toBe("Preferred Return");
    expect(waterfallTierLabel("gp_catch_up")).toBe("GP Catch-Up");
    expect(waterfallTierLabel("lp_residual")).toBe("LP Residual");
    for (const t of ["return_of_capital", "preferred_return", "gp_catch_up", "gp_carry", "lp_profit", "lp_residual", "some_future_tier"]) {
      expect(waterfallTierLabel(t), t).not.toMatch(/_/);
      expect(waterfallTierLabel(t)[0], t).toMatch(/[A-Z]/);
    }
  });

  it("activity types and attribution sources render as words", () => {
    expect(activityTypeLabel("stage_change")).toBe("Stage change");
    expect(activityTypeLabel("some_new_event")).toBe("Some new event");
    expect(activityTypeLabel(null)).toBe("Activity");
    expect(attributionSourceLabel("partner_claim")).not.toMatch(/_/);
    expect(attributionSourceLabel("admin_manual")).not.toMatch(/_/);
    expect(attributionSourceLabel(undefined)).toBe("Not recorded");
  });

  it("a raw ISO timestamp is never rendered, and an unknown time is stated", () => {
    const out = formatTimestamp("2026-07-27T12:46:53.408Z");
    expect(out).not.toContain("T12:46:53");
    expect(out).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(formatTimestamp(null)).toBe("Time not recorded");
    expect(formatTimestamp("not a date")).toBe("Time not recorded");
    expect(formatDateOnly(null)).toBe("Date not recorded");
    expect(formatDateOnly("2026-07-27T12:46:53.408Z")).not.toMatch(/T/);
  });

  it("a synthetic platform id is never passed off as a person's name", () => {
    const a = actorDisplay("u_redeemed_1783181835779");
    expect(a.text).not.toContain("u_redeemed");
    expect(a.reference).toBe("u_redeemed_1783181835779"); // still available, but labelled by the caller
    expect(actorDisplay("Shadie Broumandi").text).toBe("Shadie Broumandi");
    expect(actorDisplay("Shadie Broumandi").reference).toBeNull();
    expect(actorDisplay(null).text).toBe("Not recorded");
  });

  it("no partner surface prints a raw round-stage token or a raw jurisdiction enum as copy", () => {
    const engine = read("client/src/pages/partner/PartnerSpvEngine.tsx");
    expect(engine).not.toContain('placeholder="e.g. seed, series_a"');
    expect(engine).toContain('placeholder="e.g. Seed, Series A"');
    /* the derived-jurisdiction footnote used to print the enum itself */
    expect(engine).not.toContain("Engine jurisdiction ({w.jurisdiction})");
  });

  it("the Recent activity list and the provenance panel no longer print raw values", () => {
    const dash = read("client/src/pages/partner/PartnerDashboard.tsx");
    expect(dash).not.toContain(">{a.activityType}<");
    expect(dash).toContain("activityTypeLabel(a.activityType)");
    const prov = read("client/src/components/partner/AttributionProvenancePanel.tsx");
    expect(prov).not.toContain("{a.attributedAt || ");
    expect(prov).toContain("formatTimestamp(a.attributedAt)");
    const clients = read("client/src/pages/partner/PartnerClients.tsx");
    expect(clients).not.toContain(">{c.attributionSource}<");
    expect(clients).not.toContain(">Company ID<");
  });
});

describe("W106 F5 — a field's border follows its validity", () => {
  it("clears the invalid ring the moment the value becomes valid", () => {
    expect(fieldValidityClass(false)).toBe(INVALID_FIELD_CLASS);
    expect(fieldValidityClass(false)).toMatch(/rose/);
    expect(fieldValidityClass(true)).toBe(""); // nothing left behind
    expect(fieldValidityProps(true)).toEqual({ className: "", "aria-invalid": false });
    expect(fieldValidityProps(false)["aria-invalid"]).toBe(true);
  });

  it("the two reported wizard fields are driven by that one predicate, not by a separate flag", () => {
    const engine = read("client/src/pages/partner/PartnerSpvEngine.tsx");
    expect(engine).toContain('fieldValidityProps(w.name.trim().length > 0)');
    expect(engine).toContain('fieldValidityProps(w.mandateDescription.trim().length > 0)');
    /* Same file, same helper: one shared pattern rather than two patched sites. */
    expect(engine.match(/fieldValidityProps\(/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
