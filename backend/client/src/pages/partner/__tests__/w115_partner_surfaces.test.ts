/**
 * WAVE 115 — PARTNER SURFACES AND REMAINING TRUTH DEFECTS.
 *
 * Findings 1 (machine keys on a customer screen), 2 (fabricated figures),
 * 3 (every failure collapsed to the word "network"), 4 (placeholder figures
 * dressed as measurements), 5 (no founder version string) and 6 (dead controls,
 * a lying label, an internal id in a filename, a silently accepted bad date).
 *
 * WHY MOST OF THIS SUITE IS SOURCE-LEVEL RATHER THAN RENDER-LEVEL.
 * The defects here are about WHICH EXPRESSION reaches the DOM, not about
 * branching logic. A render test that mounts one fixture proves the label map
 * works for the stages that fixture happens to contain; a source assertion that
 * "no raw stage key is interpolated on this page" holds for every stage, every
 * partner, forever. Where behaviour genuinely branches — the date refusal, the
 * error copy, the unavailable-figure path — the behaviour itself is exercised.
 *
 * Every assertion below was run against the pre-wave tree; the before/after
 * output is recorded verbatim in build_log/wave115/W115_TESTS.md.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  partnerPipelineStageLabel,
  spvStatusLabel,
  fundStatusLabel,
  subscriptionStatusLabel,
  planTierLabel,
  quotaEnforcementLabel,
  managedFounderStatusLabel,
  humanizeMachineKey,
} from "@/lib/partnerDisplay";
import { PARTNER_PIPELINE_STAGES } from "@shared/crmStages";
import { tierErrorCopy, looksInternalCode, TRANSPORT_FAILURE } from "@/components/comms/CommsTierActionsPanel";
import { companyExportSlug, ledgerPdfFilename } from "@/lib/captable/exportProvenance";

const REPO = path.resolve(__dirname, "..", "..", "..", "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), "utf8");

/** Every file a Consortium Partner can actually look at. */
function partnerSurfaceFiles(): string[] {
  const out: string[] = [];
  for (const rel of ["client/src/pages/partner", "client/src/components/partner"]) {
    const dir = path.join(REPO, rel);
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          if (e.name === "__tests__") continue;
          walk(p);
        } else if (e.name.endsWith(".tsx")) out.push(p);
      }
    };
    walk(dir);
  }
  return out;
}

