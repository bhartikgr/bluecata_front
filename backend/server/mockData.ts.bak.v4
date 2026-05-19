/**
 * Mock data for the Sprint 1 preview. In production this is replaced by
 * Postgres + Drizzle queries (R200 §6).
 */

export const companies = [
  {
    id: "co_novapay",
    tenantId: "tn_novapay",
    name: "NovaPay AI",
    legalName: "NovaPay AI, Inc.",
    sector: "Fintech / AI Payments",
    stage: "Seed",
    hq: "San Francisco, CA",
    websiteUrl: "https://novapay.ai",
    description:
      "Agentic-AI payment routing for cross-border B2B settlements. We turn 5-day SWIFT flows into 90-second AI-orchestrated rails.",
    logoUrl: null,
    founded: "2023",
    employees: 14,
  },
  {
    id: "co_arboreal",
    tenantId: "tn_arboreal",
    name: "Arboreal Health",
    legalName: "Arboreal Health Sciences Ltd.",
    sector: "Digital Health",
    stage: "Pre-Seed",
    hq: "Boston, MA",
    websiteUrl: "https://arborealhealth.com",
    description:
      "Continuous biomarker tracking for chronic care. Closed-loop coaching layered on top of wearable + at-home labs.",
    logoUrl: null,
    founded: "2024",
    employees: 6,
  },
];

/* Cap table for NovaPay — math-correct, sums to 100% on a fully-diluted basis.
 *
 * Sprint 5 (institutional-grade) enrichments per NVCA / BVCA / Carta / Pulley convention:
 *   • certificateNumber          — single-source identifier on the share certificate (CS-1, PS-2, OPT-3…)
 *   • shareNumberFrom / To       — share-numbering ranges (1–4,000,000 etc.)
 *   • roundId                    — every security is attributed to the round it was issued in
 *   • vesting{months,cliff,start} — for option grants and restricted founder stock
 *   • drag, rofr, coSale, proRata — preferred-share rights flags surfaced inline on cap table
 *   • leadInvestorOfRound        — flag for the lead in each priced round
 *   • sideLetter                 — redacted summary if applicable (most-favored-nation, info rights, etc.)
 *   • interestRate / maturityDate / accruedInterest — for convertible notes
 *   • strike / expiry / fmv      — for warrants (intrinsic value derives from FMV − strike)
 *   • optionStatus               — granted | exercised | cancelled (for option pool sub-breakdown)
 */
export const securities = [
  {
    id: "sec_1",
    companyId: "co_novapay",
    holderName: "Maya Chen",
    holderType: "founder",
    instrument: "common",
    series: "Common",
    shares: 4_000_000,
    pricePerShare: 0.0001,
    investmentAmount: 400,
    cap: null,
    discount: null,
    issuedAt: "2023-04-01",
    certificateNumber: "CS-1",
    shareNumberFrom: 1,
    shareNumberTo: 4_000_000,
    roundId: "rnd_novapay_foundation",
    vesting: { months: 48, cliff: 12, startDate: "2023-04-01", percentVested: 100 },
    drag: true, rofr: true, coSale: true, proRata: false,
    leadInvestorOfRound: false,
    sideLetter: null,
    optionStatus: null,
  },
  {
    id: "sec_2",
    companyId: "co_novapay",
    holderName: "Daniel Okafor",
    holderType: "founder",
    instrument: "common",
    series: "Common",
    shares: 4_000_000,
    pricePerShare: 0.0001,
    investmentAmount: 400,
    cap: null,
    discount: null,
    issuedAt: "2023-04-01",
    certificateNumber: "CS-2",
    shareNumberFrom: 4_000_001,
    shareNumberTo: 8_000_000,
    roundId: "rnd_novapay_foundation",
    vesting: { months: 48, cliff: 12, startDate: "2023-04-01", percentVested: 100 },
    drag: true, rofr: true, coSale: true, proRata: false,
    leadInvestorOfRound: false,
    sideLetter: null,
    optionStatus: null,
  },
  {
    id: "sec_3",
    companyId: "co_novapay",
    holderName: "ESOP Pool (Unallocated)",
    holderType: "pool",
    instrument: "option",
    series: "ESOP 2024",
    shares: 2_000_000,
    pricePerShare: 0.10,
    investmentAmount: 0,
    cap: null,
    discount: null,
    issuedAt: "2024-02-15",
    certificateNumber: "OPT-POOL-1",
    shareNumberFrom: 8_000_001,
    shareNumberTo: 10_000_000,
    roundId: "rnd_novapay_foundation",
    vesting: null,
    drag: false, rofr: false, coSale: false, proRata: false,
    leadInvestorOfRound: false,
    sideLetter: null,
    optionStatus: { granted: 800_000, available: 1_100_000, exercised: 50_000, cancelled: 50_000 },
  },
  {
    id: "sec_4",
    companyId: "co_novapay",
    holderName: "Forge Ventures",
    holderType: "investor",
    instrument: "safe",
    series: "SAFE — Post-Money",
    shares: 0,
    pricePerShare: 1.00,
    investmentAmount: 500_000,
    cap: 8_000_000,
    discount: 20,
    issuedAt: "2024-08-22",
    certificateNumber: "SAFE-1",
    shareNumberFrom: null, shareNumberTo: null,
    roundId: "rnd_novapay_preseed",
    vesting: null,
    drag: false, rofr: false, coSale: false, proRata: true,
    leadInvestorOfRound: true,
    sideLetter: "MFN + pro-rata in next priced round",
    optionStatus: null,
    interestRate: null, maturityDate: null, accruedInterest: null,
  },
  {
    id: "sec_5",
    companyId: "co_novapay",
    holderName: "Hydra Capital",
    holderType: "investor",
    instrument: "preferred",
    series: "Series Seed Preferred",
    shares: 1_500_000,
    pricePerShare: 1.00,
    investmentAmount: 1_500_000,
    cap: null,
    discount: null,
    issuedAt: "2025-01-15",
    certificateNumber: "PS-1",
    shareNumberFrom: 10_000_001,
    shareNumberTo: 11_500_000,
    roundId: "rnd_novapay_seed_closed",
    vesting: null,
    drag: true, rofr: true, coSale: true, proRata: true,
    leadInvestorOfRound: true,
    sideLetter: "Board observer seat; major-investor info rights",
    optionStatus: null,
  },
  /* Sprint 4 — additional pre-seed SAFE holders so the As-Converted view
   * has multiple SAFEs to roll up into Common-equivalent shares. */
  {
    id: "sec_6",
    companyId: "co_novapay",
    holderName: "Avocado Angels",
    holderType: "investor",
    instrument: "safe",
    series: "SAFE — Post-Money (Pre-Seed)",
    shares: 0,
    pricePerShare: null,
    investmentAmount: 250_000,
    cap: 6_000_000,
    discount: 20,
    issuedAt: "2024-08-15",
    certificateNumber: "SAFE-2",
    shareNumberFrom: null, shareNumberTo: null,
    roundId: "rnd_novapay_preseed",
    vesting: null,
    drag: false, rofr: false, coSale: false, proRata: false,
    leadInvestorOfRound: false,
    sideLetter: null,
    optionStatus: null,
    interestRate: null, maturityDate: null, accruedInterest: null,
  },
  {
    id: "sec_7",
    companyId: "co_novapay",
    holderName: "Forge Pre-seed",
    holderType: "investor",
    instrument: "safe",
    series: "SAFE — Post-Money (Pre-Seed)",
    shares: 0,
    pricePerShare: null,
    investmentAmount: 300_000,
    cap: 5_000_000,
    discount: 20,
    issuedAt: "2024-08-22",
    certificateNumber: "SAFE-3",
    shareNumberFrom: null, shareNumberTo: null,
    roundId: "rnd_novapay_preseed",
    vesting: null,
    drag: false, rofr: false, coSale: false, proRata: false,
    leadInvestorOfRound: false,
    sideLetter: "MFN",
    optionStatus: null,
    interestRate: null, maturityDate: null, accruedInterest: null,
  },
  /* Sprint 5 — Convertible note + Warrant so every instrument type renders on the cap table. */
  {
    id: "sec_8",
    companyId: "co_novapay",
    holderName: "Northstar Angels",
    holderType: "investor",
    instrument: "note",
    series: "Bridge Note 2024",
    shares: 0,
    pricePerShare: null,
    investmentAmount: 250_000,
    cap: 7_000_000,
    discount: 15,
    issuedAt: "2024-11-01",
    certificateNumber: "CN-1",
    shareNumberFrom: null, shareNumberTo: null,
    roundId: "rnd_novapay_preseed",
    vesting: null,
    drag: false, rofr: false, coSale: false, proRata: false,
    leadInvestorOfRound: false,
    sideLetter: null,
    optionStatus: null,
    interestRate: 6, // 6% APR
    maturityDate: "2026-11-01",
    accruedInterest: 18_750, // approx 1.5 yrs simple
  },
  {
    id: "sec_9",
    companyId: "co_novapay",
    holderName: "Silicon Bridge Bank",
    holderType: "investor",
    instrument: "warrant",
    series: "Warrant 2025-A",
    shares: 50_000,
    pricePerShare: 1.00,
    investmentAmount: 0,
    cap: null,
    discount: null,
    issuedAt: "2025-02-01",
    certificateNumber: "WT-1",
    shareNumberFrom: null, shareNumberTo: null,
    roundId: "rnd_novapay_seed_closed",
    vesting: null,
    drag: false, rofr: false, coSale: false, proRata: false,
    leadInvestorOfRound: false,
    sideLetter: null,
    optionStatus: null,
    strike: 1.00,
    expiry: "2035-02-01",
    fmv: 1.42, // current FMV per share — intrinsic value = (1.42 − 1.00) × 50,000 = $21,000
  },
];

