/**
 * WAVE 136 — THE FOUR CHANGES THE OWNER GRANTED IN ONE SACRED CEREMONY (R100).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS FILE PROVES, AND WHY EACH ASSERTION IS HERE
 * ═══════════════════════════════════════════════════════════════════════════
 * R100 authorised FOUR unrelated changes, each of which needed an edit to a
 * sacred file, batched into one re-freeze (`SACRED_DOC_v26_22_0.md` §4.2 — a
 * TENTH waiver is structurally impossible, so a re-freeze is the only route).
 * The ceremony is transcript-verified in `build_log/wave136/W136_TESTS.md`; this
 * file proves the CODE, at both poles wherever a pole exists.
 *
 *   ITEM 1  `FounderCompany.capTableHolders` — a field with NO WRITER, declared
 *           in the sacred `server/lib/userContext.ts`, published as a false `0`
 *           at five surfaces until wave 125 fixed the renders. The field itself
 *           survived, ready for the next reader to assume it is maintained.
 *   ITEM 2  the FABRICATED `"1x non-participating"`. `buildPricedEquityCarryForward`
 *           read `examplePref?.liquidationPreference` off a SECURITY — a field no
 *           security in this tree has — so `liqPref` was ALWAYS 1 and the branch
 *           was UNCONDITIONAL. It then published `source: "prev_round"`,
 *           `confidence: "high"` and the sentence "1x non-participating
 *           liquidation preference was used in {round}": a statement of fact
 *           about what a named round recorded, produced without reading anything
 *           the round recorded.
 *   ITEM 3  the `mfn` reader (`SACRED_DOC` §5.3 — GENUINE, and NOT the R69 trap
 *           in the same file). `??` falls through only on null/undefined, but a
 *           side letter that EXISTS and does not say "mfn" yields boolean
 *           `false`, which IS a value — so the fallback to a stored `mfn: true`
 *           never fired and a recorded MFN read as absent.
 *   ITEM 4  `dataroom.access_revoked`. `server/track1Routes.ts` carried a WAVE 120
 *           comment block explaining that a grantee is NOT told their access was
 *           withdrawn, because the kind would have to be added to the sacred
 *           `NotificationKind`, and that reusing `dataroom.access_granted` for a
 *           revocation "would put a false label on a real event".
 *
 * ⚠ `computeConversionProjections` (`server/roundCarryForwardEngine.ts:770`) IS
 * NOT TOUCHED AND MUST NOT BE (R69). It is dead code, it consumes an
 * already-fractional value, and FIVE agents have now proposed "fixing" it.
 * Item 3 is a DIFFERENT defect in the SAME file. `W136-R69` below asserts the
 * function is still there, still uncalled and still unedited, so this wave
 * cannot be mistaken for the fifth attempt.
 *
 * COMMENT TRAP. Every "the literal is gone" assertion runs against source with
 * COMMENTS STRIPPED (`code()`), because this project records each deleted
 * literal in the comment that replaced it — a raw `toContain` would pass on the
 * documentation instead of the code. Same technique as `W70-D6f` / `W58G-D1`.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  computeCarryForward,
  computeConversionProjections,
} from "../roundCarryForwardEngine";
import { rounds as seedRounds } from "../mockData";
import { ALL_NOTIFICATION_KINDS } from "../notificationsStore";
import { isKindEnabled } from "../lib/founderNotificationPrefs";
/* Namespace import ON PURPOSE: `readMfnOnRecord` does not exist before this
   wave, and a named import of a missing export is a MODULE-LOAD failure that
   would redden every test in this file at once. Reaching through the namespace
   keeps the fail-before signal on the mfn tests alone, which is what makes the
   before/after transcript readable. */
import * as termsReader from "../../shared/liquidationTermsReader";

