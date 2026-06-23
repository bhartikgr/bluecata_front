/**
 * Sprint 18 Phase 2 — T3.3 Global stock-exchange catalog.
 *
 * Per SPRINT-18-MANDATE.md T3.3. Two-step picker: pick country, then pick
 * exchange filtered by country. Plus a freeform "ticker symbol" input.
 */

export type Exchange = {
  code: string;
  label: string;
  country: string; // ISO-3166 α2
};

export const EXCHANGES: Exchange[] = [
  // US
  { code: "NYSE", label: "NYSE", country: "US" },
  { code: "NYSEAM", label: "NYSE American", country: "US" },
  { code: "NASDAQ_GS", label: "NASDAQ Global Select", country: "US" },
  { code: "NASDAQ_GM", label: "NASDAQ Global Market", country: "US" },
  { code: "NASDAQ_CM", label: "NASDAQ Capital Market", country: "US" },
  { code: "OTCQX", label: "OTCQX", country: "US" },
  { code: "OTCQB", label: "OTCQB", country: "US" },
  { code: "OTC_PINK", label: "OTC Pink", country: "US" },
  // CA
  { code: "TSX", label: "TSX (Toronto)", country: "CA" },
  { code: "TSXV", label: "TSXV (Venture)", country: "CA" },
  { code: "CSE", label: "CSE (Canadian Securities Exchange)", country: "CA" },
  { code: "CBOE_CA", label: "Cboe Canada (NEO/Aequitas)", country: "CA" },
  // UK
  { code: "LSE", label: "LSE Main Market", country: "GB" },
  { code: "AIM", label: "LSE AIM", country: "GB" },
  { code: "AQSE", label: "AQUIS (AQSE)", country: "GB" },
  // EU + EUR
  { code: "EN_PARIS", label: "Euronext Paris", country: "FR" },
  { code: "EN_AMSTERDAM", label: "Euronext Amsterdam", country: "NL" },
  { code: "EN_BRUSSELS", label: "Euronext Brussels", country: "BE" },
  { code: "EN_LISBON", label: "Euronext Lisbon", country: "PT" },
  { code: "EN_DUBLIN", label: "Euronext Dublin", country: "IE" },
  { code: "EN_OSLO", label: "Euronext Oslo", country: "NO" },
  { code: "FWB", label: "Frankfurt (FWB)", country: "DE" },
  { code: "XETRA", label: "Xetra", country: "DE" },
  { code: "DB_SCALE", label: "Deutsche Börse Scale", country: "DE" },
  { code: "SIX", label: "SIX Swiss Exchange", country: "CH" },
  { code: "BME", label: "BME Madrid", country: "ES" },
  { code: "BIT_STAR", label: "Borsa Italiana — STAR", country: "IT" },
  { code: "BIT_AIM", label: "Borsa Italiana — AIM Italia", country: "IT" },
  { code: "WBAG", label: "Vienna (WBAG)", country: "AT" },
  { code: "WSE", label: "Warsaw (WSE)", country: "PL" },
  { code: "NEWCONNECT", label: "NewConnect", country: "PL" },
  { code: "ATHEX", label: "Athens", country: "GR" },
  { code: "OMX_STO", label: "OMX Stockholm", country: "SE" },
  { code: "OMX_HEL", label: "OMX Helsinki", country: "FI" },
  { code: "OMX_CPH", label: "OMX Copenhagen", country: "DK" },
  { code: "ICEX", label: "Iceland", country: "IS" },
  // SG
  { code: "SGX_MAIN", label: "SGX Mainboard", country: "SG" },
  { code: "SGX_CATALIST", label: "SGX Catalist", country: "SG" },
  // HK
  { code: "HKEX_MAIN", label: "HKEX Main Board", country: "HK" },
  { code: "HKEX_GEM", label: "HKEX GEM", country: "HK" },
  // CN
  { code: "SSE_MAIN", label: "SSE Main", country: "CN" },
  { code: "SSE_STAR", label: "SSE STAR Market", country: "CN" },
  { code: "SZSE_MAIN", label: "SZSE Main", country: "CN" },
  { code: "SZSE_CHINEXT", label: "SZSE ChiNext", country: "CN" },
  { code: "BSE_BJ", label: "BSE (Beijing Stock Exchange)", country: "CN" },
  // IN
  { code: "BSE_MAIN", label: "BSE Main", country: "IN" },
  { code: "BSE_SME", label: "BSE SME", country: "IN" },
  { code: "NSE_MAIN", label: "NSE Main", country: "IN" },
  { code: "NSE_EMERGE", label: "NSE Emerge", country: "IN" },
  { code: "MSEI", label: "MSEI", country: "IN" },
  // JP
  { code: "TSE_PRIME", label: "TSE Prime", country: "JP" },
  { code: "TSE_STD", label: "TSE Standard", country: "JP" },
  { code: "TSE_GROWTH", label: "TSE Growth", country: "JP" },
  { code: "NSE_NAGOYA", label: "NSE Nagoya", country: "JP" },
  { code: "SSE_SAPPORO", label: "SSE Sapporo", country: "JP" },
  { code: "FSE_FUKUOKA", label: "FSE Fukuoka", country: "JP" },
  // AU
  { code: "ASX", label: "ASX", country: "AU" },
  { code: "NSX", label: "NSX (National Stock Exchange of Australia)", country: "AU" },
  { code: "CBOE_AU", label: "Cboe Australia", country: "AU" },
  { code: "SSX", label: "Sydney Stock Exchange (SSX)", country: "AU" },
  // NZ
  { code: "NZX_MAIN", label: "NZX Main", country: "NZ" },
  { code: "NZX_GROWTH", label: "NZX Growth", country: "NZ" },
  { code: "NZX_SPV", label: "NZX SPV", country: "NZ" },
  // KR
  { code: "KOSPI", label: "KOSPI", country: "KR" },
  { code: "KOSDAQ", label: "KOSDAQ", country: "KR" },
  { code: "KONEX", label: "KONEX", country: "KR" },
  // TW
  { code: "TWSE", label: "TWSE Main", country: "TW" },
  { code: "TPEX", label: "TPEx (Taipei OTC)", country: "TW" },
  { code: "TW_EMERGING", label: "Emerging Stock Market", country: "TW" },
  // MY
  { code: "BURSA_MAIN", label: "Bursa Malaysia Main", country: "MY" },
  { code: "BURSA_ACE", label: "Bursa ACE", country: "MY" },
  { code: "BURSA_LEAP", label: "Bursa LEAP", country: "MY" },
  // TH
  { code: "SET", label: "SET", country: "TH" },
  { code: "MAI", label: "MAI", country: "TH" },
  // PH
  { code: "PSE_MAIN", label: "PSE Main", country: "PH" },
  // ID
  { code: "IDX_MAIN", label: "IDX Main", country: "ID" },
  { code: "IDX_ACCEL", label: "IDX Acceleration", country: "ID" },
  { code: "IDX_DEV", label: "IDX Development", country: "ID" },
  // VN
  { code: "HOSE", label: "HOSE", country: "VN" },
  { code: "HNX", label: "HNX", country: "VN" },
  { code: "UPCOM", label: "UPCoM", country: "VN" },
  // IL
  { code: "TASE_MAIN", label: "TASE Main", country: "IL" },
  { code: "TASE_UP", label: "TASE-Up", country: "IL" },
  // AE
  { code: "ADX", label: "ADX (Abu Dhabi)", country: "AE" },
  { code: "DFM", label: "DFM (Dubai)", country: "AE" },
  // SA
  { code: "TADAWUL", label: "Tadawul Main", country: "SA" },
  { code: "NOMU", label: "Nomu Parallel", country: "SA" },
  // ZA
  { code: "JSE_MAIN", label: "JSE Main", country: "ZA" },
  { code: "JSE_ALTX", label: "JSE AltX", country: "ZA" },
  // BR
  { code: "B3_MAIN", label: "B3 (Bovespa) Main", country: "BR" },
  { code: "B3_MAIS", label: "B3 Bovespa Mais", country: "BR" },
  // MX
  { code: "BMV", label: "BMV Main", country: "MX" },
  { code: "BIVA", label: "BIVA", country: "MX" },
  { code: "BMV_SME", label: "MXN-SME", country: "MX" },
];

