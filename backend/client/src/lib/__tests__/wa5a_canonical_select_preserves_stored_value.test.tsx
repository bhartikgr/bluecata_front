/**
 * WAVE A2 · ITEMS 5a / 5b / 7a — THE ONE PROPERTY THE DROPDOWNS MUST HAVE.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE DEFECT THIS FILE EXISTS TO FORBID
 * ══════════════════════════════════════════════════════════════════════════════
 * Sector, Stage, HQ, SPV-template Jurisdiction and SPV-template Currency were
 * free-text boxes. Turning a free-text box into a dropdown is the single most
 * dangerous shape of change available on these screens, because a native
 * `<select value={x}>` whose option set does not contain `x` DOES NOT RENDER `x`.
 * The browser selects the FIRST option, the DOM silently disagrees with React's
 * controlled value, and the next submit writes that first option to the database.
 * A partner who typed "Deep-Sea Robotics" would be shown "Fintech" and would
 * eventually have "Fintech" stored — a silent data change presented as a fact,
 * which R195.5 and R242 forbid.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * THE CONTROL COMES FIRST — THE DISAGREEMENT BEFORE THE AGREEMENT
 * ══════════════════════════════════════════════════════════════════════════════
 * `CONTROL` below renders the NAIVE dropdown (canonical options only) in the real
 * jsdom DOM and asserts that it really does fail: the stored value is NOT what the
 * element reports. That is the mechanism, demonstrated, not assumed. Only then
 * does `FIX` render the same value through `canonicalSelectOptions` and assert the
 * element reports it unchanged. If the control ever stops failing, this file's
 * agreement half proves nothing and the control assertion turns RED to say so.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * WHAT IS NOT MOCKED
 * ══════════════════════════════════════════════════════════════════════════════
 * Nothing. The canonical lists are the real shipped modules, imported here and
 * counted here. The DOM is the real jsdom `HTMLSelectElement`, so what is asserted
 * is the browser's own coercion behaviour and not a re-implementation of it.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import {
  CANONICAL_NOT_SPECIFIED_LABEL,
  CANONICAL_OFF_LIST_SUFFIX,
  canonicalSelectOptions,
  composeHq,
  hqCityPart,
  hqCountryPart,
  isOffCanonicalList,
} from "../canonicalFieldOptions";
import { COLLECTIVE_SECTORS_45, COLLECTIVE_STAGES } from "@shared/schema";
import { SPV_JURISDICTIONS, SPV_JURISDICTION_LABELS } from "@shared/spvEngine";
import { COUNTRIES } from "../profile/data/countries";
import { buildCurrencyOptions } from "../currencyOptions";

const COUNTRY_NAMES = COUNTRIES.map((c) => c.name);
const CURRENCY_CODES = buildCurrencyOptions().map((c) => c.code);

/** A sector no canonical list contains, and never will. */
const OFF_LIST_SECTOR = "Deep-Sea Robotics";

afterEach(() => cleanup());

