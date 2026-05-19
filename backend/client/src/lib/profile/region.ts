/**
 * Region resolver — country_of_incorporation_code -> cap-table engine Region.
 *
 * The engine ships 9 regional formula packs (US/CA/UK/SG/HK/CN/IN/JP/AU). Any
 * other country falls back to "Custom" which uses the engine's neutral US-style
 * defaults. Production: this same function runs in the backend before
 * persisting the company profile, so the `region` column on `companies` is
 * always derivable from `country_of_incorporation_code`.
 *
 * This is the single most important sync in Sprint 8 — the value returned by
 * this function drives:
 *   - /founder/captable engine selection ("Computed by [REGION]-default v1.0.0")
 *   - /founder/rounds/new region selector default
 *   - Term-sheet template selection (templates are region-tagged)
 *   - KYC variant for any investor invited to a round on this company
 */

import type { Region } from "@capavate/cap-table-engine";

/** All Regions the engine supports. */
export const ENGINE_REGIONS: readonly Region[] = ["US", "CA", "UK", "SG", "HK", "CN", "IN", "JP", "AU", "Custom"] as const;

/** Map country code (ISO-3166-α2) -> engine Region. */
const COUNTRY_TO_REGION: Record<string, Region> = {
  US: "US",
  CA: "CA",
  GB: "UK",
  SG: "SG",
  HK: "HK",
  CN: "CN",
  IN: "IN",
  JP: "JP",
  AU: "AU",
};

/**
 * Resolve engine Region from a country code. Returns "Custom" if the country
 * does not have a regional formula pack.
 */
export function regionForCountry(countryCode: string | null | undefined): Region {
  if (!countryCode) return "Custom";
  return COUNTRY_TO_REGION[countryCode] ?? "Custom";
}

/** Engine attribution string for badges: "Computed by IN-default v1.0.0". */
export function engineAttribution(region: Region, version = "1.0.0"): string {
  return `Computed by ${region}-default v${version}`;
}

/**
 * Default term-sheet template id for a region. Kept in sync with the
 * region-tagged templates in `client/src/lib/termsheet/templates.ts`.
 */
export function defaultTermSheetTemplate(region: Region): string {
  switch (region) {
    case "US": return "us_nvca_seed";
    case "CA": return "ca_nvca_inspired_seed";
    case "UK": return "uk_bvca_seed";
    case "SG": return "sg_pte_seed";
    case "HK": return "hk_seed";
    case "CN": return "cn_wfoe_seed";
    case "IN": return "in_pvt_seed";
    case "JP": return "jp_kk_seed";
    case "AU": return "au_pty_seed";
    case "Custom": return "us_nvca_seed";
  }
}