export const EXCHANGE_COUNTRIES: { code: string; label: string }[] = (() => {
  const set = new Map<string, string>();
  const labels: Record<string, string> = {
    US: "United States", CA: "Canada", GB: "United Kingdom", FR: "France", NL: "Netherlands",
    BE: "Belgium", PT: "Portugal", IE: "Ireland", NO: "Norway", DE: "Germany", CH: "Switzerland",
    ES: "Spain", IT: "Italy", AT: "Austria", PL: "Poland", GR: "Greece", SE: "Sweden",
    FI: "Finland", DK: "Denmark", IS: "Iceland", SG: "Singapore", HK: "Hong Kong", CN: "China",
    IN: "India", JP: "Japan", AU: "Australia", NZ: "New Zealand", KR: "South Korea",
    TW: "Taiwan", MY: "Malaysia", TH: "Thailand", PH: "Philippines", ID: "Indonesia",
    VN: "Vietnam", IL: "Israel", AE: "UAE", SA: "Saudi Arabia", ZA: "South Africa",
    BR: "Brazil", MX: "Mexico",
  };
  for (const e of EXCHANGES) {
    if (!set.has(e.country)) set.set(e.country, labels[e.country] || e.country);
  }
  return Array.from(set, ([code, label]) => ({ code, label })).sort((a, b) => a.label.localeCompare(b.label));
})();

export function exchangesForCountry(country: string): Exchange[] {
  return EXCHANGES.filter(e => e.country === country);
}