/**
 * Sprint 5 (institutional-grade) round enrichments per NVCA / BVCA / ILPA convention:
 *   • currency       — instrument-native currency (USD by default)
 *   • region         — formula-region for the engine + symbol display
 *   • useOfProceeds  — institutional pitch-deck slide: where the money goes (% breakdown)
 *   • closingChecklist — NVCA-style closing conditions (legal opinion, board consent, IRA, ROFR/Co-sale, voting agreement)
 *   • tranches       — if the round closes in tranches, list each tranche
 *   • coInvestors    — list of co-investors beyond the lead
 *   • scenarios      — saved "what-if" pre-money sensitivity scenarios for the round
 *   • termSheetUrl   — linked NVCA-style term-sheet draft
 */
export const rounds = [
  /* NovaPay AI — historical foundation round (Round 0) */
  {
    id: "rnd_novapay_foundation",
    companyId: "co_novapay",
    name: "NovaPay Foundation",
    type: "foundation",
    state: "closed",
    targetAmount: 800,
    raisedAmount: 800,
    preMoney: 0,
    postMoney: 800,
    pricePerShare: 0.0001,
    minTicket: 0,
    closeDate: "2024-01-15",
    termsSummary: "8M founder Common shares issued at par. Maya Chen + Daniel Okafor co-found. ESOP pool reserved at 20% post-money for first hires.",
    leadInvestor: "Founders",
    investorCount: 2,
    openDate: "2024-01-01",
    currency: "USD",
    region: "US",
    useOfProceeds: null,
    closingChecklist: [
      { item: "Certificate of Incorporation filed", done: true, owner: "Counsel" },
      { item: "83(b) elections filed by founders", done: true, owner: "Founders" },
      { item: "ESOP pool reserved", done: true, owner: "Counsel" },
    ],
    tranches: null,
    coInvestors: [],
    scenarios: null,
    termSheetUrl: null,
  },
  /* NovaPay AI — closed pre-seed SAFE round */
  {
    id: "rnd_novapay_preseed",
    companyId: "co_novapay",
    name: "NovaPay Pre-Seed SAFE",
    type: "preseed",
    state: "closed",
    targetAmount: 1_050_000,
    raisedAmount: 1_050_000,
    preMoney: 5_000_000,
    postMoney: 6_050_000,
    pricePerShare: null,
    minTicket: 25_000,
    closeDate: "2024-09-01",
    termsSummary: "$1.05M raised across three SAFEs (Forge Ventures $500k @ $8M cap, Avocado Angels $250k @ $6M cap, Forge Pre-seed $300k @ $5M cap). Post-money YC v1.2, 20% discount, MFN.",
    leadInvestor: "Forge Ventures",
    investorCount: 3,
    openDate: "2024-07-01",
    currency: "USD",
    region: "US",
    useOfProceeds: [
      { category: "Engineering hires (4 FTE, 18mo runway)", percent: 55, amount: 577_500 },
      { category: "Cloud + LLM compute",                   percent: 15, amount: 157_500 },
      { category: "Go-to-market + design partner pilots",  percent: 20, amount: 210_000 },
      { category: "Legal, compliance, ops",                percent: 10, amount: 105_000 },
    ],
    closingChecklist: [
      { item: "YC SAFE v1.2 docs executed", done: true, owner: "Counsel" },
      { item: "MFN side letter to Forge",   done: true, owner: "Founders" },
      { item: "Wire receipts confirmed",    done: true, owner: "Founders" },
    ],
    tranches: null,
    coInvestors: ["Avocado Angels", "Forge Pre-seed", "Northstar Angels (Bridge Note)"],
    scenarios: null,
    termSheetUrl: "/dataroom/preseed-safe-terms.pdf",
  },
  /* NovaPay AI — closed Seed Preferred round */
  {
    id: "rnd_novapay_seed_closed",
    companyId: "co_novapay",
    name: "NovaPay Series Seed",
    type: "seed",
    state: "closed",
    targetAmount: 1_500_000,
    raisedAmount: 1_500_000,
    preMoney: 10_500_000,
    postMoney: 12_000_000,
    pricePerShare: 1.00,
    minTicket: 100_000,
    closeDate: "2025-03-15",
    termsSummary: "$1.5M Series Seed Preferred led by Hydra Capital at $10.5M pre-money. SAFEs converted at their respective caps. 1x non-participating, broad-based weighted-average anti-dilution.",
    leadInvestor: "Hydra Capital",
    investorCount: 4,
    openDate: "2025-01-15",
    currency: "USD",
    region: "US",
    useOfProceeds: [
      { category: "Eng + ML team scale (8 FTE total)", percent: 50, amount: 750_000 },
      { category: "Compute + infrastructure",         percent: 18, amount: 270_000 },
      { category: "Design partners + early sales",     percent: 22, amount: 330_000 },
      { category: "Legal, audit, FX hedging",          percent: 10, amount: 150_000 },
    ],
    closingChecklist: [
      { item: "NVCA model legal opinion delivered",     done: true, owner: "Counsel" },
      { item: "Board consent executed",                  done: true, owner: "Board" },
      { item: "Investors' Rights Agreement (IRA)",      done: true, owner: "Counsel" },
      { item: "ROFR / Co-Sale Agreement",                done: true, owner: "Counsel" },
      { item: "Voting Agreement (board composition 1–1–1)", done: true, owner: "Counsel" },
      { item: "SAFE conversion cert. issued",            done: true, owner: "Counsel" },
    ],
    tranches: null,
    coInvestors: ["Forge Ventures (follow-on)", "Avocado Angels (follow-on)", "Bluepoint Angels Syndicate"],
    scenarios: null,
    termSheetUrl: "/dataroom/series-seed-termsheet.pdf",
  },
  {
    id: "rnd_pre",
    companyId: "co_arboreal",
    name: "Arboreal Pre-Seed",
    type: "preseed",
    state: "terms_set",
    targetAmount: 1_500_000,
    raisedAmount: 425_000,
    preMoney: 6_000_000,
    postMoney: 7_500_000,
    pricePerShare: 0.85,
    minTicket: 25_000,
    closeDate: "2026-08-30",
    openDate: "2026-04-15",
    termsSummary: "$1.5M SAFE, $6M post-money cap, 20% discount, 1x non-participating preferred on conversion.",
    leadInvestor: "Helix Seed",
    investorCount: 2,
    currency: "USD",
    region: "US",
    useOfProceeds: [
      { category: "Clinical-grade biomarker platform", percent: 60, amount: 900_000 },
      { category: "Regulatory + clinical advisor team", percent: 20, amount: 300_000 },
      { category: "Pilot operations",                   percent: 20, amount: 300_000 },
    ],
    closingChecklist: [
      { item: "YC SAFE v1.2 template ready", done: true, owner: "Counsel" },
      { item: "Lead lined up",                done: true, owner: "Founders" },
      { item: "Side letter (info rights)",    done: false, owner: "Counsel" },
      { item: "Wires verified",               done: false, owner: "Founders" },
    ],
    tranches: null,
    coInvestors: ["First Principles"],
    scenarios: null,
    termSheetUrl: null,
  },
  {
    id: "rnd_novapay_seed",
    companyId: "co_novapay",
    name: "NovaPay Seed Extension",
    type: "seed",
    state: "soft_circle_open",
    targetAmount: 4_000_000,
    raisedAmount: 2_650_000,
    preMoney: 18_000_000,
    postMoney: 22_000_000,
    pricePerShare: 1.42,
    minTicket: 50_000,
    closeDate: "2026-07-15",
    termsSummary: "$4M Series Seed Preferred at $18M pre-money. 1x non-participating, 8% pro-rata, 1 board observer seat.",
    leadInvestor: "Hydra Capital",
    investorCount: 6,
    openDate: "2026-04-15",
    currency: "USD",
    region: "US",
    useOfProceeds: [
      { category: "Eng + product team scale (12 FTE)", percent: 48, amount: 1_920_000 },
      { category: "Cloud + LLM compute",              percent: 20, amount: 800_000 },
      { category: "Go-to-market expansion",            percent: 22, amount: 880_000 },
      { category: "Working capital + legal",           percent: 10, amount: 400_000 },
    ],
    closingChecklist: [
      { item: "NVCA term sheet executed",                 done: true,  owner: "Counsel" },
      { item: "Board consent",                            done: false, owner: "Board" },
      { item: "Investors' Rights Agreement",             done: false, owner: "Counsel" },
      { item: "ROFR / Co-Sale Agreement",                 done: false, owner: "Counsel" },
      { item: "Voting Agreement",                          done: false, owner: "Counsel" },
      { item: "Legal opinion (Goodwin)",                  done: false, owner: "Counsel" },
      { item: "409A valuation refresh",                    done: true,  owner: "Carta" },
      { item: "Wires verified",                            done: false, owner: "Founders" },
    ],
    tranches: [
      { name: "Tranche 1 (signing)",     amount: 2_500_000, condition: "Concurrent with signing",  expectedDate: "2026-07-15", funded: false },
      { name: "Tranche 2 (milestones)", amount: 1_500_000, condition: "Net new ARR ≥ $2M by Q1 2027", expectedDate: "2027-03-31", funded: false },
    ],
    coInvestors: ["Forge Ventures (follow-on)", "Bluepoint Angels Syndicate", "Northstar Angels", "Helix Seed", "Orbital Fund (passed)"],
    scenarios: [
      { name: "Base case",  preMoney: 18_000_000, raise: 4_000_000, founderPctAfter: 49.2, dilutionPct: 18.2, note: "Lead-set pre-money. Current plan." },
      { name: "Aggressive", preMoney: 22_000_000, raise: 4_000_000, founderPctAfter: 51.8, dilutionPct: 15.4, note: "If a strategic offers a higher pre-money." },
      { name: "Conservative", preMoney: 15_000_000, raise: 4_000_000, founderPctAfter: 46.6, dilutionPct: 21.1, note: "If lead pushes back on price." },
    ],
    termSheetUrl: "/dataroom/seed-extension-termsheet.pdf",
  },
  {
    id: "rnd_a",
    companyId: "co_novapay",
    name: "NovaPay Series A",
    type: "series_a",
    state: "signing_open",
    targetAmount: 12_000_000,
    raisedAmount: 9_400_000,
    preMoney: 56_000_000,
    postMoney: 68_000_000,
    pricePerShare: 3.85,
    minTicket: 250_000,
    closeDate: "2026-06-30",
    termsSummary: "$12M Series A Preferred at $56M pre-money. 1x non-participating, broad-based weighted average anti-dilution.",
    leadInvestor: "Anchor Growth Partners",
    investorCount: 4,
    openDate: "2026-02-15",
    currency: "USD",
    region: "US",
    useOfProceeds: [
      { category: "Team scale to 50 FTE",          percent: 50, amount: 6_000_000 },
      { category: "Compute + infra (multi-region)", percent: 20, amount: 2_400_000 },
      { category: "International GTM (UK, SG)",     percent: 18, amount: 2_160_000 },
      { category: "M&A war chest",                  percent: 7,  amount:   840_000 },
      { category: "Working capital + legal",        percent: 5,  amount:   600_000 },
    ],
    closingChecklist: [
      { item: "NVCA term sheet executed",                 done: true,  owner: "Counsel" },
      { item: "Board consent",                             done: true,  owner: "Board" },
      { item: "Investors' Rights Agreement",              done: true,  owner: "Counsel" },
      { item: "ROFR / Co-Sale Agreement",                  done: true,  owner: "Counsel" },
      { item: "Voting Agreement",                           done: true,  owner: "Counsel" },
      { item: "Legal opinion (Goodwin)",                   done: true,  owner: "Counsel" },
      { item: "409A valuation refresh",                     done: true,  owner: "Carta" },
      { item: "Series A Preferred Stock Purchase Agt.",     done: true,  owner: "Counsel" },
      { item: "Restated Certificate of Incorporation",      done: false, owner: "Counsel" },
      { item: "Drag-along + Right of First Refusal",        done: true,  owner: "Counsel" },
      { item: "All wires verified",                          done: false, owner: "Founders" },
    ],
    tranches: null,
    coInvestors: ["Hydra Capital (follow-on)", "Forge Ventures (follow-on)", "Meridian Capital"],
    scenarios: [
      { name: "Base case",  preMoney: 56_000_000, raise: 12_000_000, founderPctAfter: 38.5, dilutionPct: 17.6, note: "Lead-set price." },
      { name: "Up-round",   preMoney: 65_000_000, raise: 12_000_000, founderPctAfter: 40.1, dilutionPct: 15.6, note: "If Anchor agrees to upbid." },
      { name: "Down-round", preMoney: 48_000_000, raise: 12_000_000, founderPctAfter: 36.6, dilutionPct: 20.0, note: "Anti-dilution triggered if priced here." },
    ],
    termSheetUrl: "/dataroom/series-a-termsheet.pdf",
  },
];

