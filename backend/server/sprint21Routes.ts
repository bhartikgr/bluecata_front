/**
 * Sprint 21 Wave A — New server endpoints for Investor Dashboard restructure.
 *
 * Registers:
 *   GET  /api/investor/companies/:companyId/co-members  — real seed data with privacy filter
 *   POST /api/investor/dashboard/ma-discuss             — send message or post to cap-table channel
 *
 * Registration:
 *   import { registerSprint21Routes } from "./sprint21Routes";
 *   registerSprint21Routes(app);
 */

/* v25.25.2 — createRequire shim: lazy require() calls in this file must work
   in BOTH the dev/prod tsx runtime (ESM, where `require` is undefined) AND
   the bundled CJS dist. This is the minimal, zero-risk way to unblock the
   v25.25 login 500 ("require is not defined" at userContext.ts:585 and other
   sites) without converting every lazy require() to a static import (which
   would re-introduce circular-import bugs). */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { getUserContext, getUserContextForId, resolvePersonaId } from "./lib/userContext";
/* WAVE 32 · CP-SPV-30 capability 5 — STATIC, deliberately. The lazy
   `require("./captableCommitStore")` this replaces resolves to a .ts file under
   `tsx` AND under Vitest and throws `Unexpected token '{'`, swallowed by the
   handler's catch into an empty list. The ledger-derived co-members path was
   therefore dead in dev and unobservable in every test, and live only in the
   bundled JS build. A privacy guard on an unexecutable path proves nothing, so
   the dependency is static and the path now runs where it is tested. */
import { listMembersForCompany } from "./captableCommitStore";
import { isSpvBackedCompany } from "./lib/spvBackedCompanies";
import { DEMO_SEED_ENABLED } from "./lib/demoGate";
/* WAVE 36 · ROW 6 — STATIC import of the real comms core (was a lazy require
 * of two names commsStore never exported, guarded by typeof so it silently did
 * nothing). */
import { openDmChannelCore, postChannelMessageCore } from "./commsStore";

/* ---------------------------------------------------------------------------
 * Seed data — co-members per portfolio company
 * ---------------------------------------------------------------------------
 * Shape:
 *   memberId          — stable member identifier
 *   displayLabel      — name OR "[Anonymous Holder]" if screenNameOnly/privacyOff
 *   areaOfExpertise   — investor-supplied tags
 *   investorExperienceTier — bucketed so we NEVER expose individual deal history
 *   chapter           — optional geographic chapter
 *   screenNameOnly    — if true, display as "[Anonymous Holder]" to other investors
 *   allowDM           — investor has enabled DM from cap-table members
 *   privacySettings   — internal — not sent to clients; used for anonymisation
 * --------------------------------------------------------------------------- */

type CoMember = {
  memberId: string;
  /** Sprint 22 Wave 1: platform userId for DM start (DEF-003 / DEF-004). Only included when allowDM:true. */
  userId?: string;
  displayLabel: string;
  areaOfExpertise: string[];
  investorExperienceTier: "Angel" | "Pre-seed" | "Seed" | "Series A+" | "Multi-stage";
  chapter?: string;
  screenNameOnly: boolean;
  allowDM: boolean;
  /** Internal — not sent in responses; used to apply viewerId privacy filter. */
  _privacyOff?: boolean;
};

