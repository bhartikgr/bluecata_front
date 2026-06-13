/**
 * Production-shape enum tables.
 *
 * Every enum here is the EXACT set of values that production Postgres will
 * store. UI labels are separated from canonical machine values so that the
 * Postgres column is a `text` constrained by a CHECK constraint matching
 * `value`, and the live website renders `label`. See
 * `capavate_collective_sync_schema.md` — these enums travel verbatim across
 * the Capavate ↔ Collective outbox.
 *
 * Source of truth:
 *   - capavate_founder_deep_audit.md §1 + §B.4 (industry, employees, M&A enums)
 *   - capavate_investor_deep_audit.md §1-§3 (investor type, accred, cheque, stage, etc.)
 */

export type EnumOption<V extends string = string> = {
  /** Canonical wire value (Postgres column value, sync-schema payload value). */
  value: V;
  /** UI display label (live Capavate site exact match). */
  label: string;
  /** Optional plain-language helper (HelpTip text). */
  description?: string;
};

/** Enforce literal-string narrowing on enum option lists. */
function opts<const T extends readonly EnumOption[]>(o: T): T { return o; }

/* -------------------------------------------------------------------- */
/* Founder Company Profile — Step 1 (Contact Info)                       */
/* -------------------------------------------------------------------- */

/** 50 industry options exactly as documented in audit §1. Sorted A-Z. */
export const INDUSTRY_OPTIONS = opts([
  { value: "aerospace_defense",          label: "Aerospace & Defense" },
  { value: "agriculture_farming",        label: "Agriculture & Farming" },
  { value: "ai_ml",                      label: "Artificial Intelligence & Machine Learning" },
  { value: "automotive",                 label: "Automotive" },
  { value: "banking_financial_services", label: "Banking & Financial Services" },
  { value: "biotechnology",              label: "Biotechnology" },
  { value: "chemical_industry",          label: "Chemical Industry" },
  { value: "construction_engineering",   label: "Construction & Engineering" },
  { value: "consumer_goods",             label: "Consumer Goods" },
  { value: "cybersecurity",              label: "Cybersecurity" },
  { value: "data_storage_management",    label: "Data Storage & Management" },
  { value: "education_training",         label: "Education & Training" },
  { value: "ev_sustainable_transport",   label: "Electric Vehicles & Sustainable Transportation" },
  { value: "energy_utilities",           label: "Energy & Utilities" },
  { value: "entertainment_media",        label: "Entertainment & Media" },
  { value: "environmental_sustainability", label: "Environmental Services & Sustainability" },
  { value: "fashion_apparel",            label: "Fashion & Apparel" },
  { value: "fintech_digital_payments",   label: "Fintech & Digital Payments" },
  { value: "food_beverage",              label: "Food & Beverage" },
  { value: "gaming_esports",             label: "Gaming & Esports" },
  { value: "healthcare_pharma",          label: "Healthcare & Pharmaceuticals" },
  { value: "heavy_industry",             label: "Heavy Industry" },
  { value: "hospitality_tourism",        label: "Hospitality & Tourism" },
  { value: "information_technology",     label: "Information Technology (IT)" },
  { value: "insurance",                  label: "Insurance" },
  { value: "jewelry_luxury",             label: "Jewelry & Luxury Goods" },
  { value: "legal_services",             label: "Legal Services" },
  { value: "logistics_supply_chain",     label: "Logistics & Supply Chain" },
  { value: "manufacturing",              label: "Manufacturing" },
  { value: "mining_metals",              label: "Mining & Metals" },
  { value: "nanotechnology",             label: "Nanotechnology" },
  { value: "pet_care",                   label: "Pet Care & Supplies" },
  { value: "public_administration",      label: "Public Administration & Government Services" },
  { value: "quantum_computing",          label: "Quantum Computing" },
  { value: "real_estate",                label: "Real Estate & Property Management" },
  { value: "retail_ecommerce",           label: "Retail & E-commerce" },
  { value: "robotics",                   label: "Robotics" },
  { value: "security_surveillance",      label: "Security & Surveillance" },
  { value: "social_media_marketing",     label: "Social Media & Digital Marketing" },
  { value: "space_satellite",            label: "Space Exploration & Satellite Technology" },
  { value: "sports_fitness",             label: "Sports & Fitness" },
  { value: "supply_chain_procurement",   label: "Supply Chain & Procurement" },
  { value: "telecommunications",         label: "Telecommunications" },
  { value: "traditional_crafts",         label: "Traditional Crafts & Artisanal Goods" },
  { value: "transportation_logistics",   label: "Transportation & Logistics" },
  { value: "venture_capital_pe",         label: "Venture Capital & Private Equity" },
  { value: "video_game_industry",        label: "Video Game Industry" },
  { value: "waste_management",           label: "Waste Management" },
] as const);

