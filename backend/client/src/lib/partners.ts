/**
 * Capavate Collective consortium partner directory.
 *
 * NOTE: This is a placeholder registry of publicly-known firms with
 * cap-table / startup-financing practices in each region. Replace with the
 * actual Capavate Collective directory at integration time. Partners listed
 * here have NOT confirmed Collective membership; this file exists to wire
 * the introduction flow end-to-end against realistic firm names.
 */

export type Region = "US" | "CA" | "UK" | "SG" | "HK" | "CN" | "IN" | "JP" | "AU";
export type PartnerType = "law" | "accounting" | "incubator" | "accelerator";

export interface ConsortiumPartner {
  id: string;
  region: Region;
  firmName: string;
  type: PartnerType;
  description: string;
  regionalSpecialty: string;
  url: string;
  slaBusinessDays: number;
  /**
   * Sprint 16 A3 — portfolio gating.
   *
   * Partners are visible in any directory only if they currently have at
   * least one Capavate-side portfolio company. Empty/missing array → the
   * partner is hidden from founders, investors, admins, term-sheet picker,
   * and profile sidebars.
   */
  portfolioCompanies?: string[];
}

export const CONSORTIUM_PARTNERS: ConsortiumPartner[] = [
  // ----- US -----
  { id: "us-cooley", region: "US", firmName: "Cooley LLP", type: "law", description: "Top venture-tech firm; Series A NVCA model author for many YC-backed companies.", regionalSpecialty: "Delaware C-Corp; YC SAFE; NVCA priced rounds; 409A; 83(b).", url: "https://www.cooley.com/", slaBusinessDays: 3, portfolioCompanies: ["co_novapay"] },
  { id: "us-wsgr", region: "US", firmName: "Wilson Sonsini Goodrich & Rosati", type: "law", description: "Silicon Valley pioneer; deep VC, public-company, and IP practice.", regionalSpecialty: "Series A through Series D; secondaries; reverse mergers; Reg D 506(b)/(c).", url: "https://www.wsgr.com/", slaBusinessDays: 3 },
  { id: "us-latham", region: "US", firmName: "Latham & Watkins", type: "law", description: "Global firm with strong growth-equity, late-stage venture, and IPO practices.", regionalSpecialty: "Late-stage venture; cross-border; SEC compliance; M&A.", url: "https://www.lw.com/", slaBusinessDays: 4 },

  // ----- CA -----
  { id: "ca-stikeman", region: "CA", firmName: "Stikeman Elliott", type: "law", description: "Leading Canadian business-law firm with extensive VC and startup practice.", regionalSpecialty: "CCPC structuring; NI 45-106 prospectus exemptions; cross-border US/CA.", url: "https://www.stikeman.com/", slaBusinessDays: 4 },
  { id: "ca-bennett", region: "CA", firmName: "Bennett Jones", type: "law", description: "National firm with focused emerging-companies and venture practice.", regionalSpecialty: "Toronto/Calgary tech; SR&ED; CCPC stock options; IFRS 2.", url: "https://www.bennettjones.com/", slaBusinessDays: 4 },
  { id: "ca-osler", region: "CA", firmName: "Osler, Hoskin & Harcourt", type: "law", description: "Tier-1 Canadian firm; widely used by Series A+ Canadian startups.", regionalSpecialty: "Cross-border financings; capital markets; tax-efficient holdco structures.", url: "https://www.osler.com/", slaBusinessDays: 4 },

  // ----- UK -----
  { id: "uk-bird", region: "UK", firmName: "Bird & Bird", type: "law", description: "Tech-focused international firm with strong UK/EU venture practice.", regionalSpecialty: "BVCA model docs; SEIS/EIS; EMI option scheme; data + AI compliance.", url: "https://www.twobirds.com/", slaBusinessDays: 5, portfolioCompanies: ["co_arboreal"] },
  { id: "uk-tw", region: "UK", firmName: "Taylor Wessing", type: "law", description: "Mid-market venture and growth firm; large fintech and life-sciences book.", regionalSpecialty: "Seed–Series B; convertible loan notes; HMRC valuations; SEIS/EIS advance assurance.", url: "https://www.taylorwessing.com/", slaBusinessDays: 5 },
  { id: "uk-mishcon", region: "UK", firmName: "Mishcon de Reya", type: "law", description: "Boutique London firm; well-known for founder-friendly representation.", regionalSpecialty: "Founder counsel; share schemes; cap-table audits; immigration for founders.", url: "https://www.mishcon.com/", slaBusinessDays: 5 },

  // ----- SG -----
  { id: "sg-drew", region: "SG", firmName: "Drew & Napier", type: "law", description: "Singapore Big-4 firm with strong SE-Asia VC and corporate practice.", regionalSpecialty: "ACRA filings; MAS regulatory; VCC structures; cross-border SE-Asia.", url: "https://www.drewnapier.com/", slaBusinessDays: 5 },
  { id: "sg-allen", region: "SG", firmName: "Allen & Gledhill", type: "law", description: "Top-tier Singapore firm with deep regional venture-capital experience.", regionalSpecialty: "VCC; IRAS s13H; lead-investor side letters; HK/SG holdco split.", url: "https://www.allenandgledhill.com/", slaBusinessDays: 5 },
  { id: "sg-rajah", region: "SG", firmName: "Rajah & Tann", type: "law", description: "Pan-ASEAN firm with the largest regional footprint among SE-Asia firms.", regionalSpecialty: "ASEAN cross-border; Indonesia/Vietnam structuring; M&A.", url: "https://www.rajahtann.com/", slaBusinessDays: 5 },

  // ----- HK -----
  { id: "hk-mb", region: "HK", firmName: "Mayer Brown HK", type: "law", description: "International firm with strong Greater China venture and PE practice.", regionalSpecialty: "Cayman parent + HK OpCo; HKEX-aware; SFC-licensed offers.", url: "https://www.mayerbrown.com/", slaBusinessDays: 5 },
  { id: "hk-ke", region: "HK", firmName: "Kirkland & Ellis HK", type: "law", description: "Premier private-equity and growth-equity firm in the Asia region.", regionalSpecialty: "Late-stage growth equity; pre-IPO; Cayman/BVI structures.", url: "https://www.kirkland.com/", slaBusinessDays: 5 },
  { id: "hk-skadden", region: "HK", firmName: "Skadden, Arps, Slate, Meagher & Flom HK", type: "law", description: "Top-tier US firm with HK-based China growth and IPO practice.", regionalSpecialty: "HKEX listings; US-listed China names; Reg S/144A.", url: "https://www.skadden.com/", slaBusinessDays: 5 },

  // ----- CN -----
  { id: "cn-kwm", region: "CN", firmName: "King & Wood Mallesons", type: "law", description: "Largest mainland-China-rooted international firm; strong VC/PE.", regionalSpecialty: "WFOE/VIE; SAFE Circular 37; SAMR filings; onshore-offshore split.", url: "https://www.kwm.com/", slaBusinessDays: 7 },
  { id: "cn-junhe", region: "CN", firmName: "Junhe LLP", type: "law", description: "Leading independent Chinese law firm with deep cross-border VC practice.", regionalSpecialty: "Cross-border venture; FDI; CFIUS-aware deal structuring.", url: "https://www.junhe.com/", slaBusinessDays: 7 },
  { id: "cn-hankun", region: "CN", firmName: "Han Kun Law Offices", type: "law", description: "Premier China VC/PE firm; advised on many growth-stage rounds.", regionalSpecialty: "RMB/USD dual structures; pre-IPO; phantom-equity ESOPs.", url: "https://www.hankunlaw.com/", slaBusinessDays: 7 },

  // ----- IN -----
  { id: "in-khaitan", region: "IN", firmName: "Khaitan & Co", type: "law", description: "Tier-1 Indian firm with extensive startup, VC, and regulatory practice.", regionalSpecialty: "Companies Act 2013; CCPS/CCD; FEMA non-debt rules; DPIIT recognition.", url: "https://www.khaitanco.com/", slaBusinessDays: 7 },
  { id: "in-azb", region: "IN", firmName: "AZB & Partners", type: "law", description: "Premier Indian corporate firm with deep VC-fund and startup work.", regionalSpecialty: "SEBI AIF Regulations 2012; cross-border investments; ODI/FDI.", url: "https://www.azbpartners.com/", slaBusinessDays: 7 },
  { id: "in-cyril", region: "IN", firmName: "Cyril Amarchand Mangaldas", type: "law", description: "Largest full-service Indian law firm; major M&A and venture practice.", regionalSpecialty: "Series A+; venture debt; angel-tax §56(2)(viib) exemptions; SEBI SBEB.", url: "https://www.cyrilshroff.com/", slaBusinessDays: 7 },

  // ----- JP -----
  { id: "jp-amt", region: "JP", firmName: "Anderson Mōri & Tomotsune", type: "law", description: "Top Japanese firm with strong venture and tech corporate practice.", regionalSpecialty: "Kabushiki Kaisha class shares (種類株式); FEFTA §27; J-KISS rounds.", url: "https://www.amt-law.com/", slaBusinessDays: 7 },
  { id: "jp-na", region: "JP", firmName: "Nishimura & Asahi", type: "law", description: "Largest Japanese firm; full-service venture and corporate practice.", regionalSpecialty: "Pre-IPO; Tokyo Pro Market; tax-qualified options under ITA §29-2.", url: "https://www.nishimura.com/", slaBusinessDays: 7 },
  { id: "jp-mhm", region: "JP", firmName: "Mori Hamada & Matsumoto", type: "law", description: "Leading Japanese corporate firm with deep VC/PE and cross-border practice.", regionalSpecialty: "Cross-border venture; FEFTA prior notification; class-share structures.", url: "https://www.mhmjapan.com/", slaBusinessDays: 7 },

  // ----- AU -----
  { id: "au-allens", region: "AU", firmName: "Allens", type: "law", description: "Top Australian firm allied with Linklaters; major venture practice.", regionalSpecialty: "Corporations Act 2001; ESS startup concession §83A-105; FIRB approvals.", url: "https://www.allens.com.au/", slaBusinessDays: 5 },
  { id: "au-hsf", region: "AU", firmName: "Herbert Smith Freehills", type: "law", description: "Tier-1 international firm; strong AU venture and capital-markets practice.", regionalSpecialty: "Series A+; ASIC Form 484; foreign-investor due diligence; AFSL guidance.", url: "https://www.herbertsmithfreehills.com/", slaBusinessDays: 5 },
  { id: "au-gtlaw", region: "AU", firmName: "Gilbert + Tobin", type: "law", description: "Australian independent firm widely used by Aussie tech founders.", regionalSpecialty: "Founder-friendly counsel; ESS schemes; SAFE Australian-law variants.", url: "https://www.gtlaw.com.au/", slaBusinessDays: 5 },
];

