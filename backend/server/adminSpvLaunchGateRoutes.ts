/* ═══════════════════════════════════════════════════════════════════════════
   WAVE 154 · BATCH 2 · ITEM K — ADMIN SURFACE FOR THE SPV LAUNCH GATE.
                                                                 R114, R114.3, R77
   ═══════════════════════════════════════════════════════════════════════════
   The override is a HARD RELEASE CONDITION (R114.3): the gate does not ship
   without a human lever. This module is that lever, and every action through it
   is audited with the admin's authenticated identity — never an actor taken from
   a request body.

   Endpoints (all `requireAdmin`):
     GET    /api/admin/spv-launch-gate/settings          — mode + policies, live
     GET    /api/admin/spv-launch-gate/overrides         — the FULL ledger
     POST   /api/admin/spv-launch-gate/overrides         — grant (reason REQUIRED)
     POST   /api/admin/spv-launch-gate/overrides/:id/revoke — withdraw, never delete
     GET    /api/admin/spv-launch-gate/evaluate/:spvId   — dry-run the decision

   `evaluate` exists so an admin can answer "why is this SPV blocked?" WITHOUT
   attempting a launch. It returns the per-company states in the PARTNER/ADMIN
   audience form (company named); it is admin-only, so no LP ever reads it.
   ═══════════════════════════════════════════════════════════════════════════ */
import type { Express, Request, Response } from "express";
import { requireAdmin } from "./lib/authMiddleware";
import { appendAdminAudit } from "./adminPlatformStore";
import { sanitizeErrorMessage } from "./lib/sanitize";
import { log } from "./lib/logger";
import {
  createOverride,
  revokeOverride,
  listAllOverrides,
  OverrideWriteError,
} from "./lib/spvLaunchGateOverrideStore";
import {
  evaluateLaunchGate,
  evaluateFreeze,
  resolveGatedCompanyIds,
  getLaunchGateMode,
  getNoCompanyPolicy,
  isFreezeEnabled,
  renderMembershipState,
  renderMembershipStanding,
  companyLabel,
  LAUNCH_GATE_MODE_KEY,
} from "./lib/spvEligibilityGate";
import { updatePlatformConfigValue, ensurePlatformConfigKey } from "./lib/platformConfigWriter";

function actorOf(req: Request): string {
  const ctx = (req as Request & {
    userContext?: { identity?: { email?: string }; userId?: string };
  }).userContext;
  return String(ctx?.identity?.email ?? ctx?.userId ?? "u_unknown_admin");
}

