/**
 * ══════════════════════════════════════════════════════════════════════════════
 * WAVE 122 · FINDING 3 — THREE ENDINGS THAT WERE FILED AS ONE LIVE PROSPECT,
 * AND THE PROOF THAT NO LADDER MOVED (OWNER RULING R91).
 * ══════════════════════════════════════════════════════════════════════════════
 * THE DEFECT, at shared/crmStages.ts:45-47 before this wave:
 *
 *     case "declined":     return "prospect";   // back to top of pipeline
 *     case "expired":      return "prospect";
 *     case "revoked":      return "prospect";
 *
 * and the identical collapse onto `"lead"` in `mapCollectiveStateToPCRMStage`
 * (:61-63). An investor who said NO, an invitation whose WINDOW RAN OUT, and an
 * invitation THE COMPANY ITSELF WITHDREW all arrived in the CRM as the same
 * value — and that value was index 1 of FOUNDER_CRM_STAGES / index 0 of
 * INVESTOR_PCRM_STAGES, i.e. the TOP OF A LIVE PIPELINE. A founder working the
 * "Prospect" column was being handed people it had already lost, and people it
 * had itself cut off, with nothing to distinguish them.
 *
 * ── R91 IS THE REASON THIS FILE IS HALF LADDER ASSERTIONS ────────────────────
 * R91 says stage-ladder ORDER is not refactorable and a wave must PROVE nothing
 * else shifts position before changing a mapping. So Finding 3 is fixed WITHOUT
 * adding to, removing from or reordering ANY of the four exported ladders: the
 * terminal outcomes are a SEPARATE closed vocabulary (`CRM_TERMINAL_OUTCOMES`)
 * and the mappers' return type widens to `stage | outcome`. §2 below asserts
 * every ladder ENTRY BY INDEX — not lengths, not set membership — so a future
 * reorder cannot pass this file.
 *
 * WHY EACH BLOCK FAILS BEFORE:
 *  · §1 asserted `toBe("declined")` where the old mapper returned `"prospect"`.
 *  · §3's PCRM assertions failed the same way against `"lead"`.
 *  · §4 (the three are distinct from each other, and none is a live stage)
 *    could not pass at all before: all three returned one live stage.
 *  · §5 (labels/meanings exist and differ) failed because the vocabulary did
 *    not exist.
 *  · §2 passes before AND after by design — it is the R91 CONTROL, and its job
 *    is to fail if this wave (or a later one) moves a rung.
 *
 * R90 — no auth or session code is touched or asserted. This file imports only
 * `shared/crmStages.ts`, plus the two partner ladders' consumers by grep, and
 * mounts no route and no screen.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  FOUNDER_CRM_STAGES,
  INVESTOR_PCRM_STAGES,
  PARTNER_CLIENT_STAGES,
  PARTNER_PIPELINE_STAGES,
  CRM_TERMINAL_OUTCOMES,
  CRM_TERMINAL_OUTCOME_LABELS,
  CRM_TERMINAL_OUTCOME_MEANINGS,
  isCRMTerminalOutcome,
  mapCollectiveStateToCRMStage,
  mapCollectiveStateToPCRMStage,
  type CollectiveDecisionState,
} from "@shared/crmStages";

/* ══ §1 · FOUNDER CRM — each ending is itself ═══════════════════════════════ */

describe("W122 · §1 — the founder CRM mapper returns each ending as itself", () => {
  it("W122-F3-01 · declined maps to declined, NOT to a live prospect", () => {
    expect(mapCollectiveStateToCRMStage("declined")).toBe("declined");
    expect(mapCollectiveStateToCRMStage("declined")).not.toBe("prospect");
  });

  it("W122-F3-02 · expired maps to expired — the investor never said no", () => {
    expect(mapCollectiveStateToCRMStage("expired")).toBe("expired");
    expect(mapCollectiveStateToCRMStage("expired")).not.toBe("prospect");
  });

  it("W122-F3-03 · revoked maps to revoked — the COMPANY ended this one", () => {
    expect(mapCollectiveStateToCRMStage("revoked")).toBe("revoked");
    expect(mapCollectiveStateToCRMStage("revoked")).not.toBe("prospect");
  });

  it("W122-F3-04 · the seven LIVE states are mapped exactly as before", () => {
    /* The wave must not move a live state while fixing the terminal ones. */
    expect(mapCollectiveStateToCRMStage("pending")).toBe("prospect");
    expect(mapCollectiveStateToCRMStage("viewed")).toBe("engaged");
    expect(mapCollectiveStateToCRMStage("accepted")).toBe("engaged");
    expect(mapCollectiveStateToCRMStage("soft_circled")).toBe("soft_circle");
    expect(mapCollectiveStateToCRMStage("confirmed")).toBe("committed");
    expect(mapCollectiveStateToCRMStage("signed")).toBe("signing");
    expect(mapCollectiveStateToCRMStage("funded")).toBe("invested");
  });
});

/* ══ §2 · R91 CONTROL — EVERY LADDER ENTRY, BY INDEX ═══════════════════════ */

