/**
 * Region-aware term-sheet template registry.
 *
 * Maps (region, instrument) → a TermSheetTemplate with substantive,
 * citation-backed sections. The TermSheet.tsx page renders a template for a
 * round, lets the founder edit any section, captures an SES e-signature, and
 * exports to PDF.
 *
 * Regions covered (9): US, CA, UK, SG, HK, CN, IN, JP, AU.
 * Instruments covered (7): common, preferred, safe_post, safe_pre,
 *   convertible_note, warrant, option_pool.
 *
 * Sources:
 *   • NVCA Model Term Sheet (US) — https://nvca.org/model-legal-documents/
 *   • YC SAFE v1.2 (post-money cap) — https://www.ycombinator.com/documents
 *   • BVCA Model Form Term Sheet (UK) — https://www.bvca.co.uk/
 *   • J-KISS (Coral Capital, JP) — https://github.com/CoralCapital/jkiss
 *   • Companies Act 2013 (IN) §55, §62 — https://www.mca.gov.in/
 *   • SEBI (AIF) Regulations 2012 (IN) — https://www.sebi.gov.in/
 *   • Companies Act 2006 (UK) — https://www.legislation.gov.uk/ukpga/2006/46
 *   • Corporations Act 2001 (AU) — https://www.legislation.gov.au/Series/C2004A00818
 *   • Companies Act (JP) §107-108 — https://www.japaneselawtranslation.go.jp/
 *   • SAFE Circular 37 (CN) — http://www.safe.gov.cn/
 *   • ACRA / MAS (SG) — https://www.acra.gov.sg/, https://www.mas.gov.sg/
 *   • ASIC RG 217 (AU) — https://asic.gov.au/regulatory-resources/find-a-document/regulatory-guides/
 *   • IRD DIPN 38 (HK) — https://www.ird.gov.hk/
 *   • NI 45-106 (CA) — https://www.osc.ca/en/securities-law/instruments-rules-policies/4/45-106
 */
import type { TermSheetData, TermSheetSection, TermSheetTemplate, Region, InstrumentValue } from "./types";
import { getClauseDescription } from "./descriptions";

const usd = (n: number) => `$${(Number.isFinite(n) ? n : 0).toLocaleString("en-US")}`;
const num = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString("en-US");

/* ================================================================== */
/* Governing-law per-region                                            */
/* ================================================================== */

const GOVERNING_LAW: Record<Region, string> = {
  US: "Delaware General Corporation Law (8 Del. C.) and applicable U.S. federal securities laws (Securities Act of 1933, as amended; Reg. D 506(b)/(c)).",
  CA: "Province of Ontario; Business Corporations Act (Ontario) R.S.O. 1990, c. B.16; National Instrument 45-106 prospectus exemptions; CCPC status preserved.",
  UK: "Laws of England and Wales; Companies Act 2006; Financial Services and Markets Act 2000 (FSMA); HMRC SEIS/EIS Advance Assurance to be obtained where applicable.",
  SG: "Republic of Singapore; Companies Act 1967; Securities and Futures Act 2001 (SFA); ACRA Bizfile filings within statutory windows; MAS notification where applicable.",
  HK: "Cayman Islands Companies Act (Revised) for the parent; Hong Kong Companies Ordinance (Cap. 622) for the HK OpCo; SFC-licensed offers; HKEX-aware structuring.",
  CN: "Cayman Islands law for the parent SPV; PRC law for the WFOE/VIE OpCo; SAFE Circular 37 cross-border registration; SAMR onshore filings.",
  IN: "Republic of India; Companies Act 2013; SEBI (AIF) Regulations 2012; FEMA non-debt instrument rules; DPIIT recognition retained where applicable.",
  JP: "Companies Act of Japan (Act No. 86 of 2005); Financial Instruments and Exchange Act (FIEA); FEFTA §27 prior notification where applicable.",
  AU: "Commonwealth of Australia; Corporations Act 2001 (Cth); ASIC Form 484 lodged within 28 days; FIRB approval where threshold triggered; AFSL-aware SPV structuring.",
};

const REGION_SECURITIES_NOTE: Record<Region, string> = {
  US: "Sale of securities will be made in reliance on Regulation D Rule 506(b) or 506(c); each Investor represents that it is an 'accredited investor' as defined in Rule 501(a). Form D will be filed with the SEC within 15 days of first sale.",
  CA: "Sale of securities will be made in reliance on Section 2.3 (accredited investor) and Section 2.5 (family, friends and business associates) of NI 45-106. CCPC status under ITA §125(7) is to be preserved; SR&ED eligibility unaffected.",
  UK: "Sale of securities will be made in reliance on the financial-promotion exemptions under the FSMA Financial Promotion Order (FPO) Articles 19 or 49, or as a high-net-worth / sophisticated-investor offer. Where eligible, SEIS/EIS Advance Assurance will be sought from HMRC prior to issue.",
  SG: "Sale will be made under the small-offers exemption (S.272A) or accredited-investor exemption (S.275) of the Securities and Futures Act 2001. ACRA Bizfile filings and stamp-duty payments will be completed within statutory windows.",
  HK: "Securities will be issued by the Cayman parent; offer in HK will rely on the Companies (WUMP) Ordinance §103 'professional investor' exemption or the §103(2)(ga) exempt-private-offer carve-out. SFC-licensed intermediation where required.",
  CN: "Founders to register their offshore equity holdings under SAFE Circular 37 within 30 days of any change. Onshore SAMR filings to update the WFOE/VIE arrangements. Tax: 10% standard / 5% under HK-PRC DTA on dividends.",
  IN: "Compulsorily Convertible Preference Shares (CCPS) under Companies Act 2013 §55 read with §62(1)(b); FEMA Non-Debt Instrument Rules 2019 followed; DPIIT recognition retained for §56(2)(viib) angel-tax exemption where applicable. SEBI (AIF) Regulations 2012 govern fund LPs.",
  JP: "Class shares (種類株式) issued under Companies Act §107-108; subscription agreement signed in Japanese and English; FEFTA §27 prior notification filed by foreign Investors in restricted sectors not less than 30 days prior to subscription.",
  AU: "Issue made under the small-scale offering exemption (Corporations Act 2001 §708(1)) or wholesale-investor exemption (§761G(7)). ASIC Form 484 lodged within 28 days of allotment. ESS startup concession under ITAA 1997 §83A-105 to be preserved for employee grants.",
};