export type IndustryValue = typeof INDUSTRY_OPTIONS[number]["value"];

export const EMPLOYEE_COUNT_OPTIONS = opts([
  { value: "1-10",      label: "1–10 employees" },
  { value: "11-50",     label: "11–50 employees" },
  { value: "51-200",    label: "51–200 employees" },
  { value: "201-500",   label: "201–500 employees" },
  { value: "501-1000",  label: "501–1,000 employees" },
  { value: "1000+",     label: "1,000+ employees" },
] as const);
export type EmployeeCountValue = typeof EMPLOYEE_COUNT_OPTIONS[number]["value"];

/* -------------------------------------------------------------------- */
/* Founder Company Profile — Step 4 (M&A Intelligence)                   */
/* -------------------------------------------------------------------- */

/** 12 strategic priorities — audit §1 / Strategic Intent Field 1. */
export const STRATEGIC_PRIORITY_OPTIONS = opts([
  { value: "market_expansion",       label: "Market expansion (geographic or segment growth)" },
  { value: "tech_acquisition",       label: "Technology acquisition / product capabilities" },
  { value: "vertical_integration",   label: "Vertical integration (upstream or downstream)" },
  { value: "cost_efficiencies",      label: "Cost efficiencies / scale synergies" },
  { value: "rd_innovation",          label: "R&D and innovation (including new product lines)" },
  { value: "talent_acquihire",       label: "Talent acquisition / acqui-hire and leadership depth" },
  { value: "portfolio_diversification", label: "Portfolio diversification / new revenue streams" },
  { value: "customer_distribution",  label: "Customer access / distribution partnerships and channels" },
  { value: "brand_strengthening",    label: "Brand strengthening and competitive positioning" },
  { value: "risk_mitigation",        label: "Risk mitigation / supply-chain resilience / regulatory positioning" },
  { value: "capital_balance_sheet",  label: "Capital access / balance-sheet optimization or partial exit for founders" },
  { value: "no_intention",           label: "No intention" },
] as const);
export type StrategicPriorityValue = typeof STRATEGIC_PRIORITY_OPTIONS[number]["value"];

export const TRANSACTION_INTEREST_OPTIONS = opts([
  { value: "jv_partnership",       label: "JV partnerships" },
  { value: "minority_investment",  label: "Minority strategic investment" },
  { value: "majority_sale",        label: "Majority sale" },
  { value: "full_exit",            label: "Full exit" },
  { value: "strategic_acquisition", label: "Strategic acquisitions" },
] as const);
export type TransactionInterestValue = typeof TRANSACTION_INTEREST_OPTIONS[number]["value"];

export const PARTNER_TYPE_OPTIONS = opts([
  { value: "distribution",   label: "Distribution" },
  { value: "technology",     label: "Technology" },
  { value: "manufacturing",  label: "Manufacturing" },
  { value: "co_development", label: "Co-development" },
  { value: "capital",        label: "Capital" },
  { value: "data_sharing",   label: "Data-sharing" },
  { value: "ip_licensing",   label: "IP-licensing" },
  { value: "rd",             label: "R&D" },
  { value: "biz_dev",        label: "Business development" },
] as const);
export type PartnerTypeValue = typeof PARTNER_TYPE_OPTIONS[number]["value"];