describe("W122 · §2 — R91: no ladder gained, lost or moved a rung", () => {
  it("W122-R91-01 · FOUNDER_CRM_STAGES holds its exact nine entries in order", () => {
    expect(FOUNDER_CRM_STAGES.length).toBe(9);
    expect(FOUNDER_CRM_STAGES[0]).toBe("invited_unregistered");
    expect(FOUNDER_CRM_STAGES[1]).toBe("prospect");
    expect(FOUNDER_CRM_STAGES[2]).toBe("engaged");
    expect(FOUNDER_CRM_STAGES[3]).toBe("soft_circle");
    expect(FOUNDER_CRM_STAGES[4]).toBe("committed");
    expect(FOUNDER_CRM_STAGES[5]).toBe("signing");
    expect(FOUNDER_CRM_STAGES[6]).toBe("invested");
    expect(FOUNDER_CRM_STAGES[7]).toBe("longterm");
    /* The trailing legacy alias stays LAST — v25.48.3 Q-K1 put it there so no
       historical row's index moved when "lead" was renamed "prospect". */
    expect(FOUNDER_CRM_STAGES[8]).toBe("lead");
  });

  it("W122-R91-02 · INVESTOR_PCRM_STAGES holds its exact seven entries in order", () => {
    expect(INVESTOR_PCRM_STAGES.length).toBe(7);
    expect(INVESTOR_PCRM_STAGES[0]).toBe("lead");
    expect(INVESTOR_PCRM_STAGES[1]).toBe("met");
    expect(INVESTOR_PCRM_STAGES[2]).toBe("diligence");
    expect(INVESTOR_PCRM_STAGES[3]).toBe("soft_circle");
    expect(INVESTOR_PCRM_STAGES[4]).toBe("signing");
    expect(INVESTOR_PCRM_STAGES[5]).toBe("invested");
    expect(INVESTOR_PCRM_STAGES[6]).toBe("exited");
  });

  it("W122-R91-03 · PARTNER_CLIENT_STAGES — the kanban COLUMN ORDER — is unchanged", () => {
    /* This ladder is ITERATED to lay out columns in client/src/pages/partner/
       PartnerClients.tsx:110 and PartnerClientDetail.tsx:241, and is validated
       server-side in server/partnerClientCrmRoutes.ts:35,50,68. An index shift
       here silently reorders a partner's board. */
    expect(PARTNER_CLIENT_STAGES.length).toBe(5);
    expect(PARTNER_CLIENT_STAGES[0]).toBe("prospect");
    expect(PARTNER_CLIENT_STAGES[1]).toBe("engaged");
    expect(PARTNER_CLIENT_STAGES[2]).toBe("committed");
    expect(PARTNER_CLIENT_STAGES[3]).toBe("invested");
    expect(PARTNER_CLIENT_STAGES[4]).toBe("longterm");
  });

  it("W122-R91-04 · PARTNER_PIPELINE_STAGES is unchanged", () => {
    /* v25.50.0 spec 2c is LOCKED and replicates the company deal funnel
       VERBATIM (client/src/pages/founder/RoundDetail.tsx:1388-1395), so the
       order here is contractual, not cosmetic. */
    expect(PARTNER_PIPELINE_STAGES.length).toBe(6);
    expect(PARTNER_PIPELINE_STAGES[0]).toBe("invited");
    expect(PARTNER_PIPELINE_STAGES[1]).toBe("viewed");
    expect(PARTNER_PIPELINE_STAGES[2]).toBe("soft_circle");
    expect(PARTNER_PIPELINE_STAGES[3]).toBe("signed");
    expect(PARTNER_PIPELINE_STAGES[4]).toBe("funded");
    expect(PARTNER_PIPELINE_STAGES[5]).toBe("committed");
  });

  it("W122-R91-05 · no terminal outcome was smuggled INTO a ladder", () => {
    for (const outcome of CRM_TERMINAL_OUTCOMES) {
      expect((FOUNDER_CRM_STAGES as readonly string[]).includes(outcome), `${outcome} must not be a founder stage`).toBe(false);
      expect((INVESTOR_PCRM_STAGES as readonly string[]).includes(outcome), `${outcome} must not be a PCRM stage`).toBe(false);
      expect((PARTNER_CLIENT_STAGES as readonly string[]).includes(outcome), `${outcome} must not be a partner client stage`).toBe(false);
      expect((PARTNER_PIPELINE_STAGES as readonly string[]).includes(outcome), `${outcome} must not be a partner pipeline stage`).toBe(false);
    }
  });

  it("W122-R91-06 · the four ladder LITERALS in the source file are byte-identical to their ratified text", () => {
    /* Belt and braces: index assertions above prove the VALUES, this proves the
       DECLARATIONS were not rewritten into an equivalent-looking different
       shape (e.g. a spread of another array that a later edit could change). */
    const src = fs.readFileSync(path.resolve(__dirname, "../../shared/crmStages.ts"), "utf8");
    expect(src).toContain('"invited_unregistered", "prospect", "engaged", "soft_circle", "committed", "signing", "invested", "longterm", "lead",');
    expect(src).toContain('"lead", "met", "diligence", "soft_circle", "signing", "invested", "exited",');
    expect(src).toContain('"prospect", "engaged", "committed", "invested", "longterm",');
    expect(src).toContain('"invited", "viewed", "soft_circle", "signed", "funded", "committed",');
  });
});