/* ================================================================== */
/* Section factories                                                   */
/* ================================================================== */

function commonHeader(d: TermSheetData): TermSheetSection[] {
  return [
    {
      id: "preamble",
      heading: "Preamble",
      body: () =>
        `This non-binding Term Sheet (the "Term Sheet") summarizes the principal terms of the proposed financing of ${d.companyLegalName} (the "Company") by ${d.leadInvestor} and other investors mutually acceptable to the Company and ${d.leadInvestor} (collectively, the "Investors"). Except for the provisions captioned "Confidentiality," "No-Shop," "Expenses," and "Governing Law," this Term Sheet is non-binding and is intended solely as an outline of the proposed terms in connection with the contemplated financing.`,
      editable: true,
    },
    {
      id: "closing",
      heading: "1. Closing",
      body: (x) =>
        `The financing of ${x.companyName} (the "Company") will close on or before ${x.closeDate || "[Closing Date]"} (the "Closing"), upon execution of definitive transaction agreements satisfactory to the Company and the Lead Investor.`,
      editable: true,
    },
    {
      id: "investors",
      heading: "2. Investors",
      body: (x) =>
        `${x.leadInvestor} (the "Lead Investor"), and other investors mutually acceptable to the Company and the Lead Investor (collectively, the "Investors").`,
      editable: true,
    },
  ];
}