export const roundInvitations = [
  {
    id: "inv_1",
    roundId: "rnd_novapay_seed",
    investorEmail: "partner@hydracapital.com",
    investorName: "Hydra Capital — Aisha Rahman",
    state: "accepted",
    sentAt: "2026-04-18T10:00:00Z",
    viewedAt: "2026-04-18T15:22:00Z",
    expiresAt: "2026-05-18T10:00:00Z",
  },
  {
    id: "inv_2",
    roundId: "rnd_novapay_seed",
    investorEmail: "deal@forgeventures.vc",
    investorName: "Forge Ventures",
    state: "viewed",
    sentAt: "2026-04-22T09:00:00Z",
    viewedAt: "2026-04-23T08:14:00Z",
    expiresAt: "2026-05-22T09:00:00Z",
  },
  {
    id: "inv_3",
    roundId: "rnd_novapay_seed",
    investorEmail: "ramesh@northstar.angel",
    investorName: "Ramesh Iyer",
    state: "pending",
    sentAt: "2026-05-01T11:00:00Z",
    viewedAt: null,
    expiresAt: "2026-06-01T11:00:00Z",
  },
  {
    id: "inv_4",
    roundId: "rnd_novapay_seed",
    investorEmail: "katy@orbital.fund",
    investorName: "Orbital Fund — Katy Zhao",
    state: "declined",
    sentAt: "2026-04-12T10:00:00Z",
    viewedAt: "2026-04-13T16:00:00Z",
    expiresAt: "2026-05-12T10:00:00Z",
  },
  {
    id: "inv_5",
    roundId: "rnd_a",
    investorEmail: "sarah@anchorgrowth.com",
    investorName: "Anchor Growth Partners",
    state: "accepted",
    sentAt: "2026-03-20T08:00:00Z",
    viewedAt: "2026-03-20T11:30:00Z",
    expiresAt: "2026-04-20T08:00:00Z",
  },
  {
    id: "inv_6",
    roundId: "rnd_a",
    investorEmail: "jp@meridiancap.com",
    investorName: "Meridian Capital — JP Holst",
    state: "expired",
    sentAt: "2026-02-12T08:00:00Z",
    viewedAt: "2026-02-13T08:00:00Z",
    expiresAt: "2026-03-12T08:00:00Z",
  },
  {
    id: "inv_7",
    roundId: "rnd_pre",
    investorEmail: "mike@helixseed.com",
    investorName: "Helix Seed",
    state: "viewed",
    sentAt: "2026-05-02T09:00:00Z",
    viewedAt: "2026-05-03T07:00:00Z",
    expiresAt: "2026-06-02T09:00:00Z",
  },
  {
    id: "inv_8",
    roundId: "rnd_pre",
    investorEmail: "elena@firstprinciples.vc",
    investorName: "First Principles",
    state: "revoked",
    sentAt: "2026-04-15T09:00:00Z",
    viewedAt: "2026-04-16T09:00:00Z",
    expiresAt: "2026-05-15T09:00:00Z",
  },
];