export const DEAL_BREAKER_OPTIONS = opts([
  { value: "all_options",    label: "We will explore all options" },
  { value: "sale_of_control", label: "Sale of control" },
  { value: "exclusivity",    label: "Exclusivity" },
  { value: "license_core_ip", label: "Licensing core IP" },
] as const);
export type DealBreakerValue = typeof DEAL_BREAKER_OPTIONS[number]["value"];

export const OPERATING_GEOGRAPHY_OPTIONS = opts([
  { value: "local",            label: "Local only (single city/metro area)" },
  { value: "national",         label: "National only (within one country)" },
  { value: "north_america",    label: "North America" },
  { value: "latin_america",    label: "Latin America" },
  { value: "south_america",    label: "South America" },
  { value: "western_europe",   label: "Western Europe" },
  { value: "eastern_europe",   label: "Eastern Europe" },
  { value: "middle_east",      label: "Middle East" },
  { value: "africa",           label: "Africa" },
  { value: "central_asia",     label: "Central Asia" },
  { value: "south_asia",       label: "South Asia" },
  { value: "southeast_asia",   label: "Southeast Asia" },
  { value: "east_asia",        label: "East Asia (excluding China/Hong Kong)" },
  { value: "china_hong_kong",  label: "China / Hong Kong" },
  { value: "oceania",          label: "Oceania (Australia, NZ, Pacific Islands)" },
] as const);
export type OperatingGeographyValue = typeof OPERATING_GEOGRAPHY_OPTIONS[number]["value"];

export const CUSTOMER_SEGMENT_OPTIONS = opts([
  { value: "enterprise",  label: "Enterprise" },
  { value: "mid_market",  label: "Mid-market" },
  { value: "smb",         label: "SMB" },
  { value: "government",  label: "Government" },
  { value: "consumer",    label: "Consumer" },
] as const);
export type CustomerSegmentValue = typeof CUSTOMER_SEGMENT_OPTIONS[number]["value"];

/* -------------------------------------------------------------------- */
/* Step 3 — Entity Type (jurisdiction-aware)                             */
/* -------------------------------------------------------------------- */

/**
 * Entity type options. The full union is stored in Postgres as a `text`
 * column constrained to these values. The UI filters this list per the
 * selected `country_of_incorporation_code`. See `entityTypesForCountry`.
 */
