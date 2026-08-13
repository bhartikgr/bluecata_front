/**
 * Sprint 14 D4 — Segmented cap-table milestone broadcast.
 *
 * Per harvest §3 Bullet 4: founder picks a segment (stage / region / series /
 * ownership tier) and writes ≤500 chars.
 *
 * DELIVERY, stated as it actually is (WAVE 16 + WAVE 17). The original design
 * said "in-app notification + email (template `cap_table_broadcast`)".
 *   · IN-APP is real: `deliverBroadcast` below emits one `cap_table.broadcast`
 *     notification per resolved recipient and the DELIVERED count is persisted.
 *   · EMAIL IS NOT IMPLEMENTED AND IS NOT CLAIMED. A tree-wide search for the
 *     template `cap_table_broadcast` finds no template — `server/emailStore.ts`
 *     has no such slug. `emitNotification` is therefore called with
 *     `channels.email = false`, and the founder-facing copy says in as many
 *     words that email delivery is not enabled. This half of the original design
 *     is OUTSTANDING and is recorded as such in build_log/WAVE17_REPORT.md
 *     rather than half-claimed here.
 *
 * AUTO-TRIGGER SURFACES — wired in WAVE 17 (ORP-044), previously dead vocabulary:
 *   - round_closed                 ← the two real round-close paths
 *   - governance_metric_published  ← BridgeOutbound.governanceMetricPublished
 *   - ma_initiative_started        ← POST /api/investor/ma/initiative (lead)
 * The emit points cannot import this store (a verified cycle:
 * milestoneBroadcastStore → captableCommitStore → roundsStore → the close path),
 * so `server/lib/wave17MilestoneAutoTriggers.ts` is a leaf module holding a
 * registered dispatcher; registration happens in
 * `registerMilestoneBroadcastRoutes` below, which server/routes.ts:1271 calls.
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
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { HashChain, registerChain } from "./lib/hashChain";
import { withTrace } from "./lib/trace";
import { emitSync } from "./sprint10Telemetry";
/**
 * WAVE 16 ORP-044 — STATIC imports for the three collaborators on the delivery
 * path, replacing `createRequire` lazy requires for these three only.
 *
 * WHY THIS IS NOT A GRATUITOUS REFACTOR. The `createRequire` shim above exists so
 * lazy `require()` works in both the tsx/ESM runtime and the bundled CJS dist.
 * But a lazy require of a **.ts** module is invisible to the test runner's module
 * graph, so `resolveRecipients`' `catch { return []; }` swallowed the failure and
 * silently resolved an EMPTY audience under vitest. Every test of this file was
 * therefore exercising the degradation path, never delivery — the same trap the
 * Wave 15 report recorded when its test DB failed to install two migrations.
 * A static import cannot silently degrade, and none of the three modules imports
 * this one (verified: the only importer of `milestoneBroadcastStore` tree-wide is
 * `server/routes.ts:144`), so there is no import cycle to reintroduce.
 * `captableCommitStore` and `notificationsStore` are SACRED: both are READ and
 * CALLED here, never edited.
 */
import { listMembersForCompany } from "./captableCommitStore";
import { emitNotification } from "./notificationsStore";
import { getCompanyNameById } from "./multiCompanyStore";
/* WAVE 17 ORP-044 — the auto-trigger registry. A LEAF module (logger + currency
   only), so importing it here cannot create a cycle; the emit points import that
   module, never this one. */
import {
  registerMilestoneAutoDispatcher,
  type AutoBroadcastRequest,
  type AutoBroadcastOutcome,
} from "./lib/wave17MilestoneAutoTriggers";

export const SEGMENT_KINDS = ["all", "by_stage", "by_region", "by_series", "by_ownership_tier"] as const;
export type SegmentKind = (typeof SEGMENT_KINDS)[number];

export const broadcastCreateSchema = z.object({
  companyId: z.string().min(1),
  segmentKind: z.enum(SEGMENT_KINDS),
  segmentValue: z.string().optional(),
  body: z.string().min(1).max(500),
  trigger: z.enum(["manual", "round_closed", "governance_metric_published", "ma_initiative_started"]).default("manual"),
});