export const softCircles = [
  {
    id: "sc_1",
    roundId: "rnd_novapay_seed",
    invitationId: "inv_1",
    investorName: "Hydra Capital",
    amount: 1_500_000,
    status: "committed",
    createdAt: "2026-04-19T12:00:00Z",
  },
  {
    id: "sc_2",
    roundId: "rnd_novapay_seed",
    invitationId: "inv_2",
    investorName: "Forge Ventures",
    amount: 750_000,
    status: "confirmed",
    createdAt: "2026-04-25T09:00:00Z",
  },
  {
    id: "sc_3",
    roundId: "rnd_novapay_seed",
    invitationId: null,
    investorName: "Bluepoint Angels Syndicate",
    amount: 400_000,
    status: "intent",
    createdAt: "2026-05-04T14:00:00Z",
  },
  {
    id: "sc_4",
    roundId: "rnd_a",
    invitationId: "inv_5",
    investorName: "Anchor Growth Partners",
    amount: 6_000_000,
    status: "committed",
    createdAt: "2026-03-28T10:00:00Z",
  },
];

/* CRM contacts on the founder side */
export const crmInvestors = [
  { id: "cr_1", name: "Hydra Capital", contact: "Aisha Rahman", email: "partner@hydracapital.com", stage: "Seed–Series A", checkSize: "$1M–$3M", status: "active",   notes: "Lead seed; loves agentic AI." },
  { id: "cr_2", name: "Forge Ventures",   contact: "Tom Bauer",      email: "deal@forgeventures.vc", stage: "Pre-Seed",      checkSize: "$250k–$1M", status: "active",   notes: "Wrote our first SAFE." },
  { id: "cr_3", name: "Anchor Growth",    contact: "Sarah Knox",     email: "sarah@anchorgrowth.com", stage: "Series A–B",    checkSize: "$5M–$15M", status: "active",   notes: "Series A lead candidate." },
  { id: "cr_4", name: "Orbital Fund",     contact: "Katy Zhao",      email: "katy@orbital.fund",      stage: "Seed",           checkSize: "$500k",     status: "invited",  notes: "Declined; revisit at A." },
  { id: "cr_5", name: "Meridian Capital", contact: "JP Holst",       email: "jp@meridiancap.com",     stage: "Series A",      checkSize: "$3M–$5M",  status: "pending",  notes: "Slow process; chase Q3." },
  { id: "cr_6", name: "Northstar Angels", contact: "Ramesh Iyer",    email: "ramesh@northstar.angel", stage: "Pre-Seed",      checkSize: "$25k–$100k", status: "pending",  notes: "Strong fintech rolodex." },
  { id: "cr_7", name: "Bluepoint Angels", contact: "Helena Park",    email: "helena@bluepoint.club",  stage: "Seed",           checkSize: "$50k–$250k", status: "active",   notes: "Prefers SPV vehicles." },
  { id: "cr_8", name: "Helix Seed",       contact: "Mike Stratton",  email: "mike@helixseed.com",     stage: "Pre-Seed",      checkSize: "$100k–$500k", status: "active",  notes: "Decision in 14 days." },
];