export const ENTITY_TYPE_OPTIONS = opts([
  // US (Sprint 18 Phase 2 T3.2 — expanded)
  { value: "us_c_corp",      label: "US — C-Corporation" },
  { value: "us_s_corp",      label: "US — S-Corporation" },
  { value: "us_llc",         label: "US — LLC" },
  { value: "us_lp",          label: "US — Limited Partnership (LP)" },
  { value: "us_llp",         label: "US — Limited Liability Partnership (LLP)" },
  { value: "us_sole_prop",   label: "US — Sole Proprietorship" },
  { value: "us_b_corp",      label: "US — B-Corp (Certified Benefit)" },
  { value: "us_pbc",         label: "US — Public Benefit Corporation" },
  // Canada
  // L-004 fix v23.4.13: add jurisdiction-specific CA entity types
  { value: "ca_inc_cbca",    label: "CA — Federal Corporation (CBCA)" },
  { value: "ca_inc_on",      label: "CA — Ontario Corporation" },
  { value: "ca_inc_bc",      label: "CA — BC Corporation" },
  { value: "ca_inc",         label: "CA — Provincial Corporation" },
  { value: "ca_ulc",         label: "CA — Unlimited Liability Corp. (ULC)" },
  { value: "ca_partnership", label: "CA — Partnership" },
  { value: "ca_lp",          label: "CA — Limited Partnership (LP)" },
  { value: "ca_llp",         label: "CA — Limited Liability Partnership (LLP)" },
  { value: "ca_sole_prop",   label: "CA — Sole Proprietorship" },
  { value: "ca_coop",        label: "CA — Co-operative" },
  // UK
  { value: "uk_ltd",         label: "UK — Private Limited (Ltd)" },
  { value: "uk_plc",         label: "UK — Public Limited (PLC)" },
  { value: "uk_llp",         label: "UK — Limited Liability Partnership" },
  { value: "uk_lp",          label: "UK — Limited Partnership (LP)" },
  { value: "uk_sole_trader", label: "UK — Sole Trader" },
  { value: "uk_cic",         label: "UK — Community Interest Company (CIC)" },
  // Singapore
  { value: "sg_pte_ltd",     label: "Singapore — Private Limited (Pte Ltd)" },
  { value: "sg_ltd",         label: "Singapore — Public Company Ltd" },
  { value: "sg_sole_prop",   label: "Singapore — Sole Proprietorship" },
  { value: "sg_partnership", label: "Singapore — Partnership" },
  { value: "sg_llp",         label: "Singapore — LLP" },
  // Hong Kong
  { value: "hk_limited",     label: "Hong Kong — Private Limited (Ltd)" },
  { value: "hk_public_ltd",  label: "Hong Kong — Public Limited (Ltd)" },
  { value: "hk_branch",      label: "Hong Kong — Branch Office" },
  // China
  { value: "cn_wfoe",        label: "China — WFOE" },
  { value: "cn_jv",          label: "China — Joint Venture" },
  { value: "cn_llc",         label: "China — Domestic LLC (有限责任公司)" },
  { value: "cn_jsc",         label: "China — Joint-Stock Company (股份有限公司)" },
  { value: "cn_rep_office",  label: "China — Representative Office" },
  // India
  { value: "in_pvt_ltd",     label: "India — Private Limited (Pvt Ltd)" },
  { value: "in_public_ltd",  label: "India — Public Limited" },
  { value: "in_llp",         label: "India — LLP" },
  { value: "in_opc",         label: "India — One Person Company (OPC)" },
  { value: "in_sole_prop",   label: "India — Sole Proprietorship" },
  { value: "in_partnership", label: "India — Partnership" },
  // Japan
  { value: "jp_kk",          label: "Japan — Kabushiki Kaisha (KK)" },
  { value: "jp_gk",          label: "Japan — Godo Kaisha (GK)" },
  { value: "jp_goshi",       label: "Japan — Goshi Kaisha" },
  { value: "jp_gomei",       label: "Japan — Gomei Kaisha" },
  // Australia
  { value: "au_pty_ltd",     label: "Australia — Proprietary Ltd (Pty Ltd)" },
  { value: "au_ltd",         label: "Australia — Public Co (Ltd)" },
  { value: "au_trust",       label: "Australia — Trust" },
  { value: "au_partnership", label: "Australia — Partnership" },
  { value: "au_sole_trader", label: "Australia — Sole Trader" },
  { value: "other",          label: "Other / Not listed" },
] as const);
export type EntityTypeValue = typeof ENTITY_TYPE_OPTIONS[number]["value"];

/** Filter entity types to those typical for a country. UI uses this. */
export function entityTypesForCountry(countryCode: string): typeof ENTITY_TYPE_OPTIONS[number][] {
  const map: Record<string, EntityTypeValue[]> = {
    US: ["us_c_corp", "us_s_corp", "us_llc", "us_lp", "us_llp", "us_sole_prop", "us_b_corp", "us_pbc", "other"],
    CA: ["ca_inc_cbca", "ca_inc_on", "ca_inc_bc", "ca_inc", "ca_ulc", "ca_partnership", "ca_lp", "ca_llp", "ca_sole_prop", "ca_coop", "other"],
    GB: ["uk_ltd", "uk_plc", "uk_llp", "uk_lp", "uk_sole_trader", "uk_cic", "other"],
    IN: ["in_pvt_ltd", "in_public_ltd", "in_llp", "in_opc", "in_sole_prop", "in_partnership", "other"],
    JP: ["jp_kk", "jp_gk", "jp_goshi", "jp_gomei", "other"],
    AU: ["au_pty_ltd", "au_ltd", "au_trust", "au_partnership", "au_sole_trader", "other"],
    SG: ["sg_pte_ltd", "sg_ltd", "sg_sole_prop", "sg_partnership", "sg_llp", "other"],
    HK: ["hk_limited", "hk_public_ltd", "hk_branch", "other"],
    CN: ["cn_wfoe", "cn_jv", "cn_llc", "cn_jsc", "cn_rep_office", "other"],
  };
  const allowed = map[countryCode];
  if (!allowed) return ENTITY_TYPE_OPTIONS.filter(o => o.value === "other");
  return ENTITY_TYPE_OPTIONS.filter(o => allowed.includes(o.value));
}