function pricedRoundCore(d: TermSheetData, instrumentLabel: string): TermSheetSection[] {
  return [
    {
      id: "instrument",
      heading: "3. Instrument",
      body: (x) => `${instrumentLabel} of the Company (the "${instrumentLabel}"), with the rights, preferences, privileges and restrictions described below.`,
      editable: true,
    },
    {
      id: "amount",
      heading: "4. Aggregate Investment",
      body: (x) => `${usd(x.targetAmount)}.`,
      editable: true,
    },
    {
      id: "premoney",
      heading: "5. Pre-Money Valuation",
      body: (x) => `${usd(x.preMoney)} (the "Pre-Money Valuation"), assuming a fully-diluted capitalization of ${num(x.fdSharesPreMoney)} shares (the "Fully-Diluted Capitalization") inclusive of an unallocated employee option pool sized to ${x.poolSize}% of the post-Closing fully-diluted capitalization (the "Pool Top-Up").`,
      editable: true,
    },
    {
      id: "pps",
      heading: "6. Price Per Share",
      body: (x) => `$${(Number.isFinite(x.pricePerShare) ? x.pricePerShare : 0).toFixed(4)} per share (the "Original Issue Price"), based on the Pre-Money Valuation and the Fully-Diluted Capitalization.`,
      editable: true,
    },
    {
      id: "liq",
      heading: "7. Liquidation Preference",
      body: (x) =>
        `${x.liqPrefMultiple}× ${x.participating ? "participating" : "non-participating"} liquidation preference. ` +
        (x.participating
          ? `On a Deemed Liquidation Event the holders of ${instrumentLabel} will receive ${x.liqPrefMultiple}× their Original Issue Price (plus declared but unpaid dividends) and thereafter share pro-rata with the Common Stock${x.capParticipation ? `, subject to a participation cap of ${x.capParticipation}× the Original Issue Price` : ""}. `
          : `On a Deemed Liquidation Event the holders of ${instrumentLabel} will receive the greater of (i) ${x.liqPrefMultiple}× their Original Issue Price (plus declared but unpaid dividends), or (ii) the amount they would have received had they converted to Common Stock immediately prior. `) +
        `A sale of all or substantially all of the Company's assets, a merger, consolidation, or similar transaction will constitute a "Deemed Liquidation Event."`,
      editable: true,
    },
    {
      id: "ad",
      heading: "8. Anti-Dilution",
      body: (x) => `${x.antiDilutionVariant}. The Conversion Price of the ${instrumentLabel} will be adjusted in the event the Company issues additional equity securities at a purchase price less than the then-effective Conversion Price (subject to customary carve-outs for option grants, conversion of outstanding convertibles, and certain other issuances).`,
      editable: true,
    },
    {
      id: "dividends",
      heading: "9. Dividends",
      body: () => `Non-cumulative dividends of 8% per annum on the Original Issue Price, payable when, as, and if declared by the Board of Directors, in preference to any dividend on Common Stock. No dividends will be paid on Common Stock unless an equivalent dividend is paid on the ${instrumentLabel} on an as-converted basis.`,
      editable: true,
    },
    {
      id: "conversion",
      heading: "10. Conversion",
      body: () => `Each share of ${instrumentLabel} is convertible at any time at the option of the holder into Common Stock at the then-effective Conversion Price (initially equal to the Original Issue Price). Mandatory conversion on (i) an underwritten public offering of at least $50M gross proceeds at not less than 3× the Original Issue Price, or (ii) the written consent of holders of a majority of the outstanding ${instrumentLabel}.`,
      editable: true,
    },
    {
      id: "vote",
      heading: "11. Voting",
      body: () => `${instrumentLabel} votes on an as-converted basis with the Common Stock on all matters, except as required by law or as set forth in "Protective Provisions" below.`,
      editable: true,
    },
    {
      id: "protective",
      heading: "12. Protective Provisions",
      body: () => `So long as at least 25% of the originally-issued ${instrumentLabel} is outstanding, the consent of holders of a majority of the ${instrumentLabel} (voting as a separate class) will be required for: (i) amendments to the Company's charter or bylaws adverse to the ${instrumentLabel}, (ii) creation of a senior or pari-passu series, (iii) sale or liquidation of the Company, (iv) declaration of dividends, (v) increase or decrease of the authorized number of shares of ${instrumentLabel}, (vi) increase of the option pool, and (vii) incurrence of indebtedness above $500,000.`,
      editable: true,
    },
    {
      id: "rofr",
      heading: "13. Right of First Refusal & Co-Sale",
      body: () => `Major Investors (defined as Investors holding ≥ $250,000 of ${instrumentLabel}) will have a right of first refusal and a co-sale right with respect to transfers of Common Stock by founders, on customary NVCA terms.`,
      editable: true,
    },
    {
      id: "drag",
      heading: "14. Drag-Along",
      body: () => `Holders of Common Stock and ${instrumentLabel} will agree to vote in favor of a sale of the Company approved by (i) the Board, (ii) holders of a majority of the Common Stock (held by the founders), and (iii) holders of a majority of the ${instrumentLabel}.`,
      editable: true,
    },
    {
      id: "board",
      heading: "15. Board of Directors",
      body: (x) => `The Board will consist of three (3) directors: one (1) designated by the Lead Investor, one (1) designated by the Common Stock (held by the founders, currently ${x.founderNames.join(" and ") || "[Founder Names]"}), and one (1) mutually agreed independent.`,
      editable: true,
    },
    {
      id: "founder-vesting",
      heading: "16. Founder Vesting",
      body: (x) => `All founder Common Stock will be subject to a ${x.vestingMonths}-month vesting schedule with a ${x.cliffMonths}-month cliff, with credit for time served. Single-trigger acceleration on involuntary termination; double-trigger acceleration on a Change of Control.`,
      editable: true,
    },
    {
      id: "esop",
      heading: "17. Employee Option Pool",
      body: (x) => `Immediately prior to the Closing, the Company will reserve an employee option pool sufficient to bring the unallocated portion to ${x.poolSize}% of the post-Closing fully-diluted capitalization (${x.poolTiming === "pre_money" ? "pre-money pool — dilutes founders only" : "post-money pool — dilutes all holders pro-rata"}).`,
      editable: true,
    },
    {
      id: "info-rights",
      heading: "18. Information Rights",
      body: () => `Major Investors will receive (i) annual audited (or, if not audited, founder-certified) financial statements within 120 days of fiscal year-end, (ii) quarterly unaudited financial statements within 45 days of quarter-end, (iii) an annual budget approved by the Board, and (iv) standard inspection rights.`,
      editable: true,
    },
    {
      id: "pro-rata",
      heading: "19. Pro-Rata Rights",
      body: () => `Major Investors will have a pro-rata right to participate in subsequent equity financings sufficient to maintain their as-converted ownership percentage, on terms equivalent to those offered to other Investors.`,
      editable: true,
    },
    {
      id: "no-shop",
      heading: "20. No-Shop",
      body: () => `For 30 days following execution of this Term Sheet, the Company will not solicit, encourage, or accept any offer for the issuance of equity, debt, or convertible securities (other than employee equity), and will deal exclusively with the Lead Investor in good faith toward closing.`,
      editable: true,
    },
    {
      id: "expenses",
      heading: "21. Expenses",
      body: () => `The Company will reimburse the reasonable and documented legal fees of one counsel to the Lead Investor, capped at $35,000, payable at the Closing.`,
      editable: true,
    },
  ];
}