/** Source with block and line comments removed — documentation is not UI. */
function code(fileOrRel: string): string {
  const file = path.isAbsolute(fileOrRel) ? fileOrRel : path.join(REPO, fileOrRel);
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/* ════════════════════════════════════════════════════════════════════════════
   FINDING 1 — `soft_circle` WAS ON THE OWNER'S SCREEN
   ════════════════════════════════════════════════════════════════════════════ */
describe("W115 F1 — no machine key reaches a partner-facing screen", () => {
  it("THE DEFECT IN THE SCREENSHOT: every partner pipeline stage renders a human label, and `soft_circle` is never one of them", () => {
    /* The Pipeline card iterated PARTNER_PIPELINE_STAGES and printed each key
       verbatim, so the owner read "invited · viewed · soft_circle · signed ·
       funded · committed". Four were ordinary English by luck. */
    const rendered = PARTNER_PIPELINE_STAGES.map((s) => partnerPipelineStageLabel(s));
    /* NOTE, REPORTED NOT SILENTLY HARMONISED: the shared map spells this
       "Soft-circle" while the investor spine spells the same concept
       "Soft-circled" (client/src/lib/investor/investorSpine.ts:390). Both are
       human English, so neither is the defect this wave fixes, and
       `shared/crmStages.ts` is a cross-portal file. The wording difference is
       named in the wave log for an owner ruling rather than changed here. */
    expect(rendered).toEqual(["Invited", "Viewed", "Soft-circle", "Signed", "Funded", "Committed"]);
    for (const label of rendered) {
      expect(label).not.toMatch(/_/); // no snake_case survives
      expect(label).not.toMatch(/[a-z][A-Z]/); // no camelCase survives
    }
    /* Pinned by VALUE, not by absence-of-underscore: a map that returned the key
       with underscores swapped for spaces would pass a weaker assertion. */
    expect(partnerPipelineStageLabel("soft_circle")).toBe("Soft-circle");
  });

  it("THE PIPELINE CARD NO LONGER INTERPOLATES A RAW STAGE KEY", () => {
    const src = code(path.join(REPO, "client/src/pages/partner/PartnerDashboard.tsx"));
    /* The pre-wave line was `{s}` inside the stage map. Assert the label call is
       present AND that the bare interpolation is gone, so this cannot be
       satisfied by adding the helper while leaving the old render in place. */
    expect(src).toContain("partnerPipelineStageLabel(s)");
    expect(src).not.toMatch(/>\s*\{s\}\s*</);
  });

  it("AN UNKNOWN KEY IS HUMANISED, NEVER PRINTED RAW — a legacy value must not leak either", () => {
    /* Fixing only the six known stages would leave the next legacy value (the
       register records "sourcing" reaching this surface) printing raw. */
    expect(partnerPipelineStageLabel("sourcing")).not.toContain("_");
    expect(humanizeMachineKey("wound_down")).toBe("Wound down");
    expect(humanizeMachineKey("softCircled")).not.toMatch(/[a-z][A-Z]/);
    /* And it must not invent a label for a key it does not know: humanising is a
       transformation of what was given, not a guess about meaning. */
    expect(humanizeMachineKey("zzz_unknown_thing")).toBe("Zzz unknown thing");
  });

  it("EVERY OTHER LEAKED VOCABULARY ON PARTNER SURFACES NOW GOES THROUGH A LABEL", () => {
    expect(spvStatusLabel("wound_down")).not.toContain("_");
    expect(fundStatusLabel("winding_down")).not.toContain("_");
    expect(subscriptionStatusLabel("under_review")).not.toContain("_");
    expect(planTierLabel("consortium_partner")).not.toContain("_");
    expect(quotaEnforcementLabel("hard_block")).not.toContain("_");
    expect(managedFounderStatusLabel("mp_soft_circle")).not.toContain("_");
    /* `mp_soft_circle` is the DB catalogue spelling (shared/schema.ts:459) and it
       must not carry its `mp_` table prefix onto a screen either. */
    expect(managedFounderStatusLabel("mp_soft_circle")).not.toContain("mp");
  });

  it("SWEEP — no partner surface interpolates a raw internal id of the shape `co_`/`u_`, or a raw ISO timestamp", () => {
    const offenders: string[] = [];
    for (const f of partnerSurfaceFiles()) {
      const src = code(f);
      /* A raw id rendered as its own text node. */
      for (const m of src.matchAll(/>\s*\{\s*([a-zA-Z]+\.)?(companyId|contactId|investorId|userId|memberId|breakId)\s*\}\s*</g)) {
        offenders.push(`${path.basename(f)} :: raw id ${m[0].trim()}`);
      }
      /* AN ID INSIDE A MULTI-VALUE TEXT NODE. The first version of this sweep
         only matched an id that was the WHOLE cell (`>{x.investorId}<`) and
         therefore missed four sites where the id sat in a sentence — e.g.
         `{t.fromInvestorId} → {t.toInvestorId} · {t.status}`. Recorded because
         it is a good example of a check that passes while checking too little. */
      for (const m of src.matchAll(/\{\s*[a-z][a-zA-Z]*\.(companyId|contactId|investorId|fromInvestorId|toInvestorId|userId|memberId|lpContactId)\s*\}/g)) {
        const line = src.slice(src.lastIndexOf("\n", m.index ?? 0), src.indexOf("\n", m.index ?? 0));
        /* An id passed as a PROP or a testid or a URL segment is not rendered
           copy; only a bare interpolation inside JSX children is. */
        if (/data-testid|key=|=\{|\/api\/|href/.test(line)) continue;
        /* RATIFIED, NOT WAIVED: two sites render the id under the explicit words
           "Company reference", which is wave 106's own pattern and is the
           opposite of a leak — the customer is told the value is a reference
           rather than shown it dressed as a name. Matched on the LINE so the
           exemption cannot be inherited by an unlabelled id nearby. */
        if (/Company reference/.test(line)) continue;
        offenders.push(`${path.basename(f)} :: inline id ${m[0]}`);
      }
      /* `.toISOString()` or a raw `createdAt`/`updatedAt` printed directly,
         rather than through partnerDisplay's formatTimestamp/formatDateOnly. */
      for (const m of src.matchAll(/>\s*\{[^}]*\.toISOString\(\)[^}]*\}\s*</g)) {
        offenders.push(`${path.basename(f)} :: raw ISO ${m[0].trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("SWEEP — no partner surface renders a raw EVENT CODE either", () => {
    /* Wave 108 enumerated 167 literal event codes and 37 dynamic call sites
       across the tree, so the assumption is that there are more of these than
       the screenshot showed. This pins the partner-facing ones. */
    const offenders: string[] = [];
    for (const f of partnerSurfaceFiles()) {
      const src = code(f);
      for (const m of src.matchAll(/\{\s*[a-z][a-zA-Z]*\.(event|eventType|actionCode|toStatus|fromStatus)\s*\}/g)) {
        const line = src.slice(src.lastIndexOf("\n", m.index ?? 0), src.indexOf("\n", m.index ?? 0));
        if (/data-testid|key=|=\{|\/api\/|href/.test(line)) continue;
        offenders.push(`${path.basename(f)} :: raw event code ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   FINDING 2 — FIGURES THAT WERE NEVER REAL
   ════════════════════════════════════════════════════════════════════════════ */
describe("W115 F2 — no rendered figure is derived from an array index or a default", () => {
  const INVESTOR = "client/src/components/investor/MemberValueIntelligenceInvestor.tsx";

  it("THE FABRICATION PATTERN WAVE 110 LEFT BEHIND: no `i % n` arithmetic reaches a rendered figure", () => {
    const src = code(INVESTOR);
    /* `8 + (i % 7)` and its family — a metric synthesised from a loop index and
       printed in bold as fact. */
    expect(src).not.toMatch(/%\s*\d+\s*\)/);
    expect(src).not.toMatch(/\bi\s*%\s*/);
    expect(src).not.toMatch(/index\s*%\s*/);
  });

  it("AN UNRECORDED EXPERIENCE TIER SAYS SO — it does not fall back to a plausible default", () => {
    const src = code(INVESTOR);
    /* Pre-wave the server supplied a default tier for ledger-derived co-members
       who have no platform record, and the client rendered it as a Badge
       indistinguishable from a recorded one. */
    expect(src).toContain("w115-comember-tier-unavailable-");
    expect(src).toContain("Not recorded");
    /* `?? "…"` on the tier is exactly the fabrication: assert no default. */
    expect(src).not.toMatch(/investorExperienceTier\s*\?\?\s*"/);
  });

  it("AN UNRECORDED NAME AND AN EMPTY EXPERTISE LIST BOTH SAY SO", () => {
    const src = code(INVESTOR);
    expect(src).toContain("w115-comember-name-unavailable-");
    expect(src).toContain("w115-comember-expertise-unavailable-");
  });

  it("THE SERVER NO LONGER MANUFACTURES A TIER FOR A LEDGER-DERIVED HOLDER", () => {
    const src = code("server/sprint21Routes.ts");
    expect(src).toContain("displayLabelUnavailable");
    /* The field is now OPTIONAL on the DTO, which is what makes "absent" a
       representable state rather than something the client must guess at. */
    expect(src).toMatch(/investorExperienceTier\??\s*:/);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   FINDING 3 — "That request could not be completed (network)."
   ════════════════════════════════════════════════════════════════════════════ */
describe("W115 F3 — a failure is explained, not reduced to a code word", () => {
  it('THE TOAST THE AUDITOR SAW: the bare word "network" is no longer the message', () => {
    const copy = tierErrorCopy(TRANSPORT_FAILURE);
    expect(copy).not.toMatch(/\(network\)/);
    /* It must say WHAT failed and WHAT to do. */
    expect(copy.length).toBeGreaterThan(40);
    /* And it must keep the genuinely reassuring, genuinely true half. */
    expect(copy).toContain("Nothing was changed");
  });

  it("EVERY HTTP FAILURE THE PANEL CAN SEE HAS ITS OWN EXPLANATION, and none of them prints the code", () => {
    for (const code_ of ["400", "401", "403", "404", "408", "409", "413", "429", "500", "502", "503", "504"]) {
      const copy = tierErrorCopy(code_);
      expect(copy).not.toContain(`(${code_})`);
      expect(copy).toContain("Nothing was changed");
      expect(copy.length).toBeGreaterThan(40);
    }
    /* Distinct codes must not all collapse to one sentence — that would be the
       same defect with a longer string. */
    const distinct = new Set(["401", "403", "404", "429", "503"].map((c) => tierErrorCopy(c)));
    expect(distinct.size).toBeGreaterThanOrEqual(4);
  });

  it("AN UNRECOGNISED INTERNAL CODE IS NEVER SHOWN TO A CUSTOMER", () => {
    expect(looksInternalCode("soft_circle")).toBe(true);
    expect(looksInternalCode("QUOTA_EXCEEDED_HARD")).toBe(true);
    expect(looksInternalCode("tierNotResolved")).toBe(true);
    const copy = tierErrorCopy("some_unmapped_internal_code");
    expect(copy).not.toContain("some_unmapped_internal_code");
    expect(copy).not.toContain("_");
    expect(copy).toContain("Nothing was changed");
  });

  it('THE LITERAL SENTINEL "network" IS GONE FROM THE PANEL\'S EIGHT CATCH SITES', () => {
    const src = code("client/src/components/comms/CommsTierActionsPanel.tsx");
    /* Pre-wave: eight `: "network")` fallbacks. All now name the transport. */
    expect(src).not.toMatch(/:\s*"network"\s*\)/);
    expect(src).toContain("TRANSPORT_FAILURE");
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   FINDING 4 — PLACEHOLDERS THAT LOOKED LIKE MEASUREMENTS
   ════════════════════════════════════════════════════════════════════════════ */
describe("W115 F4 — the two admin figures are labelled as what they are", () => {
  it("THE SELF-DECLARED PLACEHOLDER STRING IS GONE FROM THE TREE", () => {
    /* The tell was a comment reading "would compute from status transitions in
       production" sitting above a tile the admin read as a measurement. */
    const pricing = code("client/src/pages/admin/Pricing.tsx");
    const store = code("server/adminPlatformStore.ts");
    for (const src of [pricing, store]) {
      expect(src).not.toContain("would compute from status transitions in production");
    }
  });

  it("THE TWO TILES NOW CLAIM ONLY WHAT THEY MEASURE", () => {
    /* Comments stripped: the file DOCUMENTS the old label in the note recording
       why it was wrong, and deleting that history to make a grep pass would be
       the wrong fix. The assertion targets rendered copy. */
    const src = code("client/src/pages/admin/Pricing.tsx");
    /* A cancellation count over all time is not a churn RATE, and the MRR of two
       tiers is not EXPANSION MRR. The labels were the fabrication. */
    expect(src).toContain("Cancelled share (all-time)");
    expect(src).toContain("Scale + Enterprise MRR");
    expect(src).not.toContain("Churn rate");
    expect(src).not.toContain("Expansion MRR");
  });

  it("THE UNSOURCEABLE FIGURES RETURN null AND FAIL CLOSED, rather than returning a number", () => {
    const src = code("server/adminPlatformStore.ts");
    expect(src).toMatch(/momGrowthPct[^\n]*null/);
    expect(src).toMatch(/nrr[^\n]*null/);
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   FINDING 5 — THE FOUNDER PORTAL HAD NO VERSION STRING
   ════════════════════════════════════════════════════════════════════════════ */
describe("W115 F5 — the founder portal reports its build from the single source", () => {
  it("THE FOUNDER PORTAL NOW MOUNTS THE SHARED FOOTER", () => {
    const src = read("client/src/pages/founder/Settings.tsx");
    expect(src).toContain("<PortalVersionFooter");
    expect(src).toContain('testId="founder-portal-version"');
  });

  it("AND IT IS NOT HARDCODED — no version literal is introduced", () => {
    /* Comments stripped: this file's change-history notes are full of `v25.45.1`
       style tags. Those are documentation, not rendered copy, and the w90
       single-source suite already applies the same distinction. */
    const src = code("client/src/pages/founder/Settings.tsx");
    /* A hardcoded "v26.21.0" would satisfy a naive "shows a version" test while
       lying the moment the next build ships. The footer reads the endpoint. */
    expect(src).not.toMatch(/v?\d+\.\d+\.\d+/);
    expect(src).not.toMatch(/APP_VERSION|PLATFORM_VERSION|PORTAL_VERSION/);
  });

  it("THE SINGLE-SOURCE TEST NOW GUARDS FOUR PORTALS, NOT THREE", () => {
    const src = read("server/__tests__/w90_version_single_source.test.ts");
    expect(src).toContain('["client/src/pages/founder/Settings.tsx", "PortalVersionFooter"]');
    expect(src).toContain("ALL FOUR PORTALS");
  });
});

/* ════════════════════════════════════════════════════════════════════════════
   FINDING 6 — SMALL PARTNER DEFECTS
   ════════════════════════════════════════════════════════════════════════════ */
describe("W115 F6 — the download filename is human, and reuses wave 110's helper", () => {
  it("THE DEFECT: `captable_co_novapay.pdf` is gone; the name is built from the company name and the as-of date", () => {
    const src = code("server/lib/pdfGenerators.ts");
    expect(src).not.toContain("captable_${safeFileName(data.companyId)}");
    expect(src).toContain("ledgerPdfFilename(");
    expect(src).toContain("companyExportSlug(");
    /* Reused, not re-implemented. A second slug function in this file is the
       thing the brief forbids, so assert the import rather than the behaviour. */
    expect(src).toContain("client/src/lib/captable/exportProvenance");
    /* Still hardened: a company name can never inject a header. */
    expect(src).toContain("safeFileName(");
  });

  it("THE HELPER PRODUCES A NAME A HUMAN CAN READ, AND CARRIES NO INTERNAL ID", () => {
    const name = ledgerPdfFilename({
      slug: companyExportSlug({ companyName: "NovaPay Technologies, Inc.", companyId: "co_novapay" }),
      asOf: "2026-08-22",
    });
    expect(name).toMatch(/\.pdf$/);
    expect(name.toLowerCase()).toContain("novapay");
    expect(name).not.toContain("co_");
    expect(name).toContain("2026-08-22");
  });

  it("AND IT IS DYNAMIC — two companies, or two dates, do not collide", () => {
    const a = ledgerPdfFilename({ slug: companyExportSlug({ companyName: "Acme Labs", companyId: "co_a" }), asOf: "2026-08-22" });
    const b = ledgerPdfFilename({ slug: companyExportSlug({ companyName: "Beta Works", companyId: "co_b" }), asOf: "2026-08-22" });
    const c = ledgerPdfFilename({ slug: companyExportSlug({ companyName: "Acme Labs", companyId: "co_a" }), asOf: "2026-07-01" });
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe("W115 F6 — an invalid or past document expiry is REFUSED, not silently discarded", () => {
  const SRC = code("client/src/components/partner/SpvDetailTabs.tsx");

  it("THE DEFECT: the submit path no longer forwards whatever was typed", () => {
    /* Pre-wave, the entire validation was `if (expiry.trim()) body.expiry = …`. */
    expect(SRC).not.toContain("if (expiry.trim()) body.expiry = expiry.trim();");
    expect(SRC).toContain("if (expiryProblem) throw new Error(expiryProblem);");
  });

  it("THE CONTROL REFUSES BEFORE THE REQUEST: the button is disabled and the reason is rendered", () => {
    expect(SRC).toContain("disabled={submit.isPending || !expiryValid}");
    expect(SRC).toContain('data-testid="spv-document-expiry-error"');
    /* Reused wave-106 refusal styling, so the field is marked aria-invalid. */
    expect(SRC).toContain("fieldValidityProps(expiryValid)");
  });

  it("THE RULE ITSELF: empty is allowed, a past date and an impossible date are refused", () => {
    /* Re-derived here from the same predicate the component applies, so the rule
       is pinned by BEHAVIOUR and not only by the presence of a string. */
    const problemFor = (raw: string): string | null => {
      const v = raw.trim();
      if (!v) return null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return "format";
      const parsed = new Date(`${v}T00:00:00Z`);
      if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== v) return "not-a-date";
      if (v < new Date().toISOString().slice(0, 10)) return "past";
      return null;
    };
    expect(problemFor("")).toBeNull();
    expect(problemFor("2099-12-31")).toBeNull();
    expect(problemFor("2020-01-01")).toBe("past"); // the silently accepted case
    expect(problemFor("2026-02-30")).toBe("not-a-date"); // Date would roll to Mar 2
    expect(problemFor("not a date")).toBe("format");
    expect(problemFor("12/31/2099")).toBe("format");

    /* And the component's own predicate must agree on the past-date case — the
       three rules above are the ones actually written into the source. */
    expect(SRC).toContain("That expiry has already passed");
    expect(SRC).toContain("That is not a real calendar date");
  });
});