/* -------------------------------------------------------------------- */
/* Investor Profile — Step 2                                             */
/* -------------------------------------------------------------------- */

/** 19 investor types per audit §2. */
export const INVESTOR_TYPE_OPTIONS = opts([
  { value: "accelerator",                    label: "Accelerator" },
  { value: "advisor",                        label: "Advisor (consultant to companies)" },
  { value: "angel_individual",               label: "Angel investor (Individual)" },
  { value: "angel_network",                  label: "Angel network or angel club" },
  { value: "bank_financial_institution",     label: "Bank / Financial institution" },
  { value: "corporate_vc",                   label: "Corporate venture capital / strategic corporate investor" },
  { value: "crowdfunding",                   label: "Crowdfunding platform / crowd investor vehicle" },
  { value: "employee_esop",                  label: "Employee (via ESOP)" },
  { value: "family_office",                  label: "Family office (direct investing)" },
  { value: "fund_of_funds",                  label: "Fund-of-funds or investment company" },
  { value: "government_grant",               label: "Government (grant) or quasi-government fund" },
  { value: "hedge_fund",                     label: "Hedge fund" },
  { value: "impact_esg",                     label: "Impact or ESG-focused investment fund" },
  { value: "incubator",                      label: "Incubator" },
  { value: "micro_vc",                       label: "Micro VC / emerging fund manager (pre-seed/seed specialist)" },
  { value: "pe_growth",                      label: "Private equity / growth equity fund (late-stage or special situations)" },
  { value: "rep_accredited_individual",      label: "Representative of an accredited individual (advisor, family office CIO, etc.)" },
  { value: "spv_lead",                       label: "Syndicate lead or SPV manager (investing on behalf of a pooled vehicle)" },
  { value: "venture_capital",                label: "Venture capital fund (institutional VC)" },
] as const);
export type InvestorTypeValue = typeof INVESTOR_TYPE_OPTIONS[number]["value"];

/** Accredited status — exactly 3 options + null (Not Sure). */
export const ACCREDITED_STATUS_OPTIONS = opts([
  { value: "accredited",     label: "Yes — Accredited" },
  { value: "non_accredited", label: "No — Non-Accredited" },
  { value: "not_sure",       label: "Not Sure" },
] as const);
export type AccreditedStatusValue = typeof ACCREDITED_STATUS_OPTIONS[number]["value"];

/* -------------------------------------------------------------------- */
/* Investor Profile — Step 3                                             */
/* -------------------------------------------------------------------- */