function safeSection(d: TermSheetData, variant: "post" | "pre"): TermSheetSection[] {
  const variantLabel = variant === "post" ? "Post-Money" : "Pre-Money";
  const ycVersion = variant === "post" ? "Y Combinator SAFE v1.2 (post-money valuation cap)" : "Y Combinator SAFE v1.0 (pre-money valuation cap)";
  return [
    {
      id: "instrument",
      heading: "3. Instrument",
      body: () =>
        `Simple Agreement for Future Equity (SAFE) — ${variantLabel} Valuation Cap. The form to be used will be the ${ycVersion}, with such modifications as are mutually agreed and consistent with the laws of the Company's jurisdiction.`,
      editable: true,
    },
    {
      id: "amount",
      heading: "4. Purchase Amount",
      body: (x) => `${usd(x.targetAmount)} aggregate, with individual SAFEs sized in increments of not less than ${usd(50000)}.`,
      editable: true,
    },
    {
      id: "cap",
      heading: "5. Valuation Cap",
      body: (x) => `${usd(x.valuationCap)} ${variantLabel.toLowerCase()} valuation cap. The SAFE converts at the lower of (a) the price implied by the Valuation Cap, and (b) the Discount Price.`,
      editable: true,
    },
    {
      id: "discount",
      heading: "6. Discount",
      body: (x) => `${x.discount}% discount to the price per share in the next priced equity financing (the "Equity Financing").`,
      editable: true,
    },
    {
      id: "mfn",
      heading: "7. Most-Favored-Nation",
      body: (x) => x.mfn ? `If, prior to the Equity Financing, the Company issues a SAFE on materially more favorable terms, the Investor may elect to amend its SAFE to match.` : `No MFN provision.`,
      editable: true,
    },
    {
      id: "trigger",
      heading: "8. Conversion Trigger",
      body: () => `Automatic conversion on the next Equity Financing of at least $1,000,000 in gross proceeds (excluding the conversion of SAFEs and convertible notes). Holders may elect cash repayment on a Liquidity Event.`,
      editable: true,
    },
    {
      id: "no-shop",
      heading: "9. No-Shop",
      body: () => `For 14 days following execution of this Term Sheet, the Company will not solicit, encourage, or accept competing offers in respect of the SAFE round.`,
      editable: true,
    },
  ];
}

function noteSection(d: TermSheetData): TermSheetSection[] {
  return [
    {
      id: "instrument",
      heading: "3. Instrument",
      body: () => `Convertible Promissory Note (the "Note"), unsecured, with the principal terms below.`,
      editable: true,
    },
    {
      id: "principal",
      heading: "4. Principal Amount",
      body: (x) => `${usd(x.targetAmount)} aggregate principal amount, in individual Notes of not less than ${usd(50000)}.`,
      editable: true,
    },
    {
      id: "interest",
      heading: "5. Interest Rate",
      body: (x) => `${x.interestRate}% per annum, simple interest, accruing from the date of issuance and payable at conversion or maturity.`,
      editable: true,
    },
    {
      id: "maturity",
      heading: "6. Maturity",
      body: (x) => `${x.maturityMonths} months from the date of issuance. On or after the Maturity Date, the holders of a majority of the outstanding Notes (by principal) may elect (i) repayment in cash, or (ii) conversion at the Cap Price.`,
      editable: true,
    },
    {
      id: "cap-discount",
      heading: "7. Conversion Cap & Discount",
      body: (x) => `Notes convert at the next Qualified Financing at the lower of (a) the Cap Price implied by a ${usd(x.valuationCap)} valuation cap, and (b) the Discount Price = (1 − ${x.discount}%) × the price in the Qualified Financing.`,
      editable: true,
    },
    {
      id: "qf",
      heading: "8. Qualified Financing",
      body: () => `An equity financing of preferred stock raising at least $1,000,000 in gross proceeds (excluding conversion of Notes and SAFEs). Conversion is automatic on the closing of a Qualified Financing.`,
      editable: true,
    },
  ];
}

function warrantSection(d: TermSheetData): TermSheetSection[] {
  return [
    {
      id: "instrument",
      heading: "3. Instrument",
      body: () => `Warrant to purchase shares of the Company's Common Stock (the "Warrant"), to be issued to the Holder named in the Warrant Certificate.`,
      editable: true,
    },
    {
      id: "underlying",
      heading: "4. Underlying Shares",
      body: (x) => `${num(Math.round(x.targetAmount / Math.max(0.0001, (x.pricePerShare || 1))))} shares of Common Stock (subject to customary anti-dilution adjustments).`,
      editable: true,
    },
    {
      id: "strike",
      heading: "5. Strike Price",
      body: (x) => `$${(x.pricePerShare || 1).toFixed(4)} per share, equal to the most recent 409A fair-market value at issuance.`,
      editable: true,
    },
    {
      id: "term",
      heading: "6. Term",
      body: () => `Ten (10) years from issuance, expiring at 5:00 PM local time on the tenth anniversary.`,
      editable: true,
    },
    {
      id: "cashless",
      heading: "7. Cashless Exercise",
      body: () => `Holder may elect cashless (net) exercise; the Company will deliver only the in-the-money portion of the underlying shares.`,
      editable: true,
    },
  ];
}

function poolSection(d: TermSheetData): TermSheetSection[] {
  return [
    {
      id: "instrument",
      heading: "3. Instrument",
      body: () => `Top-up of the Company's employee equity incentive plan (the "Plan") by way of an increase in the authorized share reserve.`,
      editable: true,
    },
    {
      id: "size",
      heading: "4. Pool Size",
      body: (x) => `Increase the unallocated reserve to ${x.poolSize}% of the post-Closing fully-diluted capitalization.`,
      editable: true,
    },
    {
      id: "timing",
      heading: "5. Pool Timing",
      body: (x) => x.poolTiming === "pre_money"
        ? `Pre-money pool — created immediately prior to the next round Closing; founder dilution is borne entirely by existing holders.`
        : `Post-money pool — created immediately after Closing; dilution is shared pro-rata across all holders.`,
      editable: true,
    },
    {
      id: "vesting",
      heading: "6. Vesting",
      body: (x) => `${x.vestingMonths}-month standard vesting schedule with a ${x.cliffMonths}-month cliff. Acceleration provisions per individual award agreements.`,
      editable: true,
    },
  ];
}