// Patch v4: demo seed only when demo gate is on.
const CO_MEMBERS_BY_COMPANY: Record<string, CoMember[]> = DEMO_SEED_ENABLED ? {
  co_novapay: [
    {
      memberId: "m_novapay_1",
      userId: "u_hydra_capital",
      displayLabel: "Priya Menon",
      areaOfExpertise: ["Fintech", "Regulatory"],
      investorExperienceTier: "Seed",
      chapter: "London",
      screenNameOnly: false,
      allowDM: true,
    },
    {
      memberId: "m_novapay_2",
      displayLabel: "[Anonymous Holder]",
      areaOfExpertise: ["AI/ML", "Enterprise SaaS"],
      investorExperienceTier: "Multi-stage",
      chapter: "San Francisco",
      screenNameOnly: true,
      allowDM: false,
      _privacyOff: true,
    },
    {
      memberId: "m_novapay_3",
      userId: "u_forge_ventures",
      displayLabel: "James Kwong",
      areaOfExpertise: ["Payments", "Cross-border"],
      investorExperienceTier: "Angel",
      chapter: "Singapore",
      screenNameOnly: false,
      allowDM: true,
    },
    {
      memberId: "m_novapay_4",
      userId: "u_bluepoint_angels",
      displayLabel: "Sofia Bauer",
      areaOfExpertise: ["Fintech", "B2B SaaS"],
      investorExperienceTier: "Pre-seed",
      chapter: "Berlin",
      screenNameOnly: false,
      allowDM: true,
    },
  ],
  co_helia: [
    {
      memberId: "m_helia_1",
      userId: "u_hydra_capital",
      displayLabel: "Marcus Webb",
      areaOfExpertise: ["AI Infrastructure", "DevOps"],
      investorExperienceTier: "Seed",
      chapter: "New York",
      screenNameOnly: false,
      allowDM: true,
    },
    {
      memberId: "m_helia_2",
      userId: "u_forge_ventures",
      displayLabel: "Nadia Osei",
      areaOfExpertise: ["AI/ML", "Deep Tech"],
      investorExperienceTier: "Series A+",
      screenNameOnly: false,
      allowDM: true,
    },
    {
      memberId: "m_helia_3",
      displayLabel: "[Anonymous Holder]",
      areaOfExpertise: ["Enterprise SaaS"],
      investorExperienceTier: "Multi-stage",
      screenNameOnly: true,
      allowDM: false,
      _privacyOff: true,
    },
  ],
  co_tideline: [
    {
      memberId: "m_tideline_1",
      userId: "u_bluepoint_angels",
      displayLabel: "Amara Diallo",
      areaOfExpertise: ["Climate", "Grid Infrastructure"],
      investorExperienceTier: "Seed",
      chapter: "Lagos",
      screenNameOnly: false,
      allowDM: true,
    },
    {
      memberId: "m_tideline_2",
      userId: "u_hydra_capital",
      displayLabel: "Connor Reilly",
      areaOfExpertise: ["Energy Transition", "Hardware"],
      investorExperienceTier: "Angel",
      chapter: "Dublin",
      screenNameOnly: false,
      allowDM: true,
    },
    {
      memberId: "m_tideline_3",
      displayLabel: "Lin Jing",
      areaOfExpertise: ["Climate Tech", "ESG"],
      investorExperienceTier: "Pre-seed",
      chapter: "Hong Kong",
      screenNameOnly: false,
      allowDM: false,
    },
    {
      memberId: "m_tideline_4",
      displayLabel: "[Anonymous Holder]",
      areaOfExpertise: ["Renewable Energy"],
      investorExperienceTier: "Series A+",
      screenNameOnly: true,
      allowDM: false,
      _privacyOff: true,
    },
  ],
} : {};

/** Helper — apply viewerId privacy filter: members who have coMembersOff set
 *  to true are anonymised regardless of screenNameOnly (belt-and-suspenders).
 *  Sprint 22 Wave 1: userId is only included when allowDM:true (DEF-003 fix). */
function applyPrivacyFilter(members: CoMember[]): Omit<CoMember, "_privacyOff">[] {
  return members.map(({ _privacyOff, ...m }) => {
    if (_privacyOff || m.screenNameOnly) {
      return {
        ...m,
        displayLabel: "[Anonymous Holder]",
        screenNameOnly: true,
        allowDM: false,
        userId: undefined, // privacy: don't expose userId for anonymous members
      };
    }
    // For non-anonymous members: include userId only when allowDM:true
    return {
      ...m,
      userId: m.allowDM ? m.userId : undefined,
    };
  });
}

/* ---------------------------------------------------------------------------
 * In-memory store for ma-discuss POSTs (test-only — no persistence needed)
 * --------------------------------------------------------------------------- */
type MaDiscussRecord = {
  id: string;
  companyId: string;
  body: string;
  recipientIds: string[];
  mode: "message" | "post";
  createdAt: string;
};
const maDiscussRecords: MaDiscussRecord[] = [];