/* Investor-side: incoming invitations seen by the demo investor (Aisha Rahman). */
export const incomingInvitations = [
  {
    id: "in_1",
    company: { id: "co_novapay", name: "NovaPay AI", sector: "Fintech / AI Payments" },
    round: { id: "rnd_novapay_seed", name: "NovaPay Seed Extension", type: "seed", state: "soft_circle_open" },
    state: "viewed",
    receivedAt: "2026-04-18T10:00:00Z",
    expiresAt: "2026-06-18T10:00:00Z",
    minTicket: 50_000,
    targetAmount: 4_000_000,
    raisedAmount: 2_650_000,
    preMoney: 18_000_000,
    postMoney: 22_000_000,
    pricePerShare: 1.42,
  },
  {
    id: "in_2",
    company: { id: "co_arboreal", name: "Arboreal Health", sector: "Digital Health" },
    round: { id: "rnd_pre", name: "Arboreal Pre-Seed", type: "preseed", state: "terms_set" },
    state: "pending",
    receivedAt: "2026-05-04T14:00:00Z",
    expiresAt: "2026-06-04T14:00:00Z",
    minTicket: 25_000,
    targetAmount: 1_500_000,
    raisedAmount: 425_000,
    preMoney: 6_000_000,
    postMoney: 7_500_000,
    pricePerShare: 0.85,
  },
  {
    id: "in_3",
    company: { id: "co_quanta", name: "Quanta Robotics", sector: "Industrial Automation" },
    round: { id: "rnd_q_a", name: "Quanta Series A", type: "series_a", state: "signing_open" },
    state: "accepted",
    receivedAt: "2026-03-09T09:00:00Z",
    expiresAt: "2026-04-09T09:00:00Z",
    minTicket: 100_000,
    targetAmount: 8_000_000,
    raisedAmount: 7_200_000,
    preMoney: 32_000_000,
    postMoney: 40_000_000,
    pricePerShare: 2.15,
  },
  {
    id: "in_4",
    company: { id: "co_lattice", name: "Lattice BioFoundry", sector: "Biotech" },
    round: { id: "rnd_l_b", name: "Lattice Series B", type: "series_b", state: "signing_open" },
    state: "declined",
    receivedAt: "2026-02-12T08:00:00Z",
    expiresAt: "2026-03-12T08:00:00Z",
    minTicket: 500_000,
    targetAmount: 28_000_000,
    raisedAmount: 28_000_000,
    preMoney: 140_000_000,
    postMoney: 168_000_000,
    pricePerShare: 6.40,
  },
  {
    id: "in_5",
    company: { id: "co_kelvin", name: "Kelvin Energy", sector: "Climate / Grid" },
    round: { id: "rnd_k_seed", name: "Kelvin Seed", type: "seed", state: "soft_circle_open" },
    state: "expired",
    receivedAt: "2026-01-20T10:00:00Z",
    expiresAt: "2026-02-20T10:00:00Z",
    minTicket: 50_000,
    targetAmount: 3_000_000,
    raisedAmount: 1_900_000,
    preMoney: 12_000_000,
    postMoney: 15_000_000,
    pricePerShare: 1.10,
  },
];

/* Investor-side soft circles (the investor's own commitments) */
export const investorSoftCircles = [
  { id: "isc_1", company: "NovaPay AI",      round: "Seed Extension", amount: 1_500_000, status: "committed", createdAt: "2026-04-19" },
  { id: "isc_2", company: "Quanta Robotics", round: "Series A",       amount:   500_000, status: "confirmed", createdAt: "2026-03-15" },
  { id: "isc_3", company: "Arboreal Health", round: "Pre-Seed",       amount:   100_000, status: "intent",    createdAt: "2026-05-05" },
];

/* Investor portfolio + watchlist */
export const portfolio = [
  { id: "pf_1", company: "NovaPay AI",      stage: "Seed",     ownership: 6.82, invested: 1_500_000, currentMark: 2_140_000, irr: 28.5, mood: "up" },
  { id: "pf_2", company: "Quanta Robotics", stage: "Series A", ownership: 1.25, invested:   500_000, currentMark:   620_000, irr: 18.2, mood: "up" },
  { id: "pf_3", company: "Beacon Compute",  stage: "Series B", ownership: 0.42, invested:   250_000, currentMark:   240_000, irr: -1.4, mood: "flat" },
  { id: "pf_4", company: "Tideline Pay",    stage: "Seed",     ownership: 2.10, invested:   400_000, currentMark:   720_000, irr: 41.2, mood: "up" },
];

export const watchlist = [
  { id: "wl_1", company: "Arboreal Health", sector: "Digital Health", stage: "Pre-Seed", note: "Closing in 14 days." },
  { id: "wl_2", company: "Lattice BioFoundry", sector: "Biotech",   stage: "Series B", note: "Pass — too late stage." },
  { id: "wl_3", company: "Helia AI",          sector: "AI Infra",   stage: "Seed",     note: "Founder intro pending." },
];

/* Discover companies */
export const discover = [
  { id: "dc_1", company: "Helia AI",       sector: "AI Infrastructure",   stage: "Seed",     hq: "London",       traction: "$1.2M ARR, 38% MoM",  raising: "$5M",  match: 92 },
  { id: "dc_2", company: "Tideline Pay",   sector: "Fintech",             stage: "Series A", hq: "São Paulo",    traction: "$8M ARR, 24% MoM",   raising: "$15M", match: 88 },
  { id: "dc_3", company: "Beacon Compute", sector: "Dev Infra",           stage: "Series B", hq: "Berlin",       traction: "$22M ARR",            raising: "$40M", match: 76 },
  { id: "dc_4", company: "Arboreal Health",sector: "Digital Health",      stage: "Pre-Seed", hq: "Boston",       traction: "210 paid pilots",     raising: "$1.5M",match: 84 },
  { id: "dc_5", company: "Quanta Robotics",sector: "Industrial Robotics", stage: "Series A", hq: "Detroit",      traction: "12 enterprise design wins", raising: "$8M", match: 71 },
  { id: "dc_6", company: "Kelvin Energy",  sector: "Climate Tech",        stage: "Seed",     hq: "Austin",       traction: "Pilot with TXU",      raising: "$3M",  match: 68 },
];