function commonStockSection(d: TermSheetData): TermSheetSection[] {
  return [
    {
      id: "instrument",
      heading: "3. Instrument",
      body: () => `Common Stock of the Company, par value $0.0001 per share.`,
      editable: true,
    },
    {
      id: "amount",
      heading: "4. Issuance",
      body: (x) => `Issuance of common shares to the founders and initial team in respect of services and incorporation. Aggregate consideration: par value × shares issued.`,
      editable: true,
    },
    {
      id: "vesting",
      heading: "5. Founder Vesting",
      body: (x) => `Founder shares subject to a ${x.vestingMonths}-month vesting schedule with a ${x.cliffMonths}-month cliff. 83(b) elections to be filed within 30 days of issuance for U.S. founders.`,
      editable: true,
    },
  ];
}

/* ================================================================== */
/* Trailing sections — governing law + disclaimer                      */
/* ================================================================== */

function trailingSections(region: Region): TermSheetSection[] {
  return [
    {
      id: "confidentiality",
      heading: "Confidentiality",
      body: () => `The existence and contents of this Term Sheet are confidential and may not be disclosed by either party (except to its directors, officers, employees, attorneys, accountants, and other professional advisors) without the prior written consent of the other party.`,
      editable: true,
    },
    {
      id: "securities-law",
      heading: "Securities Law Compliance",
      body: () => REGION_SECURITIES_NOTE[region],
      editable: true,
    },
    {
      id: "governing-law",
      heading: "Governing Law",
      body: () => `This Term Sheet will be governed by and construed in accordance with ${GOVERNING_LAW[region]} The parties consent to the exclusive jurisdiction of the courts of competent jurisdiction in the foregoing forum for any dispute arising out of this Term Sheet.`,
      editable: true,
    },
    {
      id: "counsel-disclaimer",
      heading: "Counsel-Review Disclaimer",
      body: () =>
        `IMPORTANT — NOT LEGAL ADVICE. Capavate is a software platform and is not a law firm. This Term Sheet is a draft generated from a region-aware template; it is provided as a starting point only and may not reflect the most current law or your specific facts and circumstances. The Company is strongly encouraged to have qualified securities counsel licensed in the relevant jurisdiction(s) review this Term Sheet (and any definitive transaction agreements) prior to execution. The Capavate Collective consortium can introduce qualified counsel in your region on request.`,
      editable: false,
      disclaimerSection: true,
    },
  ];
}

/* ================================================================== */
/* Region template name + citations                                    */
/* ================================================================== */