/** 45 industry expertise options per audit §3. Distinct from founder INDUSTRY_OPTIONS. */
export const INDUSTRY_EXPERTISE_OPTIONS = opts([
  { value: "aerospace_defense", label: "Aerospace & Defense" },
  { value: "agriculture_farming", label: "Agriculture & Farming" },
  { value: "ai_ml", label: "Artificial Intelligence & Machine Learning" },
  { value: "banking_financial_services", label: "Banking & Financial Services" },
  { value: "chemical_industry", label: "Chemical Industry" },
  { value: "construction_engineering", label: "Construction & Engineering" },
  { value: "cybersecurity", label: "Cybersecurity" },
  { value: "data_storage_management", label: "Data Storage & Management" },
  { value: "education_training", label: "Education & Training" },
  { value: "ev_sustainable_transport", label: "Electric Vehicles & Sustainable Transportation" },
  { value: "energy_utilities", label: "Energy & Utilities" },
  { value: "entertainment_media", label: "Entertainment & Media" },
  { value: "environmental_sustainability", label: "Environmental Services & Sustainability" },
  { value: "fashion_apparel", label: "Fashion & Apparel" },
  { value: "fintech_digital_payments", label: "Fintech & Digital Payments" },
  { value: "food_beverage", label: "Food & Beverage" },
  { value: "gaming_esports", label: "Gaming & Esports" },
  { value: "healthcare_pharma", label: "Healthcare & Pharmaceuticals" },
  { value: "heavy_industry", label: "Heavy Industry" },
  { value: "hospitality_tourism", label: "Hospitality & Tourism" },
  { value: "information_technology", label: "Information Technology (IT)" },
  { value: "insurance", label: "Insurance" },
  { value: "jewelry_luxury", label: "Jewelry & Luxury Goods" },
  { value: "legal_services", label: "Legal Services" },
  { value: "logistics_supply_chain", label: "Logistics & Supply Chain" },
  { value: "manufacturing", label: "Manufacturing" },
  { value: "mining_metals", label: "Mining & Metals" },
  { value: "nanotechnology", label: "Nanotechnology" },
  { value: "pet_care", label: "Pet Care & Supplies" },
  { value: "public_administration", label: "Public Administration & Government Services" },
  { value: "quantum_computing", label: "Quantum Computing" },
  { value: "real_estate", label: "Real Estate & Property Management" },
  { value: "retail_ecommerce", label: "Retail & E-commerce" },
  { value: "robotics", label: "Robotics" },
  { value: "security_surveillance", label: "Security & Surveillance" },
  { value: "social_media_marketing", label: "Social Media & Digital Marketing" },
  { value: "space_satellite", label: "Space Exploration & Satellite Technology" },
  { value: "sports_fitness", label: "Sports & Fitness" },
  { value: "supply_chain_procurement", label: "Supply Chain & Procurement" },
  { value: "telecommunications", label: "Telecommunications" },
  { value: "traditional_crafts", label: "Traditional Crafts & Artisanal Goods" },
  { value: "transportation_logistics", label: "Transportation & Logistics" },
  { value: "venture_capital_pe", label: "Venture Capital & Private Equity" },
  { value: "video_game_industry", label: "Video Game Industry" },
  { value: "waste_management", label: "Waste Management" },
] as const);
export type IndustryExpertiseValue = typeof INDUSTRY_EXPERTISE_OPTIONS[number]["value"];

export const CHEQUE_SIZE_OPTIONS = opts([
  { value: "lt_25k",    label: "Less than $25k" },
  { value: "25k_50k",   label: "$25k–$50k" },
  { value: "50k_100k",  label: "$50k–$100k" },
  { value: "100k_250k", label: "$100k–$250k" },
  { value: "250k_500k", label: "$250k–$500k" },
  { value: "500k_1m",   label: "$500k–$1M" },
  { value: "1m_5m",     label: "$1M–$5M" },
  { value: "gt_5m",     label: "$5M+" },
] as const);
export type ChequeSizeValue = typeof CHEQUE_SIZE_OPTIONS[number]["value"];

export const GEOGRAPHY_FOCUS_OPTIONS = opts([
  { value: "home_market",  label: "Home Market Only" },
  { value: "home_country", label: "Home Country" },
  { value: "global",       label: "Open to Global / Cross-Border" },
] as const);
export type GeographyFocusValue = typeof GEOGRAPHY_FOCUS_OPTIONS[number]["value"];

export const PREFERRED_STAGE_OPTIONS = opts([
  { value: "pre_seed",   label: "Pre-Seed" },
  { value: "seed",       label: "Seed" },
  { value: "series_a",   label: "Series A" },
  { value: "series_b",   label: "Series B" },
  { value: "series_c_plus", label: "Series C+" },
  { value: "growth",     label: "Growth" },
  { value: "late_stage", label: "Late Stage" },
] as const);
export type PreferredStageValue = typeof PREFERRED_STAGE_OPTIONS[number]["value"];

export const HANDS_ON_OPTIONS = opts([
  { value: "mentoring",          label: "Mentoring" },
  { value: "board_roles",        label: "Board Roles" },
  { value: "intros_deal_flow",   label: "Intros / Deal Flow" },
  { value: "portfolio_support",  label: "Portfolio Support" },
  { value: "passive",            label: "Passive" },
] as const);
export type HandsOnValue = typeof HANDS_ON_OPTIONS[number]["value"];