/* Dataroom files (5 of 11 categories populated) */
export const dataroomFiles = [
  { id: "df_1", companyId: "co_novapay", category: "mgmt",        name: "Founders bios + cap.pdf",       sizeBytes:  814_336, mime: "application/pdf",   uploadedAt: "2026-04-12T10:00:00Z", uploadedBy: "Maya Chen"     },
  { id: "df_2", companyId: "co_novapay", category: "mgmt",        name: "Team org chart 2026.png",       sizeBytes:  221_440, mime: "image/png",          uploadedAt: "2026-04-12T10:02:00Z", uploadedBy: "Maya Chen"     },
  { id: "df_3", companyId: "co_novapay", category: "product",     name: "NovaPay product roadmap.pdf",   sizeBytes: 1_204_512, mime: "application/pdf",   uploadedAt: "2026-04-14T10:00:00Z", uploadedBy: "Daniel Okafor" },
  { id: "df_4", companyId: "co_novapay", category: "product",     name: "Architecture diagram.png",      sizeBytes:  503_204, mime: "image/png",          uploadedAt: "2026-04-14T10:08:00Z", uploadedBy: "Daniel Okafor" },
  { id: "df_5", companyId: "co_novapay", category: "financials",  name: "FY26 model — base.xlsx",        sizeBytes: 1_402_000, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", uploadedAt: "2026-04-15T11:00:00Z", uploadedBy: "Maya Chen" },
  { id: "df_6", companyId: "co_novapay", category: "financials",  name: "Cohort retention.csv",          sizeBytes:   88_421, mime: "text/csv",           uploadedAt: "2026-04-15T11:10:00Z", uploadedBy: "Maya Chen"     },
  { id: "df_7", companyId: "co_novapay", category: "term_sheet",  name: "Hydra Series Seed term sheet.pdf", sizeBytes: 412_440, mime: "application/pdf", uploadedAt: "2026-04-22T09:00:00Z", uploadedBy: "Maya Chen"     },
  { id: "df_8", companyId: "co_novapay", category: "legal",       name: "Articles of Incorporation.pdf", sizeBytes:  220_330, mime: "application/pdf",   uploadedAt: "2024-04-01T08:00:00Z", uploadedBy: "Counsel"        },
  { id: "df_9", companyId: "co_novapay", category: "legal",       name: "Restated bylaws Apr 2026.pdf",  sizeBytes:  331_204, mime: "application/pdf",   uploadedAt: "2026-04-02T08:00:00Z", uploadedBy: "Counsel"        },
  { id: "df_10",companyId: "co_novapay", category: "press",       name: "TechCrunch coverage.pdf",        sizeBytes:  220_119, mime: "application/pdf",   uploadedAt: "2026-04-25T17:00:00Z", uploadedBy: "Maya Chen"     },
];

/* Reports */
export const reports = [
  { id: "rep_1", title: "Q1 2026 Investor Update", period: "Q1 2026", status: "sent",    sentAt: "2026-04-12", recipients: 42 },
  { id: "rep_2", title: "March 2026 KPI snapshot", period: "Mar 2026", status: "sent",    sentAt: "2026-04-02", recipients: 42 },
  { id: "rep_3", title: "Q2 2026 Investor Update — DRAFT", period: "Q2 2026", status: "draft", sentAt: null,    recipients: 0  },
];

/* Activity log */
export const activity = [
  { id: "ac_1",  ts: "2026-05-08T09:14:00Z", actor: "Maya Chen",     action: "uploaded", target: "Q1 2026 Investor Update.pdf"   },
  { id: "ac_2",  ts: "2026-05-08T08:42:00Z", actor: "Hydra Capital", action: "viewed",   target: "Architecture diagram.png"      },
  { id: "ac_3",  ts: "2026-05-07T17:02:00Z", actor: "Forge Ventures",action: "soft-circled $750k", target: "Seed Extension"        },
  { id: "ac_4",  ts: "2026-05-07T16:41:00Z", actor: "Maya Chen",     action: "issued invitation",  target: "Northstar Angels"      },
  { id: "ac_5",  ts: "2026-05-06T11:08:00Z", actor: "Daniel Okafor", action: "edited",    target: "Cap table — Series Seed entry" },
  { id: "ac_6",  ts: "2026-05-05T14:33:00Z", actor: "Bluepoint Angels", action: "soft-circled $400k", target: "Seed Extension"      },
  { id: "ac_7",  ts: "2026-05-04T10:11:00Z", actor: "Hydra Capital", action: "accepted invitation", target: "Seed Extension"      },
  { id: "ac_8",  ts: "2026-05-03T08:00:00Z", actor: "Maya Chen",     action: "set close date",     target: "Seed Extension — 2026-07-15" },
];

/* Notifications (6) */
export const notifications = [
  { id: "n_1", ts: "2026-05-08T09:14:00Z", title: "Hydra Capital opened Architecture diagram", kind: "view"    },
  { id: "n_2", ts: "2026-05-07T17:02:00Z", title: "Forge Ventures soft-circled $750k", kind: "soft_circle"      },
  { id: "n_3", ts: "2026-05-07T11:00:00Z", title: "Northstar Angels invitation expires in 7 days", kind: "warn" },
  { id: "n_4", ts: "2026-05-06T08:00:00Z", title: "New report draft auto-generated for Q2 2026", kind: "report" },
  { id: "n_5", ts: "2026-05-05T15:00:00Z", title: "Bluepoint Angels declared $400k intent", kind: "soft_circle" },
  { id: "n_6", ts: "2026-05-04T08:00:00Z", title: "Hydra Capital accepted Seed Extension invitation", kind: "accept" },
];

/* =====================================================================
 * Sprint 7 — gating, identity, privacy
 * ===================================================================== */

/**
 * Pre-seeded demo invitation tokens. These are RAW tokens visible only in
 * the preview to enable demo-able flows without sending real email.
 *
 * The server stores hashed counterparts at boot — see server/routes.ts.
 *
 * In production, these are replaced by SES-delivered, single-shot tokens.
 */
export const demoInvitationTokens: Array<{
  id: string;
  rawToken: string;
  roundId: string;
  companyId: string;
  companyName: string;
  inviteeEmail: string;
  inviteeName: string;
  prefilledScreenName: string | null;
}> = [
  {
    id: "inv_demo_1",
    rawToken: "demo7-novapay-seedext-aisha-XJq8mQk2tR9pNvLwHc4dY7zFbE3sUaG6B",
    roundId: "rnd_novapay_seed",
    companyId: "co_novapay",
    companyName: "NovaPay AI",
    inviteeEmail: "aisha@greenwood.capital",
    inviteeName: "Aisha Patel",
    prefilledScreenName: "GreenwoodCap",
  },
  {
    id: "inv_demo_2",
    rawToken: "demo7-arboreal-preseed-northstar-K7vP3jQwLfRtMnHcXgYbZ8aE6dUsT4Bp",
    roundId: "rnd_pre",
    companyId: "co_arboreal",
    companyName: "Arboreal Health",
    inviteeEmail: "partner@northstar.angels",
    inviteeName: "Northstar Angels Syndicate",
    prefilledScreenName: null,
  },
  {
    id: "inv_demo_3",
    rawToken: "demo7-quanta-seriesa-bluepoint-Zq9YtKmHvL4cR8nBpJgF3wXdEsT6aU2P",
    roundId: "rnd_q_a",
    companyId: "co_quanta",
    companyName: "Quanta Robotics",
    inviteeEmail: "deals@bluepoint.vc",
    inviteeName: "Bluepoint Angels",
    prefilledScreenName: "bluepoint_angels",
  },
];

/**
 * Sprint 7 — richer portfolio for the split-view investor dashboard.
 * Each entry is the investor's view of a single company on which they hold
 * a position. Math is internally consistent: invested * marker = currentValue.
 */
export const investorPortfolio = [
  {
    id: "ip_1",
    companyId: "co_novapay",
    company: "NovaPay AI",
    sector: "Fintech / AI Payments",
    stage: "Seed Extension",
    role: "investor",
    instrument: "preferred",
    series: "Seed Preferred",
    shares: 1_056_338,
    ownershipPct: 4.21,
    invested: 1_500_000,
    currentValue: 2_140_000,
    vintageYear: 2025,
    lastRoundLabel: "Seed Extension · soft-circle open",
    lastRoundDate: "2026-04-18",
    maFlag: { strength: "high", note: "Strategic acquirer interest in cross-border rails" },
    logoColor: "hsl(184 98% 22%)",
  },
  {
    id: "ip_2",
    companyId: "co_arboreal",
    company: "Arboreal Health",
    sector: "Digital Health",
    stage: "Pre-Seed",
    role: "advisor",
    instrument: "safe",
    series: "Pre-Seed SAFE",
    shares: 0,
    ownershipPct: 1.42,
    invested: 100_000,
    currentValue: 142_000,
    vintageYear: 2026,
    lastRoundLabel: "Pre-Seed · terms set",
    lastRoundDate: "2026-05-04",
    maFlag: null,
    logoColor: "hsl(140 60% 38%)",
  },
  {
    id: "ip_3",
    companyId: "co_quanta",
    company: "Quanta Robotics",
    sector: "Industrial Automation",
    stage: "Series A",
    role: "investor",
    instrument: "preferred",
    series: "Series A",
    shares: 232_558,
    ownershipPct: 1.25,
    invested: 500_000,
    currentValue: 620_000,
    vintageYear: 2024,
    lastRoundLabel: "Series A · closed Mar 2026",
    lastRoundDate: "2026-03-09",
    maFlag: { strength: "medium", note: "Two acquirers in early conversation" },
    logoColor: "hsl(35 85% 45%)",
  },
  {
    id: "ip_4",
    companyId: "co_kelvin",
    company: "Kelvin Energy",
    sector: "Climate / Grid",
    stage: "Seed",
    role: "observer",
    instrument: "note",
    series: "Bridge Note",
    shares: 0,
    ownershipPct: 0.85,
    invested: 250_000,
    currentValue: 240_000,
    vintageYear: 2024,
    lastRoundLabel: "Bridge note · Sep 2024",
    lastRoundDate: "2024-09-15",
    maFlag: null,
    logoColor: "hsl(195 70% 42%)",
  },
  {
    id: "ip_5",
    companyId: "co_helia",
    company: "Helia AI",
    sector: "AI Infrastructure",
    stage: "Seed",
    role: "co-founder",
    instrument: "common",
    series: "Common (founder)",
    shares: 800_000,
    ownershipPct: 12.5,
    invested: 80,
    currentValue: 1_500_000,
    vintageYear: 2024,
    lastRoundLabel: "Seed · closed Jul 2025",
    lastRoundDate: "2025-07-01",
    maFlag: { strength: "high", note: "Inbound from two FAANG acquirers" },
    logoColor: "hsl(280 60% 50%)",
  },
];

/**
 * Cross-portfolio activity feed for the investor dashboard.
 */
export const investorActivity = [
  {
    id: "ia_1",
    ts: "2026-05-08T09:14:00Z",
    kind: "round_close",
    companyId: "co_quanta",
    company: "Quanta Robotics",
    text: "Quanta Robotics closed their Series A — your ownership now 1.25%.",
    href: "/investor/companies/co_quanta",
  },
  {
    id: "ia_2",
    ts: "2026-05-07T17:02:00Z",
    kind: "report",
    companyId: "co_novapay",
    company: "NovaPay AI",
    text: "NovaPay AI uploaded Q1 2026 investor update.",
    href: "/investor/companies/co_novapay",
  },
  {
    id: "ia_3",
    ts: "2026-05-06T11:08:00Z",
    kind: "message",
    companyId: "co_novapay",
    company: "NovaPay AI",
    text: "@hydra_vc sent you a message about NovaPay's Seed Extension.",
    href: "/investor/messages",
  },
  {
    id: "ia_4",
    ts: "2026-05-05T14:33:00Z",
    kind: "invitation",
    companyId: "co_arboreal",
    company: "Arboreal Health",
    text: "Arboreal Health opened a new round — you're invited as a participant.",
    href: "/investor/invitations",
  },
  {
    id: "ia_5",
    ts: "2026-05-04T10:11:00Z",
    kind: "round_close",
    companyId: "co_helia",
    company: "Helia AI",
    text: "Helia AI signed Series A term sheet with Sequoia Hadrian.",
    href: "/investor/companies/co_helia",
  },
  {
    id: "ia_6",
    ts: "2026-05-03T08:00:00Z",
    kind: "report",
    companyId: "co_kelvin",
    company: "Kelvin Energy",
    text: "Kelvin Energy posted a March 2026 KPI snapshot.",
    href: "/investor/companies/co_kelvin",
  },
  {
    id: "ia_7",
    ts: "2026-05-01T08:00:00Z",
    kind: "message",
    companyId: "co_quanta",
    company: "Quanta Robotics",
    text: "[Anonymous Holder] (cap-table co-member) requested intro on Series A pro-rata.",
    href: "/investor/messages",
  },
];

/**
 * Per-company detail payload — Capavate ↔ Collective parity.
 *
 * Fields mirror the Collective company-details shape; gating is applied
 * at the route layer (rounds / dataroom / softCircles / termSheet are
 * blanked unless the requester has access).
 */
export const companyDetailsExtra: Record<string, {
  headliner: string;
  founderBios: Array<{ name: string; role: string; bio: string; visible: boolean }>;
  problem: string;
  solution: string;
  legalEntity: { name: string; jurisdiction: string; entityType: string; ein: string };
  mailingAddress: string;
  marketPresence: { tam: string; sam: string; som: string; geos: string[] };
  strategicPriorities: string[];
  maIntelligence: Array<{ field: string; value: string }>;
  competitors: Array<{ name: string; differentiator: string; stage: string }>;
  concentrationFlags: Array<{ kind: string; note: string }>;
  pressMentions: Array<{ outlet: string; title: string; date: string; url: string }>;
}> = {
  co_novapay: {
    headliner: "Agentic-AI payment routing for cross-border B2B settlements.",
    founderBios: [
      { name: "Maya Chen", role: "CEO", bio: "Ex-Stripe payments engineer. MIT '17. Founded NovaPay in 2023 to fix the 5-day SWIFT bottleneck.", visible: true },
      { name: "Daniel Okafor", role: "CTO", bio: "Ex-Plaid. Built the routing engine at Wise. UCL '15.", visible: true },
    ],
    problem: "Cross-border B2B payments take 3–5 business days, cost 6–8% in fees, and have 18% rework rates from data-quality issues.",
    solution: "Agentic AI orchestrates pre-flight validation, multi-rail routing (SWIFT, Wise, FXC), and reconciliation in 90 seconds end-to-end.",
    legalEntity: { name: "NovaPay AI, Inc.", jurisdiction: "Delaware, USA", entityType: "C-Corp", ein: "88-1234567" },
    mailingAddress: "548 Market St #34291, San Francisco, CA 94104",
    marketPresence: { tam: "$240B", sam: "$42B", som: "$1.2B", geos: ["US", "UK", "EU", "SG"] },
    strategicPriorities: [
      "Hit $4M ARR by Dec 2026",
      "Close Seed Extension at $4M to extend runway 18 months",
      "Launch ASEAN corridor with MAS sandbox approval",
      "Hire VP Engineering and 2 senior infra engineers",
    ],
    maIntelligence: [
      { field: "Strategic acquirer interest", value: "High — 3 inbounds Q1 2026" },
      { field: "M&A readiness score", value: "82 / 100" },
      { field: "Comp set median revenue multiple", value: "11.2× ARR" },
      { field: "Comp set median EBITDA multiple", value: "n/a (pre-EBITDA)" },
      { field: "Last bid (rejected)", value: "$120M cash + $30M earnout (Mar 2026)" },
      { field: "Investor pro-rata utilisation", value: "94%" },
      { field: "Co-investor diversity", value: "12 distinct LPs across 7 funds" },
      { field: "Tax structure ready for cross-border close", value: "Yes — UK + Singapore subsidiaries" },
      { field: "ESOP refresh readiness", value: "10% pool with 2 years vesting runway" },
      { field: "Notable departures", value: "None in last 12 months" },
    ],
    competitors: [
      { name: "Modern Treasury", differentiator: "Bank rails focus, no agentic AI", stage: "Series C" },
      { name: "Airwallex", differentiator: "Consumer-first, broader scope", stage: "Pre-IPO" },
      { name: "Wise Business", differentiator: "Mature but slow on agentic features", stage: "Public" },
    ],
    concentrationFlags: [
      { kind: "customer", note: "Top 3 customers = 41% of ARR (Q1 2026)" },
      { kind: "channel", note: "76% of new logo from outbound; investing in inbound" },
    ],
    pressMentions: [
      { outlet: "TechCrunch", title: "NovaPay's agentic AI cuts B2B settlement to 90s", date: "2026-04-25", url: "https://techcrunch.com/novapay-2026" },
      { outlet: "Fintech Insider", title: "How NovaPay routes around SWIFT bottlenecks", date: "2026-03-10", url: "https://fintechinsider.io/novapay-routing" },
    ],
  },
  co_arboreal: {
    headliner: "Continuous biomarker tracking for chronic care.",
    founderBios: [
      { name: "Dr. Eli Vasquez", role: "CEO", bio: "Former Mass General CMO. Stanford MD/MBA.", visible: true },
      { name: "Priya Iyer", role: "CTO", bio: "Ex-Apple Health platform. Built CGM ingestion at Dexcom.", visible: true },
    ],
    problem: "Chronic-care patients see clinicians 4×/year — but their biomarkers shift hour-to-hour, leaving 99% of clinical signal unobserved.",
    solution: "Closed-loop coaching layered on top of CGM, BP, and at-home labs. AI flags trajectories before they become emergencies.",
    legalEntity: { name: "Arboreal Health Sciences Ltd.", jurisdiction: "Delaware, USA", entityType: "C-Corp", ein: "99-2345678" },
    mailingAddress: "100 Cambridgeside Place, Cambridge, MA 02141",
    marketPresence: { tam: "$98B", sam: "$22B", som: "$420M", geos: ["US"] },
    strategicPriorities: ["FDA Class II clearance for trajectory engine by Q3 2026", "Sign 5 health-system pilots", "Close Pre-Seed at $1.5M"],
    maIntelligence: [
      { field: "Strategic acquirer interest", value: "Low — too early" },
      { field: "M&A readiness score", value: "31 / 100" },
      { field: "Comp set median revenue multiple", value: "8.5× ARR" },
    ],
    competitors: [
      { name: "Livongo (Teladoc)", differentiator: "Diabetes only", stage: "Public" },
      { name: "Omada Health", differentiator: "Behavioural focus", stage: "Series E" },
    ],
    concentrationFlags: [{ kind: "regulatory", note: "FDA pathway is critical-path; delay = burn extension required" }],
    pressMentions: [{ outlet: "STAT News", title: "Arboreal raises pre-seed to track chronic care continuously", date: "2026-05-04", url: "https://statnews.com/arboreal" }],
  },
  co_quanta: {
    headliner: "Industrial robotics for the warehouse mid-tier.",
    founderBios: [
      { name: "Wei Chen", role: "CEO", bio: "Ex-Boston Dynamics. CMU PhD in robotics.", visible: true },
      { name: "Liam O'Brien", role: "COO", bio: "Built ops at Fetch Robotics, scaled to $40M ARR.", visible: true },
    ],
    problem: "Tier-2 warehouse operators are priced out of $4M+ robotics rollouts.",
    solution: "$80k mobile robots with same-day deploy, leasing model, AI-orchestrated fleets.",
    legalEntity: { name: "Quanta Robotics, Inc.", jurisdiction: "Delaware, USA", entityType: "C-Corp", ein: "11-9876543" },
    mailingAddress: "1500 Woodward Ave, Detroit, MI 48226",
    marketPresence: { tam: "$54B", sam: "$11B", som: "$280M", geos: ["US", "MX"] },
    strategicPriorities: ["Deploy 200 units by EOY 2026", "Series B raise H2 2026", "Expand into Texas + Mexico"],
    maIntelligence: [
      { field: "Strategic acquirer interest", value: "Medium — 2 acquirers in early conversation" },
      { field: "M&A readiness score", value: "64 / 100" },
    ],
    competitors: [
      { name: "Locus Robotics", differentiator: "Enterprise-only", stage: "Series F" },
      { name: "6 River Systems (Shopify)", differentiator: "Captive to Shopify", stage: "Acquired" },
    ],
    concentrationFlags: [],
    pressMentions: [{ outlet: "The Robot Report", title: "Quanta closes Series A at $40M post", date: "2026-03-15", url: "https://therobotreport.com/quanta-series-a" }],
  },
  co_helia: {
    headliner: "Inference compute for AI startups, 70% cheaper than the hyperscalers.",
    founderBios: [{ name: "Aisha Patel", role: "CEO", bio: "Ex-NVIDIA accelerator team lead.", visible: true }],
    problem: "AI startups burn 60% of cash on inference compute.",
    solution: "Bare-metal inference clusters with intelligent batching, 5-min provisioning.",
    legalEntity: { name: "Helia AI, Ltd.", jurisdiction: "England & Wales", entityType: "Ltd.", ein: "GB-1234567" },
    mailingAddress: "1 Finsbury Avenue, London EC2M 2PA",
    marketPresence: { tam: "$110B", sam: "$28B", som: "$340M", geos: ["UK", "EU", "US"] },
    strategicPriorities: ["Hit $5M ARR Q4 2026", "Open Frankfurt POP", "Series A H1 2026"],
    maIntelligence: [
      { field: "Strategic acquirer interest", value: "High — inbound from two FAANG acquirers" },
      { field: "M&A readiness score", value: "78 / 100" },
    ],
    competitors: [
      { name: "Together.ai", differentiator: "US-only", stage: "Series A" },
      { name: "Replicate", differentiator: "Model marketplace", stage: "Series B" },
    ],
    concentrationFlags: [{ kind: "customer", note: "Top customer = 28% of ARR" }],
    pressMentions: [{ outlet: "Sifted", title: "Helia AI's London inference play", date: "2026-04-20", url: "https://sifted.eu/helia-london" }],
  },
  co_kelvin: {
    headliner: "Grid-edge battery orchestration for utilities.",
    founderBios: [{ name: "Alex Kim", role: "CEO", bio: "Ex-Tesla Energy. MIT MBA.", visible: true }],
    problem: "Utilities lack real-time orchestration across distributed batteries.",
    solution: "FERC-compliant orchestration platform with utility-scale forecasting.",
    legalEntity: { name: "Kelvin Energy Co.", jurisdiction: "Delaware, USA", entityType: "C-Corp", ein: "33-1112233" },
    mailingAddress: "501 Congress Ave, Austin, TX 78701",
    marketPresence: { tam: "$32B", sam: "$8B", som: "$140M", geos: ["US"] },
    strategicPriorities: ["Sign 3 utility pilots", "Close Seed at $3M"],
    maIntelligence: [{ field: "Strategic acquirer interest", value: "Low — sector consolidating slowly" }],
    competitors: [
      { name: "AutoGrid (Schneider)", differentiator: "Captive to Schneider", stage: "Acquired" },
      { name: "Camus Energy", differentiator: "Smaller scope", stage: "Seed" },
    ],
    concentrationFlags: [{ kind: "regulatory", note: "FERC Order 2222 implementation pace is critical-path" }],
    pressMentions: [{ outlet: "Canary Media", title: "Kelvin's Austin pilot with TXU", date: "2026-04-12", url: "https://canarymedia.com/kelvin" }],
  },
};

/**
 * Sprint 7 — current investor identity (mock). In production, derived from Auth0.
 * The dashboard, profile, and access-checks all key off this.
 */
export const currentInvestor = {
  id: "u_aisha_patel",
  legalName: "Aisha Patel",
  email: "aisha@greenwood.capital",
  entityName: "Greenwood Capital Partners I, L.P.",
  visibility: {
    screenName: "GreenwoodCap",
    screenNameSet: true,
    visibleToCoMembers: true,
    visibleToCollectiveNetwork: false,
  },
  // Companies whose round detail / dataroom / term sheet THIS investor can see.
  invitedCompanies: ["co_novapay", "co_arboreal", "co_quanta"],
};