describe("A · CONTROL — the naive dropdown really does lose the value", () => {
  it("a <select> whose options exclude the stored value reports a DIFFERENT value", () => {
    render(
      <select data-testid="naive" defaultValue={OFF_LIST_SECTOR}>
        {COLLECTIVE_SECTORS_45.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>,
    );
    const el = screen.getByTestId("naive") as HTMLSelectElement;
    /* THE DISAGREEMENT, MEASURED. Not "it might"; it does. */
    expect(el.value).not.toBe(OFF_LIST_SECTOR);
    /* And what it reports instead is the FIRST option — a real sector name that
       nobody chose. This is the exact shape of the silent data change. */
    expect(el.value).toBe(COLLECTIVE_SECTORS_45[0]);
    expect(el.value).toBe("Fintech");
  });

  it("the same loss happens for a stored jurisdiction key and a stored currency code", () => {
    render(
      <>
        <select data-testid="naive-j" defaultValue="republic_of_atlantis">
          {SPV_JURISDICTIONS.map((j) => (
            <option key={j} value={j}>{SPV_JURISDICTION_LABELS[j]}</option>
          ))}
        </select>
        <select data-testid="naive-c" defaultValue="ZZZ">
          {CURRENCY_CODES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </>,
    );
    const j = screen.getByTestId("naive-j") as HTMLSelectElement;
    const c = screen.getByTestId("naive-c") as HTMLSelectElement;
    expect(j.value).not.toBe("republic_of_atlantis");
    expect(j.value).toBe(SPV_JURISDICTIONS[0]);
    expect(c.value).not.toBe("ZZZ");
    expect(c.value).toBe(CURRENCY_CODES[0]);
  });
});

describe("B · FIX — canonicalSelectOptions makes the loss unrepresentable", () => {
  it("an off-list sector is reported back by the DOM unchanged, and is MARKED", () => {
    render(
      <select data-testid="fixed" defaultValue={OFF_LIST_SECTOR}>
        {canonicalSelectOptions(OFF_LIST_SECTOR, COLLECTIVE_SECTORS_45).map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>,
    );
    const el = screen.getByTestId("fixed") as HTMLSelectElement;
    expect(el.value).toBe(OFF_LIST_SECTOR);
    /* The reader is told it is the partner's own words, not a Capavate term. */
    const selected = el.options[el.selectedIndex];
    expect(selected.textContent).toBe(`${OFF_LIST_SECTOR}${CANONICAL_OFF_LIST_SUFFIX}`);
    /* And every canonical member is still offered: 45 + "Not specified" + the
       off-list value = 47 options. Counted, not assumed. */
    expect(el.options.length).toBe(COLLECTIVE_SECTORS_45.length + 2);
    expect(el.options.length).toBe(47);
  });

  it("the same holds for jurisdiction (16) and currency (156)", () => {
    render(
      <>
        <select data-testid="fix-j" defaultValue="republic_of_atlantis">
          {canonicalSelectOptions("republic_of_atlantis", SPV_JURISDICTIONS, {
            omitNotSpecified: true,
            labelFor: (k) => SPV_JURISDICTION_LABELS[k as keyof typeof SPV_JURISDICTION_LABELS] ?? k,
          }).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select data-testid="fix-c" defaultValue="ZZZ">
          {canonicalSelectOptions("ZZZ", CURRENCY_CODES, { omitNotSpecified: true }).map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </>,
    );
    const j = screen.getByTestId("fix-j") as HTMLSelectElement;
    const c = screen.getByTestId("fix-c") as HTMLSelectElement;
    expect(j.value).toBe("republic_of_atlantis");
    expect(c.value).toBe("ZZZ");
    /* omitNotSpecified: 16 + the off-list value, and 156 + the off-list value.
       No empty option on a required field, because `normaliseCurrency` in
       server/spvTemplateStore.ts turns a blank currency into USD (R262). */
    expect(j.options.length).toBe(SPV_JURISDICTIONS.length + 1);
    expect(j.options.length).toBe(17);
    expect(c.options.length).toBe(CURRENCY_CODES.length + 1);
    expect(c.options.length).toBe(157);
    for (const o of Array.from(j.options)) expect(o.value).not.toBe("");
    for (const o of Array.from(c.options)) expect(o.value).not.toBe("");
  });

  it("an ON-list value gets NO extra option and NO marking", () => {
    const opts = canonicalSelectOptions("Fintech", COLLECTIVE_SECTORS_45);
    expect(opts.length).toBe(COLLECTIVE_SECTORS_45.length + 1);
    expect(opts.filter((o) => o.label.includes(CANONICAL_OFF_LIST_SUFFIX)).length).toBe(0);
    expect(opts[0]).toEqual({ value: "", label: CANONICAL_NOT_SPECIFIED_LABEL });
  });

  it("an EMPTY value is absence, not an off-list value", () => {
    expect(isOffCanonicalList("", COLLECTIVE_SECTORS_45)).toBe(false);
    expect(isOffCanonicalList(null, COLLECTIVE_SECTORS_45)).toBe(false);
    expect(isOffCanonicalList(undefined, COLLECTIVE_SECTORS_45)).toBe(false);
    const opts = canonicalSelectOptions("", COLLECTIVE_SECTORS_45);
    expect(opts.length).toBe(COLLECTIVE_SECTORS_45.length + 1);
    expect(opts[0].value).toBe("");
  });

  it("the value on the record is ALWAYS one of the option values — the structural claim", () => {
    const probes = [
      "",
      "Fintech",
      OFF_LIST_SECTOR,
      "fintech",            // wrong case is a DIFFERENT value and must survive as one
      " Fintech ",          // stray whitespace likewise
      "Not specified",      // the label of the empty option, as a real value
      "Robotics",
      "🇨🇦 Robotics",
    ];
    for (const p of probes) {
      const values = canonicalSelectOptions(p, COLLECTIVE_SECTORS_45).map((o) => o.value);
      expect(values, `no option can carry ${JSON.stringify(p)}`).toContain(p);
    }
  });
});

describe("C · the canonical lists are the shipped ones, at the counts measured", () => {
  it("counts", () => {
    expect(COLLECTIVE_SECTORS_45.length).toBe(45);
    expect(new Set(COLLECTIVE_SECTORS_45).size).toBe(45);
    expect(COLLECTIVE_STAGES.length).toBe(7);
    expect(COUNTRIES.length).toBe(250);
    expect(new Set(COUNTRY_NAMES).size).toBe(250);
    expect(SPV_JURISDICTIONS.length).toBe(16);
    expect(Object.keys(SPV_JURISDICTION_LABELS).length).toBe(16);
    expect(CURRENCY_CODES.length).toBe(156);
    expect(new Set(CURRENCY_CODES).size).toBe(156);
  });

  it("every jurisdiction key has a label, so no dropdown can show a raw storage key", () => {
    for (const j of SPV_JURISDICTIONS) {
      expect(SPV_JURISDICTION_LABELS[j], `no label for ${j}`).toBeTruthy();
      expect(SPV_JURISDICTION_LABELS[j]).not.toBe(j);
    }
  });
});

describe("D · ITEM 5b — the HQ split and re-compose lose nothing", () => {
  it("a trailing segment is the country ONLY when it exactly matches a country name", () => {
    expect(hqCountryPart("Toronto, Canada", COUNTRY_NAMES)).toBe("Canada");
    /* The shipped convention "San Francisco, CA" holds a US STATE code, not a
       country code. It must NOT be read as a country. */
    expect(hqCountryPart("San Francisco, CA", COUNTRY_NAMES)).toBe("");
    expect(hqCountryPart("Boston, MA", COUNTRY_NAMES)).toBe("");
    expect(hqCountryPart("Toronto, CA", COUNTRY_NAMES)).toBe("");
    expect(hqCountryPart("Canada", COUNTRY_NAMES)).toBe("Canada");
    expect(hqCountryPart("", COUNTRY_NAMES)).toBe("");
  });

  it("the city part keeps every character the partner typed", () => {
    expect(hqCityPart("Toronto, Canada", COUNTRY_NAMES)).toBe("Toronto");
    expect(hqCityPart("San Francisco, CA", COUNTRY_NAMES)).toBe("San Francisco, CA");
    expect(hqCityPart("Canada", COUNTRY_NAMES)).toBe("");
    expect(hqCityPart("Kraków, Nowa Huta, Poland", COUNTRY_NAMES)).toBe("Kraków, Nowa Huta");
  });

  it("choosing a country never destroys an existing value — it appends", () => {
    /* The shipped seed row, plus a chosen country. The original is intact. */
    const before = "San Francisco, CA";
    const after = composeHq(hqCityPart(before, COUNTRY_NAMES), "United States");
    expect(after).toBe("San Francisco, CA, United States");
    expect(after.startsWith(before)).toBe(true);
  });

  it("re-choosing a country REPLACES the country segment and does not stack them", () => {
    let hq = composeHq(hqCityPart("Toronto", COUNTRY_NAMES), "Canada");
    expect(hq).toBe("Toronto, Canada");
    hq = composeHq(hqCityPart(hq, COUNTRY_NAMES), "France");
    expect(hq).toBe("Toronto, France");
    /* And clearing the country leaves the city alone. */
    hq = composeHq(hqCityPart(hq, COUNTRY_NAMES), "");
    expect(hq).toBe("Toronto");
  });

  it("the country dropdown writes a FULL NAME, which is why it cannot manufacture USD", async () => {
    /* `deriveCurrencyFromRegion` (pages/founder/Settings.tsx) ends with
       `/, ?[a-z]{2}$/ -> "USD"`. This is the measured reason item 5b writes
       "Canada" and not "CA": the ISO code would have derived US dollars for a
       Canadian company, which R262 forbids. Asserted against the REAL function. */
    const { deriveCurrencyFromRegion } = await import("../../pages/founder/Settings");
    expect(deriveCurrencyFromRegion("Toronto, CA")).toBe("USD");
    expect(deriveCurrencyFromRegion("Toronto, Canada")).toBe("CAD");
    expect(deriveCurrencyFromRegion(composeHq("Toronto", "Canada"))).toBe("CAD");
  });
});