export function registerSprint21Routes(app: Express): void {

  /* -------------------------------------------------------------------------
   * GET /api/investor/companies/:companyId/co-members
   *
   * Returns co-investors on the same cap table for a given company.
   * Supports ?viewerId= privacy filter: any member with _privacyOff: true
   * or screenNameOnly: true is anonymised to "[Anonymous Holder]".
   * 401 when no x-user-id header is present.
   * ------------------------------------------------------------------------- */
  app.get(
    "/api/investor/companies/:companyId/co-members",
    async (req: Request, res: Response) => {
      // Sprint 22 Wave 1: use resolvePersonaId first to enforce explicit auth
      // (no fallback to demo persona — DEF-004 fix preserves security hardening).
      const personaId = resolvePersonaId(req);
      if (!personaId) {
        return res.status(401).json({ message: "Unauthorised" });
      }
      const ctx = getUserContextForId(personaId);
      if (!ctx.isAuthed) {
        return res.status(401).json({ message: "Unauthorised" });
      }
      const companyId = String(req.params.companyId ?? "");
      /* WAVE 32 · CP-SPV-30 capability 5 — SPV-BACKED EXCLUSION. The second of
         the two co-members handlers, and it must carry the same guard: a fix
         applied to one of a mirrored pair is a fix that gets undone a wave
         later. An SPV is a company in the ledger and every LP is written into
         it with `company_id = spv.id`, so an LP of a vehicle passes
         `gate("investor.onCapTableOf")` FOR THAT VEHICLE. Without this, one LP
         asking for their own vehicle is handed the identities of every other LP
         in it. Empty list, identical to a company with no other holders — no
         enumeration oracle. See `lib/spvBackedCompanies.ts`. */
      if (isSpvBackedCompany(companyId)) return res.json([]);
      let raw = CO_MEMBERS_BY_COMPANY[companyId] ?? [];
      /* v25.10 fix M9 — the static CO_MEMBERS_BY_COMPANY seed is only populated
       * when DEMO_SEED_ENABLED=true. For real companies (post-demo or in prod),
       * the array was empty and the "Discuss with cap-table" picker showed zero
       * recipients. Augment with co-investors derived from the canonical
       * cap-table commit ledger (committed-state holders for the company),
       * excluding the caller. */
      if (raw.length === 0) {
        try {
          /* No cast: the static import gives the real `LedgerEntry` type, and a cast
             here would have hidden a shape change in the ledger. */
          const ledger = listMembersForCompany(companyId);
          /* De-dupe by investorId. Exclude the caller. */
          const seen = new Set<string>();
          const derived: CoMember[] = [];
          for (const e of ledger) {
            if (!e.investorId || e.investorId === ctx.userId) continue;
            if (seen.has(e.investorId)) continue;
            seen.add(e.investorId);
            derived.push({
              memberId: e.investorId,
              userId: e.investorId,
              displayLabel: e.investorId,
              areaOfExpertise: [],
              investorExperienceTier: "Angel",
              screenNameOnly: false,
              allowDM: true,
            });
          }
          raw = derived;
        } catch {
          /* If the cap-table store is unavailable, fall back to empty list. */
        }
      }
      const filtered = applyPrivacyFilter(raw);
      return res.json(filtered);
    },
  );

  /* -------------------------------------------------------------------------
   * POST /api/investor/dashboard/ma-discuss
   *
   * Body: { companyId: string, body: string, recipientIds: string[], mode: "message" | "post" }
   *
   * mode="message" — records one entry per recipient (simulated channel message)
   * mode="post"    — records a single post with visibility: cap_table
   *
   * Returns { ok: true, id: string }
   * 400 on missing fields, 401 on no auth.
   * ------------------------------------------------------------------------- */
  app.post(
    "/api/investor/dashboard/ma-discuss",
    async (req: Request, res: Response) => {
      // Sprint 22 Wave 1: use resolvePersonaId first to enforce explicit auth
      // (no fallback to demo persona — DEF-004 fix preserves security hardening).
      const personaId = resolvePersonaId(req);
      if (!personaId) {
        return res.status(401).json({ message: "Unauthorised" });
      }
      const ctx = getUserContextForId(personaId);
      if (!ctx.isAuthed) {
        return res.status(401).json({ message: "Unauthorised" });
      }
      const { companyId, body, recipientIds, mode } = req.body ?? {};

      // Validate required fields
      if (!companyId || typeof companyId !== "string") {
        return res.status(400).json({ message: "companyId is required" });
      }
      if (!body || typeof body !== "string" || !body.trim()) {
        return res.status(400).json({ message: "body is required" });
      }
      if (!mode || (mode !== "message" && mode !== "post")) {
        return res.status(400).json({ message: "mode must be 'message' or 'post'" });
      }

      const id = `mad_${randomBytes(8).toString("hex")}`;
      const record: MaDiscussRecord = {
        id,
        companyId,
        body: body.trim(),
        recipientIds: Array.isArray(recipientIds) ? recipientIds : [],
        mode,
        createdAt: new Date().toISOString(),
      };
      maDiscussRecords.push(record);
      /* v25.10 fix M8 — the previous handler kept ma-discuss records in a
       * process-scoped array and never wrote to commsStore, so the message
       * never reached the recipients. Persist the record via the kv shim and,
       * for `message` mode, also create a real DM channel + first message
       * per recipient via commsStore. */
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { persistEntry } = require("./lib/storePersistenceShim");
        persistEntry("maDiscussStore", id, { ...record, senderId: ctx.userId });
      } catch {
        /* non-fatal */
      }
      /* WAVE 36 · ROW 6 — REAL delivery.
       *
       * This block used to lazily `require("./commsStore")` and destructure
       * `startDmChannel` / `postMessageToChannel`, neither of which that module
       * has ever exported, then guard the whole thing with `typeof … ===
       * "function"`. The guards made it a no-op that could never throw, so the
       * v25.10 "fix M8" claim that ma-discuss reaches recipients through
       * commsStore was false on every request. It now calls the SAME core the
       * `POST /api/comms/dm/start` and message routes call, so the identical
       * authorisation applies, and a per-recipient refusal is REPORTED rather
       * than swallowed. */
      const delivery: Array<{
        recipientId: string;
        delivered: boolean;
        channelId?: string;
        error?: string;
      }> = [];
      if (mode === "message" && record.recipientIds.length > 0) {
        for (const recipientId of record.recipientIds) {
          if (!recipientId || typeof recipientId !== "string") continue;
          const opened = openDmChannelCore({
            actorId: ctx.userId,
            targetUserId: recipientId,
          });
          if (!opened.ok) {
            delivery.push({
              recipientId,
              delivered: false,
              error: String((opened.body as any)?.error ?? (opened.body as any)?.reason ?? "dm_refused"),
            });
            continue;
          }
          const posted = postChannelMessageCore({
            actorId: ctx.userId,
            channelId: opened.channelId,
            body: record.body,
          });
          delivery.push(
            posted.ok
              ? { recipientId, delivered: true, channelId: opened.channelId }
              : {
                  recipientId,
                  delivered: false,
                  channelId: opened.channelId,
                  error: String((posted.body as any)?.error ?? (posted.body as any)?.message ?? "post_refused"),
                },
          );
        }
      }

      if (mode === "message") {
        // Simulate per-recipient message creation (reuses commsStore pattern without coupling)
        /* WAVE 36 · ROW 6 — report what was actually DELIVERED, not what was
         * requested. The old response said "Sent to N recipient(s)" while N
         * messages had been sent to nobody. */
        const deliveredCount = delivery.filter((d) => d.delivered).length;
        const refused = delivery.filter((d) => !d.delivered);
        return res.status(201).json({
          ok: true,
          id,
          mode: "message",
          recipientCount: record.recipientIds.length,
          deliveredCount,
          delivery,
          message:
            refused.length === 0
              ? `Sent to ${deliveredCount} recipient(s)`
              : `Sent to ${deliveredCount} of ${record.recipientIds.length} recipient(s); ${refused.length} could not be messaged`,
        });
      } else {
        // mode === "post"
        return res.status(201).json({
          ok: true,
          id,
          mode: "post",
          visibility: "cap_table",
          companyId,
          message: "Posted to cap-table channel",
        });
      }
    },
  );
}

/** Exported for test access only. */
export const _testAccess = { maDiscussRecords, CO_MEMBERS_BY_COMPANY };