const ROOT = path.resolve(__dirname, "../..");
const src = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const code = (rel: string) =>
  src(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ENGINE = "server/roundCarryForwardEngine.ts";
const READER = "shared/liquidationTermsReader.ts";
const USERCTX = "server/lib/userContext.ts";
const NOTIFS = "server/notificationsStore.ts";
const TRACK1 = "server/track1Routes.ts";
const CO_NOVAPAY = "co_novapay";

/* ═══════════════════════════════════════════════════════════════════════════
 * ITEM 1 — THE DEAD `capTableHolders` IS GONE FROM THE CONTRACT
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W136 · ITEM 1 — FounderCompany.capTableHolders is removed", () => {
  it("W136-1a — the sacred declaration is gone from interface FounderCompany", () => {
    /* Scoped to the interface BODY, not the whole file: a wider assertion would
       also fire on an unrelated future mention and would not say which one it
       meant. */
    const body = /export interface FounderCompany \{([\s\S]*?)\n\}/.exec(code(USERCTX));
    expect(body).not.toBeNull();
    expect(body![1]).not.toContain("capTableHolders");
    /* The SIBLING field is still declared, so this test cannot pass by deleting
       the interface. */
    expect(body![1]).toContain("activeRoundsCount");
  });

  it("W136-1b — the writer in buildFounderCompanies is gone too", () => {
    const c = code(USERCTX);
    expect(c).not.toContain("capTableHolders: c.kpi.capTableHolders");
    /* Its neighbour still writes, so the mapper was not gutted. */
    expect(c).toContain("activeRoundsCount: c.kpi.activeRoundsCount");
  });

  it("W136-1c — the CLIENT MIRROR of the same declaration is gone (contract parity)", () => {
    const body = /export interface FounderCompany \{([\s\S]*?)\n\}/.exec(
      code("client/src/lib/entitlement.tsx"),
    );
    expect(body).not.toBeNull();
    expect(body![1]).not.toContain("capTableHolders");
    expect(body![1]).toContain("activeRoundsCount");
  });

  it("W136-1d — the `kpi` shape's OWN capTableHolders is UNTOUCHED (scope fence)", () => {
    /* `multiCompanyStore.FounderCompanyKpi` is a DIFFERENT type, is NOT sacred
       and is NOT in R100's scope. If a future agent widens item 1 into it, this
       assertion tells them they left the granted scope. */
    expect(code("server/multiCompanyStore.ts")).toContain("capTableHolders");
    expect(code("client/src/lib/useActiveCompany.ts")).toContain("capTableHolders");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * ITEM 2 — NO FABRICATED TERM, AND NO PRINTED DEFAULT
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W136 · ITEM 2 — the liquidation preference is READ, never asserted", () => {
  it("W136-2a — the phantom security read and the fabricated sentence are gone", () => {
    const c = code(ENGINE);
    /* `examplePref?.liquidationPreference ?? 1` — a read of a field NO security
       in this tree has, which is why the branch was unconditional. */
    expect(c).not.toMatch(/examplePref\?\.liquidationPreference/);
    /* The false statement of fact about a named round. */
    expect(c).not.toContain("liquidation preference was used in");
    /* The inline second interpretation of the participation wording, which is
       what made this a SIXTEENTH reader rather than a consumer of the one. */
    expect(c).not.toContain('includes("non-participating")');
    /* The printed default in the no-prior-priced-round branch. */
    expect(c).not.toContain("NVCA Model Charter");
  });

  it("W136-2b — the engine now CONSUMES shared/liquidationTermsReader", () => {
    const c = code(ENGINE);
    expect(c).toMatch(/readLiquidationTerms/);
    expect(c).toMatch(/from "@shared\/liquidationTermsReader"|from "\.\.\/shared\/liquidationTermsReader"/);
  });

  it("W136-2c — POLE 1: a round that RECORDS the term still carries it, from the record", () => {
    /* NovaPay Series Seed records "…1x non-participating, broad-based
       weighted-average anti-dilution." (server/mockData.ts:365). The reader
       DETERMINES 1x non-participating from that, so the value that used to be
       lucky is now true. patch2_carry_forward.test.ts:212-218 pins the same
       value and is NOT weakened — R98 permits a test update only where a ruling
       removed pinned behaviour, and nothing pinned is removed here. */
    const r = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "priced_equity" });
    const f = r.fields["liquidationPreference"];
    expect(f).toBeDefined();
    expect(f.suggestedValue).toBe("1x_non_participating");
    expect(f.source).toBe("prev_round");
    expect(f.confidence).toBe("high");
    /* The rationale must no longer ASSERT market practice as the reason. */
    expect(f.rationale).not.toContain("NVCA market standard");
    /* It must instead name the round and quote what the reader decided. */
    expect(f.rationale).toContain("NovaPay Series Seed");
    expect(f.rationale.toLowerCase()).toContain("1x non-participating");
  });

  it("W136-2d — POLE 2: a round that records NOTHING READABLE yields NO field and SAYS SO", () => {
    /* The only honest way to exercise this pole is to make the record
       unreadable, so the seed round's wording is replaced for the duration of
       this assertion and restored in `finally` — the value is captured first and
       written back, so the fixture cannot be left mutated even if the
       expectations throw. */
    const rnd = seedRounds.find((r) => r.id === "rnd_novapay_seed_closed") as
      | { termsSummary: string | null }
      | undefined;
    expect(rnd).toBeDefined();
    const original = rnd!.termsSummary;
    try {
      rnd!.termsSummary = "Terms to be agreed with the lead investor.";
      const r = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "priced_equity" });
      /* NO FIELD. Not a `1x_non_participating` default, not a `null` value
         dressed as a suggestion. */
      expect(r.fields["liquidationPreference"]).toBeUndefined();
      /* AND IT SAYS SO, in the ONE reader's own words, so a carry-forward panel
         and an exit-waterfall 422 cannot describe one round differently. */
      const said = r.warnings.join(" | ");
      expect(said.toLowerCase()).toContain("liquidation preference");
      expect(said).toMatch(/not on record|does not record|cannot be read/i);
      /* And it must NOT smuggle the default into the warning text. */
      expect(said).not.toContain("1x_non_participating");
    } finally {
      rnd!.termsSummary = original;
    }
    /* The fixture is provably back. */
    expect(
      (seedRounds.find((r) => r.id === "rnd_novapay_seed_closed") as { termsSummary: string | null })
        .termsSummary,
    ).toBe(original);
  });

  it("W136-2e — the shared reader REFUSES rather than defaulting (the rule item 2 relies on)", () => {
    const refused = termsReader.readLiquidationTerms({
      liquidationPreference: "Terms to be agreed with the lead investor.",
    });
    expect(refused.determined).toBe(false);
    if (!refused.determined) expect(refused.refusal).toBe("liquidation_term_not_on_record");
    const determined = termsReader.readLiquidationTerms({
      liquidationPreference: "1x non-participating, broad-based weighted-average anti-dilution.",
    });
    expect(determined.determined).toBe(true);
    if (determined.determined) {
      expect(determined.multiple).toBe(1);
      expect(determined.participating).toBe(false);
    }
  });

  it("W136-2f — NO CALCULATION WAS ALTERED: no arithmetic entered this function", () => {
    /* R100 forbids altering a calculation. `buildPricedEquityCarryForward`
       performs none, and must still perform none — a "fix" that started
       computing a preference would be a worse defect than the one removed. */
    const fn = /function buildPricedEquityCarryForward\(([\s\S]*?)\n\}/.exec(code(ENGINE));
    expect(fn).not.toBeNull();
    expect(fn![1]).not.toMatch(/Number\(|parseInt|parseFloat/);
    expect(fn![1]).not.toMatch(/[)\d]\s*[*/]\s*[(\d]/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * ITEM 3 — ONE mfn READER, IN THE SAME SHARED FILE
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W136 · ITEM 3 — the mfn reader is declared ONCE and read in the right order", () => {
  it("W136-3a — readMfnOnRecord exists in the shared reader item 2 already uses", () => {
    expect(typeof termsReader.readMfnOnRecord).toBe("function");
    expect(code(READER)).toContain("export function readMfnOnRecord");
  });

  it("W136-3b — THE DEFECT ITSELF: a side letter that exists and omits MFN no longer masks a stored true", () => {
    /* This is `SACRED_DOC` §5.3 in one assertion. Before this wave the engine
       computed `sideLetter.includes("mfn") ?? mfn ?? false` — `false` is a
       VALUE, so `??` never fell through and the stored `true` was unreachable. */
    const d = termsReader.readMfnOnRecord({
      mfn: true,
      sideLetter: "Board observer seat; major-investor info rights",
    });
    expect(d.onRecord).toBe(true);
    expect(d.source).toBe("mfn_field");
  });

  it("W136-3c — every pole of the flag, moved from roundStoredTerms rather than re-invented", () => {
    expect(termsReader.readMfnOnRecord({ mfn: true }).onRecord).toBe(true);
    expect(termsReader.readMfnOnRecord({ mfn: false }).onRecord).toBe(false);
    expect(termsReader.readMfnOnRecord({ mfn: "yes" }).onRecord).toBe(true);
    expect(termsReader.readMfnOnRecord({ mfn: "on" }).onRecord).toBe(true);
    expect(termsReader.readMfnOnRecord({ mfn: "1" }).onRecord).toBe(true);
    expect(termsReader.readMfnOnRecord({ mfn: 1 }).onRecord).toBe(true);
    expect(termsReader.readMfnOnRecord({ mfn: "no" }).onRecord).toBe(false);
    expect(termsReader.readMfnOnRecord({ mfn: "off" }).onRecord).toBe(false);
    expect(termsReader.readMfnOnRecord({ mfn: 0 }).onRecord).toBe(false);
    /* ABSENT STAYS ABSENT — `null`, never `false`. A `false` here is exactly the
       value that made the bug possible. */
    expect(termsReader.readMfnOnRecord({}).onRecord).toBeNull();
    expect(termsReader.readMfnOnRecord({ mfn: null }).onRecord).toBeNull();
    expect(termsReader.readMfnOnRecord({ mfn: "maybe" }).onRecord).toBeNull();
    /* A shape that is not a flag is not a flag. */
    expect(termsReader.readMfnOnRecord({ mfn: {} }).onRecord).toBeNull();
    expect(termsReader.readMfnOnRecord({ mfn: [] }).onRecord).toBeNull();
  });

  it("W136-3d — the side letter is read only where no flag is on record", () => {
    const granted = termsReader.readMfnOnRecord({ sideLetter: "MFN + pro-rata in next priced round" });
    expect(granted.onRecord).toBe(true);
    expect(granted.source).toBe("side_letter");
    /* Spelled out in full, both spellings. */
    expect(termsReader.readMfnOnRecord({ sideLetter: "most favoured nation clause" }).onRecord).toBe(true);
    expect(termsReader.readMfnOnRecord({ sideLetter: "Most-Favored-Nation" }).onRecord).toBe(true);
    /* A side letter that says nothing about MFN records NOTHING about MFN. */
    expect(termsReader.readMfnOnRecord({ sideLetter: "Board observer seat" }).onRecord).toBeNull();
    /* An EXPLICIT `false` flag is not overridden by prose in a side letter. */
    expect(termsReader.readMfnOnRecord({ mfn: false, sideLetter: "MFN" }).onRecord).toBe(false);
    /* "mfn" inside a longer word is not the term. */
    expect(termsReader.readMfnOnRecord({ sideLetter: "amfnote reference" }).onRecord).toBeNull();
  });

  it("W136-3e — all FOUR engine sites are routed through it; none re-implements the read", () => {
    const c = code(ENGINE);
    /* The sacred doc names :335 and :430. There were FOUR, and the two it does
       not name are in `buildUnrealizedInstruments`. */
    expect(c).not.toMatch(/sideLetter\?\.toLowerCase\(\)\.includes\("mfn"\)/);
    expect((c.match(/readMfnOnRecord\(/g) ?? []).length).toBe(4);
  });

  it("W136-3f — roundStoredTerms reads the SAME function, so there is no sixteenth interpretation", () => {
    const c = code("server/lib/roundStoredTerms.ts");
    expect(c).toContain("readMfnOnRecord");
    /* The moved rules must not survive as a second copy. */
    expect(c).not.toMatch(/v === "true" \|\| v === "yes"/);
  });

  it("W136-3g — a stored MFN now reaches the carry-forward suggestion", () => {
    const r = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "safe" });
    const f = r.fields["mfn"];
    expect(f).toBeDefined();
    expect(f.suggestedValue).toBe(true);
    expect(f.source).toBe("prev_round");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * ITEM 4 — AN ADDITIVE KIND THAT SHIFTS NOTHING
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W136 · ITEM 4 — dataroom.access_revoked", () => {
  /* THE PIN. R100 requires that adding a member change the meaning of no
     existing kind. The only way to prove that is to state every pre-existing
     member AT ITS INDEX, in the order it had before this wave, and assert the
     new one is APPENDED. A length check alone would pass on a reordering, and a
     reordering silently repoints every stored `kind` value in the database.

     THE COUNT IS 37, MEASURED, NOT 36. The union's own section comments say
     "Core (15 from audit §6.5)" and "Collective-specific (6 …)", which do not add
     up to the members actually declared; counting the members is the only
     reliable answer and it gives 37 both in the union and in the array. */
  const KINDS_BEFORE_W136 = [
    "round.invitation_received",
    "round.invitation_accepted",
    "round.invitation_declined",
    "round.soft_circle_received",
    "round.document_ready_to_sign",
    "round.document_signed",
    "round.closed",
    "dataroom.access_granted",
    "dataroom.document_uploaded",
    "investor_report.published",
    "message.received",
    "collective.eligibility_gained",
    "collective.membership_approved",
    "collective.membership_rejected",
    "partner.referral_received",
    "partner.application_submitted",
    "partner.application_approved",
    "partner.application_rejected",
    "partner.attribution_granted",
    "partner.attribution_revoked",
    "partner.promotion_approved",
    "partner.promotion_rejected",
    "partner.promotion_changes_requested",
    "spv.launched",
    "spv.subscription_countersigned",
    "dsc.company_assigned",
    "cap_table.drift_detected",
    "compliance.hold_placed",
    "kyc.status_changed",
    "membership.renewal_due",
    "membership.lapsed",
    "payment.failure",
    "dsc.review_received",
    "soft_circle.lapsed",
    "cap_table.broadcast",
    "crm.intro_request",
    "dsc.feedback_summary",
  ] as const;

  it("W136-4a — NOT ONE existing member shifted index or changed value", () => {
    expect(KINDS_BEFORE_W136.length).toBe(37);
    KINDS_BEFORE_W136.forEach((k, i) => {
      expect(ALL_NOTIFICATION_KINDS[i]).toBe(k);
    });
  });

  it("W136-4b — the new kind is APPENDED, and the list grew by exactly one", () => {
    expect(ALL_NOTIFICATION_KINDS.length).toBe(38);
    expect(ALL_NOTIFICATION_KINDS[37]).toBe("dataroom.access_revoked");
    /* No duplicates — a duplicate would make the `perKind` map disagree with
       the array it is built from. */
    expect(new Set(ALL_NOTIFICATION_KINDS).size).toBe(38);
  });

  it("W136-4c — the union and the array agree (the array is the runtime half of the type)", () => {
    const union = /export type NotificationKind =([\s\S]*?);\n/.exec(src(NOTIFS));
    expect(union).not.toBeNull();
    const declared = (union![1].match(/"([a-z0-9_.]+)"/g) ?? []).map((s) => s.replaceAll('"', ""));
    expect(declared.length).toBe(38);
    expect(new Set(declared)).toEqual(new Set(ALL_NOTIFICATION_KINDS));
    expect(declared[37]).toBe("dataroom.access_revoked");
  });

  it("W136-4d — the revocation EMITS it, and the WAVE 120 excuse is gone", () => {
    const c = code(TRACK1);
    /* The emit is inside the revoke handler, not merely somewhere in the file. */
    const fn = /function handleDataRoomGrantRevoke\(([\s\S]*?)\n\}/.exec(c);
    expect(fn).not.toBeNull();
    expect(fn![1]).toContain('kind: "dataroom.access_revoked"');
    expect(fn![1]).toContain("grant.investor_id");
    /* Best-effort, like the grant path: a notification failure must not fail a
       revocation that has already committed. */
    expect(fn![1]).toMatch(/try \{[\s\S]*emitNotification[\s\S]*catch/);
    /* And the revocation is NOT mislabelled as a grant. */
    expect(fn![1]).not.toContain('"dataroom.access_granted"');
  });

  it("W136-4e — the excuse block that said the grantee cannot be told is gone from the SOURCE", () => {
    /* Deliberately read WITH comments, because the thing being removed IS a
       comment: an explanation that is now false is worse than none. */
    expect(src(TRACK1)).not.toContain("WHY THE GRANTEE IS NOT NOTIFIED HERE");
  });

  it("W136-4f — an ungoverned kind is DELIVERED, not silently muted", () => {
    /* Scope note, asserted so it cannot rot: the new kind is mapped to no
       preference key, and `isKindEnabled` returns true for an ungoverned kind.
       Mapping a withdrawal-of-access notice onto the existing dataroom switch
       would let a founder mute it, which R100 does not grant. */
    expect(isKindEnabled("usr_anybody", "dataroom.access_revoked", "in_app")).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
 * R69 — THE TRAP THIS WAVE DID NOT FALL INTO
 * ═══════════════════════════════════════════════════════════════════════════ */
describe("W136 · R69 — computeConversionProjections is untouched", () => {
  it("W136-R69a — it still exists, still takes an ALREADY-FRACTIONAL discount, still no /100", () => {
    const fn = /export function computeConversionProjections\(([\s\S]*?)\n\}/.exec(code(ENGINE));
    expect(fn).not.toBeNull();
    expect(fn![1]).not.toContain("/ 100");
    expect(fn![1]).not.toContain("toWireDiscount");
    /* Reachable only from tests and comments, exactly as W58F-F2f pins. */
    expect(typeof computeConversionProjections).toBe("function");
  });

  it("W136-R69b — the two OTHER things this file is famous for are still in place", () => {
    /* `W70-D6f`'s literal — this wave did not tidy it, and saying so here means
       the report cannot overstate the wave's scope. */
    expect(src(ENGINE)).toContain('interestRate: "0.06"');
  });
});