export function partnersByRegion(region: Region): ConsortiumPartner[] {
  return CONSORTIUM_PARTNERS.filter(p => p.region === region);
}

export function partnerById(id: string): ConsortiumPartner | undefined {
  return CONSORTIUM_PARTNERS.find(p => p.id === id);
}

/**
 * Sprint 16 A3 — portfolio gating rule.
 *
 * Filter the partner list to those who hold at least one ACTIVE Capavate
 * company. Apply this everywhere partners surface (founder Round wizard,
 * admin partner directory, term-sheet partner picker, profile sidebars).
 *
 * @param activeCapavateCompanyIds  Currently-active Capavate company IDs.
 *                                  When a company exits, callers should pass
 *                                  the new (post-exit) list — partners whose
 *                                  only co was that company will fall off.
 */
export function visiblePartners(activeCapavateCompanyIds: string[]): ConsortiumPartner[] {
  const active = new Set(activeCapavateCompanyIds);
  return CONSORTIUM_PARTNERS.filter(p =>
    p.portfolioCompanies?.some(cid => active.has(cid)) ?? false
  );
}

export function visiblePartnersByRegion(region: Region, activeCapavateCompanyIds: string[]): ConsortiumPartner[] {
  return visiblePartners(activeCapavateCompanyIds).filter(p => p.region === region);
}

export const REGIONS_LIST: Region[] = ["US", "CA", "UK", "SG", "HK", "CN", "IN", "JP", "AU"];
