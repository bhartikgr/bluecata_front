/* W-FIX1f — SPV-EDU-1. Plain-language educational copy for the whole SPV
 * journey, sourced VERBATIM from SPV Plan v2 §3 (CAPAVATE_SPV_DELTA_EXPANDED.md
 * §3 copy table). Centralised so the wizard, the tabbed detail page, and any
 * future SPV surface show the SAME copy for non-sophisticated GPs. Nothing here
 * gates or blocks — it only explains.
 */

export const SPV_EDU = {
  whatIsAnSpv:
    "An SPV (Special Purpose Vehicle) lets you pool several investors' money into ONE investment in a company. On the cap table the company sees a single line — your SPV — while you keep track of each investor inside it. It's the standard way syndicates and angel groups invest together.",
  nameJurisdiction:
    "Name your SPV and pick where it's legally based. Different countries use different entity types — a US 'LLC', a UK company, a Cayman entity, etc. You can set up the actual legal entity with your lawyer separately; nothing here forces a structure or blocks you from continuing.",
  mandate:
    "Describe what this SPV will invest in — a specific company, or a theme (sectors, stage, geography). This sets expectations for your investors. You can name a target company without committing to a dollar amount.",
  fees:
    "Set what you charge your investors. 'Carry' is your share of the profits (commonly 20%). A 'management fee' is a fixed charge. A 'hurdle' (a minimum return to investors before you take carry) and a 'GP commitment' (your own money in the deal) are optional — most SPVs skip them. We'll always show your investors a clear fee breakdown.",
  terms:
    "Set your target raise (a goal, not a limit — you can proceed even if you raise less), minimum investment, currency, and who can see the deal. Carry basis: 'per deployment' means carry is figured per investment; 'whole SPV' pools it across everything.",
  reviewLaunch:
    "Review everything and launch. Launching creates the SPV so you can start inviting investors — it does NOT move any money. You'll confirm real investments yourself as they arrive.",
  accreditation:
    "Investors on Capavate are assumed to be accredited. If an investor you add hasn't confirmed this yet, we'll ask them a one-time question and save it to their profile. Plain meaning: an accredited investor meets income/net-worth thresholds that let them invest in private deals.",
  confirmingInvestments:
    "Investors typically wire money to your SPV's bank account outside Capavate. When funds arrive, mark that investor 'Confirmed' here — that updates your SPV's cap table and the company's cap table automatically. You're the source of truth for what's actually been funded.",
  investorCount:
    "Some jurisdictions limit how many investors an SPV can have (e.g. US SPVs often cap at 100). We'll warn you as you get close — it never stops you, it just keeps you informed for your jurisdiction.",
  closing:
    "When you're done taking investors, click 'Close to new LPs.' You can do a 'first close' and deploy what you've raised, then reopen for more investors later (a rolling close). If you raised less than target, that's fine — you can deploy the confirmed amount or adjust your target.",
  deploying:
    "Deploying sends your SPV's total into the company's round as a single cap-table line. The founder sees one entry (your SPV); your investors stay private to you.",
  distributions:
    "When the company returns money (dividend or exit), it usually happens offline. Record the distribution here and confirm it — we'll compute each investor's share from your terms and update their capital accounts.",
  reporting:
    "You can share an optional valuation update with your investors. Early-stage startups often have no valuation for a while — that's normal, and we'll show investors 'not yet reported' rather than a misleading number.",
  filings:
    "Depending on your jurisdiction, there may be regulatory notices (e.g. a US 'Form D'). We list them as a helpful checklist — completing them is up to you and your lawyer; it never blocks anything here.",
  windDown:
    "When the SPV has returned everything, use the wind-down checklist to close it cleanly — notify investors, confirm the final distribution, and record the dissolution.",
  transfers:
    "A secondary transfer moves an investor's position to someone else. You approve each transfer as the GP; the incoming holder does a one-time accreditation self-declaration if they haven't already, and they count toward your investor-count awareness.",
  actingOnBehalf:
    "You administer this SPV as the GP on behalf of your investors. When you deploy into a company, the founder sees ONE aggregated line — your SPV — on their cap table, never the individual investor list. You keep track of each investor inside the SPV; the founder's round and your vehicle run in parallel.",
  /* WAVE 36 / ROW 9 — this string used to promise "TVPI/DPI/IRR". Only DPI was
     ever produced at capital-account granularity, and even that was not shown;
     the sentence was a dead promise the grid could never keep.

     WHAT CHANGED, EXACTLY:
       · DPI  — WIRED, not reworded. It is realised (distributions ÷ paid-in),
                needs no mark, and now comes from the canonical producer in
                server/lib/spvOfflineOps.ts computeCapitalAccounts, rendered as
                the appended last column of the grid.
       · TVPI — COPY CORRECTED. It needs each LP's share of a current NAV mark;
                no producer exists at this granularity. Vehicle-level TVPI does
                exist and is on the Performance page, so the copy points there
                rather than inventing a per-LP number.
       · IRR  — COPY CORRECTED, same reason: IRR needs dated per-LP flows, which
                nothing produces. Vehicle-level IRR is on the Performance page. */
  capitalAccounts:
    "A capital account tracks, per investor: what they committed, what you've confirmed as actually funded, what they've been paid in distributions, and their realised DPI (distributions divided by paid-in capital). DPI reads 'not reported' until capital has actually been called — an investor who has paid in nothing has no DPI, rather than a DPI of zero. TVPI and IRR are NOT shown per investor: both need a current valuation mark or dated per-investor cash flows that this vehicle does not produce. Vehicle-level IRR, DPI and TVPI live on the SPV's Performance page.",
} as const;

/* D6 — jurisdiction-aware, NON-BLOCKING investor-count awareness. Returns a
 * soft limit + label for the SPV's jurisdiction, or null where no common
 * threshold applies. Warn near the threshold; NEVER block. */
export function investorCountAwareness(jurisdiction: string | null | undefined): {
  limit: number | null;
  label: string;
} {
  const j = String(jurisdiction ?? "").toLowerCase();
  if (j === "delaware" || j === "us" || j === "united states") {
    return { limit: 100, label: "US 3(c)(1) funds commonly cap at ~100 investors." };
  }
  // Other jurisdictions: no single common numeric cap to assert — stay silent.
  return { limit: null, label: "No common investor-count threshold applies to this jurisdiction." };
}

/* D1/D7/D13 — voluntary, jurisdiction-aware checklist item sets. Educational
 * only; every item is optional and NONE of them block SPV activation. */
export function formationChecklist(jurisdiction: string | null | undefined): string[] {
  const j = String(jurisdiction ?? "").toLowerCase();
  const idLabel = j === "cayman" ? "Registered number obtained" : j === "bvi" ? "Company number obtained" : "Tax ID / EIN obtained";
  return [
    "Legal entity filed / registered",
    "Registered agent appointed",
    "Bank account opened",
    idLabel,
  ];
}

export function filingsChecklist(jurisdiction: string | null | undefined): string[] {
  const j = String(jurisdiction ?? "").toLowerCase();
  if (j === "delaware" || j === "us" || j === "united states") {
    return ["Form D filed with the SEC (if applicable)", "Blue-sky / state notice filings (if applicable)"];
  }
  return ["Check local regulatory notice requirements with your counsel"];
}

export const WIND_DOWN_CHECKLIST = [
  "Notify all investors of the wind-down",
  "Confirm the final distribution has been recorded",
  "Record the dissolution of the entity",
  "Close the SPV",
] as const;
