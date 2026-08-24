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

/**
 * Engine attribution string. NOT FOR DISPLAY — this is the machine-shaped value
 * persisted on the company-profile sync object (`legal.engineAttribution`) and
 * asserted by `__tests__/companyProfile.test.ts`. Wave 108 · Finding 2: anything
 * a HUMAN reads must use `regionConventionName` / `regionConventionLabel` below,
 * which name the jurisdictional convention in words and carry no package name
 * and no version number.
 */
export function engineAttribution(region: Region, version = "1.0.0"): string {
  return `Computed by ${region}-default v${version}`;
}

/* ════════════════════════════════════════════════════════════════════════════
   WAVE 108 · FINDING 2 — KEEP THE MEANING, DROP THE MACHINE FORM.
   ════════════════════════════════════════════════════════════════════════════
   A founder in Hong Kong read "Computed by HK-default v1.0.0" on their own cap
   table. The badge was NOT deleted, and must not be: WHICH jurisdictional
   convention produced a share count is information an investor and an auditor
   both need — a Hong Kong option-pool convention and a US one do not give the
   same fully-diluted number. What has to go is the internal form of it: the
   region CODE, the pack name and the version string. So the same fact is stated
   in words a reader already understands, and the code stays available to
   machines in `data-region` / `data-testid` / CSV export (R77).
   ════════════════════════════════════════════════════════════════════════════ */

const REGION_CONVENTION_NAME: Record<Region, string> = {
  US: "United States",
  CA: "Canada",
  UK: "United Kingdom",
  SG: "Singapore",
  HK: "Hong Kong",
  CN: "Mainland China",
  IN: "India",
  JP: "Japan",
  AU: "Australia",
  Custom: "international default",
};

/** The jurisdiction whose cap-table convention is in force, in words. */
export function regionConventionName(region: Region): string {
  return REGION_CONVENTION_NAME[region] ?? "international default";
}

/**
 * Human-facing attribution for a badge or a footer: "Hong Kong cap-table
 * conventions". Never contains a package name, a region code or a version.
 */
export function regionConventionLabel(region: Region): string {
  const name = regionConventionName(region);
  return region === "Custom"
    ? "International default cap-table conventions"
    : `${name} cap-table conventions`;
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