const REGION_TEMPLATE_NAME: Record<Region, Partial<Record<InstrumentValue, string>>> & { _default: Record<Region, string> } = {
  US: {
    common: "US — Delaware Common Stock Issuance (NVCA-aligned)",
    preferred: "US — NVCA Model Series A Preferred Term Sheet",
    safe_post: "US — Y Combinator SAFE v1.2 (Post-Money Cap) Side Letter",
    safe_pre: "US — Y Combinator SAFE v1.0 (Pre-Money Cap) Side Letter",
    convertible_note: "US — Convertible Note Purchase Agreement Term Sheet",
    warrant: "US — Common Stock Warrant Agreement",
    option_pool: "US — Equity Incentive Plan Top-Up (NVCA-aligned)",
  },
  CA: {
    preferred: "CA — CVCA-style Preferred Share Term Sheet (NI 45-106)",
    safe_post: "CA — SAFE Post-Money (NI 45-106 accredited)",
    safe_pre: "CA — SAFE Pre-Money (NI 45-106 accredited)",
    convertible_note: "CA — Convertible Debenture Term Sheet (CCPC)",
    warrant: "CA — Share Purchase Warrant",
    option_pool: "CA — CCPC Stock Option Plan Top-Up (IFRS 2)",
    common: "CA — CCPC Common Share Subscription",
  },
  UK: {
    preferred: "UK — BVCA Model Form Series A Term Sheet",
    safe_post: "UK — Advance Subscription Agreement (SEIS/EIS-compatible)",
    safe_pre: "UK — Advance Subscription Agreement (Pre-Money)",
    convertible_note: "UK — Convertible Loan Note Term Sheet",
    warrant: "UK — Warrant Instrument (English law)",
    option_pool: "UK — EMI / CSOP Option Plan Top-Up",
    common: "UK — Companies Act 2006 Ordinary Share Subscription",
  },
  SG: {
    preferred: "SG — Adapted NVCA Series A (ACRA / MAS / IRAS s13H)",
    safe_post: "SG — SAFE Post-Money (S.272A/S.275 SFA)",
    safe_pre: "SG — SAFE Pre-Money (S.272A/S.275 SFA)",
    convertible_note: "SG — Convertible Note (ACRA Bizfile)",
    warrant: "SG — Warrant to Subscribe (Companies Act 1967)",
    option_pool: "SG — ESOP Top-Up (MAS framework)",
    common: "SG — Ordinary Share Subscription (Companies Act 1967)",
  },
  HK: {
    preferred: "HK — Cayman Parent Series A Term Sheet (HKEX-aware)",
    safe_post: "HK — SAFE Post-Money (Cayman parent)",
    safe_pre: "HK — SAFE Pre-Money (Cayman parent)",
    convertible_note: "HK — Convertible Note (Cayman parent / HK OpCo)",
    warrant: "HK — Warrant (Cayman parent)",
    option_pool: "HK — ESOP Top-Up (IRD DIPN 38)",
    common: "HK — Cayman parent Common Stock Issuance",
  },
  CN: {
    preferred: "CN — Cayman Parent + WFOE OpCo Split Series A Term Sheet (SAFE Circular 37)",
    safe_post: "CN — SAFE Post-Money (Cayman parent; SAFE Circular 37 reminder)",
    safe_pre: "CN — SAFE Pre-Money (Cayman parent; SAFE Circular 37 reminder)",
    convertible_note: "CN — Convertible Note (Cayman parent + WFOE)",
    warrant: "CN — Warrant (Cayman parent)",
    option_pool: "CN — Phantom-Equity ESOP Top-Up (WFOE / VIE)",
    common: "CN — Cayman parent Common Stock Issuance (offshore)",
  },
  IN: {
    preferred: "IN — CCPS Term Sheet (Companies Act 2013 §55, §62(1)(b); SEBI AIF; FEMA)",
    safe_post: "IN — iSAFE Post-Money (compulsorily convertible; FEMA)",
    safe_pre: "IN — iSAFE Pre-Money (compulsorily convertible; FEMA)",
    convertible_note: "IN — CCD Term Sheet (Companies Act 2013 §71; FEMA)",
    warrant: "IN — Share Warrant (Companies Act 2013 §62(1)(c))",
    option_pool: "IN — ESOP Plan Top-Up (SEBI SBEB; perquisite tax at exercise)",
    common: "IN — Equity Share Subscription (Companies Act 2013)",
  },
  JP: {
    preferred: "JP — Class Share Term Sheet (Companies Act §107-108)",
    safe_post: "JP — Coral Capital J-KISS (SAFE-equivalent for Japan)",
    safe_pre: "JP — Coral Capital J-KISS (Pre-Money variant)",
    convertible_note: "JP — Convertible Bond with Stock Acquisition Rights (新株予約権付社債)",
    warrant: "JP — Stock Acquisition Rights (新株予約権)",
    option_pool: "JP — Tax-Qualified Stock Option Plan (ITA §29-2)",
    common: "JP — Kabushiki Kaisha Common Share Subscription",
  },
  AU: {
    preferred: "AU — Preference Share Term Sheet (Corporations Act 2001)",
    safe_post: "AU — SAFE Post-Money (ASIC §708 / §761G(7))",
    safe_pre: "AU — SAFE Pre-Money (ASIC §708 / §761G(7))",
    convertible_note: "AU — Convertible Note (Corporations Act 2001)",
    warrant: "AU — Options to Subscribe (Corporations Act 2001)",
    option_pool: "AU — ESS Plan Top-Up (ITAA 1997 §83A-105 startup concession)",
    common: "AU — Ordinary Share Subscription (Corporations Act 2001)",
  },
  _default: {
    US: "US — NVCA Model Term Sheet",
    CA: "CA — CVCA-aligned Term Sheet",
    UK: "UK — BVCA Model Form Term Sheet",
    SG: "SG — Adapted NVCA Term Sheet",
    HK: "HK — Cayman Parent Term Sheet",
    CN: "CN — Cayman + WFOE Split Term Sheet",
    IN: "IN — Companies Act 2013 Term Sheet",
    JP: "JP — Class Share / J-KISS Term Sheet",
    AU: "AU — Corporations Act Term Sheet",
  },
} as const;

const CITATIONS: Record<Region, string[]> = {
  US: [
    "NVCA Model Term Sheet (2024 release) — https://nvca.org/model-legal-documents/",
    "Y Combinator SAFE v1.2 Post-Money Cap — https://www.ycombinator.com/documents",
    "Delaware General Corporation Law (8 Del. C.) §151 (preferred series)",
    "Securities Act of 1933, Reg D Rule 506(b)/(c)",
    "IRC §83(b) election for restricted stock",
  ],
  CA: [
    "National Instrument 45-106 (Prospectus Exemptions) §2.3, §2.5",
    "Business Corporations Act (Ontario) R.S.O. 1990, c. B.16",
    "ITA §125(7) CCPC definition; SR&ED-aware structuring",
    "IFRS 2 Share-based Payment recognition",
    "CVCA-style adapted NVCA Series A terms",
  ],
  UK: [
    "BVCA Model Form Term Sheet — https://www.bvca.co.uk/",
    "Companies Act 2006 (UK) Parts 17–18 (share capital and class rights)",
    "Financial Services and Markets Act 2000 (FPO Articles 19, 49)",
    "HMRC SEIS / EIS Advance Assurance",
    "EMI Option Scheme (ITEPA 2003 Schedule 5)",
  ],
  SG: [
    "Companies Act 1967 (Singapore)",
    "Securities and Futures Act 2001 §272A, §275",
    "ACRA Bizfile post-allotment filings",
    "MAS notification of restricted/exempt offers where applicable",
    "IRAS s13H tax exemption (VCC structures)",
  ],
  HK: [
    "Cayman Islands Companies Act (Revised) — exempted-company parent",
    "Hong Kong Companies Ordinance (Cap. 622) — HK OpCo",
    "Companies (WUMP) Ordinance §103 professional-investor exemption",
    "IRD DIPN 38 — ESOP income tax at exercise",
    "HKEX listing-readiness considerations for late-stage rounds",
  ],
  CN: [
    "Cayman parent + WFOE/VIE OpCo offshore-onshore split",
    "SAFE Circular 37 — onshore individuals' offshore SPV registration",
    "SAMR (State Administration for Market Regulation) onshore filings",
    "PRC EIT 10% standard / 5% HK-PRC DTA on dividends",
    "Phantom-equity ESOP framework for WFOE/VIE",
  ],
  IN: [
    "Companies Act 2013 §55 — issue and redemption of preference shares",
    "Companies Act 2013 §62(1)(b) — preferential allotment",
    "Companies Act 2013 §71 — debentures (CCDs)",
    "FEMA Non-Debt Instrument Rules 2019 — cross-border capital",
    "SEBI (AIF) Regulations 2012 — fund LP regulation",
    "DPIIT recognition retained for §56(2)(viib) angel-tax exemption",
    "SEBI SBEB Regulations 2021 — ESOP / SAR plans",
  ],
  JP: [
    "Companies Act of Japan (Act No. 86 of 2005) §107–108 — class shares",
    "Coral Capital J-KISS template — https://github.com/CoralCapital/jkiss",
    "Financial Instruments and Exchange Act (FIEA)",
    "FEFTA §27 — prior notification for restricted-sector cross-border investment",
    "Income Tax Act §29-2 — tax-qualified stock options",
  ],
  AU: [
    "Corporations Act 2001 (Cth) §254A — share issuance authorization",
    "Corporations Act §708 — small-scale offering exemption",
    "Corporations Act §761G(7) — wholesale-investor exemption",
    "ITAA 1997 §83A-105 — ESS startup concession (<10yr / <$50M turnover)",
    "ASIC RG 217 — small-scale personal-offer exemption",
    "FIRB approval (FATA 1975) where threshold triggered",
  ],
};