export interface MilestoneBroadcast {
  id: string;
  companyId: string;
  founderUserId: string;
  segmentKind: SegmentKind;
  segmentValue?: string;
  body: string;
  trigger: z.infer<typeof broadcastCreateSchema>["trigger"];
  /** Resolved recipient user ids at send time (kept for replay/audit only). */
  recipientUserIds: string[];
  /**
   * WAVE 16 ORP-044 — how many in-app notifications were ACTUALLY delivered for
   * this broadcast. Optional so every persisted pre-Wave-16 record hydrates
   * unchanged; `undefined` therefore means "sent before delivery existed", which
   * is exactly what the founder-facing surface says about those rows.
   */
  deliveredInApp?: number;
  /**
   * WAVE 17 ORP-044 — idempotency key for AUTO-triggered broadcasts only
   * (`round_closed:<roundId>` etc). Every auto path can legitimately run twice:
   * the round sweeper is idempotent by design and re-runs, and a manual close
   * can race it. Absent on manual broadcasts, where the founder is the
   * idempotency authority. Optional, so every pre-Wave-17 persisted record
   * hydrates unchanged.
   */
  autoTriggerKey?: string;
  ts: string;
}

const items = new Map<string, MilestoneBroadcast>();

/**
 * v25.11 NC2 — milestoneBroadcastStore was RAM-only AND had no ownership
 * check AND used a hardcoded `[u_inv_a..u_inv_e]` dummy fixture for
 * recipients. Three issues, three fixes:
 *   1. Persist each broadcast via kv_milestoneBroadcastStore (this file).
 *   2. Resolve recipients from the canonical cap-table commit ledger
 *      (real investor userIds for the company) — see resolveRecipients
 *      replacement below.
 *   3. Add an ownership guard on the POST handler so only founders of the
 *      company can broadcast.
 */
function _persistBroadcast(bc: MilestoneBroadcast): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { persistEntry } = require("./lib/storePersistenceShim");
    persistEntry("milestoneBroadcastStore", bc.id, bc);
  } catch { /* non-fatal */ }
}

export function hydrateMilestoneBroadcastStore(): number {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { hydrateEntries } = require("./lib/storePersistenceShim");
    const rows = hydrateEntries("milestoneBroadcastStore") as Array<[string, MilestoneBroadcast]>;
    let n = 0;
    for (const [id, bc] of rows) {
      if (bc && id && !items.has(id)) {
        items.set(id, bc);
        n++;
      }
    }
    return n;
  } catch {
    return 0;
  }
}
export const broadcastChain = registerChain(new HashChain<{
  id: string;
  companyId: string;
  segmentKind: SegmentKind;
  recipients: number;
  ts: string;
}>("milestone_broadcasts"));

/**
 * v25.11 NC2 — resolve recipients from the REAL cap-table commit ledger
 * instead of a hard-coded `[u_inv_a..u_inv_e]` fixture. For "all" we return
 * every distinct investor on the company's cap-table. For segment filters we
 * fall through to "all" (the segment metadata — stage/region/series — lives
 * on the investor profile, which is not yet indexed here; conservative
 * fall-through is safer than dropping all recipients).
 *
 * Returns deduplicated investorIds for the company's committed positions.
 */
function resolveRecipients(companyId: string, _segmentKind: SegmentKind, _value?: string): string[] {
  try {
    /* `listMembersForCompany` returns `ReadonlyArray<LedgerEntry>`
       (server/captableCommitStore.ts:468) — read through the real type rather than
       asserting a looser shape, so a future ledger change is a compile error here
       instead of a silently empty audience at runtime. */
    const ledger: ReadonlyArray<{ investorId: string }> = listMembersForCompany(companyId);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const e of ledger) {
      if (!e || !e.investorId) continue;
      if (seen.has(e.investorId)) continue;
      seen.add(e.investorId);
      out.push(e.investorId);
    }
    return out;
  } catch {
    /* If the cap-table store is unavailable, return an empty array —
     * better to send to no one than to send to phantom personas. */
    return [];
  }
}

/**
 * WAVE 16 ORP-044 — a human company name for the notification title, resolved
 * from the DB (`getCompanyNameById`, server/multiCompanyStore.ts:373) rather than
 * hardcoded or guessed. Falls back to the id only if the lookup finds nothing,
 * because a notification titled "Update from co_abc123" is still better than one
 * titled "Update from undefined".
 */
function _companyLabel(companyId: string): string {
  try {
    const name = getCompanyNameById(companyId);
    return typeof name === "string" && name.trim() ? name.trim() : companyId;
  } catch {
    return companyId;
  }
}

