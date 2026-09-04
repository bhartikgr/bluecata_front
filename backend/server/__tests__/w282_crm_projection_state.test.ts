/* ════════════════════════════════════════════════════════════════════════════
   WAVE 282 · SERVER SIDE — A FAILED PROJECTION READ IS RECORDED AS A FAILURE.
   ════════════════════════════════════════════════════════════════════════════
   THE DEFECT. `partnerClientCrmStore.getStage` / `listStages` answer out of the
   in-memory `crmByKey` projection. That map is EMPTY in two entirely different
   worlds — "nobody has staged anybody yet" and "the boot hydrate's SELECT threw
   and the non-fatal catch swallowed it" — and the map cannot tell them apart.
   Every reader therefore resolved the second world to
   PARTNER_CLIENT_DEFAULT_STAGE, and the Clients surfaces printed "Prospect"
   for every managed client of a partner whose stage table had not been read.
   R231: never let a failure render as a fact.

   WHY THE STORE IS NOT MADE TO THROW, AND WHY THAT IS THE POINT. `getStage`
   still returns the default after a failed hydrate. That is asserted BELOW, on
   purpose: wave 282 does NOT change what the store answers, it adds the ability
   to ASK whether the answer was read or defaulted. A test that only asserted
   "the store now refuses" would be testing a change that was deliberately not
   made.

   WHY THIS FILE MOCKS `db/connection`. The seam under test is a SELECT that
   throws inside `hydratePartnerClientCrmStore`'s try. Nothing in the real test
   database makes that SELECT throw, and forcing it to would mean destructive
   SQL against a shared file. The pattern, the mock shape and the reason for a
   SEPARATE file are all lifted from the pre-existing
   `wpartner_f3_crm_hydrator_guard.test.ts`, which fences the very same catch:
   the mock would otherwise replace the database for every suite in the process.

   ANTI-VACUITY. Every negative assertion is preceded by a POSITIVE one on the
   same fixture: the healthy hydrate is asserted to have actually loaded a row
   (`crmRows.length > 0`, and `getStage` returning the NON-default "engaged")
   before any conclusion is drawn from a failed one. A fixture whose healthy
   path also returned the default would be unable to distinguish the fix from
   the defect.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  partnerClientCrmStore,
  hydratePartnerClientCrmStore,
  crmProjectionState,
} from "../partnerClientCrmStore";
import { PARTNER_CLIENT_DEFAULT_STAGE } from "../../shared/crmStages";

type Row = Record<string, unknown>;

let crmRows: Row[] = [];
let actRows: Row[] = [];
/** When true, any SELECT against partner_client_crm throws. */
let selectFails = false;

vi.mock("../db/connection", () => ({
  rawDb: () => ({
    prepare: (sql: string) => {
      const isCrmSelect = /SELECT[\s\S]*FROM partner_client_crm\b/.test(sql);
      const isActSelect = /SELECT[\s\S]*FROM partner_client_activity\b/.test(sql);
      if (selectFails && isCrmSelect) {
        throw new Error("no such column: lead_user_id");
      }
      return {
        all: () => (isCrmSelect ? crmRows : isActSelect ? actRows : []),
        get: () => undefined,
        run: () => ({ changes: 0 }),
      };
    },
  }),
  getDb: () => ({}),
}));

const PID = "ac_w282_projection_partner";
const CO_STAGED = "co_w282_staged";
const CO_NEVER_STAGED = "co_w282_never_staged";

beforeEach(() => {
  selectFails = false;
  crmRows = [
    {
      partner_id: PID,
      company_id: CO_STAGED,
      /* NOT the default stage. A fixture staged at `prospect` could not tell a
         real read from a fabrication, which is inert mechanism #10. */
      stage: "engaged",
      updated_at: "2026-09-01T00:00:00.000Z",
      updated_by: "u_actor",
      lead_user_id: "u_lead",
    },
  ];
  actRows = [];
});