/* ================================================================== */
/* Build templates                                                     */
/* ================================================================== */

function buildSections(d: TermSheetData, region: Region, instrument: InstrumentValue): TermSheetSection[] {
  let core: TermSheetSection[];
  switch (instrument) {
    case "common":
      core = commonStockSection(d);
      break;
    case "preferred":
      core = pricedRoundCore(d, instrumentLabelFor(region, instrument));
      break;
    case "safe_post":
      core = safeSection(d, "post");
      break;
    case "safe_pre":
      core = safeSection(d, "pre");
      break;
    case "convertible_note":
      core = noteSection(d);
      break;
    case "warrant":
      core = warrantSection(d);
      break;
    case "option_pool":
      core = poolSection(d);
      break;
    default:
      core = pricedRoundCore(d, "Series Preferred Stock");
  }
  const all = [...commonHeader(d), ...core, ...trailingSections(region)];
  // Sprint 26 — inject the investor-grade description registry for every
  // clause whose id is recognised. The editor renders the description in a
  // dedicated editable panel beneath each clause body.
  return all.map((s) => ({ ...s, description: s.description ?? getClauseDescription(s.id) }));
}

function instrumentLabelFor(region: Region, instrument: InstrumentValue): string {
  // Region-specific class / preferred labelling.
  if (instrument !== "preferred") return instrument;
  switch (region) {
    case "US": return "Series A Preferred Stock";
    case "CA": return "Series A Preferred Shares (CCPC)";
    case "UK": return "Series A Preference Shares";
    case "SG": return "Series A Preference Shares";
    case "HK": return "Series A Preferred Shares (Cayman parent)";
    case "CN": return "Series A Preferred Shares (Cayman parent)";
    case "IN": return "Compulsorily Convertible Preference Shares (CCPS)";
    case "JP": return "Class A Shares (種類株式)";
    case "AU": return "Series A Preference Shares";
  }
}

export function getTemplate(region: Region, instrument: InstrumentValue, data: TermSheetData): TermSheetTemplate {
  const r = (REGION_TEMPLATE_NAME as unknown as Record<Region, Partial<Record<InstrumentValue, string>>>)[region] ?? {};
  const fallback = REGION_TEMPLATE_NAME._default[region];
  const templateName = r[instrument] ?? fallback ?? `${region} — Term Sheet (${instrument})`;
  return {
    region,
    instrument,
    templateName,
    version: "1.0.0",
    sourceCitations: CITATIONS[region],
    sections: buildSections(data, region, instrument),
  };
}

/**
 * Render a full term sheet as plain markdown-ish text — used by PDF export.
 *
 * Sprint 26: when `includeDescriptions` is true, the per-clause investor-grade
 * description is rendered in an indented "Clause Notes" block beneath each
 * section so the founder + reviewing counsel can see the rationale inline.
 */
export function renderTermSheetText(
  template: TermSheetTemplate,
  data: TermSheetData,
  options: { includeDescriptions?: boolean } = {},
): string {
  const lines: string[] = [];
  lines.push(`# ${template.templateName}`);
  lines.push(`Template version: ${template.version}`);
  lines.push("");
  lines.push(`Citations: ${template.sourceCitations.join("; ")}`);
  lines.push("");
  lines.push("=".repeat(70));
  lines.push("");
  for (const s of template.sections) {
    lines.push(`## ${s.heading}`);
    lines.push("");
    lines.push(s.body(data));
    if (options.includeDescriptions && s.description) {
      lines.push("");
      lines.push("  --- Clause Notes ---");
      lines.push(`  What it means: ${s.description.whatItMeans}`);
      lines.push(`  Why it matters: ${s.description.whyItMatters}`);
      if (s.description.commonVariants) lines.push(`  Common variants: ${s.description.commonVariants}`);
      if (s.description.founderWatchouts) lines.push(`  Founder watch-outs: ${s.description.founderWatchouts}`);
      if (s.description.citation) lines.push(`  Source: ${s.description.citation}`);
      lines.push("  ---");
    }
    lines.push("");
  }
  return lines.join("\n");
}