/**
 * WAVE 16 ORP-044 — ACTUALLY DELIVER the broadcast in-app.
 *
 * THE DEFECT THIS FIXES, found while wiring the client and NOT named in the spec
 * row. This file's own header says a broadcast "is delivered as in-app
 * notification + email (template `cap_table_broadcast`)", and `createBroadcast`
 * resolved recipients, persisted them, hash-chained them and emitted
 * `cap_table_broadcast_sent` telemetry — and then delivered NOTHING. The
 * `MilestoneBroadcast.recipientUserIds` doc comment even conceded it: "kept for
 * replay/audit only". A founder-facing send button on top of that would have
 * been the worst possible outcome of this item: a UI reporting success for a
 * message no investor ever receives. So the client wiring is paired with the
 * delivery it presupposes.
 *
 * WHY `emitNotification` AND NOT A NEW MECHANISM. `server/notificationsStore.ts`
 * is SACRED — read, never edit — and it already declares the exact kind this
 * feature needs, `cap_table.broadcast` (`notificationsStore.ts:70`, listed in
 * `ALL_NOTIFICATION_KINDS` at `:109`), whose only other caller is
 * `partnerWorkspaceV19Store.ts:971`. Nothing was added to that store; it is
 * CALLED, exactly as `track1Routes.ts:967` calls it to notify committed
 * investors. `investorId` is used as the notification `userId` following the
 * established precedent at `sprint21Routes.ts:251`, which derives cap-table
 * co-investors from the same ledger.
 *
 * EMAIL IS DELIBERATELY NOT CLAIMED. A tree-wide search for the template named
 * in the header, `cap_table_broadcast`, finds only the header comment itself —
 * the template does not exist. `emitNotification` defaults `channels.email` to
 * false and this call leaves it false, so no email is promised, attempted, or
 * implied in the UI. That remaining half of the header's promise is reported as
 * outstanding rather than papered over with a channel flag that sends nothing.
 */
function deliverBroadcast(bc: MilestoneBroadcast, companyLabel: string): number {
  let delivered = 0;
  for (const userId of bc.recipientUserIds) {
    if (!userId) continue;
    try {
      emitNotification({
        userId,
        kind: "cap_table.broadcast",
        title: `Update from ${companyLabel}`,
        body: bc.body,
        link: `/investor/portfolio`,
        /* inApp only: see the email note above. */
        channels: { inApp: true, email: false },
      });
      delivered++;
    } catch {
      /* Best-effort per recipient: one bad user id must not silently drop the
         rest of the audience. The shortfall is visible because the count we
         return is the DELIVERED count, never the resolved count. */
    }
  }
  return delivered;
}

/**
 * WAVE 17 ORP-044 — auto-trigger idempotency, resolved HERE because this is where
 * the records live. Scans the same hydrated record set the routes read, so a
 * broadcast that survived a restart still de-duplicates a re-fired milestone.
 */
export function findByAutoTriggerKey(key: string): MilestoneBroadcast | undefined {
  if (!key) return undefined;
  for (const bc of Array.from(items.values())) {
    if (bc.autoTriggerKey === key) return bc;
  }
  return undefined;
}

export function listBroadcasts(filter?: { companyId?: string }): MilestoneBroadcast[] {
  const all = Array.from(items.values()).sort((a, b) => b.ts.localeCompare(a.ts));
  return filter?.companyId ? all.filter((b) => b.companyId === filter.companyId) : all;
}

export function createBroadcast(input: { companyId: string; segmentKind: SegmentKind; segmentValue?: string; body: string; trigger?: "manual" | "round_closed" | "governance_metric_published" | "ma_initiative_started"; autoTriggerKey?: string }, founderUserId: string): MilestoneBroadcast {
  return withTrace("comms.milestone_broadcast", "1.0.0", "US", () => {
    const id = `bc_${randomBytes(6).toString("hex")}`;
    const recipients = resolveRecipients(input.companyId, input.segmentKind, input.segmentValue);
    const bc: MilestoneBroadcast = {
      id,
      companyId: input.companyId,
      founderUserId,
      segmentKind: input.segmentKind,
      segmentValue: input.segmentValue,
      body: input.body,
      trigger: input.trigger ?? "manual",
      recipientUserIds: recipients,
      ts: new Date().toISOString(),
    };
    if (input.autoTriggerKey) bc.autoTriggerKey = input.autoTriggerKey;
    /* WAVE 16 ORP-044 — deliver BEFORE persisting so the stored record carries
       the real delivered count rather than a hopeful one. */
    bc.deliveredInApp = deliverBroadcast(bc, _companyLabel(input.companyId));
    items.set(id, bc);
    /* v25.11 NC2 — write-through to DB so the broadcast survives restart. */
    _persistBroadcast(bc);
    broadcastChain.append({ id, companyId: bc.companyId, segmentKind: bc.segmentKind, recipients: recipients.length, ts: bc.ts });
    emitSync({
      eventType: "cap_table_broadcast_sent",
      aggregateId: bc.companyId,
      aggregateKind: "company",
      payload: { id, segmentKind: bc.segmentKind, segmentValue: bc.segmentValue, recipients: recipients.length, deliveredInApp: bc.deliveredInApp ?? 0, trigger: bc.trigger ?? "manual" },
      actorUserId: founderUserId,
    });
    return bc;
  });
}