describe("WAVE 282 — crmProjectionState distinguishes 'read it' from 'could not read it'", () => {
  it("PRECONDITION — the fixture is capable of moving the store off the default", () => {
    /* Asserted FIRST and separately: if this row were absent, or were itself
       the default stage, every assertion below would pass on a store that
       never read anything. */
    expect(crmRows.length).toBeGreaterThan(0);
    expect(crmRows[0].stage).not.toBe(PARTNER_CLIENT_DEFAULT_STAGE);
    expect(PARTNER_CLIENT_DEFAULT_STAGE).toBe("prospect");
  });

  it("a healthy hydrate reports 'ok' AND actually loaded the row", async () => {
    await hydratePartnerClientCrmStore();
    /* Positive proof the read happened, before the flag is trusted. */
    expect(partnerClientCrmStore.getStage(PID, CO_STAGED)).toBe("engaged");
    expect(Object.keys(partnerClientCrmStore.listStages(PID)).length).toBeGreaterThan(0);
    expect(crmProjectionState()).toBe("ok");
  });

  it("a FAILED hydrate reports 'failed' — while the store still answers the default", async () => {
    /* Prove the healthy state first, so "failed" below cannot be the state the
       module happened to start in. */
    await hydratePartnerClientCrmStore();
    expect(crmProjectionState()).toBe("ok");

    selectFails = true;
    await hydratePartnerClientCrmStore();
    expect(crmProjectionState()).toBe("failed");

    /* THE DEFECT, STILL PRESENT AT THIS LAYER AND DELIBERATELY SO. A company
       nobody ever staged reads back as the default, and after a failed read
       there is nothing in the returned VALUE to say the read failed. This is
       exactly why the flag exists, and why the client must consult it. */
    expect(partnerClientCrmStore.getStage(PID, CO_NEVER_STAGED)).toBe(PARTNER_CLIENT_DEFAULT_STAGE);
  });

  it("recovery — a later healthy hydrate returns the state to 'ok'", async () => {
    selectFails = true;
    await hydratePartnerClientCrmStore();
    expect(crmProjectionState()).toBe("failed");
    selectFails = false;
    await hydratePartnerClientCrmStore();
    expect(crmProjectionState()).toBe("ok");
    /* Not a latch: a transient boot failure must not mark the surface unusable
       for the life of the process. */
    expect(partnerClientCrmStore.getStage(PID, CO_STAGED)).toBe("engaged");
  });
});

describe("WAVE 282 — both GET routes publish stagesAvailable", () => {
  /* SOURCE-LEVEL, and named as such. The two handlers are asserted to carry the
     field at BOTH call sites, because the recurring defect in this project is
     "the control is real, but not everywhere it is needed" (R255.1/R256.1) and
     the unit of installation is the CALL SITE. The RENDERED behaviour of both
     surfaces is proved separately, against the real components, in
     client/src/pages/partner/__tests__/w282_stage_read_honesty.test.tsx. */
  it("the route module wires crmProjectionState into exactly the two read handlers", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", "partnerClientCrmRoutes.ts"),
      "utf8",
    );
    /* Comments are stripped before counting. An earlier wave in this project
       counted a mechanism that existed only inside a comment. */
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    /* Prove the stripper stripped: the word below appears ONLY in a comment in
       this file, so if it survives, the stripper did nothing. */
    expect(src).toContain("ADDITIVE");
    expect(stripped).not.toContain("ADDITIVE");

    const matches = stripped.match(/stagesAvailable: crmProjectionState\(\) === "ok"/g) ?? [];
    /* THE COUNT, not merely the match. Two GET handlers, two call sites. */
    expect(matches.length).toBe(2);
    /* And each one sits in a different handler: the index route and the
       single-company route. */
    expect(stripped).toMatch(/client-crm-index[\s\S]*?stagesAvailable/);
    expect(stripped).toMatch(/client-crm\/:companyId[\s\S]*?stagesAvailable/);
    /* NEGATIVE DIRECTION, proved on a known case: the same regex must NOT find
       a third site, and must not match a bare truthiness wiring. */
    expect((stripped.match(/crmProjectionState\(\)/g) ?? []).length).toBe(2);
  });
});
