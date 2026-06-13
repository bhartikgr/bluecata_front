/**
 * Sprint 11 — Single source of truth for region/jurisdiction dropdowns.
 *
 * Every region picker in the app MUST consume REGIONS_ALL or REGION_CODES
 * to guarantee the 9-region matrix is applied uniformly:
 *
 *   US, CA, UK, SG, HK, CN, IN, JP, AU
 *
 * Anywhere a stale 4-region or 6-region constant existed, it must be
 * replaced with this list. The Sprint 11 region-coverage test asserts
 * that every element of REGION_CODES has full template/partner coverage.
 */
export type Region9 = "US" | "CA" | "UK" | "SG" | "HK" | "CN" | "IN" | "JP" | "AU";

export const REGION_CODES: ReadonlyArray<Region9> = [
  "US", "CA", "UK", "SG", "HK", "CN", "IN", "JP", "AU",
] as const;

export const REGIONS_ALL: ReadonlyArray<{
  code: Region9;
  name: string;
  jurisdiction: string;
  currency: string;
  flag: string;
}> = [
  { code: "US", name: "United States",  jurisdiction: "Delaware C-Corp / Reg D",                  currency: "USD", flag: "🇺🇸" },
  { code: "CA", name: "Canada",         jurisdiction: "CBCA / OBCA",                              currency: "CAD", flag: "🇨🇦" },
  { code: "UK", name: "United Kingdom", jurisdiction: "Companies Act 2006 / EIS / SEIS",          currency: "GBP", flag: "🇬🇧" },
  { code: "SG", name: "Singapore",      jurisdiction: "Companies Act / SFA / Pte. Ltd.",          currency: "SGD", flag: "🇸🇬" },
  { code: "HK", name: "Hong Kong",      jurisdiction: "Cap. 622 / SFC",                           currency: "HKD", flag: "🇭🇰" },
  { code: "CN", name: "China",          jurisdiction: "Company Law / WFOE / VIE",                 currency: "CNY", flag: "🇨🇳" },
  { code: "IN", name: "India",          jurisdiction: "Companies Act 2013 / SEBI",                currency: "INR", flag: "🇮🇳" },
  { code: "JP", name: "Japan",          jurisdiction: "Companies Act / J-KISS / FEFTA §27",       currency: "JPY", flag: "🇯🇵" },
  { code: "AU", name: "Australia",      jurisdiction: "Corporations Act 2001 / ASIC",             currency: "AUD", flag: "🇦🇺" },
];

export const REGION_NAME: Record<Region9, string> = Object.fromEntries(
  REGIONS_ALL.map((r) => [r.code, r.name]),
) as Record<Region9, string>;

export function isRegion9(code: string): code is Region9 {
  return (REGION_CODES as ReadonlyArray<string>).includes(code);
}