export function __clearBroadcasts(): void {
  items.clear();
  broadcastChain.__clear();
}

/**
 * v25.11 NC2 — ownership check helper. Returns true if the caller is admin
 * OR is a founder of the supplied company. Anyone else is denied.
 */
function _callerOwnsCompany(req: Request, companyId: string): boolean {
  const ctx = (req as any).userContext;
  if (!ctx?.isAuthed) return false;
  if (ctx.isAdmin) return true;
  const companies: Array<{ companyId: string }> = ctx.founder?.companies ?? [];
  return companies.some((c) => c?.companyId === companyId);
}

/**
 * WAVE 17 ORP-044 — the dispatcher the three emit points reach through.
 *
 * SEGMENT: auto-triggered broadcasts are `all`. Every declared trigger is a
 * company-wide milestone (a round closing, a governance metric being published,
 * an M&A initiative opening) and `resolveRecipients` falls through to `all` for
 * every segment anyway (`:130`), so choosing a segment here would be a claim the
 * resolver cannot honour.
 *
 * ACTOR: the real actor's user id is passed through as `founderUserId` — the
 * field is the record's actor and is used as the telemetry `actorUserId`. For the
 * sweeper path it is the system actor the cascade already stamps its audit rows
 * with, so the broadcast's provenance matches the audit trail rather than being
 * attributed to a founder who did nothing.
 */
function dispatchAutoBroadcast(req: AutoBroadcastRequest): AutoBroadcastOutcome {
  const existing = findByAutoTriggerKey(req.dedupeKey);
  if (existing) {
    /* Idempotent: the milestone already notified this cap table. Reported as a
       duplicate rather than silently succeeding, so a caller (or a test) can
       tell "already sent" from "sent now". */
    return {
      ok: true,
      id: existing.id,
      deliveredInApp: existing.deliveredInApp ?? 0,
      duplicate: true,
    };
  }
  const bc = createBroadcast(
    {
      companyId: req.companyId,
      segmentKind: "all",
      body: req.body,
      trigger: req.trigger,
      autoTriggerKey: req.dedupeKey,
    },
    req.actorUserId,
  );
  return { ok: true, id: bc.id, deliveredInApp: bc.deliveredInApp ?? 0, duplicate: false };
}

export function registerMilestoneBroadcastRoutes(app: Express): void {
  /* WAVE 17 ORP-044 — arm the auto-triggers. Registration lives HERE, not in a
     separate boot step, so the dispatcher exists wherever the broadcast routes
     exist; there is nothing to forget to call. */
  registerMilestoneAutoDispatcher(dispatchAutoBroadcast);

  app.get("/api/founder/broadcasts", (req: Request, res: Response) => {
    const companyId = req.query.companyId ? String(req.query.companyId) : undefined;
    /* v25.11 NC2 — the previous GET had no ownership check, so any caller
     * could read any company's broadcasts. Require auth + ownership when
     * companyId is supplied; admins see everything. */
    const ctx = (req as any).userContext;
    if (!ctx?.isAuthed) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    if (companyId && !_callerOwnsCompany(req, companyId)) {
      return res.status(403).json({ ok: false, error: "not_founder_of_company" });
    }
    res.json({ items: listBroadcasts({ companyId }) });
  });

  app.post("/api/founder/broadcasts", (req: Request, res: Response) => {
    const parsed = broadcastCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "validation", details: parsed.error.flatten() });
    const actor = String((req as any).userContext?.userId ?? ""); /* v14 */ if (!actor) return res.status(401).json({ ok: false, error: "missing_identity" });
    /* v25.11 NC2 — the previous handler accepted any companyId without
     * verifying caller ownership, so any authenticated user could broadcast as
     * any founder. Enforce ownership here. */
    if (!_callerOwnsCompany(req, parsed.data.companyId)) {
      return res.status(403).json({ ok: false, error: "not_founder_of_company" });
    }
    const bc = createBroadcast(parsed.data, actor);
    res.status(201).json(bc);
  });
}