export function registerAdminSpvLaunchGateRoutes(app: Express): void {
  /* ── settings (read-only here) ─────────────────────────────────────────────
     Writing them goes through the existing platform-config admin path so the
     hash chain and history stay intact; exposing a second writer here would give
     the settings two sources of truth, which is the defect class this batch is
     removing. */
  app.get("/api/admin/spv-launch-gate/settings", requireAdmin, (_req: Request, res: Response) => {
    res.json({
      ok: true,
      mode: getLaunchGateMode(),
      noCompanyPolicy: getNoCompanyPolicy(),
      freezeEnabled: isFreezeEnabled(),
      note:
        "Mode 'enforced' refuses a launch when any company in the SPV is not a current paid member. 'warn' allows the launch and records the warning instead.",
    });
  });

  /* ── mode change (WAVE 156) ────────────────────────────────────────────────
     R124.4.1 / R114.3: the override is a HARD release condition and the owner
     could not exercise any of it, because there was no admin screen — and there
     was no writer for the mode either, so the note above ("writing them goes
     through the existing platform-config admin path") described a path that does
     not exist as an HTTP endpoint anywhere. Verified before writing this:
     `grep -rn updatePlatformConfigValue server --include=*.ts` matched only its
     own definition.

     This is NOT a second source of truth. It writes the SAME `platform_config`
     row the readers read, through the SAME hash-chained writer
     (`updatePlatformConfigValue`, server/lib/platformConfigWriter.ts:121) that
     keeps `platform_config_history` intact. ONLY the mode is writable here:
     `no_company_policy` and `freeze_enabled` stay read-only, because changing
     either is a rule change rather than an operational switch.

     R123.1 IS ENFORCED IN THE RESPONSE, NOT HIDDEN: switching to `enforced`
     returns the standing warning that with no membership records and an
     unconfigured payment path, `enforced` is an outage rather than a control. */
  app.put("/api/admin/spv-launch-gate/settings", requireAdmin, (req: Request, res: Response) => {
    const actor = actorOf(req);
    const mode = String(req.body?.mode ?? "").trim();
    if (mode !== "enforced" && mode !== "warn") {
      return res.status(400).json({
        ok: false,
        error: "MODE_INVALID",
        message:
          "Choose either 'Refuse the launch' (enforced) or 'Allow it and record a warning' (warn).",
      });
    }
    const reason = String(req.body?.reason ?? "").trim();
    if (!reason) {
      return res.status(400).json({
        ok: false,
        error: "intent_required",
        message:
          "State why the launch check is changing. The reason is recorded permanently in the settings history.",
      });
    }
    try {
      try {
        updatePlatformConfigValue({
          key: LAUNCH_GATE_MODE_KEY,
          valueJson: JSON.stringify(mode),
          changedBy: actor,
        });
      } catch (first) {
        /* The settings row is seeded from TypeScript at boot because the
           hash-chain trigger refuses a plain SQL insert. If boot seeding never
           ran on this instance the key is simply absent, which is a MISSING ROW
           and not a refusal — so seed it and write once more. Any second failure
           propagates untouched. */
        if ((first as { code?: string })?.code !== "CONFIG_KEY_NOT_FOUND") throw first;
        ensurePlatformConfigKey({
          key: LAUNCH_GATE_MODE_KEY,
          valueJson: JSON.stringify(mode),
          valueType: "string",
          description:
            "SPV launch gate: 'enforced' refuses a launch when a company is not a paid member; 'warn' allows it and records the warning. Ships enforced (R114).",
          createdBy: actor,
        });
        /* `ensurePlatformConfigKey` returns an EXISTING row untouched, so if the
           row appeared between the two calls the requested value still has to be
           written — and the mode the caller asked for must be what the reader
           reports, which is asserted below rather than assumed. */
        if (getLaunchGateMode() !== mode) {
          updatePlatformConfigValue({
            key: LAUNCH_GATE_MODE_KEY,
            valueJson: JSON.stringify(mode),
            changedBy: actor,
          });
        }
      }
      try {
        appendAdminAudit(actor, `spv_launch_gate:mode`, "spv_launch_gate_mode_changed", {
          mode,
          reason,
        });
      } catch (auditErr) {
        log.warn("[adminSpvLaunchGateRoutes] mode audit append failed (non-fatal):", auditErr);
      }
      const observed = getLaunchGateMode();
      return res.json({
        ok: true,
        mode: observed,
        /* Report what the row ACTUALLY says now, not what was asked for. */
        message:
          observed === "enforced"
            ? "The launch check now REFUSES a launch when a company is not a current paid member. Before leaving it here, confirm that the companies and partners you expect to transact have a membership on record — a paid one or a comped one — otherwise every create will be refused and nobody can pay to clear it."
            : "The launch check now ALLOWS the launch and records a warning instead of refusing it.",
      });
    } catch (err) {
      return res.status(500).json({
        ok: false,
        error: "MODE_WRITE_FAILED",
        message: `The launch check setting was not changed: ${sanitizeErrorMessage(err)}`,
      });
    }
  });

  /* ── the ledger ──────────────────────────────────────────────────────────── */
  app.get("/api/admin/spv-launch-gate/overrides", requireAdmin, (_req: Request, res: Response) => {
    try {
      const all = listAllOverrides();
      res.json({
        ok: true,
        overrides: all.map((o) => ({
          ...o,
          scopeLabel: o.scopeKind === "company" ? companyLabel(o.scopeId) : o.scopeId,
          live: !o.revokedAt,
        })),
        total: all.length,
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: "OVERRIDE_LIST_FAILED",
        message: `The override list could not be read: ${sanitizeErrorMessage(err)}`,
      });
    }
  });

  app.post("/api/admin/spv-launch-gate/overrides", requireAdmin, (req: Request, res: Response) => {
    const actor = actorOf(req);
    try {
      const created = createOverride({
        scopeKind: (req.body?.scopeKind ?? "") as "spv" | "company",
        scopeId: String(req.body?.scopeId ?? ""),
        reason: String(req.body?.reason ?? ""),
        createdBy: actor, // BOUND to the session, never the body
      });
      try {
        appendAdminAudit(actor, `spv_launch_gate:${created.scopeKind}:${created.scopeId}`,
          "spv_launch_gate_override_granted", {
            overrideId: created.id,
            scopeKind: created.scopeKind,
            scopeId: created.scopeId,
            reason: created.reason,
          });
      } catch (auditErr) {
        log.warn("[adminSpvLaunchGateRoutes] override audit append failed (non-fatal):", auditErr);
      }
      res.status(201).json({ ok: true, override: created });
    } catch (err) {
      if (err instanceof OverrideWriteError) {
        res.status(400).json({ ok: false, error: err.code, message: err.message });
        return;
      }
      res.status(500).json({
        ok: false,
        error: "OVERRIDE_WRITE_FAILED",
        message: `The override was not saved: ${sanitizeErrorMessage(err)}`,
      });
    }
  });

  app.post(
    "/api/admin/spv-launch-gate/overrides/:id/revoke",
    requireAdmin,
    (req: Request, res: Response) => {
      const actor = actorOf(req);
      try {
        const revoked = revokeOverride(String(req.params.id), actor);
        try {
          appendAdminAudit(actor, `spv_launch_gate:${revoked.scopeKind}:${revoked.scopeId}`,
            "spv_launch_gate_override_revoked", {
              overrideId: revoked.id,
              scopeKind: revoked.scopeKind,
              scopeId: revoked.scopeId,
              revokedAt: revoked.revokedAt,
            });
        } catch (auditErr) {
          log.warn("[adminSpvLaunchGateRoutes] revoke audit append failed (non-fatal):", auditErr);
        }
        res.json({ ok: true, override: revoked });
      } catch (err) {
        if (err instanceof OverrideWriteError) {
          res.status(err.code === "OVERRIDE_NOT_FOUND" ? 404 : 400)
            .json({ ok: false, error: err.code, message: err.message });
          return;
        }
        res.status(500).json({
          ok: false,
          error: "OVERRIDE_REVOKE_FAILED",
          message: `The override was not withdrawn: ${sanitizeErrorMessage(err)}`,
        });
      }
    },
  );

  /* ── dry run ─────────────────────────────────────────────────────────────── */
  app.get(
    "/api/admin/spv-launch-gate/evaluate/:spvId",
    requireAdmin,
    (req: Request, res: Response) => {
      const spvId = String(req.params.spvId);
      try {
        const companyIds = resolveGatedCompanyIds(spvId);
        const launch = evaluateLaunchGate({ spvId, companyIds });
        const freeze = evaluateFreeze(spvId);
        res.json({
          ok: true,
          spvId,
          mode: launch.mode,
          launchAllowed: launch.allowed,
          warned: launch.warned,
          frozenForNewMoney: freeze.frozen,
          /* Distributions and transfers are NEVER frozen — stated here so an
             admin reading this screen cannot conclude otherwise. */
          distributionsFrozen: false,
          transfersFrozen: false,
          override: launch.override,
          companies: launch.memberships.map((m) => ({
            companyId: m.companyId,
            companyName: companyLabel(m.companyId),
            state: m.state,
            /* WAVE 155 — `stateLabel` is kept byte-for-byte for any existing
               reader; `standingLabel` is what a screen shows, because it names a
               COMPED membership as comped instead of as "Paid". */
            stateLabel: renderMembershipState(m.state),
            standingLabel: renderMembershipStanding(m),
            basis: m.basis ?? null,
            compedGrantId: m.compedGrantId ?? null,
            reason: m.reason,
            checkedAt: m.checkedAt,
          })),
          message: launch.allowed
            ? "Every company in this SPV has a current paid membership on file, or an override applies."
            : launch.partnerMessage,
        });
      } catch (err) {
        res.status(500).json({
          ok: false,
          error: "LAUNCH_GATE_EVALUATE_FAILED",
          message: `The eligibility check could not be run: ${sanitizeErrorMessage(err)}`,
        });
      }
    },
  );
}