/* ══ §3 · INVESTOR PCRM ════════════════════════════════════════════════════ */

describe("W122 · §3 — the investor PCRM mapper stops resurrecting dead deals as leads", () => {
  it("W122-F3-05 · declined / expired / revoked are themselves, not `lead`", () => {
    expect(mapCollectiveStateToPCRMStage("declined")).toBe("declined");
    expect(mapCollectiveStateToPCRMStage("expired")).toBe("expired");
    expect(mapCollectiveStateToPCRMStage("revoked")).toBe("revoked");
    for (const s of ["declined", "expired", "revoked"] as const) {
      expect(mapCollectiveStateToPCRMStage(s)).not.toBe("lead");
      expect(mapCollectiveStateToPCRMStage(s)).not.toBe(INVESTOR_PCRM_STAGES[0]);
    }
  });

  it("W122-F3-06 · the live PCRM mappings are unchanged", () => {
    expect(mapCollectiveStateToPCRMStage("pending")).toBe("lead");
    expect(mapCollectiveStateToPCRMStage("viewed")).toBe("met");
    expect(mapCollectiveStateToPCRMStage("accepted")).toBe("diligence");
    expect(mapCollectiveStateToPCRMStage("soft_circled")).toBe("soft_circle");
    expect(mapCollectiveStateToPCRMStage("confirmed")).toBe("signing");
    expect(mapCollectiveStateToPCRMStage("signed")).toBe("signing");
    expect(mapCollectiveStateToPCRMStage("funded")).toBe("invested");
  });
});

/* ══ §4 · THE THREE ARE DISTINCT, AND NONE IS A LIVE STAGE ═════════════════ */

describe("W122 · §4 — three endings, three values, none of them a working column", () => {
  const TERMINALS: CollectiveDecisionState[] = ["declined", "expired", "revoked"];

  it("W122-F3-07 · every pair of endings maps to a DIFFERENT value on both mappers", () => {
    const founder = TERMINALS.map((s) => mapCollectiveStateToCRMStage(s));
    const pcrm = TERMINALS.map((s) => mapCollectiveStateToPCRMStage(s));
    expect(new Set(founder).size, "founder mapper must not collapse the three").toBe(3);
    expect(new Set(pcrm).size, "PCRM mapper must not collapse the three").toBe(3);
  });

  it("W122-F3-08 · a board can TELL an ending from a stage without a lookup table", () => {
    for (const s of TERMINALS) {
      expect(isCRMTerminalOutcome(mapCollectiveStateToCRMStage(s))).toBe(true);
      expect(isCRMTerminalOutcome(mapCollectiveStateToPCRMStage(s))).toBe(true);
    }
    /* …and a live state is NOT reported as an ending. */
    for (const s of ["pending", "viewed", "accepted", "soft_circled", "confirmed", "signed", "funded"] as CollectiveDecisionState[]) {
      expect(isCRMTerminalOutcome(mapCollectiveStateToCRMStage(s)), `${s} is live`).toBe(false);
      expect(isCRMTerminalOutcome(mapCollectiveStateToPCRMStage(s)), `${s} is live`).toBe(false);
    }
    expect(isCRMTerminalOutcome("prospect")).toBe(false);
    expect(isCRMTerminalOutcome("lead")).toBe(false);
    expect(isCRMTerminalOutcome(undefined)).toBe(false);
  });
});

/* ══ §5 · THE WORDS A HUMAN READS ══════════════════════════════════════════ */

describe("W122 · §5 — each ending carries its own truthful words", () => {
  it("W122-F3-09 · a distinct label per outcome", () => {
    expect(CRM_TERMINAL_OUTCOME_LABELS.declined).toBe("Declined");
    expect(CRM_TERMINAL_OUTCOME_LABELS.expired).toBe("Expired");
    expect(CRM_TERMINAL_OUTCOME_LABELS.revoked).toBe("Revoked");
    expect(new Set(Object.values(CRM_TERMINAL_OUTCOME_LABELS)).size).toBe(3);
    /* None of them reads as a live pipeline column. */
    for (const label of Object.values(CRM_TERMINAL_OUTCOME_LABELS)) {
      expect(label.toLowerCase()).not.toBe("prospect");
      expect(label.toLowerCase()).not.toBe("lead");
    }
  });

  it("W122-F3-10 · a sentence per outcome that says WHO ended it", () => {
    expect(new Set(Object.values(CRM_TERMINAL_OUTCOME_MEANINGS)).size).toBe(3);
    /* The distinction that matters commercially: expiry is not a refusal, and a
       revocation is the company's own act. */
    expect(CRM_TERMINAL_OUTCOME_MEANINGS.expired).toMatch(/never said no/i);
    expect(CRM_TERMINAL_OUTCOME_MEANINGS.revoked).toMatch(/company/i);
    expect(CRM_TERMINAL_OUTCOME_MEANINGS.declined).toMatch(/said no/i);
  });
});