/* ================================================================== */
/* Reconciliation: extract + compare                                   */
/* ================================================================== */

export interface UploadedTerms {
  preMoney?: number;
  valuationCap?: number;
  liqPrefMultiple?: number;
  antiDilution?: string;
  instrument?: string;
  discount?: number;
}

export interface ReconciliationDiff {
  field: string;
  roundValue: string;
  uploadedValue: string;
  match: boolean;
}

/** Heuristic regex extractor — robust to common term-sheet phrasing. */
export function extractTermsFromText(text: string): UploadedTerms {
  const norm = text.replace(/\s+/g, " ");
  const out: UploadedTerms = {};
  // Pre-money valuation
  const preMoney = norm.match(/pre[-\s]?money(?:\s+valuation)?[^$]*\$\s?([\d,]+(?:\.\d+)?)\s?(million|m|k)?/i);
  if (preMoney) out.preMoney = toAmount(preMoney[1], preMoney[2]);
  // Valuation cap
  const cap = norm.match(/(?:valuation\s+cap|cap\s+price)[^$]*\$\s?([\d,]+(?:\.\d+)?)\s?(million|m|k)?/i);
  if (cap) out.valuationCap = toAmount(cap[1], cap[2]);
  // Liq pref multiple
  const liq = norm.match(/(\d+(?:\.\d+)?)\s?[x×]\s+(?:non-)?participating?(?:\s+preferred)?/i)
            ?? norm.match(/liquidation\s+preference[^0-9]*(\d+(?:\.\d+)?)\s?[x×]/i);
  if (liq) out.liqPrefMultiple = parseFloat(liq[1]);
  // Anti-dilution
  if (/full\s+ratchet/i.test(norm)) out.antiDilution = "full_ratchet";
  else if (/broad[-\s]?based\s+weighted/i.test(norm)) out.antiDilution = "broad_based_wa";
  else if (/narrow[-\s]?based\s+weighted/i.test(norm)) out.antiDilution = "narrow_based_wa";
  // Discount
  const disc = norm.match(/(\d+(?:\.\d+)?)\s?%\s+discount/i);
  if (disc) out.discount = parseFloat(disc[1]);
  // Instrument
  if (/series\s+[A-Z]\s+preferred/i.test(norm) || /preference\s+shares/i.test(norm)) out.instrument = "preferred";
  else if (/SAFE/i.test(norm)) out.instrument = norm.match(/post[-\s]?money/i) ? "safe_post" : "safe_pre";
  else if (/convertible\s+(?:note|loan)/i.test(norm)) out.instrument = "convertible_note";
  return out;
}

function toAmount(numStr: string, suffix?: string): number {
  const n = parseFloat(numStr.replace(/,/g, ""));
  if (!Number.isFinite(n)) return 0;
  const s = (suffix ?? "").toLowerCase();
  if (s === "million" || s === "m") return n * 1_000_000;
  if (s === "k") return n * 1_000;
  return n;
}

export function reconcileTerms(round: TermSheetData, uploaded: UploadedTerms): ReconciliationDiff[] {
  const diffs: ReconciliationDiff[] = [];
  if (uploaded.preMoney !== undefined) {
    diffs.push({
      field: "Pre-money valuation",
      roundValue: usd(round.preMoney),
      uploadedValue: usd(uploaded.preMoney),
      match: Math.abs(uploaded.preMoney - round.preMoney) < 1,
    });
  }
  if (uploaded.valuationCap !== undefined && round.valuationCap) {
    diffs.push({
      field: "Valuation cap",
      roundValue: usd(round.valuationCap),
      uploadedValue: usd(uploaded.valuationCap),
      match: Math.abs(uploaded.valuationCap - round.valuationCap) < 1,
    });
  }
  if (uploaded.liqPrefMultiple !== undefined && round.liqPrefMultiple) {
    diffs.push({
      field: "Liquidation preference multiple",
      roundValue: `${round.liqPrefMultiple}×`,
      uploadedValue: `${uploaded.liqPrefMultiple}×`,
      match: Math.abs(uploaded.liqPrefMultiple - round.liqPrefMultiple) < 0.01,
    });
  }
  if (uploaded.antiDilution !== undefined) {
    diffs.push({
      field: "Anti-dilution variant",
      roundValue: round.antiDilutionVariant,
      uploadedValue: uploaded.antiDilution,
      match: round.antiDilutionVariant.toLowerCase().replace(/[^a-z]/g, "_").includes(uploaded.antiDilution.replace(/[^a-z_]/g, "")),
    });
  }
  if (uploaded.instrument !== undefined) {
    diffs.push({
      field: "Instrument",
      roundValue: round.instrument,
      uploadedValue: uploaded.instrument,
      match: round.instrument === uploaded.instrument || (round.instrument === "preferred" && uploaded.instrument === "preferred"),
    });
  }
  if (uploaded.discount !== undefined && round.discount) {
    diffs.push({
      field: "Discount",
      roundValue: `${round.discount}%`,
      uploadedValue: `${uploaded.discount}%`,
      match: Math.abs(uploaded.discount - round.discount) < 0.5,
    });
  }
  return diffs;
}