export const MA_INTEREST_OPTIONS = opts([
  { value: "ma_advisory",          label: "M&A Advisory" },
  { value: "buyouts",              label: "Buyouts" },
  { value: "mergers",              label: "Mergers" },
  { value: "strategic_partnerships", label: "Strategic Partnerships" },
  { value: "pe_rollups",           label: "PE Roll-ups" },
  { value: "distressed_assets",    label: "Distressed Assets" },
  { value: "cross_border_ma",      label: "Cross-border M&A" },
] as const);
export type MaInterestValue = typeof MA_INTEREST_OPTIONS[number]["value"];

export const INVESTMENT_INTEREST_OPTIONS = opts([
  { value: "full_sale_exits",         label: "Full Sale Exits" },
  { value: "recapitalizations",       label: "Recapitalizations" },
  { value: "ipos_listings",           label: "IPOs / Listings" },
  { value: "secondaries",             label: "Secondaries" },
  { value: "structured_exits",        label: "Structured Exits" },
  { value: "buybacks_redemptions",    label: "Buybacks / Redemptions" },
  { value: "mbos_sponsor_deals",      label: "MBOs / Sponsor Deals" },
  { value: "partial_liquidity",       label: "Partial Liquidity" },
  { value: "distress_assets",         label: "Distress Assets" },
  { value: "cross_border_distribution", label: "Cross-border Distribution" },
  { value: "joint_ventures_strategic", label: "Joint Ventures / Strategic Partnerships" },
] as const);
export type InvestmentInterestValue = typeof INVESTMENT_INTEREST_OPTIONS[number]["value"];

/* -------------------------------------------------------------------- */
/* KYC / Jurisdiction-aware accreditation variants                       */
/* -------------------------------------------------------------------- */

/**
 * Maps an investor's `country_of_tax_residency_code` to the accreditation
 * regime that applies. Production reads this to choose which evidence the
 * investor must upload and which third-party verification flow is invoked.
 */
export const KYC_VARIANT_OPTIONS = opts([
  { value: "us_reg_d_506c",         label: "US — Reg D 506(c) third-party verification" },
  { value: "eu_gdpr_professional",  label: "EU — Professional client opt-in (GDPR-aware)" },
  { value: "uk_self_certified",     label: "UK — Self-certified Sophisticated / High-net-worth" },
  { value: "ca_ni_45_106",          label: "Canada — NI 45-106 accredited investor" },
  { value: "sg_accredited",         label: "Singapore — MAS Accredited Investor declaration" },
  { value: "hk_professional",       label: "Hong Kong — SFC Professional Investor" },
  { value: "in_fema_kyc",           label: "India — FEMA / RBI KYC" },
  { value: "cn_safe_circular_37",   label: "China — SAFE Circular 37 disclosure" },
  { value: "jp_qii",                label: "Japan — Qualified Institutional Investor (QII)" },
  { value: "au_sophisticated",      label: "Australia — Sophisticated Investor (s708)" },
  { value: "generic",               label: "Other — generic KYC + AML" },
] as const);
export type KycVariantValue = typeof KYC_VARIANT_OPTIONS[number]["value"];

export function kycVariantForCountry(countryCode: string): KycVariantValue {
  const map: Record<string, KycVariantValue> = {
    US: "us_reg_d_506c",
    GB: "uk_self_certified",
    CA: "ca_ni_45_106",
    SG: "sg_accredited",
    HK: "hk_professional",
    IN: "in_fema_kyc",
    CN: "cn_safe_circular_37",
    JP: "jp_qii",
    AU: "au_sophisticated",
    DE: "eu_gdpr_professional", FR: "eu_gdpr_professional", IT: "eu_gdpr_professional",
    ES: "eu_gdpr_professional", NL: "eu_gdpr_professional", BE: "eu_gdpr_professional",
    AT: "eu_gdpr_professional", IE: "eu_gdpr_professional", PT: "eu_gdpr_professional",
    SE: "eu_gdpr_professional", DK: "eu_gdpr_professional", FI: "eu_gdpr_professional",
    PL: "eu_gdpr_professional", LU: "eu_gdpr_professional",
  };
  return map[countryCode] ?? "generic";
}
